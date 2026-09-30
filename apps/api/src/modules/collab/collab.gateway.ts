import { Injectable, Logger, Optional, Inject, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Server } from '@hocuspocus/server';
import type { Document, onAuthenticatePayload, onDisconnectPayload, onLoadDocumentPayload, onStoreDocumentPayload } from '@hocuspocus/server';
import { Redis as RedisExtension } from '@hocuspocus/extension-redis';
import Redis from 'ioredis';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSessionToken } from '../../common/utils/parse-session-token';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabRedisSync } from './collab-redis-sync.service';
import { yjsStoreAppendFailureTotal, yjsStoreCompactFailureTotal, yjsStoreDrainTotal, yjsUnflushedProjects } from './store.metrics';
import { CollabAuthReason, type CollabAuthReasonCode } from '@flowweb/shared';

export const COMPACT_THRESHOLD = 32;

/** 批0b：孤儿影子 GC 年龄阈值（服务端所有权，R32）——shadow id 内嵌时间戳
 *  （video-project.service.ts:93），删除失败/响应丢失从未进投影的影子按 7 天清出。
 *  批 5 删信箱后本机制随行消失。 */
const SHADOW_TTL_MS = 7 * 24 * 3600 * 1000;

/** pending 队列计数封顶：折叠后恰剩 1 条、需再积 64 条才复发（字节阈值会"折完仍超限→每条 update
 *  全量重编码"——实测 3000 条积压 4.8s vs 计数 103ms 同步阻塞 WS 消息路径）。模块级 const，无测试缝、
 *  无外部消费者（绿9/9b 靠推 70 条触发，不引用常量）——不 export。 */
const PENDING_MAX_ENTRIES = 64;

export function parseProjectId(documentName: string): string {
  return documentName.replace(/^project:/, '');
}

