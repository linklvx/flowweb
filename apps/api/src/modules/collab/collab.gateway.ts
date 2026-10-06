import { Injectable, Logger, Optional, Inject, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Server } from '@hocuspocus/server';
import type { afterStoreDocumentPayload, onAuthenticatePayload, onDisconnectPayload, onLoadDocumentPayload, onStoreDocumentPayload } from '@hocuspocus/server';
import { Redis as RedisExtension } from '@hocuspocus/extension-redis';
import Redis from 'ioredis';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSessionToken } from '../../common/utils/parse-session-token';
import { SessionService } from '../../auth/session.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabRedisSync } from './collab-redis-sync.service';
import { collabSweepCloseTotal, registerPendingCollector, unregisterPendingCollector, yjsCanvasDocBytes, storeInFlightDocs, yjsStoreAppendFailureTotal, yjsStoreCompactFailureTotal, yjsStoreDrainTotal, yjsStoreHookCallsTotal, yjsStoreTailAnomalyTotal, yjsUpdatesDiscardedDeletedTotal } from './store.metrics';
import { CollabSpoolService } from './collab-spool.service';
import { isFkGone } from './pg-error.util';
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

/** 批3-4 persist-status 退避梯（doc 级活 doc 队列再 flush+detached spool 帧通道两阶段）。
 *  Y0a-2（spec v2.4 §2.3）：退避**无上限**——spool 已保底（BOI），梯子只加速恢复，永不"耗尽"弃守；
 *  前 5 档 [1,2,5,15,30]s，rung≥5 恒 60s 封顶循环（锚 A5：库不补——重试由梯子自身永续承担）。 */
export function persistRetryDelayMs(rung: number): number {
  const table = [1_000, 2_000, 5_000, 15_000, 30_000];
  return rung < table.length ? table[rung] : 60_000;
}
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

/** ===== Y0a-2 持久化契约声明（spec v2.4 §2.1，钉死）=====
 *  PG=单实例 delta 并集日志（append-only）；CRDT 幂等收敛（重复/乱序 apply 安全）；锁只管 compact；
 *  内存 pending 队列=去抖窗口非持久层；spool 文件=store 故障期唯一权威待落库台账；
 *  onStoreDocument 任何路径不 throw（失败→spool→返回 false；自有 hook 抛错跳链=库锚 A1/A5 前提）。
 *  BOI（契约 §4.3-11）：任何批次任意时刻至少归属于 {doc 队列, spool 已 fsync, PG 已提交} 之一；
 *  离开旧归属必须先进入新归属——queue.splice 永远在新家落定之后。 */
