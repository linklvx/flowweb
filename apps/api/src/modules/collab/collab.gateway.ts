import { Injectable, Logger, Optional, Inject, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Server } from '@hocuspocus/server';
import type { onAuthenticatePayload, onDisconnectPayload, onLoadDocumentPayload, onStoreDocumentPayload } from '@hocuspocus/server';
import { Redis as RedisExtension } from '@hocuspocus/extension-redis';
import Redis from 'ioredis';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSessionToken } from '../../common/utils/parse-session-token';
import { SessionService } from '../../auth/session.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabRedisSync } from './collab-redis-sync.service';
import { collabSweepCloseTotal, yjsCanvasDocBytes, yjsStoreAppendFailureTotal, yjsStoreCompactFailureTotal, yjsStoreDrainTotal, yjsUnflushedProjects } from './store.metrics';
import { CollabAuthReason, CANVAS_DOC_SCHEMA_VERSION, ensureSchemaVersion, stampDocSchema, type CollabAuthReasonCode } from '@flowweb/shared';
import { toDocLike } from './doc-like.util';

/** 批3-4：compact 门限由行数（原 COMPACT_THRESHOLD=32）改时间门限——debounce 收紧（5s→1/2s）会让
 *  行数门限的 compact 频率同步放大（advisory lock+重放+deleteMany 成本不低）。loadDocument 播种
 *  基线，距上次 compact ≥60s 才再 compact（env COMPACT_INTERVAL_MS 可调）。 */
export const COMPACT_INTERVAL_MS = Number(process.env.COMPACT_INTERVAL_MS) || 60_000;

/** 批3-4：COLLAB_DEBOUNCE 接线——显式注入（测试缝）> env > dev 1000 / prod 2000（原硬编码 5000
 *  收紧——连续编辑丢失窗口 prod ≤3s 闭环）；maxDebounce 写死 ≤ debounce×1.5（独立配置则窗口仍为旧值）。 */
export function resolveCollabDebounce(explicit?: number): number {
  if (explicit && explicit > 0) return explicit;
  const fromEnv = Number(process.env.COLLAB_DEBOUNCE);
  if (fromEnv > 0) return fromEnv;
  return process.env.NODE_ENV === 'development' ? 1000 : 2000;
}

/** 批3-4 persist-status 退避梯：doc 级（活 doc 队列再 flush）+ stash 级（projectId 直写）两阶段，
 *  5 次 ≈53s 耗尽后数据留队/stash——下次 load 回灌兜底（既有契约）仍在。 */
