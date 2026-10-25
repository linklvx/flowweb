import { Injectable, Logger, Optional, Inject, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Server, afterStoreDocumentPayload, afterUnloadDocumentPayload, beforeHandleAwarenessPayload, beforeHandleMessagePayload, beforeSyncPayload, beforeUnloadDocumentPayload, connectedPayload, onAuthenticatePayload, onDisconnectPayload, onLoadDocumentPayload, onStatelessPayload, onStoreDocumentPayload, onUpgradePayload } from '@hocuspocus/server';   // B3 手段①：Server 值 import 随构造迁 collab-server.factory——本行并入 type-only（census ⑮ gateway 条目 2→1 同批）
import type * as Y from 'yjs';   // W3a：值面消费（deepCopyYMap/loadDocument/vacuum 族）已随域迁 DR——仅委托位签名类型位残留（type-only 零运行时边）
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from '../../auth/session.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabLeaseService } from './collab-lease.service';
import { collabLeaseLostTotal, collabStartFailureTotal, collabWsCloseTotal, docUnloadBlockedTotal, unregisterAuthInflightReader, unregisterFrozenDocsReader, unregisterHeapObserverReader, unregisterLoadedDocBytesReader, unregisterPendingCollector, unregisterDocResidueReader, yjsDeletedProjects, yjsStoreCompactFailureTotal, yjsStoreHookCallsTotal, yjsUnloadCleanupFailureTotal, unregisterAwarenessReader, unregisterOldestUnflushedReader, unregisterDegradedDocsReader, unregisterUpdatesRowsReader, legacyStoreHookProbeTotal } from './store.metrics';   // B3 手段②：register* 十读者随注册块迁 collab-observability-wiring——unregister×9 关停面留本体（原序）
import { CollabSpoolService } from './collab-spool.service';
import { CollabPgBreakerService } from './collab-pg-breaker.service';
import { CollabPersistenceService, raceDeadline, type PersistenceDocument } from './collab-persistence.service';
import { CollabDocRegistryService, type QuotaConfig } from './collab-doc-registry.service';
import { CollabSessionGuardService } from './collab-session-guard.service';
import { CollabProjectActorService } from './collab-project-actor.service';   // Y1c T9：spool-first 写管线核心（偏离 38③）
import { CollabFrameGateService } from './collab-frame-gate.service';   // Y1c T9：guardSyncFrame 收编重写（偏离 38①③）
import { requireSystemHistory } from './canvas-doc-head';   // Y1c T9（T8 接线）：真 historyId 自 SystemHistory（复用读面禁重抄——Controller 裁定 2）
import { createCollabServer } from './collab-server.factory';   // B3 手段①：Server 构造 options 块单源工厂（canvas-doc.factory 同址先例）
import { wireCollabMetricsReaders } from './collab-observability-wiring';   // B3 手段②：metrics reader 注册块单源（unregister×9 关停面留本体）
import { parseDocName } from './doc-name.util';
import { CollabCloseCode } from '@flowweb/shared';
import type { TryReleaseMotive, TryReleaseOutcome } from './collab-residency.service';

/** Y0a-3 T5（SV7/W）：collab 面七态（模块别名——method 签名里 `typeof this.collabState` 有 TS 解析风险，恒用本名）。
 *  serving=唯一放行态；draining=部署停写；isolated=自隔离（listener 已让位）；start-failed=启动失败（有界重试）。 */
type CollabState = 'initializing' | 'acquiring' | 'starting' | 'serving' | 'draining' | 'isolated' | 'start-failed';

/** Y0c T40（B1）：Persistence 域常量/函数随域迁 collab-persistence.service——再导出保既有
 *  import 面（gateway.spec :962 动态 import persistRetryDelayMs 免改；:143
 *  DOC_BYTES_OVER_THRESHOLD_BYTES 再导出同形先例）。 */
export { COMPACT_INTERVAL_MS, persistRetryDelayMs } from './collab-persistence.service';

/** Y0c T40（B1/§0.6 偏离 67）：doc-name 纯函数族迁 doc-name.util（service 消费 parseDocName 的
 *  gateway↔service 运行时循环消解）——再导出保全部既有 import 面（collab-doc-name.spec/
 *  collab-document.service/collab-residency.service 及全部消费方零触碰）。 */
export { parseDocName, isValidDocName, isGenerationMismatch, type ParsedDocName } from './doc-name.util';

/** Y0c T41（W3a/B2）：DocRegistry 域常量/类型/纯函数随域迁 collab-doc-registry.service——再导出
 *  保既有 import 面（B1 COMPACT_INTERVAL_MS 先例同款；spec 实测导入面 §8.4：TRUTH_COOLDOWN_MS×2/
 *  TOPN×2/QuotaConfig type×6/parsePositiveInt×1+生产面 collab-shrink.service VACUUM_QUIESCE_*×2
 *  ——全部零触碰）。quota 四值 env 解析随构造参数迁 DR 构造器（census ㉒ 四键条目同迁——设计
 *  预估「解析留 GW」现场核不成立：DI 路径 DR 须构造期自足，gateway 桶容量读面经 activeQuota 单源）。 */
export { TRUTH_COOLDOWN_MS, TOPN_LOG_INTERVAL_MS, TOPN_LOG_LIMIT, VACUUM_THAW_SETTLE_MS, VACUUM_QUIESCE_POLL_MS, VACUUM_QUIESCE_TIMEOUT_MS, parsePositiveInt, type QuotaConfig } from './collab-doc-registry.service';

/** Y0c T41（W3b/B2）：SessionGuard 域常量随域迁 collab-session-guard.service——再导出保既有 import 面
 *  （B1/W3a 先例同款；spec 实测导入面 §8.4：AWARENESS_FRAME_LIMIT_BYTES×1〔rate-gate〕/
 *  AWARENESS_STATES_LIMIT_BYTES+AWARENESS_DISTINCT_USER_STRIP_OVER×1〔awareness-guard〕——零触碰。
 *  R4b'：BACKPRESSURE 双名自本行退役（迁 collab-limits 单源——消费方 backpressure spec 改直源 import）。
 *  SESSION_SWEEP_INTERVAL_MS/GRACE_MS 模块私有随迁（spec 导入面实测零，非再导出义务——任务卡列名为
 *  设计预估，现场实测无导入面，commit 披露）。census ⑤⑥⑪ 目标文件同批切换 SG。 */
export { AWARENESS_FRAME_LIMIT_BYTES, AWARENESS_STATES_LIMIT_BYTES, AWARENESS_DISTINCT_USER_STRIP_OVER } from './collab-session-guard.service';

/** Y0c T42（B3 手段①）：resolveCollabDebounce 随 Server 构造迁 collab-server.factory（COLLAB_DEBOUNCE/
 *  NODE_ENV 解析单点随消费点）——再导出保既有 import 面（collab.module.ts useFactory/env.spec 零触碰，
 *  B1 COMPACT_INTERVAL_MS 同款先例）。 */
export { resolveCollabDebounce } from './collab-server.factory';

/** Y0b-4 T4（Q-A v5）：writeFreeze 冻结原因四分位——readOnly=原因集非空（单一真值），
 *  解除=移除本方原因（drain 解除不误赦免 viewer/spool/quota——H-5 prev 快照语义的集合化继任）。
 *  W3a：加 export（DR host 缝签名消费——`import type` 零运行时边，无 design:paramtypes 环；
 *  设计 §1.2 collab-conn.util 候选否：type-only util 的 bufferedAmount 词面撞 census ⑤/backpressure
 *  spec 锚「生产读点唯一」词法执法面=断言修改红线，纯类型无偏离 67 循环前提——commit 披露）。 */
export type FreezeReason = 'viewer' | 'draining' | 'quota' | 'spool';

/** Y0b-4 T4：writeFreeze/拒绝链的连接结构面（库 Connection 的结构性子集——测试 fake 连接同形可达；
 *  document?.name 可选容错=auth-defense/perm-events 既有 fake 连接无 document 字段）。W3a：加 export
 *  （DR guardSyncFrame/freeze 族 conn cast+host 缝签名消费——同上 type-only 零运行时边）。 */
export interface CollabConnection {
  document?: { name: string };
  socketId?: string;
  readOnly?: boolean;
  context?: { freezeIntent?: FreezeReason; token?: string; sessionExpiresAt?: Date } & Record<string, unknown>;
  sendStateless?: (payload: string) => void;
  send?: (message: Uint8Array) => void;
  messageAddress?: string;
  /** Y0b-4 T7：webSocket 结构面子集扩 send/bufferedAmount（wrapBackpressure 消费——ws 库
   *  WebSocketLike 可变窄到本形状；stub ws 测试装置同形）。R4b'（v3）：send 双参（cb=预算
   *  release 回调）+once 可选（close 兜底释放监听——OutboundBudget 消费）。 */
  webSocket?: { send: (data: unknown, cb?: (err?: Error) => void) => void; close: (code: number, reason: string) => void; bufferedAmount?: number; once?: (event: string, cb: () => void) => void };
}

/** Y0b-5 T10：超阈计数阈值再导出（定义单源=store.metrics——gateway=测试常量绑定面先例〔TRUTH_COOLDOWN_MS 同款〕；
 *  TOPN_LOG_INTERVAL_MS/TOPN_LOG_LIMIT 定义已随 W3a 迁 collab-doc-registry.service——上方再导出块保 import 面） */
export { DOC_BYTES_OVER_THRESHOLD_BYTES } from './store.metrics';

/** Y0a-2 持久化契约声明（spec v2.4 §2.1，钉死）已随 B1 域迁 collab-persistence.service.ts 头注。 */
/** Q-I3（T10 收口）：卸载拒绝 typed error——unloadDocument catch 面分类判据=instanceof（禁 message
 *  子串『拒绝卸载』——文案改动即静默改控制流：拒绝档误分「意外异常」=双计 docUnloadBlockedTotal；
 *  测试红轴=改文案不影响分类）。 */
export class UnloadDrainRefusedError extends Error {}

