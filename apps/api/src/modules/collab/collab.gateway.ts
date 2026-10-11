import { Injectable, Logger, NotFoundException, Optional, Inject, OnApplicationShutdown, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Server } from '@hocuspocus/server';
import type { afterStoreDocumentPayload, beforeHandleAwarenessPayload, beforeUnloadDocumentPayload, connectedPayload, onAuthenticatePayload, onDisconnectPayload, onLoadDocumentPayload, onStoreDocumentPayload, onUpgradePayload } from '@hocuspocus/server';
import * as Y from 'yjs';
import { createHash } from 'node:crypto';
import type { ProjectRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSessionToken } from '../../common/utils/parse-session-token';
import { SessionService } from '../../auth/session.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabLeaseService } from './collab-lease.service';
import { collabAuthRejectTotal, collabAuthTimeoutTotal, collabLeaseLostTotal, collabStartFailureTotal, collabLeaseRowMissingTotal, collabSweepCloseTotal, collabUpgradeRejectedTotal, collabLoadRejectedTotal, collabOverloadState, collabVersionNegotiationRejectTotal, collabWsCloseTotal, collabAwarenessRejectTotal, registerAuthInflightReader, registerHeapObserverReader, registerPendingCollector, unregisterAuthInflightReader, unregisterHeapObserverReader, unregisterPendingCollector, yjsCanvasDocBytes, storeInFlightDocs, yjsDeletedProjects, yjsDocStuckTotal, yjsStoreAppendFailureTotal, yjsStoreCompactFailureTotal, yjsStoreDrainTotal, yjsStoreHookCallsTotal, yjsStoreTailAnomalyTotal, yjsStoreUnexpectedThrowTotal, yjsUnloadCleanupFailureTotal, yjsUnloadHandoffFailureTotal, yjsUpdatesDiscardedDeletedTotal } from './store.metrics';
import { TokenBucket } from './token-bucket';
import { CollabSpoolService } from './collab-spool.service';
import { isFkGone } from './pg-error.util';
import { CollabAuthReason, CANVAS_DOC_SCHEMA_VERSION, CollabCloseCode, ensureSchemaVersion, negotiateClientVersion, stampDocSchema, userColorOfUserId, type CollabAuthReasonCode, type VersionVerdict } from '@flowweb/shared';
import { toDocLike } from './doc-like.util';
import { DEFAULT_RSS_RELEASE_BYTES, DEFAULT_RSS_TRIP_BYTES, measureHeapPressure, releaseHook, type HeapPressureSample } from './heap-pressure';

/** Y0a-3 T5（SV7/W）：collab 面七态（模块别名——method 签名里 `typeof this.collabState` 有 TS 解析风险，恒用本名）。
 *  serving=唯一放行态；draining=部署停写；isolated=自隔离（listener 已让位）；start-failed=启动失败（有界重试）。 */
type CollabState = 'initializing' | 'acquiring' | 'starting' | 'serving' | 'draining' | 'isolated' | 'start-failed';

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
/** 批3-4 sweep 轮询与 grace 窗。Y0b-3 T8：间隔 60s→5min——事件驱动为主（collab.perm.changed 即时
 *  踢权）后 sweep 降为兜底；±20% jitter 见 sweepIntervalMs（setTimeout 自排链逐轮重排）。 */
const SESSION_SWEEP_INTERVAL_MS = 5 * 60_000;
const SESSION_SWEEP_GRACE_MS = 5_000;

/** X10（Y0a-2）：WS 消息路径禁 mergeUpdates——入队只 push，跨软阈（64 条/1MB）才闩锁 setImmediate
 *  提前 store（跨阈代价=一次整批 store 的 debounce 等待；低于软阈维持库 debounce 批量语义）。
 *  PENDING_MAX_ENTRIES=64 语义由"原地折叠触发点"改为"提前 flush 触发点"（折叠全部移出 WS 路径）。 */
const PENDING_MAX_ENTRIES = 64;
/** 软阈字节档：条数少但字节大（大图/长文本粘贴）同样提前 flush。 */
const FLUSH_SOFT_BYTES = 1_048_576;
/** Y7 硬阈（Y24 内存上界）：只在 store 取批点收口——超阈就地折并（splice 原地、数组身份恒定）。
 *  裁定注记（Y7 gate 裁定）：**不加 inFlight 门**——一切 store 入口（库 debounce/断连/退避梯/drain/
 *  软阈 flush）都经 saveMutex 串行，取批与折并同锁零交织窗；update 监听器在折并 await 窗口内只会
 *  push（X10 禁 merge），I-2 批尾引用锚是唯一竞态兜底。门本身结构性死锁（双败故障期 inFlight 恒置位
 *  ——X2 落定口径——带门的折并永不执行=Y24 上界破约），故直接删除门形态。 */
const COALESCE_MAX_ENTRIES = 512;
const COALESCE_MAX_BYTES = 8 * 1024 * 1024;

/** 批字节累加（软阈判定用——Uint8Array.byteLength 求和） */
const queueBytes = (q: Uint8Array[]): number => q.reduce((s, u) => s + u.byteLength, 0);

export function parseProjectId(documentName: string): string {
  return documentName.replace(/^project:/, '');
}

/** Y0b-3 T5 版本门四档映射（I-1 穷尽性 Record——VersionVerdict 加档时 tsc 红，杜绝 if/else 链
 *  兜底静默映射终态档 SCHEMA_OUTDATED）。键序=VersionVerdict 声明序（allow 除外）。 */