const PERSIST_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 15_000, 30_000];
/** 批3-4 sweep 轮询与 grace 窗 */
const SESSION_SWEEP_INTERVAL_MS = 60_000;
const SESSION_SWEEP_GRACE_MS = 5_000;

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
  /** 批3-3：session 查询/滑动续期统一入口（手写 findUnique 收口；直构测试不传时以注入的 prisma 兜底自建） */
  private readonly sessionSvc: SessionService;
  /** 批3-4：compact 时间门限基线（projectId → 上次 compact 时点；loadDocument 播种） */
  private readonly lastCompactAt = new Map<string, number>();
  /** 批3-4 doc epoch（R1c 前置物）：doc 实例代际——服务端 WeakMap 而非写 ydoc meta（meta 内容
   *  会随 doc 状态进 canonical 重放等价判据〔不变量 1〕，不持久化的 meta 字段会伪红全组契约；
   *  且持久化形态下重启换代会让每次 load 平添一行增量——破零写放大契约） */
  private readonly docEpoch = new WeakMap<Y.Doc, number>();
  /** 批3-4 persist-status：unhealthy 电平（documentName 键）+ 有界退避台账 + 已补推连接去重 */
  private readonly persistUnhealthy = new Set<string>();
  private readonly persistRetry = new Map<string, { rung: number; timer: ReturnType<typeof setTimeout> | null }>();
  private readonly persistStatusPushed = new WeakSet<object>();
  /** retryPersist 内层 storeDocument 不再自排定时器（梯子推进只归 retryPersist——否则档位取值错档） */
  private retryingPersist = false;
  /** 批3-4 sweep：grace 在途去重 + 连续复验失败计数（WeakMap/WeakSet——连接回收即散） */
  private readonly sweepGrace = new WeakSet<object>();
  private readonly sweepRecheckFails = new WeakMap<object, number>();
  private sessionSweepTimer: ReturnType<typeof setInterval> | null = null;
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
    @Optional() @Inject('COLLAB_TIMEOUT') timeout?: number,
    @Optional() @Inject(SessionService) sessions?: SessionService,
  ) {
    this.sessionSvc = sessions ?? new SessionService(prisma);
    this.hooks = {
      onAuthenticate: (p) => this.authenticate(p),
      onLoadDocument: (p) => this.loadDocument(p),
      onStoreDocument: (p) => this.storeDocument(p),
      onDisconnect: (p) => this.disconnect(p),
    };
    const debounceMs = resolveCollabDebounce(debounce);
    this.server = new Server({
      port: port ?? (Number(process.env.COLLAB_PORT) || 3001),
      debounce: debounceMs,
      maxDebounce: Math.ceil(debounceMs * 1.5),
      // 批3-4 COLLAB_TIMEOUT：双语义——同一值既驱动握手/空闲超时，也驱动 ClientConnection 的
      // 检查周期（库构造 setInterval(check, timeout)）——注入小值测 60s 死线时两者一起变小
      timeout: timeout ?? (Number(process.env.COLLAB_TIMEOUT) || 30_000),
      // 批3-2：库默认 stopOnSignals:true 在 listen() 注册信号 handler → destroy 后 process.exit(0)
      // 抢跑 Nest drain 链（hocuspocus-server.esm.js:1684-1690）——信号统一交 app.enableShutdownHooks()
      stopOnSignals: false,
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
   *  其余（DB 抖动等未打标）一律折成 db-unavailable（瞬态桶，契约锁㉙）。
   *  批3-3：session 查询统一走 SessionService.touchWithReason——age>updateAge(1d) 的活跃连接
   *  顺带续期 7d（WS 路径只能 touch DB）；context 携带 token/sessionExpiresAt 供批3-4 sweep 复验。 */
  private async authenticate({ requestHeaders, requestParameters, documentName, connectionConfig }: onAuthenticatePayload) {
    const deny = (reason: CollabAuthReasonCode, message: string) => Object.assign(new Error(message), { reason });
    try {
      const token = requestParameters?.get('token')
        ?? parseSessionToken(requestHeaders?.get('cookie'));
      if (!token) throw deny(CollabAuthReason.UNAUTHENTICATED, '未登录');
      const { session, expired } = await this.sessionSvc.touchWithReason(token);
      if (!session) throw deny(expired ? CollabAuthReason.SESSION_EXPIRED : CollabAuthReason.UNAUTHENTICATED, expired ? '会话过期' : '未登录');
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
      // 批3-4：unhealthy 电平期的新连接补推 persist-status（onAuthenticate payload 无 connection——
      // v4 形状，延迟到本 tick 后连接已注册进 document.connections）
      if (this.persistUnhealthy.has(documentName)) {
        const t = setTimeout(() => this.pushPersistStatus(documentName), 500);
        t.unref?.();
      }
      return {
        user: { id: session.user.id, name: session.user.name, role: member.role },
        readOnly,
        token,   // 批3-4 sweep 复验凭据（context 只在服务端内存，不外发）
        sessionExpiresAt: session.expiresAt,   // 批3-4 sweep 死线快照（必过期下界）
      };
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
   *  折成裸 permission-denied（F6：客户端无从分型瞬态/终态）。
   *  O0b-0 版本门 v2.1：唯一戳源=本 hook——replay 完成后四档门（戳=2 放行 no-op / 无戳∧零节点
   *  ⇒ stamp 自愈〔update 进 pending 落库——每 doc 至多一次幂等戳〕/ 戳=1 或 无戳∧有节点 ⇒ 拒
   *  〔logger.error+throw——DEV 抛/prod 拒+日志同条件不分路径（终裁 92 防鬼影）；throw 由
   *  Hocuspocus 折成连接错误拒绝载入该 doc，非崩溃进程〕）。 */
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
      // 批3-4 doc epoch（R1c 前置物）：本 doc 实例代际播种（WeakMap——见字段注记）
      if (!this.docEpoch.has(document)) this.docEpoch.set(document, Date.now());
      // 批3-4：compact 时间门限基线播种（首次 load 起算 60s 窗）
      if (!this.lastCompactAt.has(projectId)) this.lastCompactAt.set(projectId, Date.now());
      const docRow = await this.prisma.canvasDoc.findUnique({ where: { projectId } });
      if (docRow) {
        yjsCanvasDocBytes.set({ projectId }, docRow.state.length);   // 批3-4：快照字节播种
        applyReplayed(new Uint8Array(docRow.state));
      }
      for (const u of await this.repo.loadUpdates(projectId)) applyReplayed(new Uint8Array(u));
      const stash = this.takeStash(projectId);
      if (stash) Y.applyUpdate(document, stash);  // 窗口外回灌：事件进 pending。stash 落库时点=下一次读/写/断连（非显式 flush），出口有二：本处 load 回灌 / storeDocument 取批前 drain
      await this.redisSync.syncFromPeers(documentName, document, 1000);  // 对等更新进 pending（冗余落库策略）
      // O0b-0 版本门 v2.1（判据单源=shared ensureSchemaVersion——本处只留 stamp 自愈分支+拒绝日志+
      // refusal 标记；replay 完成后同步判，stamp 的 update 不在 replaying 抑制窗内 → 进 pending →
      // 下次 store 落库）
      const nodeCount = [...document.getMap('nodes').keys()].length;
      try {
        ensureSchemaVersion(toDocLike(document));
      } catch (e) {
        this.logger.error(`[O0b-0] 版本门拒绝载入 ${documentName}：${(e as Error).message}（${nodeCount} 节点）`);
        // schemaRefusal 标记：外层 catch 透传（版本门拒≠db-unavailable——不折瞬态桶）
        throw Object.assign(e as Error, { schemaRefusal: true });
      }
      if (document.getMap('meta').get('schemaVersion') !== CANVAS_DOC_SCHEMA_VERSION) {
        stampDocSchema(toDocLike(document));   // 无戳∧零节点 ⇒ stamp 唯一自愈点（新建空画布合法档——门对该档放行后仅存此档）
      }
    } catch (err) {
      if ((err as { schemaRefusal?: boolean })?.schemaRefusal) throw err;
      if (err instanceof Error && (err as Error & { reason?: CollabAuthReasonCode }).reason) throw err;
      throw Object.assign(new Error(`db unavailable: ${(err as Error).message}`), { reason: CollabAuthReason.DB_UNAVAILABLE });
    }
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
      // 批3-4：unhealthy 转折广播 + 有界退避重试（retryPersist 内层调用不排梯——档位推进归 retryPersist）
      this.setPersistStatus(documentName, false);
      if (!this.retryingPersist) this.schedulePersistRetry(documentName);
      throw err;   // hook 链由 Hocuspocus catch（"Document stays in memory"），doc 留内存重试
    }
    yjsStoreDrainTotal.inc({ result: 'appended' });
    yjsCanvasDocBytes.inc({ projectId }, payload.byteLength);   // 批3-4：增量字节累加
    this.cancelPersistRetry(documentName);   // 批3-4：成功即撤销退避定时器（有机 store 关闭重试）
    this.setPersistStatus(documentName, true);
    try {
      await this.maybeCompact(projectId);
    } catch (err) {
      // compact 是优化不是不变量载体：行已落库，失败只 WARN 绝不抛——否则被 Hocuspocus 当 store 失败 → doc 永不卸载 → destroy 挂死
      yjsStoreCompactFailureTotal.inc();
      this.logger.warn(`compact failed for ${projectId} (rows already durable): ${(err as Error).message}`);
    }
    return true;
  }

  /** 批3-4：compact 时间门限（≥COMPACT_INTERVAL_MS 一档；基线 load 播种、compact 后重置） */
  private async maybeCompact(projectId: string): Promise<void> {
    const last = this.lastCompactAt.get(projectId);
    if (last !== undefined && Date.now() - last < COMPACT_INTERVAL_MS) return;
    await this.repo.compact(projectId);
    this.lastCompactAt.set(projectId, Date.now());
  }

  /** 批3-4 persist-status：成功/失败转折点广播（只在电平翻转时发——重试期重复失败不刷屏；
   *  客户端只驱动横幅/诊断，不进 hasUnsavedWork——拦截⇒不断开⇒废掉断开 flush 兜底）。 */
  private setPersistStatus(documentName: string, healthy: boolean) {
    if (healthy) {
      if (!this.persistUnhealthy.delete(documentName)) return;   // 无转折不广播
    } else {
      if (this.persistUnhealthy.has(documentName)) return;   // 已 unhealthy：重复失败非转折
      this.persistUnhealthy.add(documentName);
    }
    const document = this.server.hocuspocus.documents.get(documentName);
    if (!document) return;   // doc 已卸载：无观察者，只维护电平（重连后补推/下次转折覆盖）
    try {
      document.broadcastStateless(JSON.stringify({ type: 'persist-status', healthy }));
      for (const connection of document.connections.keys()) this.persistStatusPushed.add(connection);
    } catch (err) {
      this.logger.warn(`persist-status broadcast failed for ${documentName}: ${(err as Error).message}`);
    }
  }

  /** 批3-4：unhealthy 电平期新连接补推（authenticate 后延迟半秒——连接注册完成的保守窗口） */
  private pushPersistStatus(documentName: string) {
    if (!this.persistUnhealthy.has(documentName)) return;
    const document = this.server.hocuspocus.documents.get(documentName);
    if (!document) return;
    const payload = JSON.stringify({ type: 'persist-status', healthy: false });
    for (const connection of [...document.connections.keys()]) {
      if (this.persistStatusPushed.has(connection)) continue;
      try { connection.sendStateless(payload); this.persistStatusPushed.add(connection); }
      catch (err) { this.logger.warn(`persist-status push failed for ${documentName}: ${(err as Error).message}`); }
    }
  }

  private schedulePersistRetry(documentName: string) {
    const entry = this.persistRetry.get(documentName) ?? { rung: 0, timer: null };
    if (entry.timer) return;   // 已排程（失败叠加不提前触发）
    if (entry.rung >= PERSIST_RETRY_DELAYS_MS.length) return;   // 梯子耗尽：等有机 store / 下次 load 回灌
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.retryPersist(documentName);
    }, PERSIST_RETRY_DELAYS_MS[entry.rung]);
    entry.timer.unref?.();
    this.persistRetry.set(documentName, entry);
  }

  private cancelPersistRetry(documentName: string) {
    const entry = this.persistRetry.get(documentName);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.persistRetry.delete(documentName);
  }

  /** 批3-4 有界退避重试（F2 接入点）：doc 级（活 doc 队列再 flush）→ stash 级（doc 已卸载，
   *  projectId 直写 unflushed 台账）两阶段；成功广播 healthy、耗尽留队（下次 load 回灌兜底仍在）。 */
  private async retryPersist(documentName: string) {
    const entry = this.persistRetry.get(documentName);
    if (!entry) return;
    const projectId = parseProjectId(documentName);
    const document = this.server.hocuspocus.documents.get(documentName);
    try {
      if (document && (this.pendingUpdates.get(document)?.length ?? 0) > 0) {
        this.retryingPersist = true;
        try {
          await this.storeDocument({ document, documentName });   // doc 级：doc 仍被观察且队列非空
        } finally {
          this.retryingPersist = false;
        }
      } else {
        const stash = this.takeStash(projectId);   // stash 级：doc 不活/队列空（tripwire 同源判定）
        if (!stash) { this.cancelPersistRetry(documentName); return; }   // 无可重试（已被 drain）
        await this.repo.append(projectId, stash);
      }
      this.cancelPersistRetry(documentName);
      this.setPersistStatus(documentName, true);
    } catch (err) {
      entry.rung += 1;
      this.logger.error(`persist retry ${entry.rung}/${PERSIST_RETRY_DELAYS_MS.length} failed for ${projectId}: ${(err as Error).message}`);
      if (entry.rung >= PERSIST_RETRY_DELAYS_MS.length) {
        this.cancelPersistRetry(documentName);
        this.logger.error(`persist retry exhausted for ${projectId}; updates retained (recovered on next load)`);
        return;
      }
      this.schedulePersistRetry(documentName);
    }
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
          await this.maybeCompact(projectId);   // 会话结束收敛增量行；没写就不 compact（消除每次 readCanvas 全量 compact）
        } catch (err) {
          yjsStoreCompactFailureTotal.inc();
          this.logger.warn(`final compact failed for ${projectId}: ${(err as Error).message}`);   // 行已落库，非 flush 失败
        }
      }
    } catch (err) {
      this.stashPending(document, projectId, err as Error);   // 只兜 flush（append）失败（storeDocument 已排退避）
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
    this.startSessionSweep();   // 批3-4：过期 session 连接清扫（灰度默认关——tick 内自检开关）
    // I3/M2：解散事件到达时 projects 可能已删——按 payload.projectIds 关连接，不查库
    this.eventEmitter.on('team.disbanded', (payload: { teamId: string; projectIds: string[] }) => {
      this.closeTeamDocuments(payload.projectIds);
    });
  }

  /** 批3-4：60s 一轮原生 interval（unref——进程退出不被阻）。灰度锚：COLLAB_SWEEP_ENABLED !== 'true'
   *  时 tick 首行即返（零行为差异：不查库不通知不关连接——旧客户端批 2 上线前不开，防 reason 盲区卡 connecting）。
   *  快照死线（context.sessionExpiresAt——authenticate 播种，必过期下界）命中后先 DB 复验
   *  （session+teamMember，移除成员也踢）；复验翻案（me 探活已续期）则刷新快照；确认 revoked →
   *  stateless 预通知 {type:'session-expiring'}（客户端 flushPendingUpdates）→ 5s grace →
   *  webSocket.close(4401)。禁 Connection.close——文档级 CLOSE 制造 L6 僵尸；close 调用处自行 catch。
   *  复验异常 fail-open，但连续 5 次（≈5min）仍关（无界 fail-open=安全债没真修）+ metric。 */
  private startSessionSweep() {
    this.sessionSweepTimer = setInterval(() => void this.sweepSessions().catch((e) => this.logger.warn(`session sweep: ${e}`)), SESSION_SWEEP_INTERVAL_MS);
    this.sessionSweepTimer.unref?.();
  }

  private async sweepSessions() {
    if (process.env.COLLAB_SWEEP_ENABLED !== 'true') return;   // 灰度锚：关=零行为差异
    for (const document of [...this.server.hocuspocus.documents.values()]) {
      for (const connection of [...document.connections.keys()]) {
        const ctx = (connection.context ?? {}) as { token?: string; sessionExpiresAt?: Date };
        const deadline = ctx.sessionExpiresAt;
        if (!(deadline instanceof Date) || deadline.getTime() > Date.now()) continue;   // 快照未过期：第一道闸
        if (this.sweepGrace.has(connection)) continue;   // 通知/grace 在途：去重
        try {
          const re = await this.recheckConnection(connection, document.name);
          this.sweepRecheckFails.delete(connection);   // 复验完成（无论结论）——连续失败计数复位
          if (!re.revoked) {
            if (re.expiresAt) ctx.sessionExpiresAt = re.expiresAt;   // 翻案：刷新死线快照（下轮按新死线）
            continue;
          }
          this.scheduleSweepClose(connection, 'revoked');
        } catch (err) {
          this.logger.warn(`sweep recheck failed for ${document.name}: ${(err as Error).message}`);
          const fails = (this.sweepRecheckFails.get(connection) ?? 0) + 1;
          this.sweepRecheckFails.set(connection, fails);
          if (fails >= 5) this.scheduleSweepClose(connection, 'db-fail');   // 5 连败仍关（≈5min 上限）
        }
      }
    }
  }

  /** 复验：复用 authenticate 同款查询（session → canvasProject → teamMember）。
   *  纯读（resolve 不续期——清扫面不得反向保活 session）。 */
  private async recheckConnection(connection: { context?: { token?: string } }, documentName: string): Promise<{ revoked: boolean; expiresAt: Date | null }> {
    const token = connection.context?.token;
    if (!token) return { revoked: false, expiresAt: null };
    const { session } = await this.sessionSvc.resolve(token);
    if (!session) return { revoked: true, expiresAt: null };   // 过期/登出（resolve 折叠两态）
    const projectId = parseProjectId(documentName);
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
      select: { teamId: true },
    });
    if (!project) return { revoked: true, expiresAt: null };
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId: session.userId } },
    });
    return { revoked: !member, expiresAt: session.expiresAt };
  }

  private scheduleSweepClose(connection: object & { sendStateless?: (p: string) => void; webSocket: { close: (code?: number, reason?: string) => void } }, cause: 'revoked' | 'db-fail') {
    if (this.sweepGrace.has(connection)) return;
    this.sweepGrace.add(connection);
    try { connection.sendStateless?.(JSON.stringify({ type: 'session-expiring' })); }
    catch (err) { this.logger.warn(`sweep pre-notice failed: ${(err as Error).message}`); }
    const grace = setTimeout(() => {
      this.sweepGrace.delete(connection);
      try {
        connection.webSocket.close(4401, 'session-expired');
        collabSweepCloseTotal.inc({ cause });
      } catch (err) {
        this.logger.warn(`sweep close failed: ${(err as Error).message}`);   // F11：webSocket.close 调用处自 catch
      }
    }, SESSION_SWEEP_GRACE_MS);
    grace.unref?.();
  }

  /** 批3-2：关停前对存活连接 close(1012, "service restart")——客户端据 code 按瞬态服务重启
   *  立即重连，不等 1006 盲区。先复制后关（[...map] 快照）：close 回调可能反噬集合
   *  （连接自清/异常路径），活迭代下漏关未访问项。单个失败各自吞（F11）不阻断其余。 */
  private closeAllConnections1012() {
    for (const document of [...this.server.hocuspocus.documents.values()]) {
      for (const connection of [...document.connections.keys()]) {
        try { connection.webSocket.close(1012, 'service restart'); }
        catch (err) { this.logger.warn(`close(1012) failed for ${document.name}: ${(err as Error).message}`); }
      }
    }
  }

  /** 批3-2：shutdown 有界化——destroy 与 8s 超时 race。无界形态下 ioredis 等保活句柄使
   *  destroy 永挂 → 进程退不出 → pm2 SIGKILL → stash 丢；超时分支点名内存 doc 数供对账。 */
  async onApplicationShutdown() {
    if (this.sessionSweepTimer) { clearInterval(this.sessionSweepTimer); this.sessionSweepTimer = null; }   // 批3-4：sweep 定时器随停
    for (const [name] of [...this.persistRetry]) this.cancelPersistRetry(name);   // 批3-4：退避定时器随停（stash 留待下次 load）
    this.closeAllConnections1012();
    let destroyed = false;
    const destroying = this.server.destroy()
      .then(() => { destroyed = true; })
      .catch((err) => { this.logger.warn(`collab server destroy failed: ${(err as Error).message}`); });   // 关停窗口禁 unhandled rejection
    await Promise.race([destroying, new Promise<void>((resolve) => { setTimeout(resolve, 8000).unref?.(); })]);
    if (!destroyed) {
      this.logger.warn(`collab server destroy timeout after 8s, ${this.server.hocuspocus.documents.size} docs still in memory (flush at risk)`);
    }
  }

  closeTeamDocuments(projectIds: string[]) {
    for (const projectId of projectIds) {
      const name = `project:${projectId}`;
      // 批3-4：先复制后关——库 closeConnections 走 Connection.close→removeConnection（活 Map 删键，
      // 不先复制则后续遍历漏连接）；且协议级 CLOSE 依赖客户端配合断开（不配合=connected 僵尸），
      // 逐连接补 webSocket.close 硬关兜底（单个失败各自吞——F11）
      const document = this.server.hocuspocus.documents.get(name);
      const connections = document ? [...document.connections.keys()] : [];
      try {
        this.server.hocuspocus.closeConnections(name);
      } catch (err) {
        this.logger.warn(`closeConnections failed for ${projectId}: ${(err as Error).message}`);
      }
      for (const connection of connections) {
        try { connection.webSocket.close(1000, 'team disbanded'); }
        catch (err) { this.logger.warn(`close webSocket failed for ${projectId}: ${(err as Error).message}`); }
      }
    }
  }
}