@Injectable()
export class CollabGateway implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CollabGateway.name);
  readonly server: Server;
  /** 每文档待落库增量队列。键为 doc 实例（生产中同文档名同实例）；数组身份在 doc 生命周期内恒定——
   *  一切变更只允许原地 push/splice/unshift，禁止任何 set 替换/重绑定（不变量 6：断引用 = 失败回灌写孤儿数组） */
  private readonly pendingUpdates = new WeakMap<Y.Doc, Uint8Array[]>();
  /** 重放抑制：只包裹每个 applyReplayed 的同步段（yjs update 事件在事务清理期同步发放——实测重放行与
   *  pendingDs 延迟整合均在 apply 同步栈内发放、被精确抑制；await 窗口内写入不被抑制、进 pending） */
  private readonly replaying = new WeakSet<Y.Doc>();
  /** flush 失败兜底：projectId → 未落库合并行（跨 doc 卸载存活；进程重启丢失=既有接受项）。
   *  单行存续，追加即 mergeUpdates 收敛（有界）。禁止 drop：Yjs 缺失 struct 会悬挂 pendingStructs。
   *  变更只经 takeStash/putStash（内部维护 gauge） */
  private readonly unflushed = new Map<string, Uint8Array>();
  readonly hooks: {
    onAuthenticate: (p: onAuthenticatePayload) => Promise<any>;
    onLoadDocument: (p: onLoadDocumentPayload) => Promise<any>;
    onStoreDocument: (p: onStoreDocumentPayload) => Promise<boolean>;
    onDisconnect: (p: onDisconnectPayload) => Promise<void>;
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly repo: CanvasDocUpdateRepository,
    private readonly redisSync: CollabRedisSync,
    private readonly perm: ProjectPermissionService,
    @Optional() @Inject('COLLAB_PORT') port?: number,
    @Optional() @Inject('COLLAB_DEBOUNCE') debounce?: number,
  ) {
    this.hooks = {
      onAuthenticate: (p) => this.authenticate(p),
      onLoadDocument: (p) => this.loadDocument(p),
      onStoreDocument: (p) => this.storeDocument(p),
      onDisconnect: (p) => this.disconnect(p),
    };
    this.server = new Server({
      port: port ?? (Number(process.env.COLLAB_PORT) || 3001),
      debounce: debounce ?? 5000,
      maxDebounce: 10000,
      onAuthenticate: this.hooks.onAuthenticate,
      onLoadDocument: this.hooks.onLoadDocument,
      onStoreDocument: this.hooks.onStoreDocument,
      onDisconnect: this.hooks.onDisconnect,
      extensions: [
        // v4.6.0 无 url 选项——createClient 直建 ioredis（吃 REDIS_URL，pub/sub 各一连接）
        // disconnectDelay 默认 1000ms 使每次直连 disconnect 固定 +2s（afterStoreDocument/beforeUnloadDocument 各等一次），
        // withDoc 每调用一断——压到 200ms：本地 Redis 发布 <10ms，Postgres 权威持久化兼作兜底
        new RedisExtension({
          createClient: () => new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379/0'),
          disconnectDelay: 200,
        }),
      ],
    });
  }

  /** 鉴权：session 直查 DB（BetterAuth getSession 在 NestJS 上下文失效——auth.service 同结论）；
   *  token 来自 WS 握手 query（测试/工具）或 httpOnly cookie（浏览器自动携带）；
   *  spec 1.2：VIEWER 连接置 readOnly，Hocuspocus 拒绝其写更新。
   *  批3-1：拒绝一律带 reason（Object.assign 附着——Hocuspocus catch 直读 error.reason 写入
   *  permission-denied 消息，客户端 authenticationFailed 原样收到）；已分型异常原样 rethrow，
   *  其余（DB 抖动等未打标）一律折成 db-unavailable（瞬态桶，契约锁㉙） */
  private async authenticate({ requestHeaders, requestParameters, documentName, connectionConfig }: onAuthenticatePayload) {
    const deny = (reason: CollabAuthReasonCode, message: string) => Object.assign(new Error(message), { reason });
    try {
      const token = requestParameters?.get('token')
        ?? parseSessionToken(requestHeaders?.get('cookie'));
      const session = token
        ? await this.prisma.session.findUnique({ where: { token }, include: { user: true } })
        : null;
      if (!session) throw deny(CollabAuthReason.UNAUTHENTICATED, '未登录');
      if (session.expiresAt < new Date()) throw deny(CollabAuthReason.SESSION_EXPIRED, '会话过期');
      const projectId = parseProjectId(documentName);
      const project = await this.prisma.canvasProject.findUnique({
        where: { id: projectId },
        select: { teamId: true },
      });
      if (!project) throw deny(CollabAuthReason.NOT_FOUND, '项目不存在');
      const member = await this.prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: project.teamId, userId: session.user.id } },
      });
      if (!member) throw deny(CollabAuthReason.FORBIDDEN, '非团队成员');
      const projectRole = await this.perm.resolve(projectId, session.user.id);
      const readOnly = projectRole === 'PROJECT_VIEWER';
      // v4 运行时只读机制：onAuthenticate 返回值仅 merge 进 context，须置 connectionConfig
      // （setUpNewConnection 以它构造 Connection，写更新按 connection.readOnly 拒绝）
      if (readOnly) connectionConfig.readOnly = true;
      return { user: { id: session.user.id, name: session.user.name, role: member.role }, readOnly };
    } catch (err) {
      if (err instanceof Error && (err as Error & { reason?: CollabAuthReasonCode }).reason) throw err;   // 已分型原样透传
      throw Object.assign(new Error(`db unavailable: ${(err as Error).message}`), { reason: CollabAuthReason.DB_UNAVAILABLE });
    }
  }

  /** spec 2.3：快照 + 增量按 (projectId, seq ASC) 重放。
   *  承重细节（spec v4 不变量 5/6，勿"简化"）：
   *  - 监听注册必须在第一个 await 之前——否则 DB 往返窗口内的写入静默漏收；
   *  - 禁止改用框架 onChange：document.onUpdate 在本 hook 返回后才注册，syncFromPeers 的更新永不触发 onChange；
   *  - replaying 抑制只包裹每个 applyUpdate 的同步段（yjs update 事件在事务清理期同步发放，不漏不误放），不跨 await；
   *  - stash 回灌必须在抑制窗口外：stash 是未落库变更，apply → update 事件 → pending → 下次 store 落库，
   *    禁止只 apply 不入队（等于二次蒸发）；
   *  - 不 return document：Hocuspocus 对 undefined no-op（doc 已就地填充）。
   *  批3-1：主体整体 try/catch——DB 异常统一折成 db-unavailable（带 reason 抛出），否则被库
   *  折成裸 permission-denied（F6：客户端无从分型瞬态/终态）。 */
  private async loadDocument({ document, documentName }: onLoadDocumentPayload) {
    const projectId = parseProjectId(documentName);
    try {
      if (!this.pendingUpdates.has(document)) {   // 防重复注册（行数翻倍）；has ⟺ 已注册（单状态源）
        this.pendingUpdates.set(document, []);    // eager 建条目：条目缺失 ⟺ 监听未注册（storeDocument/监听器双向 tripwire）
        document.on('update', (u: Uint8Array) => {
          if (this.replaying.has(document)) return;
          const q = this.pendingUpdates.get(document);
          if (!q) { this.logger.error(`update for untracked doc ${documentName}: dropped`); return; }
          q.push(u);
          // 原地封顶（禁 set 新数组——数组身份恒定）。计数阈值：折叠后恰剩 1 条需再积 64 条才复发；
          // 字节阈值会"折完仍超限→每条 update 全量重编码"（3000 条积压实测 4.8s vs 103ms 同步阻塞）
          if (q.length > PENDING_MAX_ENTRIES) q.splice(0, q.length, Y.mergeUpdates(q));
        });
      }
      const applyReplayed = (u: Uint8Array) => {
        this.replaying.add(document);
        try { Y.applyUpdate(document, u); } finally { this.replaying.delete(document); }
      };
      const docRow = await this.prisma.canvasDoc.findUnique({ where: { projectId } });
      if (docRow) applyReplayed(new Uint8Array(docRow.state));
      for (const u of await this.repo.loadUpdates(projectId)) applyReplayed(new Uint8Array(u));
      const stash = this.takeStash(projectId);
      if (stash) Y.applyUpdate(document, stash);  // 窗口外回灌：事件进 pending。stash 落库时点=下一次读/写/断连（非显式 flush），出口有二：本处 load 回灌 / storeDocument 取批前 drain
      await this.redisSync.syncFromPeers(documentName, document, 1000);  // 对等更新进 pending（冗余落库策略）
      this.sweepDocument(document);   // 批0b：短会话的有效触发点——钩子尾对当前 doc 顺手扫一次（与定时器共用同一段检查）
    } catch (err) {
      if (err instanceof Error && (err as Error & { reason?: CollabAuthReasonCode }).reason) throw err;
      throw Object.assign(new Error(`db unavailable: ${(err as Error).message}`), { reason: CollabAuthReason.DB_UNAVAILABLE });
    }
  }

  /** 批0b 定时兜底：1h interval——短会话撞定时器概率≈0（24h×短会话），加载时点单查才是有效触发 */
  private shadowSweepTimer: ReturnType<typeof setInterval> | null = null;
  private startShadowSweep() {
    this.shadowSweepTimer = setInterval(() => void this.sweepAgedShadows().catch((e) => this.logger.warn(`shadow sweep: ${e}`)), 60 * 60 * 1000);
    this.shadowSweepTimer.unref?.();
  }

  /** 与定时器共用同一段检查：只删 id 时间戳超龄的影子（regex 不匹配的旧形状保守不动），
   *  transact 使删除产生 delete set（经 update 监听进 pending → 持久化/广播） */
  private sweepDocument(document: Document) {
    const nodesMap = document.getMap('nodes');
    const stale = [...nodesMap.keys()].filter((id) => {
      if (!id.startsWith('shadow-')) return false;
      const m = /^shadow-[a-z]+-(\d+)-/.exec(id);
      return !!m && Date.now() - Number(m[1]) > SHADOW_TTL_MS;
    });
    if (stale.length) document.transact(() => { for (const id of stale) nodesMap.delete(id); });
  }

  private async sweepAgedShadows() {
    for (const [, document] of this.server.hocuspocus.documents) this.sweepDocument(document);
  }

  /** unflushed 唯一出入口（内部维护 gauge，防指标与 Map 漂移） */
  private takeStash(projectId: string): Uint8Array | undefined {
    const s = this.unflushed.get(projectId);
    if (s !== undefined) this.unflushed.delete(projectId);
    yjsUnflushedProjects.set(this.unflushed.size);
    return s;
  }

  private putStash(projectId: string, payload: Uint8Array): void {
    const prev = this.unflushed.get(projectId);
    this.unflushed.set(projectId, prev ? Y.mergeUpdates([prev, payload]) : payload);   // 单行存续，追加即合并收敛（有界）
    yjsUnflushedProjects.set(this.unflushed.size);
  }

  /** 变更驱动落库（spec v4）：从 pending 队列取批 mergeUpdates 单行 append。
   *  硬规矩：本方法内不允许存在无日志、无指标、无抛错的提前 return（本次事故的系统性教训）。
   *  禁止任何"SV 相等 / diff 为空 ⇒ 无变化 ⇒ 跳过 append"判等——删除不产生新 struct、SV 零变化、
   *  语义相同 doc 双向 diff 恒非空（本次事故根因，实测钉死）。 */
  private async storeDocument({ document, documentName }: Pick<onStoreDocumentPayload, 'document' | 'documentName'>): Promise<boolean> {
    const projectId = parseProjectId(documentName);
    const queue = this.pendingUpdates.get(document);
    if (!queue) {
      this.logger.error(`store for unobserved doc ${documentName}: listener never registered`);  // tripwire：!lastSV 同构物不得静默
      return false;
    }
    const stash = this.takeStash(projectId);
    if (stash) queue.unshift(stash);  // 提前 drain：WS 断连后 doc 驻留缓存不重载时的唯一出口；与 load 路径不双投（takeStash 已 delete）
    if (queue.length === 0) { yjsStoreDrainTotal.inc({ result: 'noop' }); return false; }  // 真·无变化不落行（readCanvas/断连的无条件触发零写放大）
    const batch = queue.splice(0);   // 同步原子取走（splice 先于任何 await——Skip 路径下 destroy 与 flush 并发，flush 不得依赖 doc 存活）
    const payload = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
    try {
      await this.repo.append(projectId, payload);   // 单行原子：全有或全无
    } catch (err) {
      const live = this.pendingUpdates.get(document);   // 跨 await 后重新 get（防御：原地封顶下 live===queue，不等=有人违反不变量 6）
      if (live !== queue) this.logger.error(`pending queue identity changed for ${documentName}`);
      (live ?? queue).unshift(payload);                 // 回灌合并行（单项）；队列保留 → 下次 store 重试
      this.logger.error(`store append failed for ${projectId}, ${batch.length} updates retained: ${(err as Error).message}`);
      yjsStoreAppendFailureTotal.inc();
      throw err;   // hook 链由 Hocuspocus catch（"Document stays in memory"），doc 留内存重试
    }
    yjsStoreDrainTotal.inc({ result: 'appended' });
    try {
      if (await this.repo.count(projectId) >= COMPACT_THRESHOLD) await this.repo.compact(projectId);
    } catch (err) {
      // compact 是优化不是不变量载体：行已落库，失败只 WARN 绝不抛——否则被 Hocuspocus 当 store 失败 → doc 永不卸载 → destroy 挂死
      yjsStoreCompactFailureTotal.inc();
      this.logger.warn(`compact failed for ${projectId} (rows already durable): ${(err as Error).message}`);
    }
    return true;
  }

  /** 最后连接断开：flush →（写了才）compact。
   *  绝不抛出（覆盖含 redlock Skip 在内的全部路径，spec v4）：onDisconnect 是 onClose 的 async 回调、
   *  注册方 forEach 不 await——抛错 = unhandled rejection = 进程退出；DirectConnection 路径是 await 的，
   *  抛错冒泡出 withDoc finally → API 500 → 前端重试 → 重复插入。Skip 路径下 saveMutex 在回调抛错时
   *  先释放 → onDisconnect 一定被调用 → 本契约面更宽。 */
  private async disconnect({ document, documentName }: onDisconnectPayload) {
    if (document.getConnectionsCount() > 0) return;
    const projectId = parseProjectId(documentName);
    try {
      const wrote = await this.storeDocument({ document, documentName });
      if (wrote) {
        try {
          await this.repo.compact(projectId);   // 会话结束收敛增量行；没写就不 compact（消除每次 readCanvas 全量 compact）
        } catch (err) {
          yjsStoreCompactFailureTotal.inc();
          this.logger.warn(`final compact failed for ${projectId}: ${(err as Error).message}`);   // 行已落库，非 flush 失败
        }
      }
    } catch (err) {
      this.stashPending(document, projectId, err as Error);   // 只兜 flush（append）失败
    }
  }

  /** flush 失败兜底：pending 转移到 projectId 键控 Map（跨 doc 卸载存活）——doc 卸载不再等于数据蒸发 */
  private stashPending(document: Y.Doc, projectId: string, error: Error) {
    const q = this.pendingUpdates.get(document);
    let retained = 0;
    if (q?.length) {
      const batch = q.splice(0);
      retained = batch.length;
      const payload = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
      this.putStash(projectId, payload);
    }
    this.logger.error(`collab flush failed for ${projectId}, ${retained} updates stashed for next load: ${error.message}`);
  }

  onModuleInit() {
    // 跨实例同步：仅回复本实例已打开的文档（Document extends Y.Doc，内存态最新）
    this.redisSync.getDocument = (name) => this.server.hocuspocus.documents.get(name);
    this.server.listen();
    this.startShadowSweep();   // 批0b：孤儿影子定时兜底（有效触发点是 onLoadDocument 尾顺手扫）
    // I3/M2：解散事件到达时 projects 可能已删——按 payload.projectIds 关连接，不查库
    this.eventEmitter.on('team.disbanded', (payload: { teamId: string; projectIds: string[] }) => {
      this.closeTeamDocuments(payload.projectIds);
    });
  }

  async onApplicationShutdown() {
    if (this.shadowSweepTimer) { clearInterval(this.shadowSweepTimer); this.shadowSweepTimer = null; }
    await this.server.destroy();
  }

  closeTeamDocuments(projectIds: string[]) {
    for (const projectId of projectIds) {
      try {
        this.server.hocuspocus.closeConnections(`project:${projectId}`);
      } catch (err) {
        this.logger.warn(`closeConnections failed for ${projectId}: ${(err as Error).message}`);
      }
    }
  }
}