@Injectable()
export class CollabGateway implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CollabGateway.name);
  readonly server: Server;
  /** Y0a-2（V4）：批次第一归属地=gateway 权威 Map（projectId 键控）——库 onClose 无条件卸载
   *  会销毁 Document 与一切 WeakMap 键控态；队列改自有 Map 后 doc 消亡≠批消失（P0-3）。
   *  数组身份恒定不变量沿用：一切变更只 push/splice，禁 set 替换。 */
  private readonly pendingQueues = new Map<string, Uint8Array[]>();
  /** doc→projectId 关联（loadDocument 播种；update 回调/stash 检查用）——doc 消亡仅失关联不失批 */
  private readonly docProject = new WeakMap<Y.Doc, string>();
  /** Y11：update 监听注册判定源（原 pendingUpdates.has 的"已注册"语义——V4 拆键后与队列条目解耦） */
  private readonly docListeners = new WeakSet<Y.Doc>();
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
  /** 审查 I-2：retryPersist 在飞标志改 per-documentName 集合——单布尔在 A 项目在飞窗（跨 saveMutex
   *  等待+append 5s 事务上界）会误罩 B 项目（独立 saveMutex）的三处排程守卫（降级支 spool 失败/
   *  spool 回退 catch/尾部守卫）→ B 批滞留无恢复路径。retryPersist 内层 storeDocument 仍不自排
   *  定时器（梯子推进只归 retryPersist——否则档位取值错档）。 */
  private readonly retryingPersistDocs = new Set<string>();
  /** Y0a-2（契约 14/P5）：in-flight 口径（projectId 键控——与队列归属同键）；维护对见 enterInFlight/leaveInFlight */
  private readonly inFlightProjects = new Set<string>();
  /** X6：熔断期退避梯暂停标志（probe 恢复经 onRecovered seam→rearmQueues 清除） */
  private retryPausedByCircuit = false;
  /** Y0a-2：draining 状态位（isShuttingDown 读点=authenticate 受理门；置位者=onApplicationShutdown 步骤 1——与 Y0a-3 /api/drain 同一状态位（幂等；内存态）） */
  private draining = false;
  /** V10：已删项目终态缓存（storeDocumentUnlocked 终态拦截读点；写入者=Task 6 删除链 emit——本批空集=门常开） */
  private readonly deletedProjects = new Set<string>();
  /** 批3-4 sweep：grace 在途去重 + 连续复验失败计数（WeakMap/WeakSet——连接回收即散） */
  private readonly sweepGrace = new WeakSet<object>();
  private readonly sweepRecheckFails = new WeakMap<object, number>();
  private sessionSweepTimer: ReturnType<typeof setInterval> | null = null;
  /** 重放抑制：只包裹每个 applyReplayed 的同步段（yjs update 事件在事务清理期同步发放——实测重放行与
   *  pendingDs 延迟整合均在 apply 同步栈内发放、被精确抑制；await 窗口内写入不被抑制、进 pending） */
  private readonly replaying = new WeakSet<Y.Doc>();
  /** flush 失败兜底（内存 unflushed Map）已随 Y0a-2 stash 族退役——spool=唯一权威待落库台账 */
  readonly hooks: {
    onAuthenticate: (p: onAuthenticatePayload) => Promise<any>;
    onLoadDocument: (p: onLoadDocumentPayload) => Promise<any>;
    onStoreDocument: (p: onStoreDocumentPayload) => Promise<boolean>;
    afterStoreDocument: (p: afterStoreDocumentPayload) => Promise<void>;
    onDisconnect: (p: onDisconnectPayload) => Promise<void>;
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly repo: CanvasDocUpdateRepository,
    private readonly redisSync: CollabRedisSync,
    private readonly perm: ProjectPermissionService,
    // Y0a-2 C6：spool=必填位置参数（漏参即编译红；TS1016 禁"必参随可选参"——前置可选参数全部改
    // 显式 `T | undefined` 形态，@Optional() 运行时语义不变，位置个数十参恒定）。
    // Nest 按类型自动注入（module providers 已注册）。
    @Optional() @Inject('COLLAB_PORT') port: number | undefined,
    @Optional() @Inject('COLLAB_DEBOUNCE') debounce: number | undefined,
    @Optional() @Inject('COLLAB_TIMEOUT') timeout: number | undefined,
    @Optional() @Inject(SessionService) sessions: SessionService | undefined,
    private readonly spool: CollabSpoolService,
  ) {
    this.sessionSvc = sessions ?? new SessionService(prisma);
    this.hooks = {
      onAuthenticate: (p) => this.authenticate(p),
      onLoadDocument: (p) => this.loadDocument(p),
      onStoreDocument: (p) => this.storeDocumentUnlocked(p),   // Y0a-2 A14：钩子直通 Unlocked（库已在 saveMutex 内调钩子——禁再包=重入死锁）
      afterStoreDocument: (p) => this.afterStoreDocument(p),
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
      afterStoreDocument: this.hooks.afterStoreDocument,   // Y0a-2 V22：最小对账钩子接线（构造 Server 配置同步——同 T3 onStoreDocument 直通位置）
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
    // Y0a-2（P1+V4 单源派生）：pending 观测注册——/api/metrics collect 回调现算（零手动维护点）；
    // G-1/G-2 演练轮询面+y0a-3 /api/ready.pending 消费同一 computePending()。
    registerPendingCollector(() => this.computePending());
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
      // Y0a-2（X9）：受理门分层——draining=关停期拒新连接（DRAINING 瞬态档，客户端继续重连）；
      // spool 熔断=只读降级（新连接放行但 readOnly——复用 VIEWER 机制+stateless 通告；存量连接不动）
      if (this.isShuttingDown()) throw deny(CollabAuthReason.DRAINING, 'service restarting');
      const spoolState = this.isWritableOrDegraded();
      if (spoolState !== 'ok') {
        connectionConfig.readOnly = true;          // X9：只读降级（协议层拒写更新）
        this.broadcastSpoolDegraded(documentName); // Y9：独立通告通道（pushPersistStatus 有 persistUnhealthy 早退——spool 熔断不在其中=静默只读）
      }
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
      // Y11：队列 get-or-create——卸载交接失败遗留的批必须在重连后存活（set 替换=静默丢批，V4 要消灭的形态）；
      // docProject 播种（update 回调经它解析队列）；数组身份恒定不变量沿用（只 push/splice）。
      this.docProject.set(document, projectId);
      if (!this.docEpoch.has(document)) this.docEpoch.set(document, Date.now());
      if (!this.pendingQueues.has(projectId)) this.pendingQueues.set(projectId, []);
      if (!this.docListeners.has(document)) {   // 监听防重复注册（update 事件一次）
        this.docListeners.add(document);
        document.on('update', (u: Uint8Array) => {
          if (this.replaying.has(document)) return;
          const q = this.pendingQueues.get(this.docProject.get(document)!);
          if (!q) { this.logger.error(`update for untracked doc ${documentName}: dropped`); return; }
          q.push(u);
          // 原地封顶（禁 set 新数组——数组身份恒定）。计数阈值：折叠后恰剩 1 条需再积 64 条才复发；
          // 字节阈值会"折完仍超限→每条 update 全量重编码"（3000 条积压实测 4.8s vs 103ms 同步阻塞）
          // （Task 7：折叠逻辑随 X10 闩锁改造移除——本批保留原折叠行为）
          if (q.length > PENDING_MAX_ENTRIES) q.splice(0, q.length, Y.mergeUpdates(q));
        });
      }
      const applyReplayed = (u: Uint8Array) => {
        this.replaying.add(document);
        try { Y.applyUpdate(document, u); } finally { this.replaying.delete(document); }
      };
      // 批3-4 doc epoch 播种已并入上方 Y11 get-or-create 块
      // 批3-4：compact 时间门限基线播种（首次 load 起算 60s 窗）
      if (!this.lastCompactAt.has(projectId)) this.lastCompactAt.set(projectId, Date.now());
      // Y0a-1：装载读唯一入口（契约 §4.3-1）+超时自愈（契约 §4.3-13·仅可重试类）
      const { state, updates } = await this.repo.hydrateWithRecovery(projectId);
      if (state) {
        yjsCanvasDocBytes.set({ projectId }, state.length);   // 快照字节播种（现状语义保留）
        applyReplayed(new Uint8Array(state));
      }
      for (const u of updates) applyReplayed(new Uint8Array(u));
      // Y0a-2：stash=spool 帧（peek→apply；帧不删——confirm 恒在 append 成功后，契约 12）。
      // apply 事件进 pending（窗口外回灌）；帧的 confirm 出口=下次 store 提前 drain / 断连 flush / 启动回灌。
      for (const f of await this.peekSpoolFrames(projectId)) Y.applyUpdate(document, f.payload);
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
      // Y0a-2：consumeStash 已退役——帧保留至 append 成功（confirm 恒在成功后，契约 12）
    } catch (err) {
      if ((err as { schemaRefusal?: boolean })?.schemaRefusal) throw err;
      if (err instanceof Error && (err as Error & { reason?: CollabAuthReasonCode }).reason) throw err;
      throw Object.assign(new Error(`db unavailable: ${(err as Error).message}`), { reason: CollabAuthReason.DB_UNAVAILABLE });
    }
  }

  /** Y0a-2 BOI 主路径（spec v2.4 §2.3 + V1/V12）：copy-first——merge 不动队列，splice 恒在新家
   *  落定（append r.ok===true 或 spool fsync 成功）之后；任何路径不 throw（契约 3）；
   *  fenced=终态（契约 15）：批走 spool+不排退避梯（selfIsolate 归 Y0a-3——本批 ERROR 日志+行为用例）。
   *  **confirm 语义（V1，防 P0-1 蒸发）**：spool 帧只在"内容已被 PG 成功接收"时 confirm（本批 peek 出的
   *  旧帧集合）；失败路径 spool.append 只写**本批**（旧帧不并入——各自独立帧，防 O(n²) 重写放大）；
   *  恢复时一次 append 合并全部未 confirm 帧+PG 已有内容，confirm 旧帧→段回收。
   *  **降级态 spool-first（V12）**：persistUnhealthy 态下批先落 spool（fsync）再试 PG——故障腿窗口
   *  =一个 debounce 窗+fsync（PG 挂起时 append 有 5s 事务上界兜底）；稳态 PG-first 零写放大。
   *  storeInFlight（契约 14/P5，**X2 四落定点**——非 try/finally）：①append ok ②spool fsync
   *  成功（含 V12 降级/交接/force-spool）③FK/终态丢弃 ④project.gone 丢弃；spool 失败回队列**不清**
   *  （批未落定=flush-at-risk）；意外异常兜底 leave=本方法外层 catch（Y2——钩子路径不经 Serialized，
   *  兜底必须在此层）。 */
  private async storeDocumentUnlocked({ document: _document, documentName }: Pick<onStoreDocumentPayload, 'document' | 'documentName'>): Promise<boolean> {
    const projectId = parseProjectId(documentName);
    if (this.deletedProjects.has(projectId)) return this.discardForGoneProject(projectId, documentName);   // V10：显式清账+点名
    const queue = this.pendingQueues.get(projectId);
    if (!queue) {
      this.logger.error(`store for unobserved doc ${documentName}: listener never registered`);   // tripwire：!lastSV 同构物不得静默
      return false;
    }
    try {   // Y2：兜底 catch 在此层（钩子直通本方法——Serialized 的 catch 盖不到；spool 失败的正常 return false 不经过这里）
      const degraded = this.persistUnhealthy.has(documentName);    // V12：降级态
      const stashFrames = await this.peekSpoolFrames(projectId);
      if (queue.length === 0 && stashFrames.length === 0) { yjsStoreDrainTotal.inc({ result: 'noop' }); return false; }
      this.enterInFlight(projectId);                               // enter storeInFlight（projectId 级）
      const stashIds = stashFrames.map((f) => f.frameId);
      // —— 降级态（V12）：本批先落 spool（新家先落定），再连带旧帧试 PG ——
      if (degraded && queue.length > 0) {
        const n0 = queue.length;
        const tailRef0 = queue[n0 - 1];                            // I-2：取批时批尾引用（splice 前身份校验锚）
        const own = n0 === 1 ? queue[0] : Y.mergeUpdates(queue.slice(0, n0));
        try {
          const ids = await this.spool.append(projectId, own);     // fsync 完成才返回（本批安全先落盘）
          // I-2：splice 前身份判据——await 交织窗折并（合并元素含快照后内容）→ 跳过 splice：
          // 本批已落 spool fsync，队列留双份 CRDT 幂等吸收；leaveInFlight/confirm 记账按落定点②照常。
          if (queue.length < n0 || queue[n0 - 1] !== tailRef0) {
            yjsStoreTailAnomalyTotal.inc();
            this.logger.error(`store tail anomaly (V12 spool-first) for ${documentName}: queue mutated during spool append（折并交织窗——跳过 splice，批留队重发）`);
          } else {
            queue.splice(0, n0);                                   // 本批新家=spool 已落定
          }
          this.leaveInFlight(projectId);                           // X2 落定点②：spool fsync 成功（批已安全——后续 PG 尝试是回收不是保命）
          stashFrames.push({ frameId: ids[0], payload: own });     // 并入本次 PG 尝试集
          stashIds.push(ids[0]);
        } catch (e2) {
          // M2：降级支 spool 失败与非降级支同形——批留队列+保 inFlight+排重试（同归属态同口径，
          // 不再上抛 Y2 兜底；本支在 append 尝试前，fenced 恒 false）
          this.logger.error(`spool append failed for ${projectId}, batch retained in queue: ${(e2 as Error).message}`);
          this.setPersistStatus(documentName, false);
          // T3 残留收口：retryingPersistDocs 在飞（doc 级重试通道）不自排——梯子推进只归 retryPersist catch
          //（审查 I-2：per-doc 集合——A 项目在飞不误罩本项目；缺失只致档位节奏漂移，无数据风险）
          if (!this.retryingPersistDocs.has(documentName)) this.schedulePersistRetry(documentName);
          return false;
        }
      }
      const n = queue.length;
      const parts = [...stashFrames.map((f) => f.payload), ...queue.slice(0, n)];
      const tailRef = parts[parts.length - 1];                     // Y8：取批时批尾引用（身份校验锚——splice 前比较）
      const payload = parts.length === 1 ? parts[0] : Y.mergeUpdates(parts);
      let appended = false; let fenced = false;
      try {
        const r = await this.repo.append(projectId, payload);      // AppendResult（契约 15）+5s 事务上界（V8）
        if (r.ok) appended = true;
        else if (r.reason === 'fenced') {
          fenced = true;
          this.logger.error(`append fenced for ${projectId}（租约失守——批走 spool，不排退避梯）`);
        } else {
          throw new Error(`append returned no row (${r.reason})`);
        }
      } catch (err) {
        if (isFkGone(err)) {                                       // V6：FK 判别=isFkGone（pg-error.util 单源——X15）
          queue.splice(0, n);
          yjsUpdatesDiscardedDeletedTotal.inc({ source: 'gateway' });
          this.leaveInFlight(projectId);                           // X2 落定点③：FK/终态丢弃
          this.logger.warn(`store append hit FK for ${projectId}——batch discarded (project deleted)`);
          return false;
        }
        this.logger.error(`store append failed for ${projectId}, ${parts.length} updates: ${(err as Error).message}`);
        yjsStoreAppendFailureTotal.inc();
      }
      if (appended) {
        // Y8：splice **前**判据（v3 的 splice 后 queue.length<n 恒真=健康路径刷 anomaly）——
        // await 期间 push 只增不减：length<n ⇒ 有人并发取批（saveMutex 被绕过）；
        // queue[n-1]!==tailRef ⇒ 结构性变更（Y7 coalesce 竞争／I-2 折并交织窗——合并元素含快照后
        // 新更新）→ 跳过 splice：合并元素留队下次 store 重发，CRDT 幂等吸收（已落 PG 部分重复
        // apply 无害——宁可重复不要误删，J5 同哲学）。
        if (queue.length < n || (n > 0 && queue[n - 1] !== tailRef)) {
          yjsStoreTailAnomalyTotal.inc();
          this.logger.error(`store tail anomaly for ${documentName}: queue mutated during append（折并交织窗/并发取批——跳过 splice，合并元素留队重发）`);
        } else {
          queue.splice(0, n);                                      // 新家（PG）已落定——移出旧归属
        }
        this.leaveInFlight(projectId);                             // X2 落定点①：append ok
        if (stashIds.length) await this.spool.confirm(projectId, stashIds);   // 旧帧内容已入 PG——可回收（契约 12）
        yjsStoreDrainTotal.inc({ result: 'appended' });
        yjsCanvasDocBytes.inc({ projectId }, payload.byteLength);   // 批3-4：增量字节累加
        this.cancelPersistRetry(documentName);   // 批3-4：成功即撤销退避定时器
        this.setPersistStatus(documentName, true);
        try { await this.maybeCompact(projectId); }
        catch (err) {
          // compact 是优化不是不变量载体：行已落库，失败只 WARN 绝不抛——否则被库当 store 失败 → doc 永不卸载 → destroy 挂死
          yjsStoreCompactFailureTotal.inc();
          this.logger.warn(`compact failed for ${projectId} (rows already durable): ${(err as Error).message}`);
        }
        return true;
      }
      // append 失败（含 fenced）：批必须入账——spool=唯一真修法（E43②：入账先于一切）。
      // V1：只写"本批"（降级态已提前写过则跳过）——旧帧留在 spool 各自独立，恢复时合并读
      if (!degraded && queue.length > 0) {
        try {
          const n2 = queue.length;
          const tailRef2 = queue[n2 - 1];                          // I-2：快照时批尾引用（splice 前身份校验锚）
          const own = n2 === 1 ? queue[0] : Y.mergeUpdates(queue.slice(0, n2));
          await this.spool.append(projectId, own);                 // fsync 完成才 resolve；新帧不 confirm（V1）
          // I-2：同款身份判据——折并交织窗跳过 splice（本批已落 spool fsync，队列合并元素留双份，幂等吸收）
          if (queue.length < n2 || queue[n2 - 1] !== tailRef2) {
            yjsStoreTailAnomalyTotal.inc();
            this.logger.error(`store tail anomaly (spool fallback) for ${documentName}: queue mutated during spool append（折并交织窗——跳过 splice，批留队重发）`);
          } else {
            queue.splice(0, n2);                                   // 新家（spool）已落定——移出旧归属
          }
          this.leaveInFlight(projectId);                           // X2 落定点②：spool fsync 成功
        } catch (e2) {
          // spool 也失败：队列不动（BOI）——**不清 inFlight 标志**（X2：批未落定=flush-at-risk 口径，契约 14 原文；
          // finally 形态会把 G-2a ii 档清零=自断言红）
          this.logger.error(`spool append failed for ${projectId}, batch retained in queue: ${(e2 as Error).message}`);
          this.setPersistStatus(documentName, false);
          // 审查 I-2：retryingPersistDocs 在飞（doc 级重试通道）不自排——梯子推进只归 retryPersist catch
          //（per-doc 集合：A 项目在飞不误罩本项目；此处自排会取错档位+与 catch 重排叠加——守卫为 BASE 先例形态）
          if (!fenced && !this.retryingPersistDocs.has(documentName)) this.schedulePersistRetry(documentName);
          return false;                                            // 任何路径不 throw（契约 3）——熔断计数在 spool 内
        }
      }
      if (queue.length === 0) this.leaveInFlight(projectId);       // 队列空=批全在 spool（fsync 已完成=契约 14 落定点；帧后续落 PG 归回灌——非 at-risk，J4 注）
      this.setPersistStatus(documentName, false);
      if (!fenced && !this.retryingPersistDocs.has(documentName)) this.schedulePersistRetry(documentName);        // fenced=终态禁退避梯；审查 I-2：per-doc 在飞不自排（A 项目在飞不误罩本项目；档位推进归 retryPersist catch）
      return false;                                                // 任何路径不 throw（契约 3）
    } catch (err) {   // Y2 兜底：意外异常（Y.mergeUpdates 炸/IO 逃逸等）——leave 防漂移+ERROR 留痕；正常失败路径（上文 return false）不经此
      this.leaveInFlight(projectId);
      this.logger.error(`store unexpected throw for ${documentName}: ${(err as Error).message}——契约 3 最后一道闸（批保留原归属地）`);
      return false;
    }
  }

  /** V10：终态拦截的显式清账——丢弃是对的，静默丢弃不是。Y1：丢弃=归属落定——leaveInFlight
   *  （Set.delete 幂等；事件到达时 store 在飞的窗口由此收口，防已删项目永久占用 storeInFlight）。 */
  private discardForGoneProject(projectId: string, documentName: string): boolean {
    const q = this.pendingQueues.get(projectId);
    const batches = q?.length ?? 0;
    const bytes = (q ?? []).reduce((s, u) => s + u.byteLength, 0);
    if (q && batches > 0) q.splice(0);
    this.leaveInFlight(projectId);   // Y1：X2 落定点④（project.gone 丢弃）
    yjsUpdatesDiscardedDeletedTotal.inc({ source: 'gateway' });
    this.logger.warn(JSON.stringify({ event: 'project_gone_discard', projectId, batches, bytes }));
    return false;
  }

  /** 提前 drain 的帧读（IO 错误不阻断主路径——帧留待下次；正常态键集判定零 IO） */
  private async peekSpoolFrames(projectId: string): Promise<{ frameId: string; payload: Uint8Array }[]> {
    try { return this.spool.hasFrames(projectId) ? await this.spool.peek(projectId) : []; }
    catch (err) {
      this.logger.error(`spool peek failed for ${projectId}（帧跳过本次合并，留待下次）: ${(err as Error).message}`);
      return [];
    }
  }

  /** Y0a-2：gateway 直调点的串行包装（A14——库已持锁调钩子，钩子路径直通 Unlocked 禁再包） */
  private storeDocumentSerialized(p: Pick<onStoreDocumentPayload, 'document' | 'documentName'>): Promise<boolean> {
    return p.document.saveMutex.runExclusive(() => this.storeDocumentUnlocked(p));
  }

  /** V13+X9：受理面判据（**粒度修正：只读降级而非停服**——"三入口全拒"会把本地磁盘故障放大成
   *  全站画布不可读：readCanvas 走 withDoc、装载拒=重连风暴，均超出 spec §2.2"拒新写入"语义）。
   *  分层：draining=关停期拒一切新连接；spool 熔断=**只读化**（新连接放行但 readOnly——复用
   *  connectionConfig.readOnly 机制+stateless persist-status 通告；存量连接不动——其批次由 BOI/V5' 承接）；
   *  loadDocument **永不 gate**；withDoc 只 gate 写意图。Y0a-3 的 /api/ready 消费同一方法。 */
  isShuttingDown(): boolean { return this.draining; }
  isWritableOrDegraded(): 'ok' | 'spool-unwritable' {
    return this.spool.isWritable() && !this.spool.overCapacity() ? 'ok' : 'spool-unwritable';
  }

  /** V22+X2：storeInFlight 维护对（projectId 键控）。enter=Unlocked 取批路径；leave=**四落定点显式调用**
   *  （见 storeDocumentUnlocked 头注释）+Y2 兜底 catch+Y1 rearm/detached——非 try/finally 单点。 */
  private enterInFlight(projectId: string): void {
    this.inFlightProjects.add(projectId);          // Set.add 幂等——重试再进入不双计（P5）
    storeInFlightDocs.set(this.inFlightProjects.size);
  }
  private leaveInFlight(projectId: string): void { // 唯一减点=归属落定/兜底——drain force-spool 复用（契约 14）
    this.inFlightProjects.delete(projectId);
    storeInFlightDocs.set(this.inFlightProjects.size);
  }

  /** Y0a-2（V22 收缩）：afterStoreDocument=**存活计数探针**（yjs_store_hook_calls_total——钩子链健康面）。
   *  v1 的"队列非空∧非 spool 键"对账判据**撤**（去抖窗内正常新写入必命中=纯噪声——外审 E4 成立）；
   *  真对账=Task 3 storeDocumentUnlocked 成功路径的 **splice 点队首前进自检**（零误报）。
   *  钩子体 try/catch 永不抛（在库 saveMutex 锁内执行——A14）。 */
  private async afterStoreDocument(_p: Pick<afterStoreDocumentPayload, 'document' | 'documentName'>): Promise<void> {
    try { yjsStoreHookCallsTotal.inc(); } catch { /* 探针钩子永不抛 */ }
  }

  /** Y0a-2（P1+V4 单源派生+Y5 键名）：pending 快照——遍历**自有 pendingQueues**（B2：不依赖库
   *  documents Map，测试与生产同构）；字段 `projects`（按 projectId 计——drain/日志/用例/drill 同名消费）；
   *  G-1/G-2 演练轮询面（/api/metrics collect 回调）+Y0a-3 /api/ready.pending 消费同一实现 */
  computePending(): { projects: number; batches: number; spoolFiles: number; spoolBytes: number } {
    let projects = 0, batches = 0;
    for (const q of this.pendingQueues.values()) {
      if (q.length > 0) { projects += 1; batches += q.length; }
    }
    const d = this.spool.depth();
    return { projects, batches, spoolFiles: d.files, spoolBytes: d.bytes };
  }

  /** 批3-4：compact 时间门限（≥COMPACT_INTERVAL_MS 一档；基线 load 播种、compact 后重置）。
   *  Y0a-1（spec v2.4 §1.3）：仅 compacted===true 开新窗——abandoned 不开窗（窗口仍从上次成功起算，
   *  早已过期⇒下次 store 立即重试）；empty 同不开窗（无行时 attempt=一次 findMany(0)，代价可忽略）。 */
  private async maybeCompact(projectId: string): Promise<void> {
    const last = this.lastCompactAt.get(projectId);
    if (last !== undefined && Date.now() - last < COMPACT_INTERVAL_MS) return;
    const r = await this.repo.compact(projectId);
    if (r.compacted) this.lastCompactAt.set(projectId, Date.now());
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

  /** Y0a-2（X9/Y9）：spool 熔断的只读降级通告——best-effort（连接注册后 doc 才存在，500ms 延迟取；
   *  无 doc 则跳过，重连时 authenticate 再补）。客户端据此展示"暂存不可用"横幅——禁静默只读。 */
  private broadcastSpoolDegraded(documentName: string): void {
    const t = setTimeout(() => {
      const document = this.server.hocuspocus.documents.get(documentName);
      if (!document) return;
      try {
        document.broadcastStateless(JSON.stringify({ type: 'persist-status', healthy: false, reason: 'spool-unwritable' }));
      } catch (err) {
        this.logger.warn(`spool degraded broadcast failed for ${documentName}: ${(err as Error).message}`);
      }
    }, 500);
    t.unref?.();
  }

  private schedulePersistRetry(documentName: string) {
    // Y0a-2（X6）：熔断自检首行——spool 不可写期不排梯（probe 恢复经 onRecovered seam→rearmQueues 唤醒，
    // 否则梯内 store 首行 spool 失败→批留队列但梯空转烧档位）。
    // I-3：限定 ioBroken 才停排——容量态下 PG 腿完全健康可消化帧（confirm 自评解除容量+唤醒 seam）；
    // 容量态也停排会级联 X9 readOnly：无 store 触发→容量永不解除=死锁（梯继续=自愈通道）。
    if (!this.spool.isWritable() && !this.spool.overCapacity()) { this.retryPausedByCircuit = true; return; }
    const entry = this.persistRetry.get(documentName) ?? { rung: 0, timer: null };
    if (entry.timer) return;   // 已排程（失败叠加不提前触发）
    entry.timer = setTimeout(() => {   // Y0a-2：耗尽 return 删——退避无上限，rung≥5 恒 60s 封顶重排
      entry.timer = null;
      void this.retryPersist(documentName);
    }, persistRetryDelayMs(entry.rung));
    entry.timer.unref?.();
    this.persistRetry.set(documentName, entry);
  }

  private cancelPersistRetry(documentName: string) {
    const entry = this.persistRetry.get(documentName);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.persistRetry.delete(documentName);
  }

  /** Y0a-2（X5）：无界退避重试双通道——doc 级（活 doc 队列再 flush，经 saveMutex 串行）→
   *  detached 态（doc 不活/队列空）队列通道+spool 帧通道；成功广播 healthy、失败留队续排
   *  （退避无上限——60s 封顶循环永不"耗尽"；下次 load 回灌/启动回灌兜底仍在，R1 拒绝理由
   *  由此自洽：回灌失败项目经退避梯运行期自愈，无需独立后台 timer）。 */
  private async retryPersist(documentName: string) {
    const entry = this.persistRetry.get(documentName);
    if (!entry) return;
    const projectId = parseProjectId(documentName);
    const document = this.server.hocuspocus.documents.get(documentName);
    try {
      if (document && (this.pendingQueues.get(this.docProject.get(document) ?? '')?.length ?? 0) > 0) {
        this.retryingPersistDocs.add(documentName);   // 审查 I-2：per-doc 在飞标志（旧单布尔跨项目误罩）
        try {
          // I-1：消费布尔返回——false=批滞留队列/spool，必须 throw 进 catch（rung 推进+退避重排+
          // 电平维持 unhealthy）。旧实现忽略 false → 尾部无条件 cancel+setPersistStatus(true)：
          // 批滞留却广播 healthy+刚排的重试定时器被杀=自断自愈通道。
          const ok = await this.storeDocumentSerialized({ document, documentName });   // doc 级：doc 仍被观察且队列非空（A14——saveMutex 串行）
          if (!ok) throw new Error('persist retry failed（批保留——退避梯续排）');
        } finally {
          this.retryingPersistDocs.delete(documentName);
        }
      } else {
        // X5：detached 态（doc 不活/队列空）双通道——先看 gateway 队列（V4 后 doc 卸载队列仍在），
        // 再看 spool 帧；皆空才 cancel。队列通道=spool-first（写 spool 成功即归属落定，帧由后续三段式回灌）。
        const queue = this.pendingQueues.get(projectId);
        if (queue && queue.length > 0) {
          const n = queue.length;
          const payload = n === 1 ? queue[0] : Y.mergeUpdates(queue.slice(0, n));
          await this.spool.append(projectId, payload);           // 失败 throw 重走 catch 退避（不 cancel——批仍需保活）
          queue.splice(0, n);
          this.leaveInFlight(projectId);                         // Y1：detached 队列通道落定点②（批可能带着 Unlocked 留下的在飞标志进梯——此处落 spool 即落定）
        } else {
          const frames = await this.peekSpoolFrames(projectId);  // 帧通道=三段式（peek→append→confirm）
          if (frames.length === 0) { this.cancelPersistRetry(documentName); return; }
          for (const f of frames) {
            const r = await this.repo.append(projectId, f.payload);
            if (!r.ok) throw new Error(`append returned no row (${r.reason})`);   // 重走 catch 退避（帧未 confirm——安全）
            await this.spool.confirm(projectId, [f.frameId]);
          }
        }
      }
      this.cancelPersistRetry(documentName);
      this.setPersistStatus(documentName, true);
    } catch (err) {
      entry.rung += 1;
      // Y0a-2：退避无上限（60s 封顶循环）——"耗尽"分支删除；批的归属地（队列/spool）不变，梯子永续
      //（下次 load 回灌/启动回灌仍为兜底——R1 拒绝理由由此自洽：回灌失败项目经退避梯运行期自愈）
      this.logger.error(`persist retry ${entry.rung} failed for ${projectId}: ${(err as Error).message}`);
      this.schedulePersistRetry(documentName);
    }
  }

  /** X5+Y1+Y10：统一唤醒——"每个非空队列恒有恢复路径"单一不变量。Y1：覆盖面=pendingQueues 非空
   *  ∪ spool.keys()（帧-only 滞留面：重启回灌预算耗尽残留/卸载交接后的帧——只遍历队列会漏）；
   *  排程前清 inFlight（rearm 时旧 store 尝试已死——批带着标志滞留会永久抬高 yjs_store_in_flight_docs；
   *  重试 enter 幂等重新置位）。 */
  private rearmQueues(): void {
    const ids = new Set<string>([
      ...[...this.pendingQueues.entries()].filter(([, q]) => q.length > 0).map(([pid]) => pid),
      ...this.spool.keys(),
    ]);
    for (const pid of ids) {
      this.leaveInFlight(pid);
      this.schedulePersistRetry(`project:${pid}`);
    }
    this.retryPausedByCircuit = false;
  }

  /** 最后连接断开：flush →（写了才）compact。
   *  绝不抛出（覆盖含 redlock Skip 在内的全部路径，spec v4）：onDisconnect 是 onClose 的 async 回调、
   *  注册方 forEach 不 await——抛错 = unhandled rejection = 进程退出；DirectConnection 路径是 await 的，
   *  抛错冒泡出 withDoc finally → API 500 → 前端重试 → 重复插入。Skip 路径下 saveMutex 在回调抛错时
   *  先释放 → onDisconnect 一定被调用 → 本契约面更宽。
   *  Y0a-2：storeDocument 不再 throw（BOI 契约 3）——失败路径自处理（批在 spool/队列），stashPending 退役。 */
  private async disconnect({ document, documentName }: onDisconnectPayload) {
    if (document.getConnectionsCount() > 0) return;
    const projectId = parseProjectId(documentName);
    const wrote = await this.storeDocumentSerialized({ document, documentName });
    if (wrote) {
      try {
        await this.maybeCompact(projectId);   // 会话结束收敛增量行；没写就不 compact（消除每次 readCanvas 全量 compact）
      } catch (err) {
        yjsStoreCompactFailureTotal.inc();
        this.logger.warn(`final compact failed for ${projectId}: ${(err as Error).message}`);   // 行已落库，非 flush 失败
      }
    }
  }

  async onModuleInit(): Promise<void> {
    // 跨实例同步：仅回复本实例已打开的文档（Document extends Y.Doc，内存态最新）
    this.redisSync.getDocument = (name) => this.server.hocuspocus.documents.get(name);
    // Y0a-2：启动回灌（先于 listen——fail-closed：先服务后回灌=第二次撕裂）。坏帧 scan 报告→隔离处置；
    // 回灌失败不阻塞启动（帧保留待下次+自检点名）；FK 帧（P2003）随 replayAll 收割。
    const { truncatedSegments } = await this.spool.scan();
    let quarantined = 0;
    for (const seg of truncatedSegments) {
      const projectId = seg.replace(/\.\d+\.spool$/, '');
      quarantined += await this.spool.quarantineTruncatedFrames(projectId);
    }
    const replay = await this.spool.replayAll(this.repo);
    if (quarantined > 0 || replay.failed > 0) {
      // 启动自检（spec §5.2 口径——ERROR 结构化日志；Y0a-3 起随 ready.spoolQuarantined 可见）
      this.logger.error(JSON.stringify({ event: 'spool_startup_selfcheck', quarantined, replayFailed: replay.failed, replayed: replay.replayed, discarded: replay.discarded, truncatedSegments }));
    }
    // 审查 I-1（X5 必修漏落）：回灌失败残帧必须落梯——onRecovered seam 只在 ioBroken 翻转时回调，
    // spool 健康时永不触发；缺此行则回灌失败项目零恢复路径（yjs_spool_depth_* 永不清零，
    // R1「回灌失败项目经退避梯运行期自愈」破约）。listen 前调用=先备恢复路径后受理。
    // 幂等安全：schedulePersistRetry 对已有 timer return。
    this.rearmQueues();
    // 审查 M-1：validateDir 的启动调用点（V15——生产相对路径拒绝构造时不判；缺此调用=V15 fail-fast 死代码）
    this.logger.log(JSON.stringify({ event: 'spool_dir', dir: this.spool.validateDir() }));
    await this.server.listen();   // Y0a-1 P1-1：await listen——onModuleInit 返回即端口就绪（消端口竞态）
    this.startSessionSweep();   // 批3-4：过期 session 连接清扫（灰度默认关——tick 内自检开关）
    // Y10 seam：spool IO 熔断恢复→统一唤醒退避梯+清 inFlight（运行期恢复缝——启动回灌失败的排程由上方
    // rearmQueues 直调承接，seam 只管运行期 ioBroken 翻转；幂等安全：schedulePersistRetry 对已有 timer return）
    this.spool.onRecovered = () => this.rearmQueues();
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

  /** Y0a-2 关停 drain 六步（spec v2.4 §2.4 预算表：直连宽限 ≤2s+flush ≤6s+自管 drain+force-spool 硬界
   *  t0+18s+race ≤4s=合计 ≤22s——Y12：hardDeadline 18s（22s+4s=26s 破表），kill_timeout 30s 内垫 ≥8s
   *  ——ecosystem Y0a-4）。G-2a：归属要么落定、要么被如实点名（禁声称 0）。
   *  步骤 6（租约显式释放 ≤2s）Y0a-3 落地——本批占位注释（v2.4"必须执行到"约束随租约同批）。 */
  async onApplicationShutdown(): Promise<void> {
    const t0 = Date.now();
    this.draining = true;                                                        // 步骤 1：停收新写（就绪门对接 Y0a-3）
    if (this.sessionSweepTimer) { clearInterval(this.sessionSweepTimer); this.sessionSweepTimer = null; }
    for (const [name] of [...this.persistRetry]) this.cancelPersistRetry(name);  // 定时器随停——drain 主动接管
    await this.graceDirectConnections(2_000);                                    // 在飞直连宽限（A3：directConnectionsCount）
    this.closeAllConnections1012();                                              // 步骤 2：瞬时
    this.server.hocuspocus.flushPendingStores();                                 // 步骤 3：库 debounce 队列（同步触发）
    await this.pollPendingDrained(6_000);                                        // ≤6s 排空窗口（只管"仍在 debounce 中"的 store——主力是步骤 4）
    await this.drainAllDocuments(t0 + 18_000);                                   // 步骤 4：自管 drain+force-spool（X7+Y12——硬界 18s，其后 4s race 收在 22s）
    let destroyed = false;                                                       // 步骤 5：destroy 与 4s race（兜底）
    const destroying = this.server.destroy()
      .then(() => { destroyed = true; })
      .catch((err) => this.logger.warn(`collab server destroy failed: ${(err as Error).message}`));   // 关停窗口禁 unhandled rejection
    await Promise.race([destroying, new Promise<void>((r) => { setTimeout(r, 4_000).unref?.(); })]);
    if (!destroyed) {
      const p = this.computePending();
      const hangReason = p.projects > 0 || p.batches > 0 ? 'store-undrained' : 'direct-open';   // 分型（v2.4；Y5 键名）
      this.logger.error(JSON.stringify({ event: 'destroy_timeout', ...p, storeInFlight: this.inFlightProjects.size, hangReason }));
    }
    unregisterPendingCollector();   // Y5：collect 闭包随 gateway 死——destroy race 判定后（M4：drain 期 pending 可观测性保留）
    // 步骤 6（≤2s）：租约显式释放——Y0a-3（deploy 不等 TTL；SIGKILL 截断则下实例吃满 TTL=RTO）
    this.logger.log(JSON.stringify({ event: 'shutdown_complete', elapsedMs: Date.now() - t0 }));
  }

  /** V9：在飞直连宽限——**入口先判**（无直连立即归还，消灭"每次重启无条件多 2s"）；轮询期间
   *  directConnectionsCount 归零即返（A3——closeAllConnections1012 只遍历 WS 不触 direct）。 */
  private async graceDirectConnections(budgetMs: number): Promise<void> {
    const count = () => { let n = 0; for (const d of this.server.hocuspocus.documents.values()) n += d.directConnectionsCount ?? 0; return n; };
    if (count() === 0) return;                                   // V9：常见路径零成本
    const t0 = Date.now();
    while (Date.now() - t0 < budgetMs) {
      if (count() === 0) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private async pollPendingDrained(budgetMs: number): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < budgetMs) {
      const p = this.computePending();
      if (p.projects === 0 && p.batches === 0) return;   // Y5：projects 键名（v3 此处读 p.docs=改名后恒 undefined）
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** 自管 drain（步骤 4 主力）——X7+Y12：hardDeadline（t0+18s）透传+两级闸（总闸 8s 遍历预算+每 doc
   *  min(2s, remaining) race）；drain 循环内 peekSpoolFrames 套 500ms race（磁盘挂起穿透防护）；
   *  force-spool **每次 append 套 Promise.race 可切断+按返回值判定**（J5：`ids!==null` 才 splice——
   *  race 超时且 append 实际失败时 splice=批蒸发；超时后成功=重复帧由 CRDT 幂等吸收，宁可重复不误删）。
   *  **race 超时分支不 leave**（Y12 修正 X7 注记错误：超时=store 挂起=批未落定=undrained 点名应含它——
   *  leave 会破坏 G-2a ii 的 storeInFlight===projects 断言；仅 catch（意外异常）leave）。
   *  G-2a：归属要么落定、要么被如实点名。 */
  private async drainAllDocuments(hardDeadline: number): Promise<void> {
    const drainStart = Date.now();
    for (const [projectId, q] of [...this.pendingQueues]) {      // V4：单源遍历
      if (Date.now() - drainStart > 8_000) break;                // X7：总闸——剩余转 force-spool
      const frames = await this.raceDeadline(this.peekSpoolFrames(projectId), 500, []);   // 磁盘挂起防护
      if (q.length === 0 && frames.length === 0) continue;
      const name = `project:${projectId}`;
      const document = this.server.hocuspocus.documents.get(name);
      if (!document) {
        await this.drainDetachedProject(projectId, hardDeadline);
        continue;
      }
      const remaining = Math.max(200, Math.min(2_000, hardDeadline - Date.now()));
      try {
        await Promise.race([
          this.storeDocumentSerialized({ document, documentName: name }),
          new Promise<void>((r) => { setTimeout(r, remaining).unref?.(); }),
        ]);   // race 超时=resolve 不进 catch——不 leave（Y12：挂起中批未落定，点名应含）
      } catch (err) {
        this.logger.warn(`drain store failed for ${name}: ${(err as Error).message}`);
        this.leaveInFlight(projectId);                           // 仅意外异常 leave（幂等——迟到的真 leave 无双扣）
      }
      if (Date.now() > hardDeadline) break;
    }
    const p = this.computePending();
    if (p.projects === 0 && p.batches === 0) {
      this.logger.log(JSON.stringify({ event: 'shutdown_drain_complete', pending: p, spoolResidual: { files: p.spoolFiles, bytes: p.spoolBytes }, storeInFlight: this.inFlightProjects.size }));   // X17：spoolResidual 显式（防误读"全部落 PG"）
      return;
    }
    // force-spool（每次 append 可切断——剩余 hardDeadline 为界；J5 按返回值判定）
    let forced = 0;
    for (const [projectId, q] of [...this.pendingQueues]) {
      if (q.length === 0) continue;
      if (Date.now() > hardDeadline) break;                      // X7：硬切断——点名其余
      const n = q.length;
      const payload = n === 1 ? q[0] : Y.mergeUpdates(q.slice());   // copy——不动队列
      try {
        const ids = await this.raceDeadline(this.spool.append(projectId, payload), Math.max(200, hardDeadline - Date.now()), null);
        if (ids !== null) { q.splice(0, n); this.leaveInFlight(projectId); forced += 1; }   // J5：真写成才 splice（null=race 超时未落定——留队列点名；后到的成功帧=重复回灌，幂等吸收）
      } catch { /* 留队列——点名 */ }
    }
    const p2 = this.computePending();
    this.logger.error(JSON.stringify({ event: 'shutdown_undrained', batches: p2.batches, projects: p2.projects, spoolFiles: p2.spoolFiles, spoolBytes: p2.spoolBytes, storeInFlight: this.inFlightProjects.size, forcedSpool: forced }));
  }

  /** X7：op 套 deadline——超时返回 fallback（op 自身继续跑，结果被弃） */
  private async raceDeadline<T>(op: Promise<T>, ms: number, fallback: T): Promise<T> {
    return Promise.race([op, new Promise<T>((r) => { setTimeout(() => r(fallback), ms).unref?.(); })]);
  }

  /** V4：doc 已卸载但归属仍在——spool 帧三段式直灌（append→confirm，每帧套剩余预算） */
  private async drainDetachedProject(projectId: string, hardDeadline: number): Promise<void> {
    for (const f of await this.peekSpoolFrames(projectId)) {
      if (Date.now() > hardDeadline) return;
      try {
        const r = await this.repo.append(projectId, f.payload);
        if (r.ok) await this.spool.confirm(projectId, [f.frameId]);
      } catch { /* 帧保留——点名 */ }
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