@Injectable()
export class CollabGateway implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CollabGateway.name);
  readonly server: Server;
  /** Y0c T40（B1）：Persistence 域 service——DI 注入（module provider 单例）或直构自建+bindHost
   *  后置绑定（31 处直构零改动；自建路径必传 this.pgBreaker 同实例=防熔断器脑裂 pgBreakerRef() 假绿面）。
   *  公有读面=消费面 8 委托语义位背后的本体+测试直调族（gw.persistence.maybeCompact 等——B1-B3
   *  公有化后 cast 消失面，§0.6 偏离 64②）。 */
  readonly persistence: CollabPersistenceService;
  /** Y0c T41（W3a/B2）：DocRegistry 域 service——DI 注入（module provider 单例）或直构自建+bindHost
   *  后置绑定（B1 persistence 同款双兼容；自建路径必传 this.pgBreaker/this.persistence 同实例=防熔断器
   *  脑裂+façade 装置同一性前提）。doc 生命周期账目单一所有者（Z24——truth/冻结族/真空代际/doc-status/
   *  stuck 账目/residency 释放入口〔RC1=B 组合持有〕）；公有读面=委托语义位背后的本体+测试直调族
   *  （gw.docRegistry.loadDocument 等——cast 消失面，§0.6 偏离 64②）。 */
  readonly docRegistry: CollabDocRegistryService;
  /** Y0c T41（W3b/B2）：SessionGuard 域 service——DI 注入（module provider 单例）或直构自建+bindHost
   *  后置绑定（B1/W3a 同款双兼容；自建路径必传 sessionSvc/perm/pgBreaker/persistence/docRegistry 同实例=
   *  防熔断器脑裂+façade 装置同一性前提）。连接鉴权/限流/awareness 判定单一所有者（Z24——限流四桶/认证
   *  防线三层/连接寿命标识台账/awareness 归属双索引/writeFreeze 冻结层单源/heap 采样闸〔RC3〕/sweep 复验）；
   *  公有读面=委托语义位/钩子接线背后的本体+测试直调族（gw.sessionGuard.startSessionSweep 等——cast 消失面，§0.6 偏离 64②）。 */
  readonly sessionGuard: CollabSessionGuardService;
  /** Y1c T9（偏离 38③）：CollabProjectActor——per-project spool-first 写管线单写者（submit 入队→
   *  单 drain 批量→WAL appendBatch+fsync→逐帧 apply（gate origin）→逐帧 resolve→PG 批行）。
   *  DI/直构双兼容（gateway 尾参自建+bindHost——B1/W3a 同款）。 */
  readonly projectActor: CollabProjectActorService;
  /** Y1c T9（偏离 38①③）：FrameGate——guardSyncFrame 收编重写（gate 提交 actor 并 await；
   *  配额判定/冻结族经 DR 单源）。公有面=hooks.beforeSync 接线背后的本体+测试直调族。 */
  readonly frameGate: CollabFrameGateService;
  /** Y0b-5 T16：PG 熔断器（准入+store 短路——spec §5.9 E57；直构测试不注入时自建） */
  private readonly pgBreaker: CollabPgBreakerService;
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
    if (next === 'serving') this.sessionGuard.onServingTransition();   // W3b：refusalCache 随域迁 SG——serving 汇点经 sg.onServingTransition（Y0b-3 T3 P-Q 清空单点：drain 解除/租约 rejoin/fence 解除全含于 serving 转移——refusalCache 残留拒连窗随状态恢复一并消除）
  }
  /** V12 判据唯一化：三入口门/写意图门统一读 collabState 派生（serving=唯一放行态）——
   *  lease.isServing() 仅为租约状态机内部使用（acquireLoop/看门狗），对外服务判据唯一源=collabState。 */
  isLeaseServing(): boolean { return this.collabState === 'serving'; }
  /** Y0b-2 T3（Z50 修订→Y0c T17 Z104 拆分）：PG 完整性谓词「PG 快照滞后度」三态合一——
   *  in-flight store（取批未落定）/pending 队列（去抖窗）/spool 帧（故障期台账）任一非空 ⇒ PG 快照
   *  可能滞后 ⇒ false；三态全空=内存与 PG 同步，快照读可信。**doc 常驻（documents.has）不再是滞后
   *  信号**（Z104：原四态首项常驻下恒 false ⇒ readCanvasSnapshotCached 永远 fallback+vacuum quiesce
   *  注定 30s 活锁——doc 常驻=独立谓词 isDocResident；常驻会话的卸载归 tryRelease('vacuum') 每轮驱动）。
   *  消费=readCanvasSnapshotCached 缓存门（三态空=快照可信）+vacuum quiesce（三态空才 tryRelease）。 */
  isPersistedComplete(projectId: string): boolean {
    return this.persistence.isPersistedComplete(projectId);   // B1 委托位①（实现随域迁 service——三态判据注释见彼处）
  }
  /** Y0b-2 T5 → Y0c T20 定案（Z105 唯一形态=hasActiveWsConnection——**推翻 Z77「∨活跃会话」倾向**）：
   *  谓词=仅 WS 连接数>0，与常驻会话（direct conn）**无关**。常驻若计入⇒无人在线项目的 reconcile 也真
   *  ⇒ exec_projection_deferred_total 的「无人在看=不值得为 UX 投影花钱」语义被废+5min 一次的 reconcile
   *  会把几十个无人项目钉在内存——故语义本就只看 WS 连接（旧 documents.has 形态在常驻化〔T15〕后恒真
   *  =假门禁 D13 族，本批根除）。
   *  消费=①reaper 终态投影分治（intent-reconcile projectReaped deferred 门——无人看=deferred，用户回来
   *  alignExecFromIntents 既有机制对齐）②（T13 probeArtifacts 退役——该归因计数面随之退役，指标保留历史读数）装载归因（yjs_doc_loaded_by_
   *  reconciler_total——reconcile 装载=ephemeral 即用即释非常驻，T20 同批）。 */
  isDocResident(projectId: string): boolean {
    return (this.server.hocuspocus.documents.get(`project:${projectId}`)?.connections.size ?? 0) > 0;
  }
  /** Y0c T17（Z129）：常驻会话统一释放回调公有注册点（CollabResidencyService 构造期注册——
   *  setVacuumRunner 同款反向注入形态：residency→gateway 单向依赖）。W3a RC1=B 组合持有：字段+
   *  释放入口所有权迁 DR（attach 缝后置绑定），本注册点=1 行转发——residency 构造器注册缝
   *  （`gateway.registerResidentSessionReleaser?.()` 调用形态）与 reaper spec :494-497 mock 断言
   *  零触碰（注册缝宿主=公有方法名+调用形态不动，设计 §3.3-1）。语义注释见 service 对应位。 */
  registerResidentSessionReleaser(fn: (pid: string | null, motive: TryReleaseMotive) => Promise<unknown>): void {
    this.docRegistry.attachResidencyReleaser(fn);
  }
  /** Y0c T18：residency 条目读面公有注册点（W3a：探针字段迁 DR——1 行转发 attach；未注册
   *  〔直构 gateway〕=0 语义见 service probeResidentSessions；hangReason 判据注释见彼处）。 */
  registerResidentSessionsProbe(fn: () => number): void { this.docRegistry.attachResidencyProbe(fn); }
  /** T17 Z129：单会话释放转发——W3a 委托位（实现随域迁 DR；vacuum quiesce/shrink 消费面零触碰，
   *  未注册=undefined 语义与 outcome 透传/异常折叠注释见 service 对应位）。 */
  tryReleaseResidentSession(pid: string, motive: TryReleaseMotive): Promise<TryReleaseOutcome | undefined> {
    return this.docRegistry.tryReleaseResidentSession(pid, motive);
  }
  /** T17 Z129：全部常驻会话释放转发——W3a 委托位（drain/隔离/关停出口消费；调用方 fire-and-forget
   *  的 void 语义逐字保持〔§2.2 链 2〕；未注册=no-op，A2 :524 Σdirect===0 证明义务注释见 service）。 */
  releaseAllResidentSessions(motive: TryReleaseMotive): Promise<void> {
    return this.docRegistry.releaseAllResidentSessions(motive);
  }
  /** Y0c T15（Z111）：装载降级谓词——degradedDocs（pendingStructs/pendingDs 非空）读取出口。
   *  消费=residency acquire 新开路径阻断常驻（degraded doc 不入会话表——分钟级盲区不拉成小时级）。
   *  W3a 委托位（台账随域迁 DR——公有字段读面，B1 storeFailedDocs 委托 getter 同款）。 */
  isDocDegraded(projectId: string): boolean {
    return this.docRegistry.degradedDocs.has(projectId);
  }
  /** Y0c T16（Z126①）：heap 闸压力态纯读数（reaper 消费——禁调 heapPressureSample〔翻转日志+
   *  gauge 同步+refusalCache 清理副作用〕；overloadTripped=翻转检测缓存，真实态在 util 迟滞内）。 */
  isHeapPressureTripped(): boolean { return this.sessionGuard.isHeapPressureTripped(); }   // W3b 委托位（overloadTripped 采样闸随域迁 SG——RC3；residency reaper 消费零触碰）
  /** Y0c T16（Z141）：reaper 判据读出口①——pending 队列非空（B1 委托位②，实现随域迁 service）。 */
  hasPendingWrites(projectId: string): boolean {
    return this.persistence.hasPendingWrites(projectId);
  }
  /** Y0c T16（Z141）：reaper 判据读出口②——在飞 store（B1 委托位③，实现随域迁 service）。 */
  hasInFlightStore(projectId: string): boolean {
    return this.persistence.hasInFlightStore(projectId);
  }
  /** Y0c T16（Z110）：store append 失败 doc 标记（B1 委托位④——getter 返回 service 真实 Set 引用，
   *  residency reaper 读面零触碰；add/delete 单点语义注释见 service 字段声明）。 */
  get storeFailedDocs(): Set<string> {
    return this.persistence.storeFailedDocs;
  }
  /** Y0c T16（Z106）：常驻条目字节单源读——truth+delta（:557 既有求和口径的 per-pid 版）。
   *  会话表 bytes=缓存（reaper tick 刷新）——禁造第二真源禁新 encode。无键=0（未装载/已清理）。
   *  W3a 委托位（truth 三件套随域迁 DR——公有字段读面，求和口径逐字保持）。 */
  docBytesOf(projectId: string): number {
    return (this.docRegistry.docTruth.get(projectId) ?? 0) + (this.docRegistry.docDelta.get(projectId) ?? 0);
  }
  /** flush 失败兜底（内存 unflushed Map）已随 Y0a-2 stash 族退役——spool=唯一权威待落库台账 */
  readonly hooks: {
    connected: (p: connectedPayload) => Promise<any>;
    onAuthenticate: (p: onAuthenticatePayload) => Promise<any>;
    onLoadDocument: (p: onLoadDocumentPayload) => Promise<any>;
    onStoreDocument: (p: onStoreDocumentPayload) => Promise<boolean>;
    afterStoreDocument: (p: afterStoreDocumentPayload) => Promise<void>;
    beforeHandleAwareness: (p: beforeHandleAwarenessPayload) => Promise<any>;
    beforeHandleMessage: (p: beforeHandleMessagePayload) => Promise<void>;
    beforeSync: (p: beforeSyncPayload) => Promise<void>;
    onStateless: (p: onStatelessPayload) => Promise<void>;   // Y1c T10：save barrier（偏离 37⑦+38⑳——首语句同步捕获 appliedSeq）
    onDisconnect: (p: onDisconnectPayload) => Promise<void>;
    beforeUnloadDocument: (p: beforeUnloadDocumentPayload) => Promise<void>;
    afterUnloadDocument: (p: afterUnloadDocumentPayload) => Promise<void>;
    onUpgrade: (p: onUpgradePayload) => Promise<void>;
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly repo: CanvasDocUpdateRepository,
    private readonly lease: CollabLeaseService,
    perm: ProjectPermissionService,   // W3b：裸参数（perm 所有权迁 SG——直通 SG 构造器，this.perm 字段退役；位序/类型不动，直构注入面零触碰）
    // Y0a-2 C6：spool=必填位置参数（漏参即编译红；TS1016 禁"必参随可选参"——前置可选参数全部改
    // 显式 `T | undefined` 形态，@Optional() 运行时语义不变，位置个数十一参恒定〔Y0b-4 T2 尾增
    // quota——尾参真可选（后无必参）不违 C6，既有直构十参调用免改〕）。
    // Nest 按类型自动注入（module providers 已注册）。
    @Optional() @Inject('COLLAB_PORT') port: number | undefined,
    @Optional() @Inject('COLLAB_DEBOUNCE') debounce: number | undefined,
    @Optional() @Inject('COLLAB_TIMEOUT') timeout: number | undefined,
    @Optional() @Inject(SessionService) sessions: SessionService | undefined,
    private readonly spool: CollabSpoolService,
    // Y0b-4 T2：配额构造注入（测试/组装期覆盖 env 默认；Nest DI 无此令牌恒 undefined→env 默认）。
    // W3a：Partial 直通 DR 构造器（四值解析单点随域迁——本参数签名/位序不动，直构注入面零触碰）。
    @Optional() quota?: Partial<QuotaConfig>,
    // Y0b-5 T16：熔断器注入（尾参真可选——既有直构调用免改；Nest 由 module provider 注入单例）。
    @Optional() pgBreaker?: CollabPgBreakerService,
    // Y0c T40（B1）：Persistence 域 service 注入（pgBreaker 尾参先例同款——既有 31 处直构零改动；
    // Nest 由 module provider 注入单例）。
    @Optional() persistence?: CollabPersistenceService,
    // Y0c T41（W3a/B2）：DocRegistry 域 service 注入（B1 persistence 尾参先例同款——既有直构零改动；
    // Nest 由 module provider 注入单例；quota Partial 直通 DR 构造器——env 解析单点在彼处）。
    @Optional() docRegistry?: CollabDocRegistryService,
    // Y0c T41（W3b/B2）：SessionGuard 域 service 注入（B1/W3a 尾参先例同款——既有直构零改动；
    // Nest 由 module provider 注入单例；直构顺序 DR→SG，SG 构造器读 docRegistry.activeQuota 桶容量三值）。
    @Optional() sessionGuard?: CollabSessionGuardService,
    // Y1c T9：actor/gate 尾参注入（直构自建传同 repo/spool 实例——W3a 同款双兼容）。
    @Optional() projectActor?: CollabProjectActorService,
    @Optional() frameGate?: CollabFrameGateService,
  ) {
    // W3b：sessionSvc 所有权迁 SG（原 this.sessionSvc 字段退役——局部构造后直通 SG 构造器；gateway
    // 不再直持〔authenticateInner/recheckConnection 消费面随域迁 SG〕）。批3-3：手写 findUnique 收口语义不变。
    const sessionSvc = sessions ?? new SessionService(prisma);
    this.pgBreaker = pgBreaker ?? new CollabPgBreakerService();
    // Y0b-5 T16：冻结契约 16 第五钩子（PG 半开成功清 refusalCache——清空点二）；W3b：refusalCache 随域迁
    // SG，接线改 sg.clearRefusalCache（惰性闭包——SG 下方构造，回调触发时已在位；锚随迁 §8.3-1 GW 接线恰 1）。
    this.pgBreaker.setOnRecovered(() => this.sessionGuard.clearRefusalCache());
    // Y0c T40（B1）：Persistence service——DI 单例或直构自建；自建路径必传 this.pgBreaker 同实例
    // （防熔断器脑裂=pgBreakerRef() 假绿面）+同 repo/spool/eventEmitter 实例（façade stubRepo/stubSpool
    // 双写装置的同一性前提）。bindHost 后置绑定（setLeaseOwner/registerResidentSessionReleaser 同形
    // 先例）：host=留 gateway 语义域的最小接口（logger 共享实例保 spyLogger 断言面/truth 族单点/
    // collabState 三谓词/refusalCache 清空点/P-Q spool 支）。
    this.persistence = persistence ?? new CollabPersistenceService(repo, spool, eventEmitter, this.pgBreaker);
    // Y0c T41（W3a/B2）：DocRegistry service——DI 单例或直构自建；自建路径必传 this.persistence/
    // this.pgBreaker 同实例（防熔断器脑裂+façade stubRepo 双写装置同一性前提，B1 同款）+quota
    // Partial 直通（env 解析单点=DR 构造器——gateway 桶容量读面经 activeQuota 单源，防双源 P3）。
    this.docRegistry = docRegistry ?? new CollabDocRegistryService(repo, this.persistence, this.pgBreaker, quota);
    // Y0c T41（W3b/B2）：SessionGuard service——DI 单例或直构自建；自建路径必传 sessionSvc/perm/
    // this.persistence/this.docRegistry/eventEmitter/this.pgBreaker 同实例（防熔断器脑裂+façade 装置同一性，
    // B1/W3a 同款；直构顺序 DR→SG——SG 构造器读 docRegistry.activeQuota 桶容量三值单源）。SG→DR 构造边
    // 既有设计（connected/authenticateInner/freezeReasons/sweepStaleAuthMaps/disconnect 消费），DR 不注入
    // SG（能力经 DR host 缝下方接线转发 sg.*）⇒ 无环。
    this.sessionGuard = sessionGuard ?? new CollabSessionGuardService(sessionSvc, perm, this.persistence, this.docRegistry, eventEmitter, this.pgBreaker);
    // W3a host 缝 SG 能力五位（bytes 桶/freezeReasons/hardClose/applyWriteFreeze/releaseFreezeForDoc）
    // +RC3 heapPressureSample+connectionIdOf：W3a 实现=gateway 现存私有方法本体，W3b 迁 SG 后接线改转发
    // sg.*（惰性闭包——SG 上方已构造）——DR 文件与 host 接口签名两波零改动契约兑现（§4.3）。
    this.docRegistry.bindHost({
      logger: this.logger,
      documents: () => this.server.hocuspocus.documents,
      unloadingDocuments: () => this.server.hocuspocus.unloadingDocuments,
      shouldUnloadDocument: (document) => this.server.hocuspocus.shouldUnloadDocument(document),
      isServingState: () => this.collabState === 'serving',
      isDrainingState: () => this.collabState === 'draining',
      heapPressureSample: () => this.sessionGuard.heapPressureSample(),
      applyWriteFreeze: (conn, reason, on) => this.sessionGuard.applyWriteFreeze(conn, reason, on),
      releaseFreezeForDoc: (pid, reason) => this.sessionGuard.releaseFreezeForDoc(pid, reason),
      hardClose: (conn, code, reason) => this.sessionGuard.hardClose(conn, code, reason),
      // Y1c T9：consumeBytesBucket 缝随 guardSyncFrame 收编迁 frame-gate host（DR 消费点消失）
      freezeReasons: (conn) => this.sessionGuard.freezeReasons(conn),
      connectionIdOf: (socketId) => this.sessionGuard.connectionIdOf(socketId),
      onGenerationSeeded: (pid, generation) => this.spool.setProjectGeneration(pid, generation),   // T8 接线：世代权威播种（帧内一律携带 generation 的 WAL 段单源）
      onWalSeqFloorSeeded: (pid, pgSeq) => this.spool.seedWalSeqFromPg(pid, pgSeq),   // C1①（T11 双评审）：装载缝 PG 播种——段全回收项目计数器自 PG 真值重建（红链见 canvas-doc-walseq-seeding.int.spec）
    });
    this.persistence.bindHost({
      logger: this.logger,
      getDocument: (name) => this.server.hocuspocus.documents.get(name) as PersistenceDocument | undefined,
      docStats: () => {
        // Y0c T20（Z47）：directConns=Σ directConnectionsCount（graceDirectConnections count() 同款求和）
        let directConns = 0;
        for (const doc of this.server.hocuspocus.documents.values()) directConns += doc.directConnectionsCount ?? 0;
        return { loadedDocs: this.server.hocuspocus.documents.size, connections: this.server.hocuspocus.getConnectionsCount(), directConns };
      },
      // Y0b-4 T3（Q-B）：delta 触发器累加——W3a 接线改指：守卫体（update 监听唯一写者/未建键不计/
      // 已清理跳过/SERVER_TRANSACT_ORIGIN 不计〔Z119②〕）逐字迁 DR.onUpdateDelta（承接账⑤：
      // persistence host 接口签名零变化，仅 gateway 侧接线实现改接——persistence 文件零 diff）。
      onUpdateDelta: (pid, bytes, origin) => this.docRegistry.onUpdateDelta(pid, bytes, origin),
      // RC4：fenced→selfIsolate→closeAll1012→spool 入账链=同方法体同 async 流 inline await（未切两半）
      onFencedByWrite: () => this.selfIsolate('fenced-by-write'),
      calibrateTruth: (pid, bytes) => this.docRegistry.calibrateTruth(pid, bytes),
      observeDocBytes: (bytes) => this.docRegistry.observeDocBytes(bytes),
      isIsolated: () => this.collabState === 'isolated',
      isServingState: () => this.collabState === 'serving',
      isShuttingDownFlag: () => this.shuttingDown,
      currentLeaseEpoch: () => this.lease.currentEpoch(),   // T14（v11.1①）：flushDocument 提交前 epoch 校验读缝——CollabLeaseService 单源
      onSpoolRecoveredFlip: () => this.sessionGuard.onServingTransition(),   // W3b：refusalCache 随域迁 SG——P-Q 清空并集 spool 支经 sg.onServingTransition（serving 汇点）接线
    });
    // W3b：SessionGuard host 绑定（4+1 位——logger 共享实例保 spyLogger 断言面/allDocuments 库读面/
    // collabState serving+draining 谓词/closeConnections 库方法〔设计 §4.2 表列漏位，现场核补，DR
    // shouldUnloadDocument 同款先例〕；B3 承接账④：SG 位更名 isShuttingDownFlag→isDrainingDerived
    // ——现场实测=isShuttingDown() draining 派生〔非布尔 shuttingDown 关停闸〕，同名异义消歧〔质量评审
    // Minor-4〕；persistence host 位 isShuttingDownFlag 不改名=真读 this.shuttingDown 关停闸，语义各归其名）。
    this.sessionGuard.bindHost({
      logger: this.logger,
      allDocuments: () => this.server.hocuspocus.documents,
      isServingState: () => this.collabState === 'serving',
      isDrainingDerived: () => this.isShuttingDown(),
      closeConnections: (name) => this.server.hocuspocus.closeConnections(name),
    });
    // Y1c T9：actor+gate 构造与接线（顺序 SG→actor→gate——gate 消费 DR/actor；actor host=文档读面/
    // SG 能力三位经 1 行转发+DR 判定三位直引；persistence 维护写独立 append 通道 sink=actor
    // submitMaintenance——偏离 38①：connection 帧=actor 管线唯一写者，旧 store 链降级 telemetry）。
    this.projectActor = projectActor ?? new CollabProjectActorService(this.spool, this.repo, this.pgBreaker);
    this.projectActor.bindHost({
      logger: this.logger,
      documents: () => this.server.hocuspocus.documents,
      hardClose: (conn, code, reason) => this.sessionGuard.hardClose(conn, code, reason),
      isQuotaFrozen: (pid) => this.docRegistry.isQuotaFrozen(pid),
      generationOf: (pid) => this.docRegistry.generationOf(pid),
      noteReadOnlyDrop: (conn, pid, bytes) => this.docRegistry.noteReadOnlyDrop(conn, pid, bytes),
      onFencedByWrite: () => this.selfIsolate('fenced-by-write'),   // RC4 承接（actor PG 腿 fenced→隔离链）
      isMaintenanceBlocked: (pid) => this.docRegistry.isVacuuming(pid),   // Y1c T10：barrier maintenance 拒绝语义（T27 维护状态机扩同缝）
    });
    this.frameGate = frameGate ?? new CollabFrameGateService(this.docRegistry, this.projectActor);
    this.frameGate.bindHost({
      logger: this.logger,
      hardClose: (conn, code, reason) => this.sessionGuard.hardClose(conn, code, reason),
      consumeBytesBucket: (socketId, bytes) => this.sessionGuard.consumeBytesBucket(socketId, bytes),
    });
    this.persistence.setMaintenanceSink((pid, payload) => this.projectActor.submitMaintenance(pid, payload));
    this.hooks = {
      // W3b（RC4=A）：connected 钩子体即迁 SG.onConnected（消费面 8 成员 5 SG 所有+isVacuuming/
      // quotaFrozenDocs/buildDocStatus SG→DR 直引 3 位）——GW 接线改 1 行（寿命台账播种/wrapBackpressure/
      // hardClose 4410 terminal/writeFreeze 意图登记全随本体逐字平移，承重细节注释见 service 对应位）。
      connected: (p) => this.sessionGuard.onConnected(p),
      onAuthenticate: (p) => this.sessionGuard.authenticate(p),   // W3b：SessionGuard 域认证防线三层（refusalCache→信号量→桶→inner→DB）
      onLoadDocument: (p) => this.docRegistry.loadDocument(p),   // W3a：DocRegistry 域直调（钩子接线即编排点——B1 onStoreDocument 直通先例同款）
      // Y1c T9（偏离 38①——P1 入口条件）：onStoreDocument 旧链拆除 telemetry-only——
      // connection 帧经 gate pre-apply（origin={source:'connection',...,gate:true}）恒触发库防抖
      // store（S1-F-3：connection 档 shouldSkipStoreHooks 恒 false 无逃生舱），保留 store 调用=每帧
      // 新旧双写；帧持久化归 actor（WAL→PG），维护写走 persistence 独立通道（soft/disconnect/retry/
      // drain/maintenance 五直调点）。验收=onStoreDocument 对 connection-origin 零调用（S1 ⑨ 翻转）。
      onStoreDocument: async () => { try { legacyStoreHookProbeTotal.inc({ origin: 'library-debounce' }); } catch { /* telemetry 探针永不抛（A14） */ } return true; },
      // 注：storeDocumentUnlocked('debounce') 退出现役——trigger 枚举保留 'debounce' 历史读数（零生产调用方）。
      // Y0a-2（V22 收缩）：afterStoreDocument=**存活计数探针**（yjs_store_hook_calls_total——钩子链健康面）。
      // v1 的"队列非空∧非 spool 键"对账判据**撤**（去抖窗内正常新写入必命中=纯噪声——外审 E4 成立）；
      // 真对账=storeDocumentUnlocked 成功路径的 **splice 点队首前进自检**（零误报）。探针永不抛
      //（库 saveMutex 锁内执行——A14）。B3 手段④壳再薄化：私有壳唯一消费=本接线——内联（体逐字）。
      afterStoreDocument: async () => { try { yjsStoreHookCallsTotal.inc(); } catch { /* 探针钩子永不抛 */ } },
      beforeHandleAwareness: (p) => { this.sessionGuard.guardAwarenessRate(p); this.sessionGuard.guardAwareness(p); return Promise.resolve(); },   // W3b：SessionGuard 域（Y0b-3 T7 states 三分支+Y0b-4 T6 独立限速——限速先行；guardAwareness 自吞异常，限速 throw 必须在外层）
      beforeHandleMessage: (p) => this.sessionGuard.guardMessageFrame(p),   // W3b：SessionGuard 域（Y0b-4 T6 awareness 帧闸〔判型单源 readFrameType〕+msg 桶计数 H-3）
      beforeSync: (p) => this.frameGate.guardSyncFrame(p),   // Y1c T9：guardSyncFrame 收编 frame-gate（SS1 SV 代际门/帧闸/bytes 桶/配额判定→actor.submit——apply 归属=actor pre-apply，ACK 时帧必已 fsync）
      // Y1c T10（偏离 37⑦+38⑳——save barrier 服务端接线）：{nonce,clientSeq,tabId,sessionEpoch} wire
      // 载体 → actor.handleStateless（首语句同步捕获 target=appliedSeq→flushThrough 有界→显式
      // connection.sendStateless 回执；nonce 幂等/永不 throw/maintenance 拒绝语义在 actor）。
      // 同连接串行=库 processMessages 队列（stateless 与 sync 同队列序——契约测试锁定）。
      onStateless: async (p) => { await this.projectActor.handleStateless(p); },
      onDisconnect: (p) => this.disconnect(p),
      beforeUnloadDocument: (p) => this.unloadDocument(p),   // Y0a-2 Task 7：卸载清理+交接（永不抛——X4）
      afterUnloadDocument: async (p) => {
        this.docRegistry.afterUnloadDocument(p.documentName);
        this.projectActor.onProjectStateCleanup(parseDocName(p.documentName)?.projectId ?? '');   // Q-I1：actor per-project 状态随真卸载清（unload 链——queue 空/drain 静止守卫在 actor 方法内）
      },   // Y0b-4 T3 外审修复（I-1）：真卸载终态清理（库删键+destroy 后才调）；DocRegistry 域直调（钩子接线即编排点——onLoadDocument 同款；async 仅为满足库 hook 签名〔原私有壳 async 同形——DR 方法同步体〕；B3 手段④壳再薄化：15 容器清理/键集差异逐键钉死注释见 service 对应位〔W2 穷举单测 D1〕）
      onUpgrade: async (p) => this.sessionGuard.handleUpgrade(p),   // W3b：SessionGuard 域（Y0b-3 T2 Origin 403+升级限流 §3.1ter——socket 直写形态；async 仅为满足库 hook 签名，同步体全吞不 reject）
    };
    // Y0c T42（B3 手段①）：Server 构造 options 块=createCollabServer 单源（collab-server.factory——
    // options/注释逐字平移；接线序不变：this.hooks 上方已赋值，工厂消费只读签名面）。
    this.server = createCollabServer({ port, debounce, timeout, hooks: this.hooks });
    // Y0c T42（B3 手段②）：metrics reader 注册块单源（collab-observability-wiring——注册时序=构造器末
    // 原位；prisma=构造器参数名直通〔私有字段不扩公有面〕；unregister×9 关停面留 onApplicationShutdown 原位原序）。
    wireCollabMetricsReaders(this, prisma);
    this.docRegistry.startHeapObserver();   // W3a：stuck 观测随域迁 DR（RC3——heapPressureSample 经 host 缝转发 sg）
    this.docRegistry.startFrozenRecheckTimer();   // Y0b-4 T4：冻结 doc 重测（独立 timer——禁挂 sweep 逃生阀）
    this.sessionGuard.syncOverloadGauge(false);   // W3b：heap 采样闸随域迁 SG——初始 seed：ok=1/tripped=0 两 series 常在（面板恒可见）
    this.sessionGuard.startAuthMapsSweeper();   // W3b：防线 Map 老化随域迁 SG（P-V⑦ 独立 timer——禁挂 sweep tick，SWEEP_ENABLED=false 逃生阀不得静默关掉老化）
    // Y0b-5 T10：top-N doc 结构日志（5min——日志非指标，指标面零定时器纪律唯一豁免；W3a：启动
    // 两行机械提取 DR.startDocTopNLogTimer——构造器末调用位原序保持）
    this.docRegistry.startDocTopNLogTimer();
  }

  /** ===== Y0b-3 T2/T3（upgrade 面 §3.1ter + 认证防线三层+权限判据单源 §3.1bis）已随 W3b 迁
   *  collab-session-guard.service（连接鉴权/限流判定=SG 域；handleUpgrade/rejectUpgrade/allowedOrigins/
   *  clientIpOf/denyAuth/authenticate/authenticateInner 承重细节注释全文随迁见彼处）。钩子接线=构造器
   *  onAuthenticate/onUpgrade 直调 sg。verdict 纯函数化（decideUpgrade/resolveAllowedOrigins/clientIpOf/
   *  decideAuthAdmission）§5 顶层导出见 service。 */

  /** spec 2.3 装载重放（loadDocument——含四门拒绝族/版本门/truth cheap 播种/Q-O 降级可观测）已随
   *  W3a 迁 collab-doc-registry.service（doc 生命周期入口=DR 域；钩子接线=构造器 onLoadDocument
   *  直调，承重细节注释全文随迁见彼处）。 */

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
      // B1（T40）：Persistence 子步整体提取=persistence.onProjectGone（deletedProjects 终态集+退避梯
      // 随清+Z11① 收割梯保排+lastCompactAt/persistUnhealthy 清账+X1 discardForGoneProject 显式清队列
      // 点名+M6 空队列条目回收——与 DR 域清理均为独立 Map/Set 同步写面，跨族先后序不可观测）。
      this.persistence.onProjectGone(projectId);
      // W3a（B2）：truth/冻结/代际族 15 容器清理子步整体提取=docRegistry.onProjectGoneStateCleanup
      // （含 vacuumingDocs 真空窗兜底 :1157——B1 onProjectGone 同款机械提取，事件编排壳留 gateway，
      // V11 禁慢操作纪律在壳；键集差异逐键钉死=W2 穷举单测 D3）。
      this.docRegistry.onProjectGoneStateCleanup(projectId);
      // Q-I1：actor per-project 状态随项目终态清（projectGone 链——queue 空/drain 静止守卫在 actor 方法内；
      // 纯内存操作不违 V11 禁慢操作）
      this.projectActor.onProjectStateCleanup(projectId);
    }
    yjsDeletedProjects.set(this.persistence.deletedProjects.size);   // V25：永久无界的可见化（终态集随域迁 service——gauge set 留 gateway 原点）
    this.sessionGuard.closeTeamDocuments(projectIds);             // W3b：关连接随域迁 SG（payload-only 不查库；handleProjectsGone 内部直调 sg，不设公有委托 §4.4）
  }

  /** V13+X9：受理面判据（**粒度修正：只读降级而非停服**——"三入口全拒"会把本地磁盘故障放大成
   *  全站画布不可读：readCanvas 走 withDoc、装载拒=重连风暴，均超出 spec §2.2"拒新写入"语义）。
   *  分层：draining=关停期拒一切新连接；spool 熔断=**只读化**（新连接放行但 readOnly——复用
   *  connectionConfig.readOnly 机制+stateless persist-status 通告；存量连接不动——其批次由 BOI/V5' 承接）；
   *  loadDocument **永不 gate**；withDoc 只 gate 写意图。Y0a-3 的 /api/ready 消费同一方法。 */
  /** 派生（既有消费方两名不变——draining 布尔已并入 collabState 状态机）。 */
  isShuttingDown(): boolean { return this.collabState === 'draining'; }
  isWritableOrDegraded(): 'ok' | 'spool-unwritable' {
    return this.persistence.isWritableOrDegraded();   // B1 委托位⑧（实现随域迁 service——判据注释见彼处；residency/ready/recheckConnection 消费面零触碰）
  }
  /** Y0b-5 T16：PG 熔断 open 观测（ready 503 db-unavailable 面消费）——经 stateName 委托
   *  （闸门调用点静态锚恰三：admitQuery×2+isOpen×1，勿在此新增闸门调用）。 */
  isPgBreakerOpen(): boolean { return this.pgBreaker.stateName() === 'open'; }

  /** E35 自隔离（不自杀不硬撑）：拒新 WS（三入口门）+closeAll1012+**释放 listener 让位**（B7：
   *  closeAllConnections 不关监听——半死场景新实例 listen 必 EADDRINUSE；用 httpServer.close 不用
   *  destroy——后者 memoized 不可逆）。计数单源=本方法（{cause}——写侧直调与心跳侧 onLost 汇入同点，
   *  一次失守至多计 1）。re-listen 前置=M2① await listenerClosed+documents 清空（listenCollab）。
   *  Y0c T17（Z129）：常驻会话释放先行于 closeAll1012（await 序——A2 :524「调 closeConnections 时
   *  Σdirect===0」证明义务；批在途会话被拒留表，批由退避梯/spool 既有链路承接）。listenerClosed
   *  创建保持在同步段（释放 await 之前——listenCollab 的等待面就位，与释放时长解耦）。 */
  private async selfIsolate(cause: 'fenced-by-write' | 'heartbeat-fenced' | 'heartbeat-unknown-expired' | 'revoked'): Promise<void> {
    if (this.collabState === 'isolated') return;
    this.transition('isolated', cause);   // V33
    collabLeaseLostTotal.inc({ cause });
    this.sessionGuard.onServingTransition();   // W3b：refusalCache 随域迁 SG——Y0b-3 T3 防御性：隔离期写入的 LEASE_NOT_READY 缓存提前清消残窗（rejoin 的 serving 转移本会覆盖——双保险）
    this.clearDrainTimer();
    this.sessionGuard.clearAllWriteFreeze();   // W3b：writeFreeze 随域迁 SG——Y0b-4 T4：强引用台账随隔离清（连接由 closeAll1012 关——正常路径 onDisconnect 自清）
    this.listenerClosed = new Promise<void>((res) => {
      try {
        this.server.httpServer?.closeAllConnections?.();   // Node≥18.2 清 keep-alive
        this.server.httpServer?.close(() => res());
        setTimeout(res, 2_000).unref?.();                  // close 回调兜底
      } catch (e) { this.logger.warn(`isolate: listener close failed: ${(e as Error).message}`); res(); }
    });
    // I-2（质量评审）：释放段 try/finally——closeAll1012 可达性结构自证（不再依赖「转发面内部吞错」
    // 推理链；释放 reject 时连接关闭仍必达且异常不吞上抛，调用方语义不变）。listenerClosed 同步创建
    // 先行保证保持（上方）。
    try {
      await this.releaseAllResidentSessions('self-isolate');
    } finally {
      this.sessionGuard.closeAllConnections1012();   // W3b：连接批量关闭随域迁 SG（链 1 唯一编排点=selfIsolate 本体，§2.1 inline 缝）
    }
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
  /** SV9：POST /api/drain 动作体——置 draining+冻结既有连接（readOnly+doc-status 冻结通告）+刷新 60s
   *  deadline（幂等=刷新非 no-op：慢排空部署链续 POST 续窗）。**不触发关停流程**——只停写、等去抖
   *  自然排空；进度=GET /api/ready 的 pending。60s 未收到 SIGTERM 自动解除=对冻结连接 close(CollabCloseCode.APP_RESTART)
   *  （B12：readOnly 直翻 false 会漏"冻结期客户端单侧编辑"的静默分叉——客户端重连经状态向量自愈。
   *  Y0b-4 T5：冻结/解除通告并入 doc-status〔writeFrozen 维度翻转 rev++〕——遗留 write-frozen
   *  stateless 消息退役〔census ⑧：服务端清零〕）。 */
  beginDraining(): { draining: boolean; phase: string; autoReleaseAt: number; pending: ReturnType<CollabGateway['computePending']> } {
    if (this.collabState === 'serving') this.transition('draining', 'api-drain');
    // V15：回真实态——非 serving 态（isolated/start-failed/acquiring）置位不生效，draining:false 不对部署链说谎
    this.clearDrainTimer();
    const autoReleaseAt = Date.now() + 60_000;
    this.drainAutoReleaseTimer = setTimeout(() => {
      this.drainAutoReleaseTimer = null;
      if (this.collabState === 'draining') this.transition('serving', 'drain-auto-release');
      // Y0b-4 T4：解除=移除 'draining' 原因（writeFreeze 单源——spool 降级/viewer 连接的其余原因
      // 不被误赦免=H-5 prev 快照语义的集合化继任；drain 期无新连接——auth DRAINING 拒，全量遍历安全）
      // Y0b-4 T5：解除改发 doc-status（serving 转移后 writeFrozen 自然回落 false；连接随 1012 关闭，广播=尽力通告）
      for (const doc of this.server.hocuspocus.documents.values()) {
        const releasePid = parseDocName(doc.name)?.projectId ?? '';
        this.docRegistry.broadcastDocStatus(releasePid, this.docRegistry.quotaStateOf(releasePid));   // W3a：drain 编排域留 GW——冻结/广播跨域动作=同步缝调用（§2.2 链 2，编排序逐字保持）
        for (const c of doc.connections.keys()) {
          const conn = c as unknown as CollabConnection;
          try {
            this.sessionGuard.applyWriteFreeze(conn, 'draining', false);   // W3b：writeFreeze 单源随域迁 SG——H-5：先还原 readOnly 再 close（§2.2 链 2 同步缝）
            conn.webSocket?.close(CollabCloseCode.APP_RESTART, 'drain released');
            collabWsCloseTotal.inc({ code: String(CollabCloseCode.APP_RESTART), reason: 'drain released' });   // Y0b-3 T6：close 分布面
          } catch { /* 已断 */ }
        }
      }
      this.logger.warn('drain 60s 未续期——自动解除（冻结连接已 1012 复连；慢排空请部署链周期性续 POST）');
    }, 60_000);
    this.drainAutoReleaseTimer.unref?.();
    // Y0b-4 T5：冻结通告=per-doc doc-status（writeFrozen 维度翻转——broadcastDocStatus 判 {quota 态,writeFrozen} 复合翻转）
    for (const doc of this.server.hocuspocus.documents.values()) {
      const pid = parseDocName(doc.name)?.projectId ?? '';
      this.docRegistry.broadcastDocStatus(pid, this.docRegistry.quotaStateOf(pid));   // W3a：同步缝（§2.2 链 2——dr.broadcastDocStatus+dr.quotaStateOf+sg.applyWriteFreeze 逐 conn 原序）
      for (const c of doc.connections.keys()) this.sessionGuard.applyWriteFreeze(c as unknown as CollabConnection, 'draining', true);   // W3b：冻结层单源随域迁 SG（B12 库逐条 update 查 readOnly；§2.2 链 2 同步缝）
    }
    // Y0c T17（Z129）：drain 出口释放——冻结先行（pending 停增）后 fire-and-forget（drain API 响应
    // 不被释放阻塞）；批在途会话被拒（计数+idleTimer 重置）留表，60s 窗内退避梯排空后 idleTimer/reaper 承接。
    void this.releaseAllResidentSessions('drain');
    return { draining: this.collabState === 'draining', phase: this.collabState, autoReleaseAt, pending: this.computePending() };
  }
  private clearDrainTimer(): void {
    if (this.drainAutoReleaseTimer) { clearTimeout(this.drainAutoReleaseTimer); this.drainAutoReleaseTimer = null; }
  }

  /** Y0a-2（P1+V4 单源派生+Y5 键名）：pending 快照——B1 委托位⑤（实现随域迁 service：自有
   *  pendingQueues 单源遍历+spool.depth own/stranded 分区+host.docStats 库四连接计数〔Z47 显式
   *  分解字段 residentDocs/directConns〕；字段口径注释全文见 service computePending）。
   *  G-1/G-2 演练轮询面（/api/metrics collect 回调）+Y0a-3 /api/ready.pending 消费同一实现。 */
  computePending(): ReturnType<CollabPersistenceService['computePending']> {
    return this.persistence.computePending();
  }

  /** Y0b-5 T14（E54⑤）：ready token 档 degraded 四键——与指标面同源：dirtyDocs=computePending()
   *  .projects（yjs_pending_projects）；spoolDepthBytes=own+stranded total 口径（yjs_spool_depth_bytes
   *  collect 同式）；oldestUnflushed 双给（at ISO+age 秒——T15 巡检阈值消费形态，pendingSince 台账
   *  随域迁 service=B1 组合委托）；stuckDocs=stuckDocsSeen（yjs_doc_stuck_total 同增点进程寿命累计
   *  ——W3a 随 DocRegistry 域迁 DR，§1.3「computeDegraded 内 stuckDocsSeen 读→DR 缝」公有字段读面）。
   *  观测非门禁——ready 布尔不因此翻转。 */
  computeDegraded(): { dirtyDocs: number; oldestUnflushedAt: string | null; oldestUnflushedAgeSeconds: number; spoolDepthBytes: number; stuckDocs: number } {
    const p = this.computePending();
    const oldest = this.persistence.oldestUnflushedAt();
    return {
      dirtyDocs: p.projects,
      oldestUnflushedAt: oldest === null ? null : new Date(oldest).toISOString(),
      oldestUnflushedAgeSeconds: oldest === null ? 0 : Math.floor((Date.now() - oldest) / 1000),
      spoolDepthBytes: p.spoolBytes + p.strandedBytes,
      stuckDocs: this.docRegistry.stuckDocsSeen,
    };
  }

  /** Y0b-5 T10 观测族（observeDocBytes 直方图单点/heapUsedNow 采样单点/logDocTopN top-N 结构日志）
   *  已随 W3a 迁 collab-doc-registry.service（truth 族单点=DR 域；census ④ encode 白名单点同迁）。 */

  /** ===== W3a（B2）：DocRegistry 域委托位（§4.4/RC5=A——既有外部消费方〔shrink 15 处/residency/
   *  document.service 等十文件〕零触碰=B1 八委托语义位同款：本体 1 行转发，判定/台账注释见 service
   *  对应位；退役归 B3「本体收敛」既有议程） ===== */

  /** Y0b-4 T8：配额只读出口——shrink service 消费（实例级构造注入覆盖 env 默认后的单源读点，
   *  防 service 侧自读 env 与 gateway 注入值漂移）。W3a 委托位（quota 四值随构造参数迁 DR）。 */
  get activeQuota(): QuotaConfig {
    return this.docRegistry.activeQuota;
  }

  /** Y0b-4 T8 外审修复（Concern ①）+T9 收窄：配额**真冻结**判定——W3a 委托位（消费=shrink thaw
   *  前置；freezePending 确认窗不算+广播态域/冻结判定域分立禁混用语义见 service 对应位）。 */
  isQuotaFrozen(pid: string): boolean {
    return this.docRegistry.isQuotaFrozen(pid);
  }

  /** Y0b-4 T8 外审修复（偏差③）：force 广播公共出口——W3a 委托位（shrink 成功未 thaw 时其他
   *  客户端 localDocBytes 需要新 truth；dedup 键语义见 service 对应位）。 */
  broadcastDocStatusForce(pid: string): void {
    this.docRegistry.broadcastDocStatusForce(pid);
  }

  /** Y0b-4 T3：真值校准单点（compact 成功+pending 空 / T8 shrink 校准复用）——W3a 委托位
   *  （truth 覆写+delta 归零+冷却窗基线重置；「未装载不复活」守卫+返回校准前 truth〔偏差③〕
   *  语义见 service 对应位；persistence host calibrateTruth 接线同批改指 DR）。 */
  calibrateTruth(projectId: string, bytes: number): number | undefined {
    return this.docRegistry.calibrateTruth(projectId, bytes);
  }

  /** ===== Y0b-4 T9a（Q-U v6）：vacuum 代际替换——W3a 委托位（serving 门/纪元开启/清态/重建；
   *  GW* 保 shrink 15 处消费零触碰〔§4.3〕，真空纪元五步语义注释见 service 对应位） ===== */

  /** serving 门读点（REST withDoc/readServerSV/readCanvas/writeExecStatus 同挂〔U-3/G-7〕+
   *  WS connected 钩子+loadDocument 三入口）。 */
  isVacuuming(pid: string): boolean {
    return this.docRegistry.isVacuuming(pid);
  }

  /** serving 门写点（service vacuumGate.runExclusive 内 add/finally delete——真空窗口=协议执行期）。 */
  setVacuuming(pid: string, on: boolean): void {
    this.docRegistry.setVacuuming(pid, on);
  }

  /** 零连接窄版自动 vacuum 注入（service 构造期调用——recheckFrozenDocs 判据链消费）。 */
  setVacuumRunner(fn: (pid: string) => Promise<unknown>): void {
    this.docRegistry.setVacuumRunner(fn);
  }

  /** docResidue 现值（skip-low-residue 判据源——recheck≥2 轮维护）。 */
  docResidueOf(pid: string): number {
    return this.docRegistry.docResidueOf(pid);
  }

  /** 纪元代开启（service vacuum ⓪①② 调用）：② serving 门先开→⓪ thaw 回灌（U-5 保命）→① freeze
   *  全连接+terminal close 4410 'doc-vacuuming'——纪元序注释见 service 对应位（§2 同步块链：
   *  quiesce 轮询 inline await 语义逐字随迁）。 */
  beginVacuumEra(pid: string): Promise<void> {
    return this.docRegistry.beginVacuumEra(pid);
  }

  /** ③ 清进程态=共享状态普查表（v6：防旧代记账污染新代；writeFreeze/overPush 经 SG 缝+persistence
   *  两步——键集差异注释见 service 对应位；shrink spec I-1 反射普查锚=三对象〔偏离 70⑤〕）。 */
  purgeDocState(pid: string): void {
    this.docRegistry.purgeDocState(pid);
  }

  /** 中止恢复（v6 报告3 P1-2：中止路径 503 永久+全员只读=比不 vacuum 更糟——不允许存在；
   *  ③purge 后幂等 no-op/①②间仅解除 'quota' 原因语义见 service 对应位）。 */
  abortVacuumRestore(pid: string): void {
    this.docRegistry.abortVacuumRestore(pid);
  }

  /** ④ 全根真空重建（vacuum service 与 recheck residue 评估共用单源——yjs wire 根类型事实/
   *  U-1/U-2 注释见 service 对应位；deepCopyYMap 随迁 DR 模块级）。 */
  rebuildVacuumDoc(source: Y.Doc): Y.Doc | null {
    return this.docRegistry.rebuildVacuumDoc(source);
  }

  /** ⑤ 等价断言扩全根（把信任 fillDoc 变成验证 fillDoc——三条 O(键数) 判定注释见 service 对应位）。 */
  vacuumEquivalent(oldDoc: Y.Doc, newDoc: Y.Doc): boolean {
    return this.docRegistry.vacuumEquivalent(oldDoc, newDoc);
  }

  /** ===== Y0b-4 T6/T7（Q-E v5/Q-K/Q-F v2）：beforeHandleMessage 帧闸+msg 桶（guardMessageFrame）/
   *  code 权威投递（hardClose/hardCloseWs）/出站背压 wrap（wrapBackpressure+backpressureWrapped）/
   *  writeFreeze 单源查询与唯一出口（freezeReasons/applyWriteFreeze）已随 W3b 迁
   *  collab-session-guard.service（连接限流/背压/冻结层判定=SG 域；census ⑤ bufferedAmount 生产读点/
   *  ⑥ TokenBucket 四定义点/⑪ readOnly 直写点目标文件同批切换 SG）。钩子接线=构造器 beforeHandleMessage
   *  直调 sg；DR guardSyncFrame 经 host 缝消费 sg.hardClose/consumeBytesBucket/freezeReasons/applyWriteFreeze；
   *  drain 编排经 sg.applyWriteFreeze 同步缝（§2.2 链 2）。承重细节注释全文随迁见彼处。 */

  /** ===== Y0b-4 T4（Q-B v3/Q-C/Q-D/Q-E/Q-S）：beforeSync 分层判据 guardSyncFrame（配额执法唯一
   *  落点——⓪帧闸→⓪′bytes 桶→①readOnly→②over→③快路径→④实测）已随 W3a 迁
   *  collab-doc-registry.service（RC2=A：分层判定链单一所有者，链不切两半；bytes 桶/freezeReasons/
   *  hardClose 三处经 SG 能力 host 缝——分层序钉死注释全文随迁见彼处）。钩子接线=构造器
   *  beforeSync 直调。 */

  /** ===== Y0b-4 T4 冻结/解冻/重测状态机（scheduleFreezePending/freezeQuota/startFrozenRecheckTimer/
   *  recheckFrozenDocs/updateResidue/measureTruth/truthBudget 两位/quotaStateOf/buildDocStatus/
   *  broadcastDocStatus）已随 W3a 迁 collab-doc-registry.service（RC2=A：冻结族=pid 键 doc 级配额
   *  状态归 DR；drain 编排经 dr.broadcastDocStatus/dr.quotaStateOf 同步缝消费〔§2.2 链 2〕；
   *  connected 钩子经 dr.buildDocStatus 直引〔RC4〕）。跃迁穷举对象=W2 collab-doc-lifecycle spec。 */

  /** thaw：解除 quota 冻结+overPush 复位（唯一复位点）+writeFirstSyncStepFor 回灌+broadcast(ok)
   *  +30s 复冻冷却——W3a 委托位（Y0b-4 T8 起公共方法：shrink 滞回出口复用，阈值判定在调用方；
   *  document 缺席 early-return/T0 探针⑧回灌语义注释见 service 对应位）。 */
  thawQuota(pid: string): void {
    this.docRegistry.thawQuota(pid);
  }

  /** Y0a-2（X9/Y9）：spool 熔断只读降级通告（broadcastSpoolDegraded）已随 W3b 迁 collab-session-guard.service
   *  （通告载体=document.connections 广播面=SessionGuard/协议适配域；唯一消费=authenticateInner SG 同域）。 */

  /** 最后连接断开：flush →（写了才）compact。
   *  绝不抛出（覆盖含 redlock Skip 在内的全部路径，spec v4）：onDisconnect 是 onClose 的 async 回调、
   *  注册方 forEach 不 await——抛错 = unhandled rejection = 进程退出；DirectConnection 路径是 await 的，
   *  抛错冒泡出 withDoc finally → API 500 → 前端重试 → 重复插入。Skip 路径下 saveMutex 在回调抛错时
   *  先释放 → onDisconnect 一定被调用 → 本契约面更宽。
   *  Y0a-2：storeDocument 不再 throw（BOI 契约 3）——失败路径自处理（批在 spool/队列），stashPending 退役。 */
  private async disconnect({ document, documentName, socketId, clientsCount }: onDisconnectPayload) {
    // W3b：首行键控清理段整体随域迁 sg.onDisconnectCleanup（Y0b-3 T6/T7 同点纪律【首行、early-return
    // 之前——多标签 clientsCount>0 断连同样要清防无界】+Y0b-4 T4 冻结层反查/T6 速率三桶清理+overPush
    // 经 DR 直引——原位原序逐字保持；库 clientsCount=removeConnection 后剩余数〔esm:1059〕语义见 service 对应位）。
    this.sessionGuard.onDisconnectCleanup(socketId);
    if (clientsCount > 0) return;
    const projectId = parseDocName(documentName)?.projectId ?? '';
    const wrote = await this.persistence.storeDocumentSerialized({ document, documentName }, 'disconnect');   // Y0c T0：断连收尾归因；B1 编排点直调（非转发壳）
    const actorLanded = this.projectActor.takeActorLanded(parseDocName(documentName)?.projectId ?? '');   // Y1c T9：connection 帧=actor 管线（不经维护队列）——disconnect compact 触发承接（wrote 契约继任）
    if (wrote || actorLanded) {
      try {
        await this.persistence.maybeCompact(projectId);   // 会话结束收敛增量行；没写就不 compact（消除每次 readCanvas 全量 compact）
      } catch (err) {
        yjsStoreCompactFailureTotal.inc();
        this.logger.warn(`final compact failed for ${projectId}: ${(err as Error).message}`);   // 行已落库，非 flush 失败
      }
    }
  }

  /** Y0c T16（Z110/Z129）：强制淘汰 spool 交接——B1 委托位⑦（实现随域迁 service：fsync 落定才
   *  splice，BOI；handoffOnUnload 同款形态复用）。返回 false=交接失败/折并交织窗
   *  ⇒调用方（residency reaper）拒绝淘汰该会话——Z129/Z143「拒绝释放非放弃」，批留队列由退避梯承接。 */
  async handoffPendingToSpool(projectId: string): Promise<boolean> {
    return this.persistence.handoffPendingToSpool(projectId);
  }

  /** Y0a-2 Task 7：卸载清理+交接钩子（X4 永不抛——库对钩子抛错=取消卸载→destroy 永不 resolve）。
   *  Y3 顺序：①cancel 退避梯（残留梯随卸载清）→②交接（队列批 best-effort 落 spool——fsync 落定才
   *  splice，BOI；失败批留队列+③重排梯保活）→④清理残留（finally 保证）。
   *  裁定注记：②不进 inFlight（批全程留队列=归属地恒在，BOI 自持）；交接成功的 leave 为防御性
   *  收口（spool 已落定=at-risk 口径终结）。残留 spool 帧不触盘处理（V11 禁慢操作——仅交接失败支
   *  需承接：退避梯 detached 通道/shutdown drain/启动回灌三路径；成功支帧已落定非 at-risk——等
   *  重开/关停/重启回灌入 PG，J4 口径）。 */
  private async unloadDocument({ document, documentName }: beforeUnloadDocumentPayload): Promise<void> {
    const projectId = parseDocName(documentName)?.projectId ?? '';
    // Y0b-5 T10：卸载边界 heap 倍率播种（truth 在 afterUnload 被清——先存；结算在 afterUnloadDocument
    // 〔destroy 之后〕；卸载取消=残留条目下次装载同键覆写，无泄漏）——W3a：播种子步机械提取
    // dr.beforeUnloadAnchor（锚台账/heapUsedNow/docTruth 全 DR 域；X4 永不抛语义在本壳）。
    this.docRegistry.beforeUnloadAnchor(projectId);
    // Y1c T10（偏离 37⑩+38⑤——doc 卸载纪律）：drain applied→PG **先行**——失败=throw=**拒绝卸载**
    // （库对 beforeUnloadDocument 抛错=取消卸载〔正名：无 onUnloadDocument 钩子〕；doc 常驻
    // fail-closed：PG 不可用/隔离态/applied 前缀未落库均不得丢内存账）。帧 WAL 安全≠可卸载——卸载
    // 后本实例无法自证 PG 前缀，恢复链代价（重启回灌）不应由被动卸载触发。
    // **关停豁免**：进程关停（shuttingDown）=destroy 在途，拒绝只会挂 destroy（库 unloadAll 永不
    // resolve）；关停路径 drain 尽力后放行（帧 WAL 落定+启动回灌承接——drainAllDocuments 同语义）。
    try {
      const drained = await this.projectActor.drainAppliedForUnload(projectId, this.shuttingDown ? 1_000 : 5_000);
      if (!drained) {
        if (this.shuttingDown) {
          this.logger.warn(`unload drain 未竟（关停窗——放行卸载：帧 WAL 落定，启动回灌承接）for ${documentName}`);
        } else {
          docUnloadBlockedTotal.inc();
          throw new UnloadDrainRefusedError(`applied 前缀未 drain 至 PG——拒绝卸载（doc 常驻 fail-closed）`);
        }
      }
    } catch (err) {
      if (err instanceof UnloadDrainRefusedError) throw err;   // 本方拒绝语义=向上抛（取消卸载）——Q-I3：typed 判定（文案无关）
      // drain 意外异常：保守同样拒绝卸载（fail-closed 方向）——计数留痕
      docUnloadBlockedTotal.inc();
      this.logger.warn(`unload drain unexpected error for ${documentName}: ${(err as Error).message}——拒绝卸载（保守）`);
      throw err;
    }
    try {
      // B1（T40）：①cancel 退避梯+②交接（fsync 落定才 splice，BOI）+③失败重排梯保活=persistence
      // 内联块整体提取（handoffOnUnload——Y3 顺序/I-2 批尾锚/Q-O 切批语义逐字随迁）
      await this.persistence.handoffOnUnload(projectId, documentName);
    } catch (err) {
      // X4：意外异常一律吞（库语义=钩子抛错取消卸载→destroy 永不 resolve）——计数留痕
      yjsUnloadCleanupFailureTotal.inc();
      this.logger.warn(`beforeUnloadDocument swallowed error for ${documentName}: ${(err as Error).message}`);
    } finally {
      // ④清理残留（M1：project.gone 事件为第一入口——本钩子为卸载路径第二入口）——B1：persistence
      // 子步（lastCompactAt+persistUnhealthy）随域迁 service；W3b：连接寿命/awareness 归属反查清理
      // 随域迁 sg.onDocUnloadCleanup（原序保持：onDocumentUnload→SG 清理→recycleEmptyQueue；X4 永不抛在本壳）
      this.persistence.onDocumentUnload(projectId, documentName);
      this.sessionGuard.onDocUnloadCleanup(document);
      // I-1：仅当 doc 真已从库 documents Map 消失才回收空条目——库在钩子后复检 shouldUnloadDocument
      //（mutex 锁定/连接>0 时取消卸载 doc 存活），此时重连复用 doc 不重跑 loadDocument=条目不重建，
      // 每条 update 命中 !q 丢弃=活编辑静默蒸发窗（X17 与库取消卸载语义的交织）。
      this.persistence.recycleEmptyQueue(projectId, documentName);
    }
  }

  async onModuleInit(): Promise<void> {
    // 租约回调接线（W5 单点：启动只经 onAcquired；失守/撤销→selfIsolate）
    this.lease.onAcquired = () => this.startCollabAfterLease();
    this.lease.onLost = (cause) => { void this.selfIsolate(cause); };   // T17 起 async（常驻释放先行）——回调不等待
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
    this.sessionGuard.wirePermChangedEvents();   // W3b：collab.perm.changed 监听随域迁 SG（内存两步 permCache 失效+立即 tick）
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
        // C1'（复核 round-2 Critical）+C1①（T11 双评审 Critical）boot 三元组播种——**先于 replayAll**：
        // ①generation=回灌插行代辖单源（不播种则 genOf=??1 落错代×compact ② 代辖滤除=真空纪静默丢
        // 数据链——scan 面不重建 projectGeneration）；②walSeq floor=max(当前值, pgSeq+1)（段全回收+
        // 重启项目计数器自 1 重起——新帧将落已发布快照基线之下不可见；幸存段承载未落 PG 帧时 scan
        // 重建值更高，PG 值只抬底不压顶；先播无害——replayAll catch-up 推 pgSeq 后计数器=scan 值恒≥）。
        // 与 loadDocument 缝（onGenerationSeeded/onWalSeqFloorSeeded）同方法单源。
        const floors = await this.repo.pgSeqFloors();
        for (const p of floors) {
          this.spool.setProjectGeneration(p.projectId, p.generation);
          this.spool.seedWalSeqFromPg(p.projectId, p.pgSeq);
        }
        const replay = await this.spool.replayAll(this.repo);
        if (quarantined > 0 || replay.failed > 0) {
          // 启动自检（spec §5.2 口径——ERROR 结构化日志；Y0a-3 起随 ready.spoolQuarantined 可见）
          this.logger.error(JSON.stringify({ event: 'spool_startup_selfcheck', quarantined, replayFailed: replay.failed, replayed: replay.replayed, discarded: replay.discarded, truncatedSegments }));
        }
        // 审查 I-1（X5 必修漏落）：回灌失败残帧必须落梯——listen 前调用=先备恢复路径后受理。
        // 幂等安全：schedulePersistRetry 对已有 timer return。
        this.persistence.rearmQueues();
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
    // Y1c T9（Controller 裁定 2——T8 接线归本卡）：真 historyId 自 SystemHistory（requireSystemHistory
    // 复用读面禁重抄——缺头/为零 fail-closed throw→start-failed 有界重试）；setWalHistory（段头权威）+
    // sg.setServerHistory（版本门 historyId 硬门+auth 回执下发半链）；onWalFailStop→close 全部连接
    // 1011 WAL_FSYNC_EIO（EIO fail-stop 档——不进复用路径）。幂等（rejoin 重跑无害）。
    const { historyId } = await requireSystemHistory(this.prisma);
    this.spool.setWalHistory(historyId);
    this.sessionGuard.setServerHistory({ historyId });
    this.spool.onWalFailStop = () => this.sessionGuard.closeAllConnectionsWs(CollabCloseCode.WAL_FSYNC_EIO, 'wal-fsync-eio');
    this.listenRetries = 0;   // 成功即重置端口重试预算（防终身保守漂移）
    this.sessionGuard.startSessionSweep();     // W3b：sweep 自排链随域迁 SG——W8/M2②：先 clear 再 set（幂等——rejoin 不泄漏定时器）
    this.persistence.startSpoolReconciler();
    // Y10 seam（v3 重排漏接=v4 修复，I4）：spool IO 熔断恢复→唤醒退避梯——缺此行=熔断期梯死+恢复后零自愈
    this.spool.onRecovered = () => this.persistence.rearmQueues();
    this.transition('serving');   // 置位=最后一步（"已完成"非"已进入"）
    this.watchdogFired = false;
    this.persistence.rearmQueues();   // I4（P0-1 修）：serving ⟹ 非空队列∪spool.keys() 全部在梯上——rejoin 后 own 帧的运行期恢复路径（缺此=own 帧只待重启=部署门死锁）
  }

  /** ===== W3b（B2）：SessionGuard 域 sweep 兜底+事件踢权链+awareness 判定族+连接批量关闭已随域迁
   *  collab-session-guard.service（连接鉴权/限流/awareness 判定=SG 域）。迁出成员：startSessionSweep/
   *  sweepIntervalMs/enforceConnMaxLifetime/connMaxLifetimeMs/sweepSessions/permRecheckDue〔逻辑并入
   *  decideSweepRecheck verdict §5〕/wirePermChangedEvents/sweepKickPending/scheduleImmediateSweep/
   *  recheckConnection/socketIdOf/ownedClientIdsOf/rewriteAwarenessRole/AWARENESS_CLIENT_ID_LIMIT/
   *  guardAwareness/stripTransientFields/guardAwarenessRate/isEmptyState/serverIdentityOf/scheduleSweepClose/
   *  closeAllConnections1012/closeTeamDocuments。verdict 纯函数化（decideSweepRecheck/decideAwarenessStrip/
   *  decideClientOwnership/isEmptyState/serverIdentityOf）§5 顶层导出见 service。GW 接线=listenCollab
   *  startSessionSweep/onModuleInit wirePermChangedEvents/selfIsolate+shutdown closeAllConnections1012/
   *  handleProjectsGone closeTeamDocuments 直调 sg（承重细节注释全文随迁见彼处）。 */

  /** Y0a-2 关停 drain 六步（spec v2.4 §2.4 预算表：直连宽限 ≤2s+flush ≤6s+自管 drain+force-spool 硬界
   *  t0+18s+race ≤4s=合计 ≤22s——Y12：hardDeadline 18s（22s+4s=26s 破表），kill_timeout 30s 内垫 ≥8s
   *  ——ecosystem Y0a-4）。G-2a：归属要么落定、要么被如实点名（禁声称 0）。
   *  步骤 6（租约显式释放 ≤2s）Y0a-3 落地——本批占位注释（v2.4"必须执行到"约束随租约同批）。 */
  async onApplicationShutdown(): Promise<void> {
    const t0 = Date.now();
    await this.releaseAllResidentSessions('shutdown');                           // 步骤 0（Y0c T18/Z81 硬前置）：常驻会话释放先行于一切关停动作——Nest DI 反序已隐式调 residency 钩子，此处显式化（双调安全：releaser 幂等无条目 no-op）
    this.shuttingDown = true;                                                    // 步骤 1：停收新写（V11 关停闸——isolated 态 rejoin CAS 成功也不得 re-listen）
    if (this.collabState === 'serving' || this.collabState === 'start-failed' || this.collabState === 'acquiring') this.transition('draining', 'shutdown');
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
    this.clearDrainTimer();
    this.sessionGuard.clearAllWriteFreeze();   // W3b：writeFreeze 随域迁 SG——Y0b-4 T4：冻结层台账随停清（连接由 closeAll1012 关——正常路径 onDisconnect 自清）
    this.docRegistry.stopTimers();   // W3a（§2.3 拆缝）：DR 域定时器四位随停（frozenRecheckTimer/freezePendingTimers/heapObserverTimer/docTopNLogTimer——清理行逐字平移进 service stopTimers，GW 壳只剩缝调用；docTopNLogTimer 原位在下文 unregister 之后，收进本缝=同同步块零 await，interval 清除时点同 tick 内不可观测，编排序语义不变——commit 披露）
    this.sessionGuard.stopTimers();   // W3b（§2.3 拆缝）：SG 域定时器两位随停（sessionSweepTimer/authMapsSweepTimer——清理行逐字平移进 service stopTimers，GW 壳只剩缝调用；清理段在 unregister readers 之前的相对序不动）
    unregisterAuthInflightReader();   // Y0b-3 T3：gauge reader 闭包随 gateway 死（pendingCollector 同惯例）
    unregisterHeapObserverReader();   // Y0b-3 T4：观测 collect 闭包随 gateway 死（同惯例）
    unregisterLoadedDocBytesReader();   // Y0b-4 T3：容量聚合 collect 闭包随 gateway 死（同惯例）
    unregisterFrozenDocsReader();   // Y0b-4 T4：冻结面 collect 闭包随 gateway 死（同惯例）
    unregisterDocResidueReader();   // Y0b-4 T9a：真空残留 collect 闭包随 gateway 死（同惯例）
    unregisterAwarenessReader();   // Y0b-5 T10：awareness 两 gauge collect 闭包随 gateway 死（同惯例）
    unregisterOldestUnflushedReader();   // Y0b-5 T14：最老未 flush gauge collect 闭包随 gateway 死（同惯例）
    unregisterDegradedDocsReader();   // Y0c T15（Z111）：装载降级 gauge collect 闭包随 gateway 死（同惯例）
    unregisterUpdatesRowsReader();   // Y0c T29-II（Z125-5）：行数 gauge collect 闭包随 gateway 死（同惯例）
    this.persistence.cancelAllRetries();                                         // 定时器随停——drain 主动接管（B1 提取=cancelAllRetries）
    await this.graceDirectConnections(2_000);                                    // 在飞直连宽限（A3：directConnectionsCount）
    this.sessionGuard.closeAllConnections1012();                                 // W3b：连接批量关闭随域迁 SG——步骤 2：瞬时
    this.server.hocuspocus.flushPendingStores();                                 // 步骤 3：库 debounce 队列（同步触发）
    await this.persistence.pollPendingDrained(6_000);                            // ≤6s 排空窗口（只管"仍在 debounce 中"的 store——主力是步骤 4）
    await this.persistence.drainAllDocuments(t0 + 18_000);                       // 步骤 4：自管 drain+force-spool（X7+Y12——硬界 18s，其后 4s race 收在 22s；18s 重标归 T22 内存实测轮回填 Z114②）
    let destroyed = false;                                                       // 步骤 5：destroy 与 4s race（兜底）
    const destroying = this.server.destroy()
      .then(() => { destroyed = true; })
      .catch((err) => this.logger.warn(`collab server destroy failed: ${(err as Error).message}`));   // 关停窗口禁 unhandled rejection
    await Promise.race([destroying, new Promise<void>((r) => { setTimeout(r, 4_000).unref?.(); })]);
    if (!destroyed) {
      const p = this.computePending();
      // 分型优先级（Y0c T18 扩档；Y5 键名）：store-undrained > resident-session-open（residency 条目
      // 残留=步骤 0 预算/交接拒绝留 hold——probe 读面）> direct-open（兜底档维持 v2.4）。
      const hangReason = p.projects > 0 || p.batches > 0 ? 'store-undrained'
        : this.docRegistry.probeResidentSessions() > 0 ? 'resident-session-open'   // W3a：探针读面随域迁 DR（未注册=0 语义逐字保持——Z81 三分型链断言零触碰）
        : 'direct-open';
      this.logger.error(JSON.stringify({ event: 'destroy_timeout', ...p, storeInFlight: p.storeInFlight, hangReason }));   // B1：inFlightProjects 随域迁 service——显式键取 p.storeInFlight（computePending 同源值，JSON 键序/值逐字节等价）
    }
    unregisterPendingCollector();   // Y5：collect 闭包随 gateway 死——destroy race 判定后（M4：drain 期 pending 可观测性保留）
    // 步骤 6（≤2s）：租约显式释放——Y0a-3（deploy 不等 TTL；SIGKILL 截断则下实例吃满 TTL=RTO）
    await raceDeadline(this.lease.release(), 2_000, null as never).catch(() => {});   // B1：raceDeadline export 单源（service 模块——「双持」候选否，3 行纯函数复制两份=漂移面）
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

  /** 批3-2/Y0a-2：closeTeamDocuments（解散关连接+connEstablishedAt 反查清理）已随 W3b 迁
   *  collab-session-guard.service（连接批量关闭=SG 协议适配域）；消费=handleProjectsGone 内部直调
   *  sg.closeTeamDocuments（不设公有委托，§4.4）。 */
}