const REASON_BY_VERDICT: Record<Exclude<VersionVerdict, 'allow'>, CollabAuthReasonCode> = {
  'client-version-missing': CollabAuthReason.CLIENT_VERSION_MISSING,
  'client-version-invalid': CollabAuthReason.CLIENT_VERSION_INVALID,
  'schema-outdated': CollabAuthReason.SCHEMA_OUTDATED,
  'server-outdated': CollabAuthReason.SERVER_OUTDATED,
};

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
  /** X10：软阈提前 flush 闩锁（projectId 键）——重复跨阈触发合并为一次 setImmediate（WS 路径
   *  零合并零重复排程；回调内队列空/doc 不在即静默返回，批由退避梯/断连/drain 路径兜底）。 */
  private readonly flushScheduled = new Set<string>();
  /** 批3-3：session 查询/滑动续期统一入口（手写 findUnique 收口；直构测试不传时以注入的 prisma 兜底自建） */
  private readonly sessionSvc: SessionService;
  /** Y0b-3 T2（P-R）：WS 升级限流桶（per-IP——DoS 兜底非配额；60/min 补充+burst 20；重启清零） */
  private readonly upgradeBucket: TokenBucket;
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
  /** SV7/W 状态机（单枚举消灭布尔组合态）：ready reason 与三入口门 1:1 派生（P6）。
   *  serving=唯一放行态；draining=部署停写（与 /api/drain 同一位）；isolated=自隔离（listener
   *  已关让位——rejoin 由 lease.rejoinLoop 驱动/revoked 终态）；start-failed=启动失败（有界重试）。 */
  private collabState: CollabState = 'initializing';
  private initDone = false;             // V9/I3：成功后置（scan/隔离/回灌/rearm 四步全成才 true——早置=失败重试跳过 init 带半截索引上线）
  private startInFlight = false;        // V10：starting 在飞闸（watchdog/5s 定时器/fast-path 并发重入防线）
  private shuttingDown = false;         // V11：关停闸（步骤 1 置位——isolated 态关停时 rejoin 的 CAS 成功也不得 re-listen）（与 isShuttingDown()=draining 态派生不同名同义——前者=进程关停闸含步骤 1 置位时序，后者=对外 draining 判定）
  private listenerClosed: Promise<void> | null = null;   // M2①：isolate 的 close 完成信号（re-listen 前 await）
  private listenRetries = 0;            // V10/N2③：端口类失败的有界持锁重试计数（≤2）
  private watchdogFired = false;        // N3③/V14：episode 计数标志——看门狗每 episode 至多 inc 1 次
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  /** Y0b-3 T9（H-5）：冻结连接登记 conn→prevReadOnly——解除路径先还原 readOnly 再 close
   *  （close 在 CLOSING 态是 no-op 的边角下连接可能活过本次 close，"只 close 不还原"会把
   *  存活连接永久钉在 readOnly；prev 快照同时保证 spool 熔断降级连接（prev=true）不被
   *  drain 解除误赦免）。 */
  private frozenConnections = new Map<{ readOnly?: boolean; sendStateless?: (p: string) => void; webSocket?: { close: (c: number, r: string) => void } }, boolean>();
  getCollabState() { return this.collabState; }
  /** V33 迁移单点（三轮病根的结构解）：所有 collabState 写点经此——日志+非法迁移点名。 */
  private static readonly LEGAL_TRANSITIONS: Record<string, string[]> = {
    initializing: ['acquiring', 'starting'],
    acquiring: ['starting', 'draining', 'isolated'],
    starting: ['serving', 'start-failed', 'draining', 'isolated'],
    serving: ['draining', 'isolated'],
    draining: ['serving', 'isolated'],
    isolated: ['starting', 'draining'],   // rejoin 经 startCollabAfterLease→starting
    'start-failed': ['starting', 'draining', 'isolated'],
  };
  private transition(next: CollabState, cause?: string): void {
    if (!(next === this.collabState)) {
      const legal = CollabGateway.LEGAL_TRANSITIONS[this.collabState] ?? [];
      if (!legal.includes(next)) this.logger.error(JSON.stringify({ event: 'collab_illegal_transition', from: this.collabState, to: next, cause }));
    }
    this.logger.log(JSON.stringify({ event: 'collab_state', from: this.collabState, to: next, cause }));
    this.collabState = next;
    if (next === 'serving') this.onServingTransition();   // Y0b-3 T3（P-Q 清空单点）：drain 解除/租约 rejoin/fence 解除全含于 serving 转移——refusalCache 残留拒连窗随状态恢复一并消除
  }
  /** V12 判据唯一化：三入口门/写意图门统一读 collabState 派生（serving=唯一放行态）——
   *  lease.isServing() 仅为租约状态机内部使用（acquireLoop/看门狗），对外服务判据唯一源=collabState。 */
  isLeaseServing(): boolean { return this.collabState === 'serving'; }
  /** Y0b-2 T3（Z50 修订）：PG 完整性谓词——projectId 的全部在途写已落 PG。四态合一：
   *  documents 常驻（编辑在途）/in-flight store（取批未落定）/pending 队列（去抖窗）/spool 帧
   *  （故障期台账）任一非空 ⇒ PG 快照可能滞后 ⇒ false；四态全空=drain 已冲刷完成，快照读可信。
   *  消费=readCanvasSnapshotCached 缓存门（谓词不满足→活读 fallback）+Y0b-3/4 settleStranded 前置门。 */
  isPersistedComplete(projectId: string): boolean {
    const name = `project:${projectId}`;
    return !this.server.hocuspocus.documents.has(name) && !this.inFlightProjects.has(projectId)
      && (this.pendingQueues.get(projectId)?.length ?? 0) === 0 && !this.spool.hasFrames(projectId);
  }
  /** Y0b-2 T5（Z106/Z112）：doc 常驻谓词（documents.has——区别于 isPersistedComplete 的 PG 完整性四态合一）。
   *  消费=reaper 终态投影分治：常驻才写 exec 投影，非常驻跳过+deferred 计数（UX 投影不得成为装载源——
   *  provider 故障批量收敛时 withDoc 批量装载=故障自放大，正撞 E39/heap 闸）。 */
  isDocResident(projectId: string): boolean {
    return this.server.hocuspocus.documents.has(`project:${projectId}`);
  }
  /** Y0a-2（spec §2.5+V10/V11+X1）：项目消失终态集——**永久无界**（spec §9.10：进程寿命内**真删除**项目数
   *  ——V11 emit 后置后无假终态；可见地接受：yjs_deleted_projects gauge，V25）。
   *  X1：discardForGoneProject 在**事件处理器内**调用（唯一必然执行点——doc 卸载后 store 拦截分支
   *  结构性不可达，不清则僵尸队列令 computePending 恒>0→drain_complete 永不打印+G-1 barrier 超时）；
   *  storeDocumentUnlocked 首行拦截保留兜底（事件与 store 的竞态窗）。spool 段收割=FK 双形状（V6）。 */
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
    connected: (p: connectedPayload) => Promise<any>;
    onAuthenticate: (p: onAuthenticatePayload) => Promise<any>;
    onLoadDocument: (p: onLoadDocumentPayload) => Promise<any>;
    onStoreDocument: (p: onStoreDocumentPayload) => Promise<boolean>;
    afterStoreDocument: (p: afterStoreDocumentPayload) => Promise<void>;
    beforeHandleAwareness: (p: beforeHandleAwarenessPayload) => Promise<any>;
    onDisconnect: (p: onDisconnectPayload) => Promise<void>;
    beforeUnloadDocument: (p: beforeUnloadDocumentPayload) => Promise<void>;
    onUpgrade: (p: onUpgradePayload) => Promise<void>;
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly repo: CanvasDocUpdateRepository,
    private readonly lease: CollabLeaseService,
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
    // Y0b-3 T2：升级限流——COLLAB_UPGRADE_RATE_PER_MIN 默认 60/min；burst=20 常量（多标签友好——
    // 单用户多标签页各持一条 WS 连接，burst 抬高集中握手容忍度；DoS 兜底非配额）。
    this.upgradeBucket = new TokenBucket({
      capacity: 20,
      refillPerMin: Number(process.env.COLLAB_UPGRADE_RATE_PER_MIN) || 60,
    });
    this.hooks = {
      connected: ({ socketId }) => { this.connEstablishedAt.set(socketId, Date.now()); return Promise.resolve(); },   // Y0b-3 T6：寿命台账播种
      onAuthenticate: (p) => this.authenticate(p),
      onLoadDocument: (p) => this.loadDocument(p),
      onStoreDocument: (p) => this.storeDocumentUnlocked(p),   // Y0a-2 A14：钩子直通 Unlocked（库已在 saveMutex 内调钩子——禁再包=重入死锁）
      afterStoreDocument: (p) => this.afterStoreDocument(p),
      beforeHandleAwareness: (p) => { this.guardAwareness(p); return Promise.resolve(); },   // Y0b-3 T7：states 三分支覆写（同步体——async 仅为满足库 hook 签名）
      onDisconnect: (p) => this.disconnect(p),
      beforeUnloadDocument: (p) => this.unloadDocument(p),   // Y0a-2 Task 7：卸载清理+交接（永不抛——X4）
      onUpgrade: async (p) => this.handleUpgrade(p),   // Y0b-3 T2：Origin 403+升级限流（§3.1ter——socket 直写形态；async 仅为满足库 hook 签名，同步体全吞不 reject）
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
      // Y0a-4/P25 + Y0b-3 T2：绑定面默认收口 127.0.0.1（对外暴露必须显式 COLLAB_BIND_ADDR——
      // ecosystem:27 已注入同值，翻转对部署零差异；本地 dev 直连 localhost 不受影响）。
      // 键随读者：COLLAB_BIND_ADDR 同批进 config/env.ts（T1 结构锚方向二防死键）。
      address: process.env.COLLAB_BIND_ADDR ?? '127.0.0.1',
      // Y0a-4/P24 显式 pin 双旋钮 Server 级（B20/B26：库 defaultConfiguration 即 true/false——
      // 文档锚防升级翻转，非行为修复）
      unloadImmediately: true,
      quiet: false,
      connected: this.hooks.connected,   // Y0b-3 T6：寿命台账播种钩子接线
      onAuthenticate: this.hooks.onAuthenticate,
      onLoadDocument: this.hooks.onLoadDocument,
      onStoreDocument: this.hooks.onStoreDocument,
      afterStoreDocument: this.hooks.afterStoreDocument,   // Y0a-2 V22：最小对账钩子接线（构造 Server 配置同步——同 T3 onStoreDocument 直通位置）
      beforeHandleAwareness: this.hooks.beforeHandleAwareness,   // Y0b-3 T7：awareness states 三分支覆写钩子接线（scratch Map 改写=重编码广播——esm:197-207）
      onDisconnect: this.hooks.onDisconnect,
      beforeUnloadDocument: this.hooks.beforeUnloadDocument,   // Y0a-2 Task 7：卸载清理钩子接线（v4.6.0 Server 配置）
      onUpgrade: this.hooks.onUpgrade,   // Y0b-3 T2：Origin 403+升级限流钩子接线（hook resolve 后库才 crossws.handleUpgrade）
      // Y0a-3 T5/T6：跨实例扩展挂载删除（多实例权威=PG 租约 fence——单写者由租约保证，跨实例
      // 消息同步退役；其固定断开延迟借道语义随之消失，service 本体已删）。
      // Y0b-3 T1：库选项四 pin——文档锚防升级回落（断言在 collab-gateway.options.spec）。
      websocketOptions: { maxPayload: 16 * 1024 * 1024 }, // §7.2 禁回落 ws 默认 100MiB；键集 ⊆ {maxPayload}（T1 断言）
      maxUnauthenticatedQueueMessages: 256, // §3.1bis 4 pre-auth 三 pin（库默认 1e3）
      maxUnauthenticatedQueueSize: 1024 * 1024, // 库默认 5MiB
      maxPendingDocuments: 100, // 库默认即同值——显式 pin 防升级翻转（P24 先例）
    });
    // Y0a-2（P1+V4 单源派生）：pending 观测注册——/api/metrics collect 回调现算（零手动维护点）；
    // G-1/G-2 演练轮询面+y0a-3 /api/ready.pending 消费同一 computePending()。
    registerPendingCollector(() => this.computePending());
    // Y0b-3 T3：collab_auth_inflight gauge collect 源（pendingCollector 同惯例——同进程单 gateway）
    registerAuthInflightReader(() => this.authInflight);
    // Y0b-3 T4：观测 gauge collect 源（pendingBytes/zeroConnDocs）+卡住观测器独立 timer
    //（禁挂 startSessionSweep——SWEEP_ENABLED=false 逃生阀不得静默关掉观测）
    registerHeapObserverReader(() => ({
      pendingBytes: [...this.pendingQueues.values()].reduce((s, q) => s + queueBytes(q), 0),
      zeroConnDocs: [...this.server.hocuspocus.documents.values()].filter((d) => d.connections.size === 0).length,
    }));
    this.startHeapObserver();
    this.syncOverloadGauge(false);   // 初始 seed：ok=1/tripped=0 两 series 常在（面板恒可见）
    this.startAuthMapsSweeper();   // P-V⑦：防线 Map 老化独立 timer——禁挂 sweep tick（SWEEP_ENABLED=false 逃生阀不得静默关掉老化）
  }

  /** ===== Y0b-3 T2：upgrade 面（§3.1ter）=====
   *  Origin 白名单+升级限流，拒绝形态=socket 直写 403/429+end（hook throw=库 async 监听器内
   *  unhandled rejection 形同虚设〔hocuspocus esm:1623-1636 实证〕——必须 socket 直写让客户端
   *  收到真实 HTTP 响应；hook 自身全函数 try/catch fail-open：校验面炸不阻断升级，鉴权仍由
   *  onAuthenticate 兜底）。hook 正常 resolve 后库仍调 crossws.handleUpgrade——对已 end socket
   *  的后续握手写由 ws 的 socketOnError 吞（handleUpgrade 首行注册 error 监听，无进程崩溃）。
   *  end 替代 destroy（P-R：write 后立即 destroy 丢弃未发送字节=客户端收 RST 非 403）。 */
  private handleUpgrade({ request, socket }: onUpgradePayload): void {
    try {
      const origin = request.headers.origin;
      if (typeof origin !== 'string' || !this.allowedOrigins().includes(origin)) {
        collabUpgradeRejectedTotal.inc({ reason: 'origin' });
        this.rejectUpgrade(socket, 'HTTP/1.1 403 Forbidden');
        return;
      }
      const ip = this.clientIpOf(request, socket);
      if (!this.upgradeBucket.consume(ip)) {
        collabUpgradeRejectedTotal.inc({ reason: 'rate-limited' });
        this.rejectUpgrade(socket, 'HTTP/1.1 429 Too Many Requests');
      }
    } catch (e) {
      // fail-open：升级面校验炸=放行（onAuthenticate 兜底鉴权）。I-3：真实触发面存在（BETTER_AUTH_URL
      // 配垃圾串→allowedOrigins 内 new URL 抛 TypeError→每次升级静默 fail-open、Origin 防线全失）——
      // 必须留痕，否则运维零可见。
      this.logger.warn(`[y0b-3] onUpgrade fail-open：${(e as Error)?.message}`);
    }
  }

  /** 拒绝响应直写（403/429 同族——P-G/P-R 形态单点） */
  private rejectUpgrade(socket: { write?: (s: string) => void; end?: () => void }, statusLine: string): void {
    try {
      socket?.write?.(`${statusLine}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket?.end?.();
    } catch { /* 已断 */ }
  }

  /** Origin 白名单：显式 COLLAB_ALLOWED_ORIGINS（逗号分隔）> BETTER_AUTH_URL origin 推导
   *  （缺省 dev http://localhost:5173）。P-R：生产不注入 localhost（非浏览器工具可注入任意
   *  Origin——localhost 在表=多余绕过面）；dev 推导表补 127.0.0.1:5173（vite host:0.0.0.0 下
   *  用 127.0.0.1 打开时 origin 不含 localhost——403 全灭）；LAN IP 场景显式 COLLAB_ALLOWED_ORIGINS。 */
  private allowedOrigins(): string[] {
    const raw = process.env.COLLAB_ALLOWED_ORIGINS;
    if (raw) return raw.split(',').map((s) => s.trim()).filter(Boolean);
    const base = process.env.BETTER_AUTH_URL ?? 'http://localhost:5173';
    const origins = [new URL(base).origin];
    if (process.env.NODE_ENV !== 'production') {
      for (const dev of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
        if (!origins.includes(dev)) origins.push(dev);
      }
    }
    return origins;
  }

  private trustedProxyEnabled(): boolean {
    return process.env.COLLAB_TRUSTED_PROXY === '1';
  }

  /** 升级面客户端 IP（限流键）。X-Real-IP 仅 socket peer 为 loopback 时信任（绑定 127.0.0.1+
   *  nginx 同机使前提成立；nginx conf 已设 X-Real-IP）+COLLAB_TRUSTED_PROXY='1' 门控（P-I 双门——
   *  未设 env=peer 恒用，全站单桶=生产必须设 env，部署告知项）。M-1：private（唯一消费=handleUpgrade；
   *  测试走 (gw as any)）。 */
  private clientIpOf(request: { headers: Record<string, unknown> }, socket: { remoteAddress?: string }): string {
    const peer = socket?.remoteAddress ?? '';
    const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
    if (loopback && this.trustedProxyEnabled()) {
      const xri = request.headers['x-real-ip'];
      if (typeof xri === 'string' && xri) return xri;
    }
    return peer || 'unknown';
  }

  /** ===== Y0b-3 T3（P-F/P-K/P-Q）：认证防线三层+权限判据单源 =====
   *  结构（§3.1bis 钉死）：authenticate()=外层防线壳（refusalCache→信号量→桶→try{inner}finally——
   *  heap 闸〔T4〕/版本门〔T5〕已插入 inner 内）；authenticateInner()=原方法体
   *  （状态检查→token→session→权限段 resolveWithTeam 单源→DB）。
   *  信号量/桶的 throw 在 try 之外=不经过写缓存的 catch（P-F 结构分离："瞬时拥塞≠状态故障"
   *  按 throw 来源结构分离，非 reason 值——入缓存=一次拥塞变 15s 确定性拒绝）；
   *  inner 的 throw 进外层 catch→reason∈REFUSAL_CACHEABLE（四类）→写 cache。 */
  private readonly refusalCache = new Map<string, { reason: CollabAuthReasonCode; at: number }>();
  private authInflight = 0;
  private authInflightPeak = 0;   // peak 仅测试/演练观测用（进程寿命只写不读）——生产 gauge=collab_auth_inflight collect 读 authInflight 现值
  private readonly authAttemptBuckets = new Map<string, { count: number; windowStart: number }>();
  /** Y0b-3 T6：连接寿命台账（socketId → 建立时点）。键=connected/onAuthenticate/onDisconnect 三钩子
   *  共有稳定键（onDisconnectPayload 无 connection 字段〔d.ts:687-696〕——Connection 键 Map=死代码）。
   *  写点三处：connected 播种 / onDisconnect+closeTeamDocuments+beforeUnloadDocument 键控清理（防无界）；
   *  读点一处：sweep tick 首部 enforceConnMaxLifetime。 */
  private readonly connEstablishedAt = new Map<string, number>();
  /** ===== Y0b-3 T7（E73/spec §3.3）：awareness 归属表（双索引）+认证身份表 =====
   *  clientIdOwner=归属权威（clientId→socketId，O(1) 伪造判定——库 connections 的 clients 集在 hook
   *  之后才填充〔esm:625-634〕不能作权威，自建表语义）；ownedClientIds=socketId→clientIds 反向索引
   *  （上限计数=.size；剪枝/断连清理/T8 role 改写按自有 Set 迭代 O(自己)）；socketIdentity=认证身份
   *  （authenticate 成功路径播种——覆写 user 的来源，不读 connection.context 防未认证帧绕过）。 */
  private readonly clientIdOwner = new Map<number, string>();
  private readonly ownedClientIds = new Map<string, Set<number>>();
  private readonly socketIdentity = new Map<string, { id: string; name: string; role: string; teamId: string }>();
  /** 漂移告警去重（socketId 级——漂移持续期只告警一次，恢复即清；防热路径刷屏） */
  private readonly awarenessDriftLogged = new Set<string>();
  private lastSpoolState: 'ok' | 'spool-unwritable' = 'ok';   // spool 恢复翻转检测（清空并集的 spool 支——谓词非集合，消费点记上一态）
  private authMapsSweepTimer: ReturnType<typeof setInterval> | null = null;
  /** sweep 判据门第二分支（P-K）：per-connection 权限结论缓存（5min 会话级 TTL——WeakMap 随连接回收）；
   *  T8 事件失效消费=仅 delete 不直接 recheck。 */
  private readonly permCache = new WeakMap<object, { role: ProjectRole | null; at: number }>();
  /** Y0b-3 T4（spec §3.2）：heap 压力闸观测态+卡住观测连续轮数+观测 timer（独立——不挂 startSessionSweep，
   *  SWEEP_ENABLED=false 逃生阀不得静默关掉观测）。 */
  private overloadTripped = false;   // gauge/日志翻转检测缓存（真实状态在 heap-pressure util 迟滞内）
  private readonly docStuckRounds = new Map<string, number>();
  private heapObserverTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly REFUSAL_CACHEABLE = new Set<string>([
    CollabAuthReason.DRAINING, CollabAuthReason.LEASE_NOT_READY,
    CollabAuthReason.DB_UNAVAILABLE, CollabAuthReason.SERVER_OVERLOADED,
  ]);   // §3.1bis 白名单精确四类（terminal 不入=客户端已 disconnect；信号量溢出/桶超限不经此——P-F 结构分离）；SERVER_OVERLOADED 自 T4 起可达（heap 闸在 inner 首行 throw 经此写缓存——信号量层 throw 仍不经此）
  /** AUTH deadline——DB 段超时折 db-unavailable（防慢 DB 挂满信号量；不加 env=YAGNI）。
   *  边界：Promise.race 到期不取消底层 Prisma 查询——约束的是信号量槽位占用，非 DB 工作量；
   *  DB 真实并发由池 connection_limit=5 兜底（池 5−REST/worker 预留≥INFLIGHT 4——禁单独调大任一破坏预算）。 */
  private static readonly AUTH_DB_DEADLINE_MS = 3_000;
  private static readonly PERM_RECHECK_TTL_MS = 5 * 60_000;   // §3.1bis：sweep 权限复验周期=会话级结论缓存 5min
  private withAuthDeadline<T>(p: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      p.finally(() => { if (timer) clearTimeout(timer); }),   // settle 即清 timer（I-1：不清理则成功路径迟到 fire=假超时计数，指标报废）
      new Promise<never>((_resolve, rej) => {
        timer = setTimeout(() => {
          collabAuthTimeoutTotal.inc();
          rej(Object.assign(new Error('auth db deadline'), { reason: CollabAuthReason.DB_UNAVAILABLE }));
        }, CollabGateway.AUTH_DB_DEADLINE_MS);
        timer.unref?.();
      }),
    ]);
  }
  private refusalTtlMs(): number { return Number(process.env.COLLAB_REFUSAL_CACHE_TTL_MS) || 15_000; }
  private authAttemptsPerMin(): number { return Number(process.env.COLLAB_AUTH_ATTEMPTS_PER_MIN) || 10; }
  private authInflightMax(): number { return Number(process.env.COLLAB_AUTH_INFLIGHT_MAX) || 4; }   // 默认 4——池公式 cpu×2+1=5 对齐（8×3 查询>池 5=P2024 折 db-unavailable）
  /** 清空钩子单点（P-Q）：任一 transition('serving') 转移清（fence/drain 解除/租约 rejoin 全含于
   *  serving 转移——比枚举因由稳，漏一即残留）+spool 恢复翻转+heap 释放（T4 releaseHook 接线汇入同点）。 */
  private onServingTransition(): void { this.refusalCache.clear(); }
  /** 防线三 Map 老化（P-V⑦）：TTL 过期条目清+桶过期窗清——独立 1min timer（禁挂 sweep tick——
   *  SWEEP_ENABLED=false 逃生阀不得静默关掉老化）。 */
  private sweepStaleAuthMaps(): void {
    const now = Date.now();
    for (const [k, v] of this.refusalCache) if (now - v.at >= this.refusalTtlMs()) this.refusalCache.delete(k);
    for (const [k, v] of this.authAttemptBuckets) if (now - v.windowStart >= 60_000) this.authAttemptBuckets.delete(k);
    // 防只握手不认证风暴喂新 socketId：TTL 清不掉"未满窗"的桶（60s 内持续新增）——硬上界兜底（Map 插入序=最旧优先）
    while (this.authAttemptBuckets.size > 10_000) this.authAttemptBuckets.delete(this.authAttemptBuckets.keys().next().value!);
  }
  private startAuthMapsSweeper(): void {
    if (this.authMapsSweepTimer) { clearInterval(this.authMapsSweepTimer); this.authMapsSweepTimer = null; }
    this.authMapsSweepTimer = setInterval(() => this.sweepStaleAuthMaps(), 60_000);
    this.authMapsSweepTimer.unref?.();
  }

  /** Y0b-3 T4：5min 零连接 doc 观测器（纯观测零卸载动作——v3 裁定删除 reaper：自队列谓词与库守卫
   *  在可达状态同真+库 store 排程后必 setTimeout unload 自愈+保内存分支本仓不可达〔契约 3"任何路径
   *  不 throw"〕）。独立 timer 不挂 startSessionSweep——SWEEP_ENABLED=false 逃生阀不得静默关掉观测。
   *  stuck 判据=零连接∧!isLoading∧自队列空∧库守卫不满足（shouldUnloadDocument=false=debouncer/
   *  saveMutex 未清=应卸载而未卸）连续 2 轮；自队列非空=正常流转轮内跳过（≠stuck）。 */
  private startHeapObserver(): void {
    if (this.heapObserverTimer) { clearInterval(this.heapObserverTimer); this.heapObserverTimer = null; }
    this.heapObserverTimer = setInterval(() => this.observeIdleDocs(), 5 * 60_000);
    this.heapObserverTimer.unref?.();
  }
  private observeIdleDocs(): void {
    this.heapPressureSample();   // 评审 F-2：每轮周期采样——纯需求驱动（新 doc auth/load 才采样）下 tripped 后客户端放弃重试+内存回落时 overload_state 恒读 tripped=1 假阳性喂 runbook；周期消费 releaseHook 清 refusalCache+gauge 翻转
    for (const doc of this.server.hocuspocus.documents.values()) {
      const name = doc.name;
      if (doc.connections.size > 0 || doc.isLoading) { this.docStuckRounds.delete(name); continue; }
      // pendingQueues 键=裸 projectId（播种/取用全裸键实证——get(doc.name) 恒 undefined=静默失效）
      const pid = parseProjectId(name);
      if ((this.pendingQueues.get(pid)?.length ?? 0) > 0) { this.docStuckRounds.delete(name); continue; }
      if (!this.server.hocuspocus.shouldUnloadDocument(doc)) {   // 守卫拒绝+零连接+队列空=疑似卡住
        const n = (this.docStuckRounds.get(name) ?? 0) + 1;
        this.docStuckRounds.set(name, n);
        if (n >= 2) { yjsDocStuckTotal.inc(); this.docStuckRounds.delete(name); }   // 连续 2 轮=真 stuck
      } else {
        this.docStuckRounds.delete(name);
      }
    }
  }
  /** spool 状态判定+恢复翻转检测（清空并集的 spool 支——'spool-unwritable'→'ok' 翻转时清）。 */
  private spoolStateForAuth(): 'ok' | 'spool-unwritable' {
    const s = this.isWritableOrDegraded();
    if (this.lastSpoolState === 'spool-unwritable' && s === 'ok') this.onServingTransition();
    this.lastSpoolState = s;
    return s;
  }
  /** deny 工厂单点（§5.1-5 拒绝与计数同点）：所有 onAuthenticate 拒绝路径经此——reason=词表 13 值，
   *  source=拒绝位六分位（state=inner 业务状态拒绝含 DB 折叠桶；semaphore/bucket/heap/version=防线层位；cache=缓存命中重放）。 */
  private denyAuth(reason: CollabAuthReasonCode, message: string, source: 'state' | 'semaphore' | 'bucket' | 'heap' | 'version' | 'cache'): Error {
    collabAuthRejectTotal.inc({ reason, source });
    return Object.assign(new Error(message), { reason });
  }

  /** Y0b-3 T4：heap 压力采样包装（env 三键读在此——util 收纯数值保持可测）。翻转驱动：
   *  trip 翻转→gauge+四数采样日志一条（首拒前必经翻转点——禁每拒一条 ERROR）；tripped→released
   *  翻转→util 一次性回调→onServingTransition 清 refusalCache（P-Q 钩子②）+gauge 复位。 */
  private heapPressureSample(): HeapPressureSample {
    const sample = measureHeapPressure({
      tripBytes: Number(process.env.COLLAB_RSS_TRIP_BYTES) || DEFAULT_RSS_TRIP_BYTES,
      releaseBytes: Number(process.env.COLLAB_RSS_RELEASE_BYTES) || DEFAULT_RSS_RELEASE_BYTES,
      tripRatio: Number(process.env.COLLAB_HEAP_PRESSURE_RATIO) || 0.8,
    });
    if (sample.tripped && !this.overloadTripped) {
      this.overloadTripped = true;
      this.syncOverloadGauge(true);
      const mu = process.memoryUsage();
      this.logger.warn(JSON.stringify({ event: 'collab_heap_tripped', rss: sample.rssBytes, heapUsed: sample.heapUsedBytes, heapLimit: sample.heapLimitBytes, external: mu.external, arrayBuffers: mu.arrayBuffers }));
    }
    const released = releaseHook();
    if (released) {
      this.overloadTripped = false;
      this.syncOverloadGauge(false);
      this.onServingTransition();   // P-Q：heap 释放清空汇入 serving/spool 翻转同点
      this.logger.log(JSON.stringify({ event: 'collab_heap_released' }));
    }
    return sample;
  }
  private syncOverloadGauge(tripped: boolean): void {
    collabOverloadState.set({ state: 'tripped' }, tripped ? 1 : 0);
    collabOverloadState.set({ state: 'ok' }, tripped ? 0 : 1);
  }

  /** 鉴权外壳（防线三层，§3.1bis 钉死执行序：refusalCache → 信号量 → 桶 → inner〔T4 heap 已落首行；T5 版本门后续插入〕→ DB）。
   *  fingerprint=真实凭据（P-Q）：cookie-only 后 payload.token 恒占位——从 cookie 解析真值做键
   *  （'anon' 塌缩=跨用户 15s 放大）；键=(documentName, sha256(token) 前 16 位)。
   *  无 cookie ⇒ cacheKey=null ⇒ 本轮拒绝不落缓存（anon 键会使不同来源的状态拒绝互相覆盖——写入侧短路）。
   *  拒绝一律带 reason（客户端 authenticationFailed 原样收到）；断连由库 30s 超时自然完成（桶超限不主动 close）。 */
  private async authenticate(payload: onAuthenticatePayload) {
    const credential = parseSessionToken(payload.requestHeaders?.get('cookie'));
    const fingerprint = credential ? `t:${createHash('sha256').update(credential).digest('hex').slice(0, 16)}` : null;
    const cacheKey = fingerprint ? `${payload.documentName}|${fingerprint}` : null;   // 唯一声明（读写两侧均 if(cacheKey) 短路）
    const cached = cacheKey ? this.refusalCache.get(cacheKey) : undefined;
    if (cached && Date.now() - cached.at < this.refusalTtlMs()) {
      throw this.denyAuth(cached.reason, `refusal cached: ${cached.reason}`, 'cache');   // TTL 15s 绝对过期不续期
    }
    // 全局并发认证信号量（spec 序第二层——唯一不依赖库内部结构的乘积闸）；throw 在 try 外=不经写缓存的 catch（P-F）
    if (this.authInflight >= this.authInflightMax()) {
      throw this.denyAuth(CollabAuthReason.SERVER_OVERLOADED, 'auth inflight limit', 'semaphore');
    }
    // per-socket 认证尝试桶（spec 序第三层；键=payload.socketId d.ts:480）
    const bucket = this.authAttemptBuckets.get(payload.socketId) ?? { count: 0, windowStart: Date.now() };
    if (Date.now() - bucket.windowStart >= 60_000) { bucket.count = 0; bucket.windowStart = Date.now(); }
    bucket.count += 1;
    this.authAttemptBuckets.set(payload.socketId, bucket);
    if (bucket.count > this.authAttemptsPerMin()) {
      throw this.denyAuth(CollabAuthReason.RATE_LIMITED, 'auth attempts exceeded', 'bucket');
    }
    this.authInflight += 1;
    this.authInflightPeak = Math.max(this.authInflightPeak, this.authInflight);
    try {
      return await this.authenticateInner(payload);
    } catch (err) {
      const reason = (err as { reason?: CollabAuthReasonCode } | null)?.reason;
      if (reason && CollabGateway.REFUSAL_CACHEABLE.has(reason) && cacheKey) {
        this.refusalCache.set(cacheKey, { reason, at: Date.now() });   // 无凭据不落缓存（P-Q）
      }
      throw err;
    } finally {
      this.authInflight -= 1;
    }
  }

  /** 鉴权内层（原 authenticate 方法体——Y0b-3 T3 改名+判据单源化）：
   *  token 只来自 httpOnly cookie（Y0b-3 T2 cookie-only；BetterAuth getSession 在 NestJS 上下文失效——session 直查 DB）。
   *  spec 1.2：VIEWER 连接置 readOnly，Hocuspocus 拒绝其写更新。
   *  批3-1：已分型异常原样 rethrow，其余（DB 抖动等未打标）一律折成 db-unavailable（瞬态桶，契约锁㉙）。
   *  批3-3：session 查询统一走 SessionService.touchWithReason——age>updateAge(1d) 顺带续期 7d；
   *  context 携带 token/sessionExpiresAt 供 sweep 复验。 */
  private async authenticateInner({ requestHeaders, requestParameters, documentName, connectionConfig, socketId }: onAuthenticatePayload) {
    const deny = (reason: CollabAuthReasonCode, message: string) => this.denyAuth(reason, message, 'state');
    try {
      // Y0b-3 T4 heap 闸（§3.1bis 序：外层桶/信号量→heap→DB——"压力期被拒重连不得打 DB"）：
      // 仅拒新物化（!documents.has 前置——压力期放行存量编辑防自伤）；source='heap' 经 deny 工厂
      // 单点计数；throw 带 reason→外层 authenticate catch 写 refusalCache（SERVER_OVERLOADED 在白名单）。
      if (!this.server.hocuspocus.documents.has(documentName) && this.heapPressureSample().tripped) {
        collabLoadRejectedTotal.inc({ reason: 'server-overloaded' });   // P-B 双计数（auth 面）
        throw this.denyAuth(CollabAuthReason.SERVER_OVERLOADED, 'server overloaded', 'heap');
      }
      // Y0b-3 T5 版本门（§3.1bis 序：heap 之后 DB 之前——旧/新客户端零 DB 往返）：
      // csv 精确相等四档（negotiateClientVersion 单源）；cb=审计透传通道本批不消费
      // （遥测 clientBuild 预留=Y0b-5——URL 带上即通道建立）。版本族不入 REFUSAL_CACHEABLE
      // （确定性拒绝无 TTL 语义；终态档客户端已 disconnect 不重试，瞬态档 server-outdated 重试同拒）。
      const verdict = negotiateClientVersion(requestParameters?.get('csv') ?? null);
      if (verdict !== 'allow') {
        const reason = REASON_BY_VERDICT[verdict];   // 收窄后直接索引（Exclude<VersionVerdict,'allow'>）——无兜底
        collabVersionNegotiationRejectTotal.inc({ reason });
        throw this.denyAuth(reason, `client protocol ${verdict}`, 'version');
      }
      // 状态检查先于凭据提取：状态类拒绝（draining/lease-not-ready）与凭据无关——无凭据连接也得到
      // 状态分型（凭据缺失只影响外层 cacheKey=null 不落缓存，不改变拒绝语义）。
      // Y0a-2（X9）：draining=关停期拒新连接（瞬态档）；spool 熔断=只读降级（放行但 readOnly）。
      // DRAINING 档必须前置于租约门：draining 时 collabState≠'serving'，租约门先行=死代码+误导 reason。
      if (this.isShuttingDown()) throw deny(CollabAuthReason.DRAINING, 'service restarting');
      if (!this.isLeaseServing()) throw deny(CollabAuthReason.LEASE_NOT_READY, 'collab lease not held');   // P0-1 三入口①（V12：collabState 派生——serving=唯一放行态）
      const spoolState = this.spoolStateForAuth();   // 恢复翻转检测在此（P-Q 清空并集 spool 支）
      if (spoolState !== 'ok') {
        connectionConfig.readOnly = true;          // X9：只读降级（协议层拒写更新）
        this.broadcastSpoolDegraded(documentName); // Y9：独立通告通道
      }
      const token = parseSessionToken(requestHeaders?.get('cookie'));   // T2 cookie-only——query token 通道删除
      if (!token) throw deny(CollabAuthReason.UNAUTHENTICATED, '未登录');
      const { session, expired } = await this.withAuthDeadline(this.sessionSvc.touchWithReason(token));
      if (!session) throw deny(expired ? CollabAuthReason.SESSION_EXPIRED : CollabAuthReason.UNAUTHENTICATED, expired ? '会话过期' : '未登录');
      // —— 权限段（F-3 判据单源——P-K）：原 canvasProject.findUnique+teamMember.findUnique 硬门+
      // perm.resolve 三段整体换为一次 resolveWithTeam（显式 ProjectMember>创建者>团队回退——
      // 4-5 次冗余往返归 1-3 次，信号量乘积闸才有意义）。⚠ 权限语义 A：removeMember 不触碰
      // ProjectMember 表=移出团队但有显式授权仍保留访问（REST assertEditor 同链既有语义）。
      const projectId = parseProjectId(documentName);
      let resolved: { role: ProjectRole | null; teamId: string };
      try {
        resolved = await this.withAuthDeadline(this.perm.resolveWithTeam(projectId, session.user.id));
      } catch (e) {
        if (e instanceof NotFoundException) throw deny(CollabAuthReason.NOT_FOUND, '项目不存在');   // 保 NOT_FOUND/FORBIDDEN 分型（客户端 UX 分流依赖）
        throw e;   // 其余进 catch 分型（DB_UNAVAILABLE 等）
      }
      if (!resolved.role) throw deny(CollabAuthReason.FORBIDDEN, '无项目访问权限');
      const readOnly = resolved.role === 'PROJECT_VIEWER';
      // v4 运行时只读机制：onAuthenticate 返回值仅 merge 进 context，须置 connectionConfig
      // （setUpNewConnection 以它构造 Connection，写更新按 connection.readOnly 拒绝）
      if (readOnly) connectionConfig.readOnly = true;
      // 批3-4：unhealthy 电平期的新连接补推 persist-status（payload 无 connection——v4 形状，
      // 延迟到本 tick 后连接已注册进 document.connections）
      if (this.persistUnhealthy.has(documentName)) {
        const t = setTimeout(() => this.pushPersistStatus(documentName), 500);
        t.unref?.();
      }
      // Y0b-3 T7：认证成功即播 socketIdentity（guardAwareness 覆写 user 的唯一来源——防未认证帧绕过）
      this.socketIdentity.set(socketId, { id: session.user.id, name: session.user.name, role: resolved.role, teamId: resolved.teamId });   // Y0b-3 T8：+teamId（perm.changed 事件匹配依据）
      return {
        user: { id: session.user.id, name: session.user.name, role: resolved.role },   // 词表统一 ProjectRole（TeamRole OWNER/MEMBER 混用终结）
        readOnly,
        token,   // sweep 复验凭据（context 只在服务端内存，不外发）
        sessionExpiresAt: session.expiresAt,   // sweep 死线快照（必过期下界）
      };
    } catch (err) {
      if (err instanceof Error && (err as Error & { reason?: CollabAuthReasonCode }).reason) throw err;   // 已分型原样透传（denyAuth 已计数；withAuthDeadline 超时另有专表不双计）
      throw this.denyAuth(CollabAuthReason.DB_UNAVAILABLE, `db unavailable: ${(err as Error).message}`, 'state');
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
    if (!this.isLeaseServing()) {
      throw Object.assign(new Error('collab lease not held'), { reason: CollabAuthReason.LEASE_NOT_READY });   // P0-1 三入口②（P1 正确性门——外层 catch 对带 reason 异常透传）
    }
    // Y0b-3 T4 heap 闸（三入口汇聚点·WS/DirectConnection/REST withDoc——lease 门后）：仅拒新物化。
    // 可达性：库 createDocument 在 onLoadDocument hook 返回后才 documents.set（esm:1438）——hook 内
    // 对新 doc 恒 !has=两面可达；重放/复用窗（has=true）放行防自伤。throw 形态=SUE 带
    // code='COLLAB_NOT_SERVING'——CollabNotServingFilter 只认 body.code 才附 Retry-After: 2（REST
    // 面 503 语义化；字符串形态落 fallback 无 Retry-After=T9 retryAfter 消费静默降级）。WS 面
    // err.reason 透传进 PermissionDenied 帧不变（本 throw 在 try 外——不经 loadDocument 兜底 catch）。
    if (!this.server.hocuspocus.documents.has(documentName) && this.heapPressureSample().tripped) {
      collabLoadRejectedTotal.inc({ reason: 'server-overloaded' });
      throw Object.assign(new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'server overloaded' }), { reason: CollabAuthReason.SERVER_OVERLOADED });
    }
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
          q.push(u);   // X10：WS 消息路径只 push（禁合并编码——3000 条积压实测同步折并 4.8s 阻塞消息路径）
          // 软阈跨点（超过 64 条/1MB——严格 >，第 65 条/超 1MB 触发）→ 闩锁 setImmediate 提前 store；硬阈折并在 store 取批点收口（同锁零交织）
          if (q.length > PENDING_MAX_ENTRIES || queueBytes(q) > FLUSH_SOFT_BYTES) this.scheduleSoftFlush(projectId);
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
      // O0b-0 版本门 v2.1（判据单源=shared ensureSchemaVersion——本处只留 stamp 自愈分支+拒绝日志+
      // refusal 标记；replay 完成后同步判，stamp 的 update 不在 replaying 抑制窗内 → 进 pending →
      // 下次 store 落库）
      const nodeCount = [...document.getMap('nodes').keys()].length;
      try {
        ensureSchemaVersion(toDocLike(document));
      } catch (e) {
        this.logger.error(`[O0b-0] 版本门拒绝载入 ${documentName}：${(e as Error).message}（${nodeCount} 节点）`);
        // schemaRefusal 标记：外层 catch 透传（版本门拒≠db-unavailable——不折瞬态桶）。
        // E56 v2.1 断链修复（Y0b-3 T6）：附 reason（词表第五终态档）——库 esm:939 透传 error.reason，
        // 客户端 authenticationFailed.reason==='schema-outdated' 通路可达（下方 db-unavailable 已有
        // 附 reason 惯例——补齐同风格）；缺此行客户端收字面量 permission-denied 落瞬态桶。
        throw Object.assign(e as Error, { schemaRefusal: true, reason: CollabAuthReason.SCHEMA_OUTDATED });
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
      // Y7 硬阈（Y24 内存上界）：超过 512 条/8MB（严格 >，第 513 条触发）就地折并——splice 原地保数组身份；内容全保留（合并元素即本批）。
      // 无 inFlight 门（裁定见常量块注记）：与取批同锁串行，push-only WS 路径零交织；双败期折并照常
      // 执行=上界收敛（600k 条 → 1 合并元素），I-2 批尾锚为唯一竞态兜底。
      if (queue.length > COALESCE_MAX_ENTRIES || queueBytes(queue) > COALESCE_MAX_BYTES) {
        queue.splice(0, queue.length, Y.mergeUpdates(queue));
      }
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
      let appended = false; let fenced = false; let rowMissing = false; let notHeld = false;
      try {
        const r = await this.repo.append(projectId, payload);      // AppendResult（契约 15）+5s 事务上界（V8）
        if (r.ok) appended = true;
        else {   // AppendResult fenced 单失败档（no-row 已删——0 行只可能是 fenced 或 throw，T3 repo 实证）
          fenced = true;
          this.logger.error(`append fenced for ${projectId}（租约失守——批走 spool，不排退避梯）`);
          this.selfIsolate('fenced-by-write');   // 必办①：closeAll1012+listener 释放+lost{cause} 单点计数
        }
      } catch (err) {
        if ((err as { leaseRowMissing?: boolean })?.leaseRowMissing) {
          // SV13/W11/I5：配置错误重试无用——但**照常走下方 spool 兜底**（早退=批只留内存，重启即丢=BOI 实质失效）
          rowMissing = true;
          collabLeaseRowMissingTotal.inc();
          this.logger.error(JSON.stringify({ event: 'lease_row_missing', projectId, note: '批落 spool（BOI）；修复=补 CollabLease 行后重启回灌' }));
        } else if ((err as { leaseNotHeld?: boolean })?.leaseNotHeld) {
          // V13/I5：隔离/释放过渡窗在飞 store 撞 owner=null（P7 throw）——与 fenced 同处置（落 spool+不排梯），
          // 不进通用分支（否则误报 DB 故障+failure 计数污染——日志事件区分）
          notHeld = true;
          this.logger.error(JSON.stringify({ event: 'lease_owner_not_set', projectId, note: '隔离/释放过渡窗——批落 spool（BOI）不排梯' }));
        } else if (isFkGone(err)) {                                // V6：FK 判别=isFkGone（pg-error.util 单源——X15）
          queue.splice(0, n);
          yjsUpdatesDiscardedDeletedTotal.inc({ source: 'gateway' });
          this.leaveInFlight(projectId);                           // X2 落定点③：FK/终态丢弃
          this.logger.warn(`store append hit FK for ${projectId}——batch discarded (project deleted)`);
          return false;
        } else {
          this.logger.error(`store append failed for ${projectId}, ${parts.length} updates: ${(err as Error).message}`);
          yjsStoreAppendFailureTotal.inc();
        }
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
        // E71（Y0b-2 T8）：store 成功路径 emit——doc 已落 PG，消费面（video-work process 快照）双层失效。
        //  emit 非 emitAsync（V11 纪律：store 取批点在 saveMutex 内，不等监听器；监听器自兜底不抛）。
        this.eventEmitter.emit('canvas.doc-saved', { projectId });
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
          if (!fenced && !rowMissing && !notHeld && !this.retryingPersistDocs.has(documentName)) this.schedulePersistRetry(documentName);
          return false;                                            // 任何路径不 throw（契约 3）——熔断计数在 spool 内
        }
      }
      if (queue.length === 0) this.leaveInFlight(projectId);       // 队列空=批全在 spool（fsync 已完成=契约 14 落定点；帧后续落 PG 归回灌——非 at-risk，J4 注）
      this.setPersistStatus(documentName, false);
      if (!fenced && !rowMissing && !notHeld && !this.retryingPersistDocs.has(documentName)) this.schedulePersistRetry(documentName);        // fenced/rowMissing/notHeld=终态/配置错禁退避梯；审查 I-2：per-doc 在飞不自排（A 项目在飞不误罩本项目；档位推进归 retryPersist catch）
      return false;                                                // 任何路径不 throw（契约 3）
    } catch (err) {   // Y2 兜底：意外异常（Y.mergeUpdates 炸/IO 逃逸等）——leave 防漂移+ERROR 留痕；正常失败路径（上文 return false）不经此
      this.leaveInFlight(projectId);
      yjsStoreUnexpectedThrowTotal.inc();   // Y0b-3 T4：兜底命中可观测（原仅 ERROR 日志）
      this.logger.error(`store unexpected throw for ${documentName}: ${(err as Error).message}——契约 3 最后一道闸（批保留原归属地）`);
      return false;
    }
  }

  /** V10：终态拦截的显式清账——丢弃是对的，静默丢弃不是。Y1：丢弃=归属落定——leaveInFlight
   *  （Set.delete 幂等；事件到达时 store 在飞的窗口由此收口，防已删项目永久占用 storeInFlight）。 */
  private discardForGoneProject(projectId: string, documentName: string): boolean {
    const q = this.pendingQueues.get(projectId);
    const batches = q?.length ?? 0;
    if (q && batches > 0) {
      const bytes = (q ?? []).reduce((s, u) => s + u.byteLength, 0);
      q.splice(0);
      // Task 6 Minor 1：零批=没发生丢弃——不计数不点名（告警面干净）；有批才显式接受
      yjsUpdatesDiscardedDeletedTotal.inc({ source: 'gateway' });
      this.logger.warn(JSON.stringify({ event: 'project_gone_discard', projectId, batches, bytes }));
    }
    this.leaveInFlight(projectId);   // Y1：X2 落定点④无条件执行（幂等 delete——事件到达时 store 在飞窗由此收口）
    return false;
  }

  /** Y0a-2（V10/V11 单点收敛）：项目消失终态处理——三删除入口（project.delete/cleanDrafts/
   *  template.delete 级联）**事务提交后** emit 汇入此点（team.disbanded 同点汇入）。事件处理器
   *  **禁慢操作**（V11：emitAsync await 监听器——只做内存终态+显式清账+关连接，零磁盘 I/O；
   *  team.service emitAsync 先例同形）。
   *  X1：discardForGoneProject 在此调用=**唯一必然执行点**（doc 卸载后 store 拦截分支结构性
   *  不可达，不清则僵尸队列令 computePending 恒>0→drain_complete 永不打印+G-1 barrier 超时）；
   *  storeDocumentUnlocked 首行拦截保留兜底（事件与 store 的竞态窗）；
   *  spool 段收割=FK 双形状（V6——本处理器不触盘）。 */
  private handleProjectsGone(projectIds: string[]): void {
    for (const projectId of projectIds) {
      this.deletedProjects.add(projectId);
      this.cancelPersistRetry(`project:${projectId}`);            // 定时器随清
      if (this.spool.hasFrames(projectId)) this.schedulePersistRetry(projectId);   // Z11①：cancel 后保收割梯——帧通道撞 FK→confirm+cancel（必办⑨ 同批先行），段回收不滞盘
      this.lastCompactAt.delete(projectId);                       // 卸载清理的第二入口（Task 7 钩子为第一入口）
      this.persistUnhealthy.delete(`project:${projectId}`);       // 陈旧电平（重连会补推失效横幅）
      this.discardForGoneProject(projectId, `project:${projectId}`);   // X1：显式清队列+点名
      const q = this.pendingQueues.get(projectId);                // M6：空队列条目回收（X17 同款——discard 后空数组条目随清）
      if (q && q.length === 0) this.pendingQueues.delete(projectId);
    }
    yjsDeletedProjects.set(this.deletedProjects.size);            // V25：永久无界的可见化
    this.closeTeamDocuments(projectIds);                          // 关连接（payload-only 不查库）
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

  /** X10 软阈提前 flush（update 监听器跨 64 条/1MB 时闩锁触发）：setImmediate 出 WS 消息路径——
   *  经 storeDocumentSerialized 与库 debounce/断连同锁串行；doc 已卸载时不触发（批留队列，
   *  断连/退避梯/shutdown drain 兜底）。storeDocumentUnlocked 契约 3 永不 reject（void 即弃）。 */
  private scheduleSoftFlush(projectId: string): void {
    if (this.flushScheduled.has(projectId)) return;
    this.flushScheduled.add(projectId);
    setImmediate(() => {
      this.flushScheduled.delete(projectId);
      const q = this.pendingQueues.get(projectId);
      if (!q || q.length === 0) return;
      const documentName = `project:${projectId}`;
      const document = this.server.hocuspocus.documents.get(documentName);
      if (!document) return;
      void this.storeDocumentSerialized({ document, documentName });
    });
  }

  /** V13+X9：受理面判据（**粒度修正：只读降级而非停服**——"三入口全拒"会把本地磁盘故障放大成
   *  全站画布不可读：readCanvas 走 withDoc、装载拒=重连风暴，均超出 spec §2.2"拒新写入"语义）。
   *  分层：draining=关停期拒一切新连接；spool 熔断=**只读化**（新连接放行但 readOnly——复用
   *  connectionConfig.readOnly 机制+stateless persist-status 通告；存量连接不动——其批次由 BOI/V5' 承接）；
   *  loadDocument **永不 gate**；withDoc 只 gate 写意图。Y0a-3 的 /api/ready 消费同一方法。 */
  /** 派生（既有消费方两名不变——draining 布尔已并入 collabState 状态机）。 */
  isShuttingDown(): boolean { return this.collabState === 'draining'; }
  isWritableOrDegraded(): 'ok' | 'spool-unwritable' {
    return this.spool.isWritable() && !this.spool.overCapacity() ? 'ok' : 'spool-unwritable';
  }

  /** E35 自隔离（不自杀不硬撑）：拒新 WS（三入口门）+closeAll1012+**释放 listener 让位**（B7：
   *  closeAllConnections 不关监听——半死场景新实例 listen 必 EADDRINUSE；用 httpServer.close 不用
   *  destroy——后者 memoized 不可逆）。计数单源=本方法（{cause}——写侧直调与心跳侧 onLost 汇入同点，
   *  一次失守至多计 1）。re-listen 前置=M2① await listenerClosed+documents 清空（listenCollab）。 */
  private selfIsolate(cause: 'fenced-by-write' | 'heartbeat-fenced' | 'heartbeat-unknown-expired' | 'revoked'): void {
    if (this.collabState === 'isolated') return;
    this.transition('isolated', cause);   // V33
    collabLeaseLostTotal.inc({ cause });
    this.onServingTransition();   // Y0b-3 T3 防御性：隔离期写入的 LEASE_NOT_READY 缓存提前清消残窗（rejoin 的 serving 转移本会覆盖——双保险）
    this.clearDrainTimer();
    this.frozenConnections.clear();
    this.closeAllConnections1012();
    this.listenerClosed = new Promise<void>((res) => {
      try {
        this.server.httpServer?.closeAllConnections?.();   // Node≥18.2 清 keep-alive
        this.server.httpServer?.close(() => res());
        setTimeout(res, 2_000).unref?.();                  // close 回调兜底
      } catch (e) { this.logger.warn(`isolate: listener close failed: ${(e as Error).message}`); res(); }
    });
    this.logger.error(JSON.stringify({ event: 'collab_self_isolate', cause, note: 'listener 已释放——rejoin 由 lease.rejoinLoop 驱动（revoked 终态）；纯 DB REST 不受影响' }));
  }

  /** 30s 看门狗（Z7/W22）：lease held ∧ 未服务——P0-1 整类失败的可观测出口+一次有界自愈
   *  （N3③：start-failed 且 5s 重试未达时再调度）；counter 每 episode 至多 1 次（无界增长治理）。 */
  private startServingWatchdog(): void {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);   // 幂等（onModuleInit 理论单次——防线零成本）
    this.watchdogTimer = setInterval(() => {
      if (this.lease.isServing() && this.collabState !== 'serving' && this.collabState !== 'draining') {
        if (!this.watchdogFired) { this.watchdogFired = true; collabStartFailureTotal.inc(); }
        this.logger.error(JSON.stringify({ event: 'collab_not_serving_watchdog', collabState: this.collabState, listening: this.server.httpServer?.listening }));
        if (this.collabState === 'start-failed') void this.startCollabAfterLease().catch(() => {});
      }
    }, 30_000);
    this.watchdogTimer.unref?.();
  }

  private isPortError(e: unknown): boolean {
    const code = (e as { code?: string })?.code;
    return code === 'EADDRINUSE' || code === 'DOCS_NOT_UNLOADED' || /EADDRINUSE/i.test((e as Error)?.message ?? '');
  }

  private drainAutoReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  /** SV9：POST /api/drain 动作体——置 draining+冻结既有连接（readOnly+write-frozen 通告）+刷新 60s
   *  deadline（幂等=刷新非 no-op：慢排空部署链续 POST 续窗）。**不触发关停流程**——只停写、等去抖
   *  自然排空；进度=GET /api/ready 的 pending。60s 未收到 SIGTERM 自动解除=对冻结连接 close(CollabCloseCode.APP_RESTART)
   *  （B12：readOnly 直翻 false 会漏"冻结期客户端单侧编辑"的静默分叉——客户端重连经状态向量自愈；
   *  write-frozen/resumed 通告归 Y0b）。 */
  beginDraining(): { draining: boolean; phase: string; autoReleaseAt: number; pending: ReturnType<CollabGateway['computePending']> } {
    if (this.collabState === 'serving') this.transition('draining', 'api-drain');
    // V15：回真实态——非 serving 态（isolated/start-failed/acquiring）置位不生效，draining:false 不对部署链说谎
    this.clearDrainTimer();
    const autoReleaseAt = Date.now() + 60_000;
    this.drainAutoReleaseTimer = setTimeout(() => {
      this.drainAutoReleaseTimer = null;
      const frozen = [...this.frozenConnections];
      this.frozenConnections.clear();
      if (this.collabState === 'draining') this.transition('serving', 'drain-auto-release');
      for (const [c, prevReadOnly] of frozen) {
        try {
          // H-5：先还原 readOnly 再 close——解除后存活连接恢复冻结前写权（prev 快照，
          // spool 熔断降级连接还原 true 不被误赦免）
          c.readOnly = prevReadOnly;
          c.webSocket?.close(CollabCloseCode.APP_RESTART, 'drain released');
          collabWsCloseTotal.inc({ code: String(CollabCloseCode.APP_RESTART), reason: 'drain released' });   // Y0b-3 T6：close 分布面
        } catch { /* 已断 */ }
      }
      this.logger.warn('drain 60s 未续期——自动解除（冻结连接已 1012 复连；慢排空请部署链周期性续 POST）');
    }, 60_000);
    this.drainAutoReleaseTimer.unref?.();
    for (const doc of this.server.hocuspocus.documents.values())
      for (const c of doc.connections.keys()) {
        const conn = c as unknown as { readOnly?: boolean; sendStateless?: (p: string) => void };
        if (this.frozenConnections.has(c as never)) continue;
        this.frozenConnections.set(c as never, conn.readOnly ?? false);   // H-5：prev 快照（解除还原用）
        conn.readOnly = true;   // B12：库逐条 update 查它——冻结生效
        try { conn.sendStateless?.(JSON.stringify({ type: 'write-frozen', reason: 'draining' })); } catch { /* Y0b 消费 */ }
      }
    return { draining: this.collabState === 'draining', phase: this.collabState, autoReleaseAt, pending: this.computePending() };
  }
  private clearDrainTimer(): void {
    if (this.drainAutoReleaseTimer) { clearTimeout(this.drainAutoReleaseTimer); this.drainAutoReleaseTimer = null; }
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
   *  G-1/G-2 演练轮询面（/api/metrics collect 回调）+Y0a-3 /api/ready.pending 消费同一实现。
   *  Y0a-3 R3/P16：spoolFiles/spoolBytes=own 口径（部署门）；stranded*=外来段（depth 分区透传——
   *  gauge 侧取 total）。
   *  Y0a-4/N16：容量观测两字段（loadedDocs/connections）挂同一快照——gauge（yjs_loaded_documents/
   *  yjs_connection_count）与 /api/ready 授权档同源供数。connections 口径=server.getConnectionsCount()
   *  （已聚合 WS 连接去重+directConnectionsCount 单独累加——勿再加任何分量）。 */
  computePending(): { projects: number; batches: number; storeInFlight: number; spoolFiles: number; spoolBytes: number; strandedFiles: number; strandedBytes: number; loadedDocs: number; connections: number } {
    let projects = 0, batches = 0;
    for (const q of this.pendingQueues.values()) {
      if (q.length > 0) { projects += 1; batches += q.length; }
    }
    const d = this.spool.depth();
    return {
      projects, batches, storeInFlight: this.inFlightProjects.size,
      spoolFiles: d.ownFiles, spoolBytes: d.ownBytes, strandedFiles: d.strandedFiles, strandedBytes: d.strandedBytes,
      loadedDocs: this.server.hocuspocus.documents.size,
      connections: this.server.hocuspocus.getConnectionsCount(),
    };
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
    if (this.collabState === 'isolated') return;   // 必办⑧/I-3：fenced/revoked=终态禁梯——重试无意义且掩盖失守
    // CI 首跑实证（2026-10-08）：关停步骤 1 取消梯子后，drain 内 store 失败（degraded 态跳过 spool 兜底）
    // 的尾部会**重新武装**梯子——进程将退出，重试无意义（批已由 drain_complete/undrained 如实点名，G-2a）；
    // 且关停后连发=日志噪声。关停闸与 isolated 门同判。
    if (this.shuttingDown) return;
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
          const tailRef = queue[n - 1];                          // I-2：批尾引用锚（unload 交接/store 三处同款——splice 前身份校验）
          const payload = n === 1 ? queue[0] : Y.mergeUpdates(queue.slice(0, n));
          await this.spool.append(projectId, payload);           // 失败 throw 重走 catch 退避（不 cancel——批仍需保活）
          // I-2：await 窗口锁内折并改写前缀（两处锁外 splice 之一——unload 交接同为此列，均 I-2 批尾锚守卫）——身份不符跳过 splice：
          // merged 含未落库新内容留队由梯子重发（CRDT 幂等吸收）；本批已落 spool fsync=归属落定，leave 无条件。
          if (queue.length < n || (n > 0 && queue[n - 1] !== tailRef)) {
            yjsStoreTailAnomalyTotal.inc();
            this.logger.error(`detached retry tail anomaly for ${projectId}: queue mutated during spool append（折并/并发改写——splice 跳过，批留队列重发）`);
          } else {
            queue.splice(0, n);                                  // 新家（spool）已落定——移出旧归属
          }
          this.leaveInFlight(projectId);                         // Y1：detached 队列通道落定点②（批可能带着 Unlocked 留下的在飞标志进梯——此处落 spool 即落定）
        } else {
          const frames = await this.peekSpoolFrames(projectId);  // 帧通道=三段式（peek→append→confirm）
          if (frames.length === 0) { this.cancelPersistRetry(documentName); return; }
          for (const f of frames) {
            try {
              const r = await this.repo.append(projectId, f.payload);
              if (!r.ok) throw new Error(`append fenced (${r.reason})`);
              await this.spool.confirm(projectId, [f.frameId]);
            } catch (err) {
              if (isFkGone(err)) {   // M3/必办⑨：已删项目帧无终态出口——与 store 主路径 FK 分支同形（旧实现 throw 卡批=段永滞盘）
                await this.spool.confirm(projectId, [f.frameId]);
                yjsUpdatesDiscardedDeletedTotal.inc({ source: 'spool' });
                this.logger.warn(`persist retry frames for ${projectId} discarded (project deleted, FK)`);
                continue;
              }
              throw err;   // 重走 catch 退避（帧未 confirm——安全）
            }
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

  private spoolReconcilerTimer: ReturnType<typeof setInterval> | null = null;
  private startSpoolReconciler(): void {
    if (this.spoolReconcilerTimer) clearInterval(this.spoolReconcilerTimer);   // M2②：clear-first（幂等——rejoin 不泄漏定时器）
    this.spoolReconcilerTimer = setInterval(() => { void this.reconcileSpool().catch(() => {}); }, 30_000);
    this.spoolReconcilerTimer.unref?.();
  }
  /** SV4/Z11+I4：收养静默外来段（boot 后新出现的前任残余）→定向回灌（replayAll{projectIds} 单源）→段回收。
   *  守卫含 own（V10/I4：隔离期落 spool 的自有段无客户端重连时也要有恢复驱动——只看 foreign=own 帧永滞）。
   *  ENOENT 全程容错（P2-2：并发 confirm 先收走）。
   *  契约注记②（锁定增补）：adoptSilentForeignSegments 重建 meta 的 quarantinedRange=null ∧ 坏尾段
   *  goodBytes<bytes ⇒ confirm 判 tailSettled 恒 false=段永不 unlink=磁盘滞留——回灌前先按本 owner 档
   *  隔离坏尾（sidecar 先落盘 V3 语义不变），tailSettled 才可闭合。 */
  private async reconcileSpool(): Promise<void> {
    if (this.collabState !== 'serving') return;
    const d = this.spool.depth();   // 廉价守卫（零 IO——depth 走内存 index；无外来段且 own 无段即返）
    if (d.strandedFiles === 0 && d.ownFiles === 0) return;
    const adopted = d.strandedFiles > 0 ? await this.spool.adoptSilentForeignSegments(60_000) : [];
    const ownPending = d.ownFiles > 0;
    if (adopted.length === 0 && !ownPending) return;
    const byProject = [...new Set(adopted.map((s) => s.projectId))];
    for (const p of byProject) await this.spool.quarantineTruncatedFrames(p).catch(() => 0);   // 注记②：坏尾先隔离（adopt 重建的 meta 无 quarantinedRange——不补则段永不回收）
    await this.spool.replayAll(this.repo, byProject.length ? { projectIds: byProject } : undefined);
    if (ownPending) this.rearmQueues();   // own 段的驱动=退避梯（replayAll 不点名全量——幂等回灌无害）
    this.logger.warn(JSON.stringify({ event: 'spool_reconcile_adopted', projects: byProject, segments: adopted.length, ownPending }));
  }

  /** 最后连接断开：flush →（写了才）compact。
   *  绝不抛出（覆盖含 redlock Skip 在内的全部路径，spec v4）：onDisconnect 是 onClose 的 async 回调、
   *  注册方 forEach 不 await——抛错 = unhandled rejection = 进程退出；DirectConnection 路径是 await 的，
   *  抛错冒泡出 withDoc finally → API 500 → 前端重试 → 重复插入。Skip 路径下 saveMutex 在回调抛错时
   *  先释放 → onDisconnect 一定被调用 → 本契约面更宽。
   *  Y0a-2：storeDocument 不再 throw（BOI 契约 3）——失败路径自处理（批在 spool/队列），stashPending 退役。 */
  private async disconnect({ document, documentName, socketId, clientsCount }: onDisconnectPayload) {
    // Y0b-3 T6：键控清理【首行、early-return 之前】——多标签（clientsCount>0）断连同样要清（防无界）。
    // 库语义（esm:1059）：payload.clientsCount=removeConnection 之后的剩余数——与原
    // document.getConnectionsCount() 同值等价，改读库已算好的字段。
    this.connEstablishedAt.delete(socketId);
    this.authAttemptBuckets.delete(socketId);
    // Y0b-3 T7 在此追加 awareness 归属表清理（T6 同点纪律：首行、early-return 之前——多标签
    // clientsCount>0 断连同样要清）：按 socketId 键控=所有权校验天然满足（双标签只清自己的）；
    // doc awareness 状态清场归库（removeConnection 已自动 removeAwarenessStates——自建表只清登记）。
    for (const cid of this.ownedClientIds.get(socketId) ?? []) this.clientIdOwner.delete(cid);
    this.ownedClientIds.delete(socketId);
    this.socketIdentity.delete(socketId);
    this.awarenessDriftLogged.delete(socketId);   // Y0b-3 T8 附带 T7 评审小修：漂移去重 Set 同点清（socketId 级残留=泄漏面）
    if (clientsCount > 0) return;
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

  /** Y0a-2 Task 7：卸载清理+交接钩子（X4 永不抛——库对钩子抛错=取消卸载→destroy 永不 resolve）。
   *  Y3 顺序：①cancel 退避梯（残留梯随卸载清）→②交接（队列批 best-effort 落 spool——fsync 落定才
   *  splice，BOI；失败批留队列+③重排梯保活）→④清理残留（finally 保证）。
   *  裁定注记：②不进 inFlight（批全程留队列=归属地恒在，BOI 自持）；交接成功的 leave 为防御性
   *  收口（spool 已落定=at-risk 口径终结）。残留 spool 帧不触盘处理（V11 禁慢操作——仅交接失败支
   *  需承接：退避梯 detached 通道/shutdown drain/启动回灌三路径；成功支帧已落定非 at-risk——等
   *  重开/关停/重启回灌入 PG，J4 口径）。 */
  private async unloadDocument({ document, documentName }: beforeUnloadDocumentPayload): Promise<void> {
    const projectId = parseProjectId(documentName);
    try {
      this.cancelPersistRetry(documentName);                       // ①
      const queue = this.pendingQueues.get(projectId);
      if (queue && queue.length > 0) {
        const n = queue.length;
        const tailRef = queue[n - 1];                              // I-2：批尾引用锚（splice 前身份校验）
        try {
          const payload = n === 1 ? queue[0] : Y.mergeUpdates(queue.slice(0, n));
          await this.spool.append(projectId, payload);             // fsync 完成才 resolve——新家落定
          if (queue.length < n || queue[n - 1] !== tailRef) {      // I-2：await 窗口并发取批/折并——跳过 splice
            yjsStoreTailAnomalyTotal.inc();
            this.logger.error(`unload handoff tail anomaly for ${documentName}: queue mutated during spool append（批留队列重发——CRDT 幂等吸收）`);
          } else {
            queue.splice(0, n);                                    // 新家（spool）已落定——移出旧归属
          }
          this.leaveInFlight(projectId);                           // X2 落定点②（卸载交接变体）
        } catch (err) {
          yjsUnloadHandoffFailureTotal.inc();
          this.logger.error(`unload handoff failed for ${documentName}, batch retained in queue: ${(err as Error).message}`);
          this.schedulePersistRetry(documentName);                 // ③保活梯（①cancel 之后重排——entry.timer 真值）
        }
      }
    } catch (err) {
      // X4：意外异常一律吞（库语义=钩子抛错取消卸载→destroy 永不 resolve）——计数留痕
      yjsUnloadCleanupFailureTotal.inc();
      this.logger.warn(`beforeUnloadDocument swallowed error for ${documentName}: ${(err as Error).message}`);
    } finally {
      // ④清理残留（M1：project.gone 事件为第一入口——本钩子为卸载路径第二入口）
      this.lastCompactAt.delete(projectId);
      this.persistUnhealthy.delete(documentName);
      // Y0b-3 T6 键控清理：卸载清该 doc 全部连接寿命条目（防无界——常规路径 onDisconnect 已逐条清，
      // 此为库自发卸载/直连路径的兜底反查；钩子在 doc 移出 documents 之前触发，payload.document 仍可达；
      // ?. 防 finally 内 TypeError 绕过上方 catch——X4「钩子永不抛」契约对 finally 同样成立）
      for (const connection of document.connections?.keys() ?? []) this.connEstablishedAt.delete(connection.socketId);
      // Y0b-3 T7 键控清理：卸载清该 doc 全部连接的 awareness 归属条目（T6 同款兜底反查——常规路径
      // onDisconnect 已逐条清，此为库自发卸载/直连路径的兜底；socketIdentity 不在此清=socket 键控
      // 随 onDisconnect 走，doc 卸载不构成身份失效）
      for (const connection of document.connections?.keys() ?? []) {
        for (const cid of this.ownedClientIds.get(connection.socketId) ?? []) this.clientIdOwner.delete(cid);
        this.ownedClientIds.delete(connection.socketId);
      }
      const q2 = this.pendingQueues.get(projectId);
      // I-1：仅当 doc 真已从库 documents Map 消失才回收空条目——库在钩子后复检 shouldUnloadDocument
      //（mutex 锁定/连接>0 时取消卸载 doc 存活），此时重连复用 doc 不重跑 loadDocument=条目不重建，
      // 每条 update 命中 !q 丢弃=活编辑静默蒸发窗（X17 与库取消卸载语义的交织）。
      if (q2 && q2.length === 0 && !this.server.hocuspocus.documents.get(documentName)) this.pendingQueues.delete(projectId);
    }
  }

  async onModuleInit(): Promise<void> {
    // 租约回调接线（W5 单点：启动只经 onAcquired；失守/撤销→selfIsolate）
    this.lease.onAcquired = () => this.startCollabAfterLease();
    this.lease.onLost = (cause) => this.selfIsolate(cause);
    // 事件订阅先于租约（获取窗口内 project.gone/team.disbanded 照常清账——内存终态不依赖 listen）。
    // I3/M2：解散事件到达时 projects 可能已删——按 payload.projectIds 终态处理（清账+关连接），不查库
    this.eventEmitter.on('team.disbanded', (payload: { teamId: string; projectIds: string[] }) => {
      this.handleProjectsGone(payload.projectIds);
    });
    // Y0a-2（V11）：三删除入口（project.delete/cleanDrafts/template.delete 级联）事务提交后 emit——
    // 与解散事件汇入同一终态处理（处理器禁慢操作：内存态+关连接，零磁盘 I/O）
    this.eventEmitter.on('project.gone', (payload: { projectIds: string[] }) => {
      this.handleProjectsGone(payload.projectIds);
    });
    // Y0b-3 T8：权限变更事件面（team.service 三变更点 emit——即时踢权+permCache 失效，同构挂载）
    this.wirePermChangedEvents();
    // 审查 M-1：validateDir 的启动调用点（V15——生产相对路径拒绝构造时不判；缺此调用=V15 fail-fast 死代码）
    this.logger.log(JSON.stringify({ event: 'spool_dir', dir: this.spool.validateDir() }));
    this.startServingWatchdog();
    this.transition('acquiring');
    let acquired = false;
    try { acquired = await this.lease.tryAcquireFast(); }   // 单点负责制：成功⇒已 await 启动（stub/真实现同契约）
    catch (e) { this.logger.error(`lease fast-acquire failed: ${(e as Error).message}`); }
    if (acquired) return;   // serving 或 start-failed（后者自调度重试）
    this.logger.error('collab lease not acquired（fast path）——detached 重试中，不 listen（ready=lease-*）');
    void this.lease.acquireLoop().catch((e) => this.logger.error(`lease acquireLoop crashed: ${(e as Error).message}`));
  }

  /** 租约获取成功后的 collab 面启动（onAcquired 唯一入口——fast path/acquireLoop/rejoinLoop 同点）。
   *  W8 拆分：init 四步（scan/隔离/回灌/rearm）+listenCollab（可重复——rejoin re-listen）。
   *  V9/I3：initDone **成功后置**（早置+scan 抛错=重试跳过 init 带半截索引上线=门假绿）；
   *  V11：关停期（步骤 1 置 shuttingDown）不得再起 collab 面（isolated 态关停时 rejoin CAS 成功场景）；
   *  V10：startInFlight 闸防并发重入（watchdog/5s 定时器/fast-path）。
   *  契约注记①：scan/隔离/回灌全在租约持有后——活前任的段对非持有者不可见不可删（R3 owner 子目录）。 */
  private async startCollabAfterLease(): Promise<void> {
    if (this.collabState === 'serving' || this.collabState === 'draining' || this.shuttingDown || this.startInFlight) return;
    this.startInFlight = true;
    try {
      this.transition('starting');   // 锁定适配：无条件（isolated rejoin 合法迁移——藏进 !initDone 则 isolated→serving 直跳=非法迁移）
      if (!this.initDone) {
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
        // 审查 I-1（X5 必修漏落）：回灌失败残帧必须落梯——listen 前调用=先备恢复路径后受理。
        // 幂等安全：schedulePersistRetry 对已有 timer return。
        this.rearmQueues();
        this.initDone = true;   // V9：四步全成才置位
      }
      await this.listenCollab();
    } catch (e) {
      this.transition('start-failed');
      collabStartFailureTotal.inc();
      this.watchdogFired = true;   // V14：episode 标志——看门狗不再对同一 episode 双计
      const portErr = this.isPortError(e);
      this.logger.error(JSON.stringify({ event: 'collab_start_failed', error: (e as Error).message, portError: portErr }));
      // V10/N2③ 失败分型：端口类（EADDRINUSE/documents 未卸载）=**本地瞬态、与租约无关**——持锁
      // 有界重试 ≤2 次（旧持有者 ≤1 心跳让位）；非端口类或耗尽 → release（不占租约不服务）
      if (portErr && this.listenRetries < 2) this.listenRetries += 1;
      else { this.listenRetries = 0; await this.lease.release().catch(() => {}); }
      setTimeout(() => {
        if (this.shuttingDown) return;
        if (this.lease.isServing()) void this.startCollabAfterLease().catch(() => {});   // 持锁重试 listen/init
        else void this.lease.acquireLoop().catch(() => {});                              // 已释放——重获取（经 onAcquired 回此）
      }, 5_000).unref?.();
    } finally {
      this.startInFlight = false;
    }
  }

  /** B13（listen 错误路径可观测）：hocuspocus listen() 的 Promise 只在 listening 回调内 resolve、
   *  httpServer 无 error 监听——EADDRINUSE 时 promise 悬挂+error 事件 unhandled（Sentry 吞=持锁僵尸）。
   *  自接线 once('error') 转 reject；成功后摘除（运行期 error 维持现状语义）。 */
  private listenServer(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const httpServer = this.server.httpServer;
      const onError = (e: Error) => {
        httpServer?.off('error', onError);
        reject(Object.assign(e instanceof Error ? e : new Error(String(e)), { code: (e as { code?: string })?.code }));
      };
      httpServer?.once('error', onError);
      this.server.listen().then(
        () => { httpServer?.off('error', onError); resolve(); },
        (e: unknown) => { httpServer?.off('error', onError); reject(e); },
      );
    });
  }

  /** E35 三入口之首的 listen 收口（可重复——rejoin re-listen）：等 isolate 的 close 落定+documents
   *  清空→listen→定时器族 clear-first 重挂→onRecovered 接线→transition('serving') 置位=最后一步。 */
  private async listenCollab(): Promise<void> {
    if (this.listenerClosed) { await this.listenerClosed.catch(() => {}); this.listenerClosed = null; }   // M2①：等 isolate 的 close 落定再 re-listen（net close 异步）
    // M2③/P1-2 前置：隔离期内存 doc 必须已卸载——陈旧 doc 对外服务=同进程复现"两实例互不可见"
    const t0 = Date.now();
    while (this.server.hocuspocus.documents.size > 0 && Date.now() - t0 < 5_000)
      await new Promise((r) => setTimeout(r, 100));
    if (this.server.hocuspocus.documents.size > 0)
      throw Object.assign(new Error(`documents 未卸载（${this.server.hocuspocus.documents.size} 个——mutex 持有），拒绝 re-listen（留 isolated 等下轮退避）`), { code: 'DOCS_NOT_UNLOADED' });   // V10：归端口类=持锁重试
    await this.listenServer();   // Y0a-1 P1-1：await listen——返回即端口就绪（消端口竞态）
    // Y0a-4/P25：绑定面漂移在启动日志可见（0.0.0.0=缺省全卡；127.0.0.1=ecosystem 收窄档）
    {
      const addr = this.server.httpServer?.address();
      const bind = typeof addr === 'object' && addr ? `${addr.address}:${addr.port}` : String(addr);
      this.logger.log(`collab listen ${bind}（COLLAB_BIND_ADDR=${process.env.COLLAB_BIND_ADDR ?? 'unset→127.0.0.1'}）`);
    }
    // V11 收口（终审 Important）：SIGTERM 落在 starting 态 listen 窗时此处才 resolve——不复检即
    // transition('serving') 会翻转关停已置的 draining（ready 翻 200+authenticate 放行新 WS=
    // 破"draining ⇒ ready≠true"契约）。不转 serving 直接返回：listener 由关停链步骤 5 destroy 收口；
    // 窗口内新 WS/直连被 draining/LEASE_NOT_READY 门拒。
    if (this.shuttingDown) {
      this.logger.warn('listen 完成但关停已在途——不转 serving（draining 契约保持），listener 随关停链 destroy 销毁');
      return;
    }
    this.listenRetries = 0;   // 成功即重置端口重试预算（防终身保守漂移）
    this.startSessionSweep();     // W8/M2②：先 clear 再 set（幂等——rejoin 不泄漏定时器）
    this.startSpoolReconciler();
    // Y10 seam（v3 重排漏接=v4 修复，I4）：spool IO 熔断恢复→唤醒退避梯——缺此行=熔断期梯死+恢复后零自愈
    this.spool.onRecovered = () => this.rearmQueues();
    this.transition('serving');   // 置位=最后一步（"已完成"非"已进入"）
    this.watchdogFired = false;
    this.rearmQueues();   // I4（P0-1 修）：serving ⟹ 非空队列∪spool.keys() 全部在梯上——rejoin 后 own 帧的运行期恢复路径（缺此=own 帧只待重启=部署门死锁）
  }

  /** 批3-4：sweep 轮询（unref——进程退出不被阻）。Y0b-3 T8：setTimeout 自排链——每轮按
   *  sweepIntervalMs（5min±20% jitter）重排（setInterval 固定周期无法表达 jitter；jitter 防多连接
   *  同刻聚集脉冲）。Y0b-3 T1 起默认开：COLLAB_SWEEP_ENABLED === 'false' 时 tick 首行即返
   *  （逃生阀=零行为差异——§4.2 回滚表用）。快照死线（context.sessionExpiresAt——authenticate 播种，
   *  必过期下界）命中后先 DB 复验（session+权限链，移除成员也踢）；复验翻案（me 探活已续期）则刷新
   *  快照；确认 revoked → stateless 预通知 {type:'session-expiring'}（客户端 flushPendingUpdates）→
   *  5s grace → webSocket.close(CollabCloseCode.SESSION_EXPIRED)。禁 Connection.close——文档级 CLOSE
   *  制造 L6 僵尸；close 调用处自行 catch。复验异常 fail-open，但连续 5 次仍关（无界 fail-open=安全债
   *  没真修）+ metric。 */
  private startSessionSweep() {
    if (this.sessionSweepTimer) { clearTimeout(this.sessionSweepTimer); this.sessionSweepTimer = null; }   // W8/M2②：clear-first（幂等——rejoin 不泄漏定时器）
    const schedule = (): void => {
      this.sessionSweepTimer = setTimeout(() => {
        void this.sweepSessions().catch((e) => this.logger.warn(`session sweep: ${e}`));
        schedule();
      }, this.sweepIntervalMs());
      this.sessionSweepTimer.unref?.();
    };
    schedule();
  }

  /** Y0b-3 T8：jitter 间隔（±20% → [4min, 6min]）。抽函数=区间断言单点（perm-events spec）。 */
  private sweepIntervalMs(): number { return SESSION_SWEEP_INTERVAL_MS * (0.8 + Math.random() * 0.4); }

  /** Y0b-3 T6：连接最大寿命检查（默认 12h——COLLAB_CONN_MAX_LIFETIME_MS，默认值落使用点）。
   *  并进 sweep 同一脉冲（不新开 timer）；置于 SWEEP_ENABLED 逃生阀**之前**——阀=session-expiry
   *  回滚面，不得静默关掉本机制（T3 防线老化/T4 观测同纪律）。超线→webSocket.close(CollabCloseCode.MAX_LIFETIME)——
   *  P7：connection.close 丢 code，统一 webSocket.close；close 调用处自 catch（F11）。 */
  private enforceConnMaxLifetime(): void {
    for (const doc of this.server.hocuspocus.documents.values()) {
      for (const conn of doc.connections.keys()) {
        const at = this.connEstablishedAt.get(conn.socketId);
        if (at !== undefined && Date.now() - at > this.connMaxLifetimeMs()) {
          try {
            conn.webSocket?.close(CollabCloseCode.MAX_LIFETIME, 'max-lifetime');   // 4401 已被库 Unauthorized+sweep 双占用——4402 新码
            collabWsCloseTotal.inc({ code: String(CollabCloseCode.MAX_LIFETIME), reason: 'max-lifetime' });
            this.connEstablishedAt.delete(conn.socketId);   // Y0b-3 T6 评审小修：close 成功即删条目——防重入 tick 重复 inc 失真（onDisconnect delete 幂等无副作用）
          } catch (err) { this.logger.warn(`max-lifetime close failed for ${doc.name}: ${(err as Error).message}`); }
        }
      }
    }
  }

  private connMaxLifetimeMs(): number { return Number(process.env.COLLAB_CONN_MAX_LIFETIME_MS) || 43_200_000; }

  private async sweepSessions() {
    this.enforceConnMaxLifetime();   // Y0b-3 T6：寿命检查同一脉冲首部（在 SWEEP_ENABLED 阀之前——见上注）
    if (process.env.COLLAB_SWEEP_ENABLED === 'false') return; // 默认开（Y0b-3 T1 P-H，spec §3.1）；'false'=env 逃生阀（§4.2 回滚表——只静默 session-expiry 支，寿命检查在其前不受辖）
    for (const document of [...this.server.hocuspocus.documents.values()]) {
      for (const connection of [...document.connections.keys()]) {
        const ctx = (connection.context ?? {}) as { token?: string; sessionExpiresAt?: Date };
        if (this.sweepGrace.has(connection)) continue;   // 通知/grace 在途：去重
        // —— 判据门两分支（Y0b-3 T3 P-K）：快照死线 ∨ 权限复验到期（permCache 5min/首查）——
        // 原单分支（快照未过期 continue）使权限复验零调用=降级/撤权最长 7d 不可见（本 Task 修）
        const deadline = ctx.sessionExpiresAt;
        const expired = deadline instanceof Date && deadline.getTime() <= Date.now();
        const dueForPerm = this.permRecheckDue(connection);
        if (!expired && !dueForPerm) continue;
        try {
          const re = await this.recheckConnection(connection, document.name);
          this.sweepRecheckFails.delete(connection);   // 复验完成（无论结论）——连续失败计数复位
          if (!re.revoked) {
            if (re.expiresAt) ctx.sessionExpiresAt = re.expiresAt;   // 翻案/刷新：死线快照按新值（下轮按新死线）
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

  /** sweep 判据门第二分支（P-K）：权限复验到期=无条目（首查）∨ 距上次结论 ≥5min。 */
  private permRecheckDue(connection: object): boolean {
    const c = this.permCache.get(connection);
    return !c || Date.now() - c.at >= CollabGateway.PERM_RECHECK_TTL_MS;
  }

  /** ===== Y0b-3 T8：事件驱动即时踢权（spec §3.1"即时"——纯 sweep 5min 兜底撤权退化 ≤6min）=====
   *  权限变更点（team.service removeMember/changeRole/transferOwnership）emit 'collab.perm.changed'
   *  { userId, teamId }；监听器只做内存两步（V11 禁慢操作纪律）：①匹配连接的 permCache 失效
   *  （仅 delete 不直接 recheck——T3 契约）；②scheduleImmediateSweep 请求一次立即 tick。
   *  project 删除路径不 emit 本事件——已有 project.gone → handleProjectsGone → closeTeamDocuments
   *  关连接（强于缓存失效；连接亡=WeakMap 键散）。 */
  private wirePermChangedEvents(): void {
    this.eventEmitter.on('collab.perm.changed', (payload: { userId: string; teamId: string; projectId?: string }) => {
      for (const document of this.server.hocuspocus.documents.values()) {
        for (const connection of document.connections.keys()) {
          const identity = this.socketIdentity.get(connection.socketId);
          if (!identity || identity.id !== payload.userId || identity.teamId !== payload.teamId) continue;
          this.permCache.delete(connection);   // 事件=缓存失效信号（下一 tick 立即复验）
        }
      }
      this.scheduleImmediateSweep();
    });
  }

  /** Y0b-3 T8：事件=请求一次立即 tick——仍单一执行路径 sweepSessions（不新增第二执行器）；
   *  sweepKickPending 防惊群（事件风暴合并为一次）。tick 与 event 撞窗的重叠 sweepSessions 为良性：
   *  double close 在 CLOSING 态 no-op + recheck 幂等（permCache 重写）。 */
  private sweepKickPending = false;
  private scheduleImmediateSweep(): void {
    if (this.sweepKickPending) return;
    this.sweepKickPending = true;
    setImmediate(() => {
      this.sweepKickPending = false;
      void this.sweepSessions().catch(() => {});
    });
  }

  /** 复验：session resolve（纯读不续期——清扫面不得反向保活 session）+权限链 perm.resolveWithTeam
   *  （F-3 判据单源——与 authenticate 同链；原手写三段查询删除）。⚠ 权限语义 A（P-U②）：
   *  role 非 null 但用户已被移出团队（有显式 ProjectMember 行）=预期行为——REST 同链既有语义，不踢。
   *  cause 分型：no-role（权限链无角色）/session-invalid（会话失效）——T8 事件路径同分型。 */
  private async recheckConnection(connection: { context?: { token?: string }; readOnly?: boolean; socketId?: string }, documentName: string): Promise<{ revoked: boolean; cause?: 'no-role' | 'session-invalid'; expiresAt?: Date }> {
    const token = connection.context?.token;
    if (!token) return { revoked: false, expiresAt: undefined };   // 无凭据（authenticate 必播种——理论不可达）不翻案
    const { session } = await this.sessionSvc.resolve(token);
    if (!session) return { revoked: true, cause: 'session-invalid', expiresAt: undefined };   // 过期/登出（resolve 折叠两态）
    const { role } = await this.perm.resolveWithTeam(parseProjectId(documentName), session.userId);
    this.permCache.set(connection, { role, at: Date.now() });   // 会话级结论缓存（T8 事件失效消费——仅清不直接 recheck）
    if (role === 'PROJECT_VIEWER' && !connection.readOnly) {
      connection.readOnly = true;   // E13：降级=修越权写不断连
      this.rewriteAwarenessRole(connection, 'PROJECT_VIEWER', documentName);
      collabSweepCloseTotal.inc({ cause: 'role-downgraded' });
      return { revoked: false, expiresAt: session.expiresAt };
    }
    // 升回分支（I-2）：readOnly 三写者共享（viewer 降级/spool 降级/drain 冻结）——停写状态期
    // 严禁静默解冻（窗 ≤60s 但违背 SV9/B12 部署停写意图）；降级方向（上一分支）永不加守卫。
    if (role !== null && role !== 'PROJECT_VIEWER' && connection.readOnly
      && !this.isShuttingDown() && this.isWritableOrDegraded() === 'ok') {
      connection.readOnly = false;   // 升回可写（VIEWER 翻案/授权变化——仅 serving+spool ok 期）
      this.rewriteAwarenessRole(connection, role, documentName);
    }
    // H-5×E13 嵌套（Y0b-3 评审 I-2）：drain 冻结窗内复验 VIEWER 结论——快照跟随（prev→true）。
    // 降级分支条件带 !readOnly——冻结连接（drain 已置 true）不进分支，prev 保持 false；60s 解除
    // 无条件还原 false + close(1012)（CLOSING no-op 边角存活）⇒ 已降 VIEWER 获写权至 permCache 下轮
    //（≤5min 越权写窗）。快照跟随解除还原 true 不打穿。降级 return 路径不涉冻结：能进降级分支即
    // !readOnly=未冻结；先降后冻结形态 prev 快照已 true（H-5 degradedConn 用例锚）。
    if (role === 'PROJECT_VIEWER' && this.frozenConnections.has(connection)) {
      this.frozenConnections.set(connection, true);
    }
    return role === null ? { revoked: true, cause: 'no-role', expiresAt: undefined } : { revoked: false, expiresAt: session.expiresAt };
  }

  /** Y0b-3 T8 helper（T7 留定义随消费补）：连接的 socketId 取法 + socketId 名下 clientId 快照。 */
  private socketIdOf(connection: { socketId?: string }): string { return connection?.socketId ?? ''; }
  private ownedClientIdsOf(socketId: string): number[] { return [...(this.ownedClientIds.get(socketId) ?? [])]; }

  /** awareness role 改写（E73——只置 readOnly 不改 awareness=成员表仍显示旧角色）。
   *  Y0b-3 T8 实接。⚠ 时钟门（y-protocols applyAwarenessUpdate 判据 `currClock < clock`，非 null 改写
   *  无相等分支）：服务端直改 states 不动 meta ⇒ 广播帧编出旧 clock ⇒ 对端全丢弃而服务端自以为成功
   *  （假绿型）——必须先递增 meta.clock 再改 states；广播经 aw.emit('update') 走 Document.
   *  handleAwarenessUpdate → broadcastAwarenessUpdate（encode 读新 clock，对端 currClock<clock 通过）。
   *  探针裁注：applyAwarenessUpdate(aw, encode(aw,[cid])) 重入形态不可行——改后 currClock===clock 被
   *  时钟门丢弃（updated 不 push=零广播），直接 emit 同一广播链少一次编解码。origin='local' 非
   *  transaction origin：handleAwarenessUpdate 不动 entry.clients；beforeHandleAwareness 只挂 inbound
   *  scratch 解码链（esm:197-212）——服务端自发广播零拦截。socketIdentity.role 同步改写——否则下一个
   *  入站帧经 guardAwareness ③无条件注入把旧 role 冲回广播。 */
  private rewriteAwarenessRole(connection: { socketId?: string }, role: ProjectRole, documentName: string): void {
    const socketId = this.socketIdOf(connection);
    const document = this.server.hocuspocus.documents.get(documentName);
    const aw = document?.awareness;
    if (!aw || !socketId) return;
    const identity = this.socketIdentity.get(socketId);
    if (identity) identity.role = role;   // 防 T7 注入链冲回（下一入站帧的 user 来源）
    for (const clientId of this.ownedClientIdsOf(socketId)) {
      const prevState = aw.states.get(clientId);
      if (!prevState) continue;   // 无本地态的 clientId 无可改写
      const meta = aw.meta.get(clientId);
      aw.meta.set(clientId, { clock: (meta?.clock ?? 0) + 1, lastUpdated: Date.now() });   // ⚠ 先递增（时钟门判据）
      aw.states.set(clientId, { ...prevState, user: { ...(prevState.user ?? {}), role } });
      aw.emit('update', [{ added: [], updated: [clientId], removed: [] }, 'local']);   // 触发 Document 广播链
    }
  }

  /** 单连接 clientId 上限（spec §3.3 终裁值 4——纯真内容 clientId 计入：自身 clock=0 占位被时钟门
   *  剥离、scratch 幽灵被空态判据剔除，均不占槽；触发必计数防静默故障 S-3） */
  private static readonly AWARENESS_CLIENT_ID_LIMIT = 4;

  /** ===== Y0b-3 T7（E73/spec §3.3）：beforeHandleAwareness——states 归属三分支+身份覆写 =====
   *  载体=payload.states（scratch Map——库在钩子后从它重编码广播〔esm:197-207〕，d.ts 官方契约
   *  "Mutate this map in place to rewrite the update"）；禁碰 payload.awareness.states（文档本体）。
   *  三分支同一趟遍历：①他人登记=伪造→整帧丢弃（不替别人发声）；②首见=登记（同一趟——首帧不被
   *  丢弃）；③owned（含刚登记）→**无条件注入** serverIdentityOf（不依赖帧内 user 字段存在性——
   *  局部帧〔只带 cursor〕跳过覆写=绕过，P0-2）。
   *  scratch 幽灵剔除（4.6.0 实证偏离登记）：库 scratch Awareness 构造器 setLocalState({}) 使每帧
   *  states 混入一个随机 clientId 空态项（真身 clock=0 占位反被 y-protocols 时钟门剥离——guard 实测
   *  frames 全含幽灵）。判据=首见 ∧ 空态 ∧ doc awareness 无此 id ⇒ states.delete（不计登记/上限/
   *  注入——防幽灵吃上限槽位+每帧登记 churn）。**T10 勘误（真身误杀机理）**：真身空态帧同判据被剔
   *  （hook 载荷只有 states 内容，拿不到 scratchDoc.clientID 与幽灵区分）⇒ 零回显 ⇒ 客户端 30s
   *  messageReconnectTimeout 判死重连循环（探针 bare 45s 实证）——客户端已由构造/replayLocalUser
   *  播种非空态锚点 {presence:true} 保证真身帧非空态（apps/web/src/collab/awareness.ts）；
   *  **ghost 计数异常增高=客户端播种退化信号**（runbook 巡检项）。
   *  放行门（P0-1）：非连接来源（DirectConnection/服务端内部写——connection undefined 或 context
   *  undefined 或 socketId 空串）=我们自己写的，整体放行禁删禁改。
   *  onAwarenessUpdate 是观测钩子禁改写（E73 钉死）——本钩子=唯一改写点。 */
  private guardAwareness({ states, socketId, context, connection, document }: beforeHandleAwarenessPayload): void {
    try {
      if (!connection || !context || !socketId) return;   // P0-1：非连接来源放行（空串含）
      const identity = this.socketIdentity.get(socketId);
      if (!identity) return;   // 未认证连接的 awareness 帧（pre-auth 队列外不应出现——防御性放行）
      const libClients = (document as any).getClients?.(connection) as Set<number> | undefined;
      for (const [clientId, state] of [...states]) {
        const owner = this.clientIdOwner.get(clientId);
        if (owner !== undefined && owner !== socketId) {   // ①他人登记=伪造→整帧丢弃（O(1) 判定）
          states.delete(clientId);
          collabAwarenessRejectTotal.inc({ reason: 'forged' });
          continue;
        }
        if (owner === undefined) {   // ②首见
          if (CollabGateway.isEmptyState(state) && !document.awareness.states.has(clientId)) {
            states.delete(clientId);   // scratch 幽灵——剔除（见方法头注 T10 真身误杀机理）
            collabAwarenessRejectTotal.inc({ reason: 'ghost' });   // T10 观测盲区根修：剔除必计数（异常增高=客户端播种退化）
            continue;
          }
          if ((this.ownedClientIds.get(socketId)?.size ?? 0) >= CollabGateway.AWARENESS_CLIENT_ID_LIMIT) {
            states.delete(clientId);
            collabAwarenessRejectTotal.inc({ reason: 'owner-limit' });
            continue;
          }
          this.clientIdOwner.set(clientId, socketId);
          if (!this.ownedClientIds.has(socketId)) this.ownedClientIds.set(socketId, new Set());
          this.ownedClientIds.get(socketId)!.add(clientId);
        }
        states.set(clientId, { ...state, user: this.serverIdentityOf(identity) });   // ③无条件注入
      }
      // 剪枝：陈旧 clientId（客户端 setLocalState(null) 移除自身后索引残留——防上限被垃圾占满卡死长会话）。
      // 判据=既不在库 clients 集也不在本帧 states 且 doc awareness.states 已无此 id；只迭代自己名下
      // Set（O(自己)——热路径禁全表扫描）。
      const own = this.ownedClientIds.get(socketId) ?? new Set<number>();   // 空 states 帧（幽灵剔除后零条目）时无登记条目——空安全（否则 for-of 抛进 catch，warn 热路径刷屏）
      for (const cid of own) {
        if (!libClients?.has(cid) && !states.has(cid) && !document.awareness.states.has(cid)) {
          this.clientIdOwner.delete(cid);
          own.delete(cid);
        }
      }
      // spec §3.3 ③一致性校验源：库 clients 集相对归属表的差异=漂移探针（不信赖库内部也为漂移留
      // 观测出口）——lib 有而归属表无=登记链断裂（异常态）；去重防热路径刷屏，恢复即清。
      if (libClients) {
        let drifted = false;
        for (const cid of libClients) if (!own.has(cid)) { drifted = true; break; }
        if (drifted && !this.awarenessDriftLogged.has(socketId)) {
          this.awarenessDriftLogged.add(socketId);
          this.logger.warn(JSON.stringify({ event: 'collab_awareness_drift', lib: libClients.size, owned: own.size }));
        } else if (!drifted) {
          this.awarenessDriftLogged.delete(socketId);
        }
      }
    } catch (err) {
      // 观测面禁抛——钩子抛错中断库消息处理链（esm try/finally 不 catch）；swallow 但留痕
      //（对齐 unloadDocument swallow 先例——catch 静默=零观测；不加指标保 reason 枚举）
      this.logger.warn(`[y0b-3] awareness guard error: ${(err as Error)?.message}`);
    }
  }

  /** scratch 幽灵判据：空态对象（构造器 setLocalState({}) 指纹——真内容帧不受影响） */
  private static isEmptyState(state: Record<string, any>): boolean {
    return typeof state === 'object' && state !== null && Object.keys(state).length === 0;
  }

  /** Y0b-3 T7（P-L）：服务端身份注入形——color=shared 单源确定性哈希（与客户端同源算法=迁移等价性
   *  保证：旧 bundle 自算 userColor(id) 与新注入同值，部署窗口零色变）。 */
  private serverIdentityOf(u: { id: string; name: string; role: string }) {
    return { id: u.id, name: u.name, role: u.role, color: userColorOfUserId(u.id) };
  }

  private scheduleSweepClose(connection: object & { sendStateless?: (p: string) => void; webSocket: { close: (code?: number, reason?: string) => void } }, cause: 'revoked' | 'db-fail') {
    if (this.sweepGrace.has(connection)) return;
    this.sweepGrace.add(connection);
    try { connection.sendStateless?.(JSON.stringify({ type: 'session-expiring' })); }
    catch (err) { this.logger.warn(`sweep pre-notice failed: ${(err as Error).message}`); }
    const grace = setTimeout(() => {
      this.sweepGrace.delete(connection);
      try {
        connection.webSocket.close(CollabCloseCode.SESSION_EXPIRED, 'session-expired');
        collabSweepCloseTotal.inc({ cause });
        collabWsCloseTotal.inc({ code: String(CollabCloseCode.SESSION_EXPIRED), reason: 'session-expired' });   // Y0b-3 T6：close 分布面
      } catch (err) {
        this.logger.warn(`sweep close failed: ${(err as Error).message}`);   // F11：webSocket.close 调用处自 catch
      }
    }, SESSION_SWEEP_GRACE_MS);
    grace.unref?.();
  }

  /** 批3-2：关停前对存活连接 close(CollabCloseCode.APP_RESTART, "service restart")——客户端据 code 按瞬态服务重启
   *  立即重连，不等 1006 盲区。先复制后关（[...map] 快照）：close 回调可能反噬集合
   *  （连接自清/异常路径），活迭代下漏关未访问项。单个失败各自吞（F11）不阻断其余。 */
  private closeAllConnections1012() {
    for (const document of [...this.server.hocuspocus.documents.values()]) {
      for (const connection of [...document.connections.keys()]) {
        try {
          connection.webSocket.close(CollabCloseCode.APP_RESTART, 'service restart');
          collabWsCloseTotal.inc({ code: String(CollabCloseCode.APP_RESTART), reason: 'service restart' });   // Y0b-3 T6：close 分布面
        }
        catch (err) { this.logger.warn(`close(${CollabCloseCode.APP_RESTART}) failed for ${document.name}: ${(err as Error).message}`); }
      }
    }
  }

  /** Y0a-2 关停 drain 六步（spec v2.4 §2.4 预算表：直连宽限 ≤2s+flush ≤6s+自管 drain+force-spool 硬界
   *  t0+18s+race ≤4s=合计 ≤22s——Y12：hardDeadline 18s（22s+4s=26s 破表），kill_timeout 30s 内垫 ≥8s
   *  ——ecosystem Y0a-4）。G-2a：归属要么落定、要么被如实点名（禁声称 0）。
   *  步骤 6（租约显式释放 ≤2s）Y0a-3 落地——本批占位注释（v2.4"必须执行到"约束随租约同批）。 */
  async onApplicationShutdown(): Promise<void> {
    const t0 = Date.now();
    this.shuttingDown = true;                                                    // 步骤 1：停收新写（V11 关停闸——isolated 态 rejoin CAS 成功也不得 re-listen）
    if (this.collabState === 'serving' || this.collabState === 'start-failed' || this.collabState === 'acquiring') this.transition('draining', 'shutdown');
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
    this.clearDrainTimer();
    this.frozenConnections.clear();
    if (this.sessionSweepTimer) { clearTimeout(this.sessionSweepTimer); this.sessionSweepTimer = null; }
    if (this.authMapsSweepTimer) { clearInterval(this.authMapsSweepTimer); this.authMapsSweepTimer = null; }   // Y0b-3 T3：防线 Map 老化 timer 随停
    if (this.heapObserverTimer) { clearInterval(this.heapObserverTimer); this.heapObserverTimer = null; }   // Y0b-3 T4：卡住观测 timer 随停
    unregisterAuthInflightReader();   // Y0b-3 T3：gauge reader 闭包随 gateway 死（pendingCollector 同惯例）
    unregisterHeapObserverReader();   // Y0b-3 T4：观测 collect 闭包随 gateway 死（同惯例）
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
    await this.raceDeadline(this.lease.release(), 2_000, null as never).catch(() => {});
    this.lease.halt();
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
   *  G-2a：归属要么落定、要么被如实点名。
   *  M-1（复审登记，保守方向不修）：force-spool 成功清空后不回打 drain_complete（drain_complete 只在
   *  主循环后判定点打一次）——统一落 shutdown_undrained（batches=0+forcedSpool≥1）；race 超时后迟到的
   *  真成功=spool 重复回灌且 undrained 仍点名——虚报偏保守（宁多点名，不虚报成功）。 */
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
      const tailRef = q[n - 1];                                  // I-2 终审收口：force-spool 是关停窗内 splice——并发 append 竞速下队列结构可能已变（折并/取批交织），无锚 splice 会误删未落定批（唯一残余蒸发窗）——与队列其余三处 splice 同形补锚
      const payload = n === 1 ? q[0] : Y.mergeUpdates(q.slice());   // copy——不动队列
      try {
        const ids = await this.raceDeadline(this.spool.append(projectId, payload), Math.max(200, hardDeadline - Date.now()), null);
        if (ids !== null) {
          if (q.length < n || (n > 0 && q[n - 1] !== tailRef)) {   // I-2：await 窗口队列被折并/并发改写（q[n-1] 身份断）——跳过 splice 留队列点名
            yjsStoreTailAnomalyTotal.inc();
            this.logger.error(`force-spool tail anomaly for ${projectId}: queue mutated during spool append（折并/并发改写——splice 跳过，批留队列点名）`);
          } else {
            q.splice(0, n);                                        // J5：真写成才 splice（null=race 超时未落定——留队列点名；后到的成功帧=重复回灌，幂等吸收）
            this.leaveInFlight(projectId);
            forced += 1;
          }
        }
      } catch { /* 留队列——点名 */ }
    }
    const p2 = this.computePending();
    this.logger.error(JSON.stringify({ event: 'shutdown_undrained', batches: p2.batches, projects: p2.projects, spoolFiles: p2.spoolFiles, spoolBytes: p2.spoolBytes, storeInFlight: this.inFlightProjects.size, forcedSpool: forced }));
  }

  /** X7：op 套 deadline——超时返回 fallback（op 自身继续跑，结果被弃） */
  private async raceDeadline<T>(op: Promise<T>, ms: number, fallback: T): Promise<T> {
    return Promise.race([op, new Promise<T>((r) => { setTimeout(() => r(fallback), ms).unref?.(); })]);
  }

  /** V4：doc 已卸载但归属仍在——spool 帧三段式直灌（append→confirm，每帧套剩余预算）。
   *  I-2（复审）：整腿 deadline 背书——peek 套 500ms race（磁盘挂起防护，与主循环同口径）；
   *  append 套 race min(5s, remaining)——race 超时 r===null→不 confirm→帧保留点名（J5 同哲学；
   *  V8 修复后 repo.append 自身 5s 事务上界是第二道）。 */
  private async drainDetachedProject(projectId: string, hardDeadline: number): Promise<void> {
    const frames = await this.raceDeadline(this.peekSpoolFrames(projectId), 500, []);   // I-2：磁盘挂起防护（与主循环 500ms 同口径）
    for (const f of frames) {
      if (Date.now() > hardDeadline) return;
      const remaining = Math.max(200, Math.min(5_000, hardDeadline - Date.now()));
      try {
        const r = await this.raceDeadline(this.repo.append(projectId, f.payload), remaining, null);
        if (r?.ok) await this.spool.confirm(projectId, [f.frameId]);
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
        this.connEstablishedAt.delete(connection.socketId);   // Y0b-3 T6 键控清理：解散清该 doc 全部连接寿命条目（防无界）
        try {
          connection.webSocket.close(CollabCloseCode.NORMAL, 'team disbanded');
          collabWsCloseTotal.inc({ code: String(CollabCloseCode.NORMAL), reason: 'team disbanded' });   // Y0b-3 T6：close 分布面
        }
        catch (err) { this.logger.warn(`close webSocket failed for ${projectId}: ${(err as Error).message}`); }
      }
    }
  }
}
