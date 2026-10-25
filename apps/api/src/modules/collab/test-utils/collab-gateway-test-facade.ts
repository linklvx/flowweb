// apps/api/src/modules/collab/test-utils/collab-gateway-test-facade.ts
// Y0c T39b B0（Z140③ façade 按操作设计非按成员暴露；控制方裁决 RB2；落位 test-utils/=偏离 62④
// 勘正——RB2 原路径 modules/collab/ 顶层会被 nest build 编入 dist〔tsconfig 仅排除 *.spec.ts 与
// **/test-utils/**〕，test-utils 目录=仓内测试专用模块惯例〔lease-stub/doc-writer-stub 同址〕）。
// collab.gateway 测试专用 façade——**唯一 sanctioned 绕点**（内部单点受控 cast=internals()；
// 生产代码零 import，只被 *.spec.ts 消费）。门禁 check-collab-test-facade.mjs 的豁免依据=
// 本文件非 .spec.ts 后缀天然出扫描面（结构性豁免，脚本内 assert 自证）。
//
// 设计原则（Z140③）：
// - **按操作设计**：方法名=测试操作语义（seedPendingQueue/backdateLastCompactAt/spyListenServer），
//   非成员 1:1 暴露；每个方法注释「替代的成员访问形态」（波 2 机械替换对照面）。
// - **数组身份与 splice 语义保留**：pendingQueueRef 返回 Map 内真实数组引用（非复制）——
//   spec :698 toBe(firstRef)/:1233+:1295 toBe(tailRef)/:1312 toBe(before)/:1334+:1339 toBe(before)/
//   :1395 toBe(qBefore) 身份契约与 :1229/:1291 q.unshift 折并交织装置直接操作真实数组
//   （行号=T39b 波 2 勘正 grep 实测；旧记 :697/:1331/:1393/:1226/:1288 系波 1 留白漂移——偏离 64 R2②）。
// - **类型单源**：读面字段类型经 CollabGateway['member'] 索引访问（TS 类型位私有成员合法——
//   gateway 成员演进时 façade 类型自动跟随=编译红漂移面）；写面 stub 入参宽松（unknown/object）
//   +内部受控 cast（本文件即 sanctioned 点）。
// - N=128 class 方法+gatewayFacade 工厂+1 模块级函数 authDbDeadlineMs（Y1c T9 遗留收口 扩 3 法
//   〔storeDocumentUnlocked/storeDocumentSerialized 直调转发+spyStoreUnlocked——⑲ 门禁 19 处
//   `.persistence` 触达改道（T41 W4 universe 扩面后 persistence ∈ universe=DR 私有字段同名，spec 侧
//   gateway.persistence/kit.gateway.persistence 直访全数回收），登记红 0 全替换〕，N=125→128；
//   T42 B3 扩 1 法〔clearDrainTimer
//   ——承接账① 登记红核销，façade stub 裁决：drain 编排域留 gateway 私有、生产 API 面零扩〕，N=124→125；
//   历史实测口径：波 1 class 方法 40
//   〔表格口径 41 含工厂〕+波 2 扩 73——偏离 64 收窄裁决：直调族不转发，扩面=字段/状态/splice/
//   身份引用族+spy 组缺口；T40 W5 勘正：原记 113 系盘点漏计 1，文件实测=114；B1〔T40〕persistence
//   族 ~25 法改道 persistOf(gw) 单点 cast——方法数不增减，身份契约七处零变化=service Map 真实引用；
//   T41 W2 扩 10 法〔B2 前置穷举单测 collab-doc-lifecycle/collab-state-machine 消费——DR 普查
//   读面/播种面+常驻探针读面，操作化归并同款（Of/Has/seed 族），N=114→124〕；
//   T41 W3a〔B2〕DocRegistry 域迁出——DR 族 ~30 法改道 docRegistryOf(gw) 单点 cast（persistOf/B1
//   同款先例，控制方波次分工调整：façade 改道同批 W3a 非 W4——不改道则成员迁出后读 undefined=
//   collab 套件大面积红）。方法数不增减（N=124）、公有签名零变化、身份契约零变化〔States/Ref 族
//   返回活引用语义保持=service Map 真实引用〕）。
import { vi } from 'vitest';
import * as Y from 'yjs';
import { CollabGateway } from '../collab.gateway';
import type { CollabPersistenceService } from '../collab-persistence.service';
import type { CollabDocRegistryService } from '../collab-doc-registry.service';
import { CollabSessionGuardService } from '../collab-session-guard.service';   // W3b：authDbDeadlineMs 静态读需类值引用（非 type-only）
import type { TokenBucket } from '../token-bucket';

/** gateway 内部成员镜像（测试触达面——类型索引访问单源；写面去 readonly 由 stub 方法内 cast 承担。
 *  B1〔T40〕：Persistence 族十成员迁 service——镜像面随迁 PersistenceInternals（persistOf 单点 cast），
 *  身份契约七处（:698/:1233/:1295/:1312/:1334/:1339/:1395）零变化=façade 返回 service Map 内真实引用。 */
interface GatewayInternals {
  collabState: CollabGateway['collabState'];
  initDone: CollabGateway['initDone'];
  shuttingDown: CollabGateway['shuttingDown'];
  logger: CollabGateway['logger'];
  eventEmitter: CollabGateway['eventEmitter'];
  spool: CollabGateway['spool'];
  repo: CollabGateway['repo'];
  pgBreaker: CollabGateway['pgBreaker'];
}

/** 受控 cast 点①（sanctioned——门禁豁免面本体） */
function internals(gw: CollabGateway): GatewayInternals {
  return gw as unknown as GatewayInternals;
}

/** SessionGuard service 内部成员镜像（T41 W3b/B2——SG 域 15 字段+4 私有方法迁 service；类型索引
 *  访问单源 CollabSessionGuardService['member']，gateway 前提=`readonly sessionGuard` 公有字段，
 *  persistOf/docRegistryOf/B1 同款；镜像面随迁=身份契约零变化〔façade 返回 service Map 内真实引用〕）。 */
interface SessionGuardInternals {
  // ── 限流四桶+认证防线三层态+连接寿命/标识台账+awareness 归属双索引/身份表+sweep 复验缓存+writeFreeze ──
  writeFreeze: CollabSessionGuardService['writeFreeze'];
  refusalCache: CollabSessionGuardService['refusalCache'];
  authInflightPeak: CollabSessionGuardService['authInflightPeak'];
  permCache: CollabSessionGuardService['permCache'];
  connectionIds: CollabSessionGuardService['connectionIds'];
  clientIdOwner: CollabSessionGuardService['clientIdOwner'];
  ownedClientIds: CollabSessionGuardService['ownedClientIds'];
  socketIdentity: CollabSessionGuardService['socketIdentity'];
  awarenessDriftLogged: CollabSessionGuardService['awarenessDriftLogged'];
  connEstablishedAt: CollabSessionGuardService['connEstablishedAt'];
  authAttemptBuckets: CollabSessionGuardService['authAttemptBuckets'];
  bytesBuckets: CollabSessionGuardService['bytesBuckets'];
  msgBuckets: CollabSessionGuardService['msgBuckets'];
  awareBuckets: CollabSessionGuardService['awareBuckets'];
  upgradeBucket: CollabSessionGuardService['upgradeBucket'];
  // ── 私有方法直调/spy 组（recheckConnection/closeAllConnections1012/sweepSessions/allowedOrigins 随域迁 SG） ──
  recheckConnection: CollabSessionGuardService['recheckConnection'];
  closeAllConnections1012: CollabSessionGuardService['closeAllConnections1012'];
  sweepSessions: CollabSessionGuardService['sweepSessions'];
  allowedOrigins: CollabSessionGuardService['allowedOrigins'];
}

/** 受控 cast 点⑤（W3b——SessionGuard 族单点收敛；gw.sessionGuard 本体公有非 cast 面，
 *  persistOf/docRegistryOf 同款先例）。 */
function sessionGuardOf(gw: CollabGateway): SessionGuardInternals {
  return gw.sessionGuard as unknown as SessionGuardInternals;
}

/** DocRegistry service 内部成员镜像（T41 W3a/B2——DR 域 ~19 字段+3 私有方法迁 service；类型索引
 *  访问单源 CollabDocRegistryService['member']，gateway 前提=`readonly docRegistry` 公有字段，
 *  persistOf/B1 同款；镜像面随迁=身份契约零变化〔façade 返回 service Map 内真实引用〕）。 */
interface DocRegistryInternals {
  // ── 真值三件套+降级+代际+冻结族+真空态+普查定时器/时点台账+卸载锚+常驻探针+overPush ──
  docTruth: CollabDocRegistryService['docTruth'];
  docDelta: CollabDocRegistryService['docDelta'];
  truthMeasuredAt: CollabDocRegistryService['truthMeasuredAt'];
  degradedDocs: CollabDocRegistryService['degradedDocs'];
  quotaFrozenDocs: CollabDocRegistryService['quotaFrozenDocs'];
  freezePending: CollabDocRegistryService['freezePending'];
  thawCooldown: CollabDocRegistryService['thawCooldown'];
  recheckRounds: CollabDocRegistryService['recheckRounds'];
  docStatusRev: CollabDocRegistryService['docStatusRev'];
  docStatusState: CollabDocRegistryService['docStatusState'];
  docGeneration: CollabDocRegistryService['docGeneration'];
  docResidue: CollabDocRegistryService['docResidue'];
  // Y1c T12：preVacuumSvCache 随 SV 代际门退役删除（偏离 27——迁移 20261024160000）
  docEpoch: CollabDocRegistryService['docEpoch'];
  freezePendingTimers: CollabDocRegistryService['freezePendingTimers'];
  autoVacuumLastAt: CollabDocRegistryService['autoVacuumLastAt'];
  unloadHeapAnchors: CollabDocRegistryService['unloadHeapAnchors'];
  residentSessionsProbe: CollabDocRegistryService['residentSessionsProbe'];
  overPush: CollabDocRegistryService['overPush'];
  repo: CollabDocRegistryService['repo'];
  // ── 私有方法 spy 组（heapUsedNow/measureTruth/updateResidue 随域迁 DR——spyOn 单点收敛） ──
  heapUsedNow: CollabDocRegistryService['heapUsedNow'];
  measureTruth: CollabDocRegistryService['measureTruth'];
  updateResidue: CollabDocRegistryService['updateResidue'];
}

/** 受控 cast 点④（W3a——DocRegistry 族单点收敛；gw.docRegistry 本体公有非 cast 面，
 *  persistOf 同款先例）。 */
function docRegistryOf(gw: CollabGateway): DocRegistryInternals {
  return gw.docRegistry as unknown as DocRegistryInternals;
}

/** Persistence service 内部成员镜像（B1/T40——类型索引访问单源 CollabPersistenceService['member']；
 *  gw.persistence 公有字段=persistOf 的唯一入口，私有成员经本单点 cast 收敛） */
interface PersistenceInternals {
  pendingQueues: CollabPersistenceService['pendingQueues'];
  docProject: CollabPersistenceService['docProject'];
  persistRetry: CollabPersistenceService['persistRetry'];
  persistUnhealthy: CollabPersistenceService['persistUnhealthy'];
  retryingPersistDocs: CollabPersistenceService['retryingPersistDocs'];
  lastCompactAt: CollabPersistenceService['lastCompactAt'];
  flushScheduled: CollabPersistenceService['flushScheduled'];
  inFlightProjects: CollabPersistenceService['inFlightProjects'];
  pendingSince: CollabPersistenceService['pendingSince'];
  deletedProjects: CollabPersistenceService['deletedProjects'];
  spool: CollabPersistenceService['spool'];
  repo: CollabPersistenceService['repo'];
  reconcileSpool: CollabPersistenceService['reconcileSpool'];
  schedulePersistRetry: CollabPersistenceService['schedulePersistRetry'];
  cancelPersistRetry: CollabPersistenceService['cancelPersistRetry'];
  retryPersist: CollabPersistenceService['retryPersist'];
  storeDocumentSerialized: CollabPersistenceService['storeDocumentSerialized'];
  peekSpoolFrames: CollabPersistenceService['peekSpoolFrames'];
}

/** 受控 cast 点②（B1——persistence 族单点收敛；gw.persistence 本体公有非 cast 面） */
function persistOf(gw: CollabGateway): PersistenceInternals {
  return gw.persistence as unknown as PersistenceInternals;
}

// ── 波 2 entry 类型派生（索引访问单源——手写形状零漂移面，M-5 同款） ──
type RefusalEntry = NonNullable<ReturnType<SessionGuardInternals['refusalCache']['get']>>;   // W3b：refusalCache 随域迁 SG——entry 型派生单源随迁
type PermCacheEntry = NonNullable<ReturnType<SessionGuardInternals['permCache']['get']>>;
type SocketIdentityEntry = NonNullable<ReturnType<SessionGuardInternals['socketIdentity']['get']>>;
type AuthAttemptEntry = NonNullable<ReturnType<SessionGuardInternals['authAttemptBuckets']['get']>>;
type OverPushEntry = NonNullable<ReturnType<DocRegistryInternals['overPush']['get']>>;   // W3a：overPush 台账随域迁 DR（RC2）——entry 型派生单源随迁

/** writeFreeze conn 键形态受控 cast 单点（seedWriteFreeze/hasWriteFreezeReason 既有内联形态的
 *  波 2 收敛镜像——M-4：新扩方法禁新增内联 cast） */
function writeFreezeMap(gw: CollabGateway): Map<object, { pid: string; reasons: Set<string> }> {
  return sessionGuardOf(gw).writeFreeze as unknown as Map<object, { pid: string; reasons: Set<string> }>;   // W3b：writeFreeze 随域迁 SG（sessionGuardOf 单点）
}

/** TokenBucket 私有面镜像（options/buckets 是 TokenBucket 自身 private——rate-gate 桶容量/
 *  tokens/键存在断言面；受控 cast 第三单点=internals()/methods() 同族收敛） */
interface BucketInternals {
  options: { capacity: number; refillPerMin: number };
  buckets: Map<string, { tokens: number; last: number }>;
}
function bucketInternals(bucket: TokenBucket): BucketInternals {
  return bucket as unknown as BucketInternals;
}

/** 替代 `(CollabGateway as any).AUTH_DB_DEADLINE_MS`（类名静态私有常量读——auth deadline
 *  推进断言面；模块级函数=façade 唯一非 class 方法出口，静态面不依赖实例）。
 *  W3b：AUTH_DB_DEADLINE_MS 静态随域迁 CollabSessionGuardService（读面改指 SG 类——façade 公有签名零变化）。 */
export function authDbDeadlineMs(): number {
  return (CollabSessionGuardService as unknown as { AUTH_DB_DEADLINE_MS: number }).AUTH_DB_DEADLINE_MS;
}

/** 私有方法转发面（直调/替换/spy 对象——方法族经索引访问取签名，运行时 private 仅 TS 层面） */
type GatewayMethods = {
  startCollabAfterLease: CollabGateway['startCollabAfterLease'];
  selfIsolate: CollabGateway['selfIsolate'];
  listenCollab: CollabGateway['listenCollab'];
  listenServer: CollabGateway['listenServer'];
  transition: CollabGateway['transition'];
  clearDrainTimer: CollabGateway['clearDrainTimer'];   // B3 承接账①：drain 定时器清场直调（write-endpoint.int 登记红核销——façade stub 裁决）
  // ── 波 2 spy 组缺口扩面（偏离 64——spyOn 字符串成员形态的 sanctioned 替代面；
  //    直调族本体不转发=收窄裁决，spy 装置面照扩）。
  //    B1（T40）：reconcileSpool/schedulePersistRetry/cancelPersistRetry/retryPersist/
  //    storeDocumentSerialized/peekSpoolFrames 六法迁 service——转发面随迁 PersistenceInternals
  //    （persistOf 单点），façade 公有方法签名零变化。
  //    W3a（T41/B2）：heapUsedNow/measureTruth/updateResidue 三法迁 DR service——spy 面随迁
  //    DocRegistryInternals（docRegistryOf 单点），façade 公有方法签名零变化。
  //    W3b（T41/B2）：recheckConnection/closeAllConnections1012/sweepSessions/allowedOrigins 四法迁
  //    SG service——spy/直调面随迁 SessionGuardInternals（sessionGuardOf 单点），façade 公有签名零变化。 ──
  graceDirectConnections: CollabGateway['graceDirectConnections'];
};

function methods(gw: CollabGateway): GatewayMethods {
  return gw as unknown as GatewayMethods;
}

export class GatewayTestFacade {
  constructor(private readonly gw: CollabGateway) {}

  // ── pendingQueues 族（替代形态：(gw as any).pendingQueues.get/set/has/delete——试点 56 处触达
  //    归并为 5 操作；身份引用=真实数组，禁复制） ──

  /** 替代 `(gw as any).pendingQueues.get(pid)`——返回 Map 内真实数组引用（身份契约承载面；
   *  M-5 波 1 评审：返回型经索引访问派生=手写形状零漂移面） */
  pendingQueueRef(pid: string): ReturnType<PersistenceInternals['pendingQueues']['get']> {
    return persistOf(this.gw).pendingQueues.get(pid);
  }

  /** 替代 `(gw as any).pendingQueues.get(pid)?.length ?? 0`（长度读归并） */
  pendingQueueLen(pid: string): number {
    return this.pendingQueueRef(pid)?.length ?? 0;
  }

  /** 替代 `(gw as any).pendingQueues.has(pid)` */
  pendingQueueHas(pid: string): boolean {
    return persistOf(this.gw).pendingQueues.has(pid);
  }

  /** 替代 `(gw as any).pendingQueues.set(pid, frames)`（Y19 projectId 键控装置播种） */
  seedPendingQueue(pid: string, frames: Uint8Array[]): void {
    persistOf(this.gw).pendingQueues.set(pid, frames);
  }

  /** 替代 `(gw as any).pendingQueues.delete(pid)`（条目丢失模拟/清场） */
  clearPendingQueue(pid: string): void {
    persistOf(this.gw).pendingQueues.delete(pid);
  }

  // ── docProject 族（替代两跳形态 .pendingQueues.get(.docProject.get(doc))） ──

  /** 替代 `(gw as any).docProject.get(doc)`（Y4 两跳第一跳） */
  docProjectOf(doc: Y.Doc): string | undefined {
    return persistOf(this.gw).docProject.get(doc);
  }

  /** 替代 `(gw as any).docProject.set(doc, pid)` */
  seedDocProject(doc: Y.Doc, pid: string): void {
    persistOf(this.gw).docProject.set(doc, pid);
  }

  /** 两跳归并：`(gw as any).pendingQueues.get((gw as any).docProject.get(doc))` 单操作化 */
  pendingQueueRefForDoc(doc: Y.Doc): Uint8Array[] | undefined {
    const pid = this.docProjectOf(doc);
    return pid === undefined ? undefined : this.pendingQueueRef(pid);
  }

  // ── persistRetry 族（退避梯台账） ──

  /** 替代 `(gw as any).persistRetry.get(name)`（entry={rung,timer}——timer 真值断言面；
   *  M-5 波 1 评审：返回型经索引访问派生=手写形状零漂移面） */
  persistRetryEntry(name: string): ReturnType<PersistenceInternals['persistRetry']['get']> {
    return persistOf(this.gw).persistRetry.get(name);
  }

  /** 替代 `(gw as any).persistRetry.has(name)` */
  persistRetryHas(name: string): boolean {
    return persistOf(this.gw).persistRetry.has(name);
  }

  /** 替代 `(gw as any).persistRetry.size`（BOI-2 fenced=终态禁梯断言面） */
  persistRetrySize(): number {
    return persistOf(this.gw).persistRetry.size;
  }

  /** 替代 `(gw as any).persistRetry.set(name, entry)`（FK 收割用例前置装置；entry 型同源派生） */
  seedPersistRetry(name: string, entry: NonNullable<ReturnType<PersistenceInternals['persistRetry']['get']>>): void {
    persistOf(this.gw).persistRetry.set(name, entry);
  }

  // ── 状态/台账族 ──

  /** 替代 `(gw as any).lastCompactAt.set(pid, ms)`（批3-4 compact 时间门回拨装置） */
  backdateLastCompactAt(pid: string, ms: number): void {
    persistOf(this.gw).lastCompactAt.set(pid, ms);
  }

  /** 替代 `(gw as any).lastCompactAt.has(pid)` */
  lastCompactAtHas(pid: string): boolean {
    return persistOf(this.gw).lastCompactAt.has(pid);
  }

  /** 替代 `(gw as any).persistUnhealthy.add(name)` */
  addPersistUnhealthy(name: string): void {
    persistOf(this.gw).persistUnhealthy.add(name);
  }

  /** 替代 `(gw as any).persistUnhealthy.has(name)` */
  persistUnhealthyHas(name: string): boolean {
    return persistOf(this.gw).persistUnhealthy.has(name);
  }

  /** 替代 `(gw as any).retryingPersistDocs?.add(name)`（I-2 per-doc 在飞集合装置） */
  addRetryingPersistDoc(name: string): void {
    persistOf(this.gw).retryingPersistDocs?.add(name);
  }

  /** 替代 `(gw as any).retryingPersist = true`（I-2 双形态装置红绿同源——旧代码单布尔字段，
   *  新代码字段不存在写幻影属性无害；语义=模拟旧代码在飞布尔被 A 项目置位的红相条件） */
  seedLegacyRetryingFlag(): void {
    (this.gw as unknown as Record<string, unknown>).retryingPersist = true;
  }

  /** 替代 `(gw as any).flushScheduled.has(pid)`（X10 软阈闩锁断言面） */
  flushScheduledHas(pid: string): boolean {
    return persistOf(this.gw).flushScheduled.has(pid);
  }

  /** 替代 `(gw as any).inFlightProjects.has(pid)`（X2 在飞口径断言面） */
  inFlightHas(pid: string): boolean {
    return persistOf(this.gw).inFlightProjects.has(pid);
  }

  /** 替代 `(gw as any).initDone`（V9 四步全成置位断言面；读=public getCollabState() 不入 façade） */
  isInitDone(): boolean {
    return internals(this.gw).initDone;
  }

  /** 替代 `(gw as any).collabState = state`（测试强置状态机——生产写点唯一 transition()，
   *  本操作=白盒装置非生产路径；M-5 波 1 评审：入参=CollabGateway['collabState'] 联合型——
   *  typo 即编译红=façade 类型面收益兑现，值域单源 collab.gateway.ts CollabState，cast 消失） */
  forceCollabState(state: CollabGateway['collabState']): void {
    internals(this.gw).collabState = state;
  }

  /** 替代 `(gw as any).shuttingDown = true`（V11 关停闸模拟——onApplicationShutdown 步骤 1 等价） */
  forceShuttingDown(): void {
    internals(this.gw).shuttingDown = true;
  }

  // ── writeFreeze 族（Q-A v5 冻结层单源） ──

  /** 替代 `(gw as any).writeFreeze.set(conn, { pid, reasons: new Set([...]) })`（连接形态装置） */
  seedWriteFreeze(conn: object, pid: string, reasons: string[]): void {
    const map = sessionGuardOf(this.gw).writeFreeze as unknown as Map<object, { pid: string; reasons: Set<string> }>;
    map.set(conn, { pid, reasons: new Set(reasons) });
  }

  /** 替代 `(gw as any).writeFreeze.get(conn)?.reasons.has(reason)` */
  hasWriteFreezeReason(conn: object, reason: string): boolean {
    const map = sessionGuardOf(this.gw).writeFreeze as unknown as Map<object, { pid: string; reasons: Set<string> }>;
    return map.get(conn)?.reasons.has(reason) ?? false;
  }

  // ── stub 族（依赖整体替换——白盒故障注入） ──

  /** 替代 `(gw as any).spool = fake`（清理钩子永不抛用例的内部依赖炸装置）。
   *  B1（T40）双写：gateway（启动面 scan/replayAll/validateDir）+service（store 链/退避梯/reconciler）
   *  两引用同换——单写即半 stub 假绿面。 */
  stubSpool(fake: unknown): void {
    (internals(this.gw) as { spool: unknown }).spool = fake;
    (persistOf(this.gw) as { spool: unknown }).spool = fake;
  }

  /** 替代 `gw.transition = fn`（V11 终审收口用例的非法迁移捕获装置——transition 是方法，
   *  实例属性赋值遮蔽原型方法） */
  stubTransition(fn: (next: string, cause?: string) => void): void {
    (this.gw as unknown as Record<string, unknown>).transition = fn;
  }

  // ── spy 族（vi.spyOn 私有成员——字符串成员形态的门禁替代面） ──

  /** 替代 `vi.spyOn((gw as any).logger, level)`（波 2 扩 'log'——sentry/metrics-obs 结构化日志断言面） */
  spyLogger(level: 'error' | 'warn' | 'log') {
    return vi.spyOn(internals(this.gw).logger, level);
  }

  /** 替代 `vi.spyOn((gw as any).eventEmitter, 'emit')` */
  spyEventEmit() {
    return vi.spyOn(internals(this.gw).eventEmitter, 'emit');
  }

  /** 替代 `vi.spyOn(gw as any, 'listenServer')`（W5 listen 单点断言面） */
  spyListenServer() {
    return vi.spyOn(methods(this.gw), 'listenServer');
  }

  /** 替代 `vi.spyOn(gw as any, 'closeAllConnections1012')`（1012 面免真关装置） */
  spyCloseAll1012() {
    return vi.spyOn(sessionGuardOf(this.gw), 'closeAllConnections1012');   // W3b：随域迁 SG（sessionGuardOf 单点）
  }

  /** 替代 `vi.spyOn(gw as any, 'storeDocumentSerialized')`（M-4(a) 排程计数白盒；B1 随域迁
   *  service——实例属性 spy 对 service 内部 this. 调用与 gateway 委托调用同命中） */
  spyStoreSerialized() {
    return vi.spyOn(persistOf(this.gw), 'storeDocumentSerialized');
  }

  /** 替代 `vi.spyOn(gateway.persistence, 'storeDocumentUnlocked')`（Y1c T9 旧链拆除强形态 spy——
   *  零调用验收面；spyStoreSerialized 同款实例属性 spy——persistence 域公有方法 spyOn 免 cast，
   *  `.persistence` 触达经本点收敛〔persistence ∈ 门禁 universe——DR 私有字段同名〕） */
  spyStoreUnlocked() {
    return vi.spyOn(this.gw.persistence, 'storeDocumentUnlocked');
  }

  // ── 私有方法直调转发（测试驱动私有流程——操作即语义，签名经索引访问单源） ──

  /** 替代 `(gw as any).startCollabAfterLease()`（onAcquired 唯一入口直调） */
  startCollabAfterLease(): ReturnType<GatewayMethods['startCollabAfterLease']> {
    return methods(this.gw).startCollabAfterLease();
  }

  /** 替代 `(gw as any).selfIsolate(cause)`（G-3b 写路径隔离直调） */
  selfIsolate(...args: Parameters<GatewayMethods['selfIsolate']>): ReturnType<GatewayMethods['selfIsolate']> {
    return methods(this.gw).selfIsolate(...args);
  }

  /** 替代 `(gw as any).listenCollab()`（I4 rejoin 重入执行点） */
  listenCollab(): ReturnType<GatewayMethods['listenCollab']> {
    return methods(this.gw).listenCollab();
  }

  /** 替代 `(gw as any).recheckConnection(conn, name)`（H-5×E13 复验直调） */
  recheckConnection(...args: Parameters<SessionGuardInternals['recheckConnection']>): ReturnType<SessionGuardInternals['recheckConnection']> {
    return sessionGuardOf(this.gw).recheckConnection(...args);   // W3b：recheckConnection 随域迁 SG（sessionGuardOf 单点）
  }

  /** 替代 `(gw as any).reconcileSpool()`（I4 收养回收闭环直调；B1 随域迁 service——persistOf 单点） */
  reconcileSpool(): ReturnType<PersistenceInternals['reconcileSpool']> {
    return persistOf(this.gw).reconcileSpool();
  }

  /** 替代 `(gw as any).schedulePersistRetry(name)`（Y19 梯排程直调；B1 随域迁 service） */
  schedulePersistRetry(documentName: string): void {
    persistOf(this.gw).schedulePersistRetry(documentName);
  }

  /** 替代 `(gw as any).cancelPersistRetry(name)`（梯清场直调；B1 随域迁 service） */
  cancelPersistRetry(documentName: string): void {
    persistOf(this.gw).cancelPersistRetry(documentName);
  }

  /** 替代 `(gw as any).retryPersist(name)`（M-2 FK 收割直调；B1 随域迁 service） */
  retryPersist(documentName: string): ReturnType<PersistenceInternals['retryPersist']> {
    return persistOf(this.gw).retryPersist(documentName);
  }

  /** 替代 `gw.persistence.storeDocumentUnlocked(p, trigger)`（Y1c T9 维护写显式 flush 白盒直调——
   *  旧 onStoreDocument 语义面；方法=persistence 域公有〔Y.Doc 直收〕非内部状态，但 `.persistence`
   *  触达 ∈ 门禁 universe（DR 私有字段同名——T41 W4 扩面）⇒ spec 侧 gateway.persistence/
   *  kit.gateway.persistence 直访经本点收敛，签名索引访问单源） */
  storeDocumentUnlocked(...args: Parameters<CollabPersistenceService['storeDocumentUnlocked']>): ReturnType<CollabPersistenceService['storeDocumentUnlocked']> {
    return this.gw.persistence.storeDocumentUnlocked(...args);
  }

  /** 替代 `gw.persistence.storeDocumentSerialized(p, trigger)`（维护写显式 flush 收尾直调——saveMutex
   *  串行面〔A14〕；同上 `.persistence` 触达经本点收敛，签名索引访问单源） */
  storeDocumentSerialized(...args: Parameters<CollabPersistenceService['storeDocumentSerialized']>): ReturnType<CollabPersistenceService['storeDocumentSerialized']> {
    return this.gw.persistence.storeDocumentSerialized(...args);
  }

  /** 替代 `(gw as any).transition(next, cause)`（V33 状态机单点直调——非法迁移点名日志面） */
  transitionState(...args: Parameters<GatewayMethods['transition']>): void {
    methods(this.gw).transition(...args);
  }

  /** 替代 `(gw as any).clearDrainTimer()`（drain 60s 自动解除定时器清场直调——B3 承接账①裁决=
   *  façade stub 非公有化：clearDrainTimer=drain 编排域留 gateway 私有〔设计 §9②「B3 收敛时裁公有化
   *  或 façade stub」，transitionState 直调族同款先例——生产 API 面零扩，登记红 until B3 核销） */
  clearDrainTimer(): void {
    methods(this.gw).clearDrainTimer();
  }

  // ══ 波 2 扩面（偏离 64——字段/状态/splice/身份引用族全量替换；直调族不转发=收窄裁决） ══

  // ── DocRegistry 真值台账族（docTruth/docDelta/truthMeasuredAt 三件套+degraded/epoch） ──

  /** 替代 `(gw as any).docTruth.get(name)` */
  docTruthOf(name: string): ReturnType<DocRegistryInternals['docTruth']['get']> {
    return docRegistryOf(this.gw).docTruth.get(name);
  }

  /** 替代 `(gw as any).docTruth.has(name)` */
  docTruthHas(name: string): boolean {
    return docRegistryOf(this.gw).docTruth.has(name);
  }

  /** 替代 `(gw as any).docTruth.set(name, bytes)`（陈旧 truth 预置/普查播种装置） */
  seedDocTruth(name: string, bytes: number): void {
    docRegistryOf(this.gw).docTruth.set(name, bytes);
  }

  /** 替代 `(gw as any).docDelta.get(name)` */
  docDeltaOf(name: string): ReturnType<DocRegistryInternals['docDelta']['get']> {
    return docRegistryOf(this.gw).docDelta.get(name);
  }

  /** 替代 `(gw as any).docDelta.has(name)` */
  docDeltaHas(name: string): boolean {
    return docRegistryOf(this.gw).docDelta.has(name);
  }

  /** 替代 `(gw as any).docDelta.set(name, bytes)` */
  seedDocDelta(name: string, bytes: number): void {
    docRegistryOf(this.gw).docDelta.set(name, bytes);
  }

  /** 替代 `(gw as any).truthMeasuredAt.get(name)` */
  truthMeasuredAtOf(name: string): ReturnType<DocRegistryInternals['truthMeasuredAt']['get']> {
    return docRegistryOf(this.gw).truthMeasuredAt.get(name);
  }

  /** 替代 `(gw as any).truthMeasuredAt.has(name)` */
  truthMeasuredAtHas(name: string): boolean {
    return docRegistryOf(this.gw).truthMeasuredAt.has(name);
  }

  /** 替代 `(gw as any).truthMeasuredAt.set(name, ms)`（冷却窗回拨/窗外装置） */
  seedTruthMeasuredAt(name: string, ms: number): void {
    docRegistryOf(this.gw).truthMeasuredAt.set(name, ms);
  }

  /** 替代 `(gw as any).degradedDocs.has(name)` */
  degradedDocsHas(name: string): boolean {
    return docRegistryOf(this.gw).degradedDocs.has(name);
  }

  /** 替代 `(gw as any).degradedDocs.add(name)` */
  addDegradedDoc(name: string): void {
    docRegistryOf(this.gw).degradedDocs.add(name);
  }

  /** 替代 `(gw as any).docEpoch.get(doc)`（epoch 播种/重入不换代断言面） */
  docEpochOf(doc: Y.Doc): ReturnType<DocRegistryInternals['docEpoch']['get']> {
    return docRegistryOf(this.gw).docEpoch.get(doc);
  }

  // ── 配额冻结台账族（quotaFrozen/freezePending/thawCooldown/recheck/docStatus 五键+代际） ──

  /** 替代 `(gw as any).quotaFrozenDocs.has(name)` */
  quotaFrozenHas(name: string): boolean {
    return docRegistryOf(this.gw).quotaFrozenDocs.has(name);
  }

  /** 替代 `(gw as any).quotaFrozenDocs.add(name)`（冻结态播种——recheck 装置） */
  addQuotaFrozen(name: string): void {
    docRegistryOf(this.gw).quotaFrozenDocs.add(name);
  }

  /** 替代 `(gw as any).freezePending.has(name)` */
  freezePendingHas(name: string): boolean {
    return docRegistryOf(this.gw).freezePending.has(name);
  }

  /** 替代 `(gw as any).freezePending.add(name)` */
  addFreezePending(name: string): void {
    docRegistryOf(this.gw).freezePending.add(name);
  }

  /** 替代 `(gw as any).thawCooldown.has(name)` */
  thawCooldownHas(name: string): boolean {
    return docRegistryOf(this.gw).thawCooldown.has(name);
  }

  /** 替代 `(gw as any).thawCooldown.set(name, ms)` */
  seedThawCooldown(name: string, ms: number): void {
    docRegistryOf(this.gw).thawCooldown.set(name, ms);
  }

  /** 替代 `(gw as any).recheckRounds.set(name, rounds)`（AUTO_VACUUM_ROUNDS 前置装置） */
  seedRecheckRounds(name: string, rounds: number): void {
    docRegistryOf(this.gw).recheckRounds.set(name, rounds);
  }

  /** 替代 `(gw as any).docStatusRev.get(name)`（rev 生命周期断言面） */
  docStatusRevOf(name: string): ReturnType<DocRegistryInternals['docStatusRev']['get']> {
    return docRegistryOf(this.gw).docStatusRev.get(name);
  }

  /** 替代 `(gw as any).docStatusRev.set(name, rev)`（装载播种形态装置） */
  seedDocStatusRev(name: string, rev: number): void {
    docRegistryOf(this.gw).docStatusRev.set(name, rev);
  }

  /** 替代 `(gw as any).docStatusState.set(name, state)`（上次广播同态 dedup 装置） */
  seedDocStatusState(name: string, state: string): void {
    docRegistryOf(this.gw).docStatusState.set(name, state);
  }

  /** 替代 `(gw as any).docGeneration.set(name, generation)` */
  seedDocGeneration(name: string, generation: number): void {
    docRegistryOf(this.gw).docGeneration.set(name, generation);
  }

  /** 替代 `(gw as any).docResidue.set(name, bytes)` */
  seedDocResidue(name: string, bytes: number): void {
    docRegistryOf(this.gw).docResidue.set(name, bytes);
  }

  // ── Persistence 族扩（compact 时间门/pendingSince/退避梯枚举/终态集/在飞集/repo） ──

  /** 替代 `(gw as any).lastCompactAt.delete(name)`（绕 compact 时间门装置） */
  clearLastCompactAt(name: string): void {
    persistOf(this.gw).lastCompactAt.delete(name);
  }

  /** 替代 `(gw as any).pendingSince.get(pid)`（空→非空播种断言面） */
  pendingSinceOf(projectId: string): ReturnType<PersistenceInternals['pendingSince']['get']> {
    return persistOf(this.gw).pendingSince.get(projectId);
  }

  /** 替代 `[...((gw as any).persistRetry as Map<string, unknown>)]` 枚举（dispose 后梯收口装置） */
  persistRetryNames(): string[] {
    return [...persistOf(this.gw).persistRetry.keys()];
  }

  /** 替代 `(gw as any).deletedProjects.has(pid)`（project.gone 终态集断言面） */
  deletedProjectsHas(pid: string): boolean {
    return persistOf(this.gw).deletedProjects.has(pid);
  }

  /** 替代 `(gw as any).inFlightProjects.add(pid)`（在飞口径装置） */
  addInFlight(pid: string): void {
    persistOf(this.gw).inFlightProjects.add(pid);
  }

  /** 替代 `(gw as any).inFlightProjects.delete(pid)` */
  removeInFlight(pid: string): void {
    persistOf(this.gw).inFlightProjects.delete(pid);
  }

  /** 替代 `(gw as any).repo`（身份引用——mock 链装置 `.hydrateWithRecovery.mock…` 消费面；
   *  spec 侧接 mock 类型 cast 属 mock 链合法面非门禁违规） */
  repoRef(): GatewayInternals['repo'] {
    return internals(this.gw).repo;
  }

  /** 替代 `(gw as any).repo = fake`（恢复腿换接真库 repo——stubSpool 同款整体替换装置）。
   *  B1（T40）双写：gateway（replayAll 传参）+persistence（store 链 append/compact/reconcileSpool
   *  replayAll/drainDetached）两引用同换；W3a（T41/B2）三写：+docRegistry（loadDocument
   *  hydrateWithRecovery 随域迁 DR——单写即半 stub 假绿面同款纪律）。 */
  stubRepo(fake: unknown): void {
    (internals(this.gw) as { repo: unknown }).repo = fake;
    (persistOf(this.gw) as { repo: unknown }).repo = fake;
    (docRegistryOf(this.gw) as { repo: unknown }).repo = fake;
    // Y1c T9：actor PG 腿 repo 同步换接（构造持有引用——漏此=探测腿仍打旧桩=假 half-open）
    (this.gw.projectActor as unknown as { rebindRepoForTest(r: unknown): void }).rebindRepoForTest(fake);
  }

  // ── SessionGuard 族扩（refusal/perm 缓存+身份/归属台账+寿命/桶台账+overPush+writeFreeze） ──

  /** 替代 `(gw as any).refusalCache.size`（清空单点断言面） */
  refusalCacheSize(): number {
    return sessionGuardOf(this.gw).refusalCache.size;
  }

  /** 替代 `cache.set(fingerprint, { reason, at })`（refusalCache 播种——五钩子清空装置） */
  seedRefusal(fingerprint: string, reason: RefusalEntry['reason'], at: number): void {
    sessionGuardOf(this.gw).refusalCache.set(fingerprint, { reason, at });
  }

  /** 替代 `(gw as any).authInflightPeak`（读——演练判据③观测面） */
  authInflightPeak(): number {
    return sessionGuardOf(this.gw).authInflightPeak;
  }

  /** 替代 `(gw as any).authInflightPeak = 0`（演练前置零装置） */
  resetAuthInflightPeak(): void {
    sessionGuardOf(this.gw).authInflightPeak = 0;
  }

  /** 替代 `(gw as any).permCache.set(conn, { role, at })`（会话级结论缓存播种/老化装置） */
  seedPermCache(conn: object, role: PermCacheEntry['role'], at: number): void {
    sessionGuardOf(this.gw).permCache.set(conn, { role, at });
  }

  /** 替代 `cache.delete(conn)`（permCache 手动失效——事件触发复验装置） */
  evictPermCache(conn: object): void {
    sessionGuardOf(this.gw).permCache.delete(conn);
  }

  /** 替代 `(gw as any).connectionIds.set(socketId, cid)` */
  seedConnectionId(socketId: string, connectionId: string): void {
    sessionGuardOf(this.gw).connectionIds.set(socketId, connectionId);
  }

  /** 替代 `(gw as any).connectionIds.get(socketId)` */
  connectionIdOf(socketId: string): ReturnType<SessionGuardInternals['connectionIds']['get']> {
    return sessionGuardOf(this.gw).connectionIds.get(socketId);
  }

  /** 替代 `(gw as any).connectionIds.has(socketId)` */
  connectionIdHas(socketId: string): boolean {
    return sessionGuardOf(this.gw).connectionIds.has(socketId);
  }

  /** 替代 `(gw as any).clientIdOwner.has(clientId)` */
  clientIdOwnerHas(clientId: number): boolean {
    return sessionGuardOf(this.gw).clientIdOwner.has(clientId);
  }

  /** 替代 `(gw as any).clientIdOwner.get(clientId)` */
  clientIdOwnerOf(clientId: number): ReturnType<SessionGuardInternals['clientIdOwner']['get']> {
    return sessionGuardOf(this.gw).clientIdOwner.get(clientId);
  }

  /** 替代 `(gw as any).clientIdOwner.size` */
  clientIdOwnerSize(): number {
    return sessionGuardOf(this.gw).clientIdOwner.size;
  }

  /** 两跳归并：`(gw as any).ownedClientIds.get((gw as any).clientIdOwner.get(cid))` 单操作化
   *  （返回 Map 内真实 Set 引用——上限槽位 live 断言面；pendingQueueRefForDoc 先例） */
  ownedClientIdsOfClient(clientId: number): ReturnType<SessionGuardInternals['ownedClientIds']['get']> {
    const sock = sessionGuardOf(this.gw).clientIdOwner.get(clientId);
    return sock === undefined ? undefined : sessionGuardOf(this.gw).ownedClientIds.get(sock);
  }

  /** 替代 `(gw as any).socketIdentity.set(socketId, ident)`（事件匹配依据播种装置） */
  seedSocketIdentity(socketId: string, ident: SocketIdentityEntry): void {
    sessionGuardOf(this.gw).socketIdentity.set(socketId, ident);
  }

  /** 替代 `(gw as any).socketIdentity.get(socketId)` */
  socketIdentityOf(socketId: string): ReturnType<SessionGuardInternals['socketIdentity']['get']> {
    return sessionGuardOf(this.gw).socketIdentity.get(socketId);
  }

  /** 替代 `(gw as any).socketIdentity.has(socketId)`（断连清理断言面） */
  socketIdentityHas(socketId: string): boolean {
    return sessionGuardOf(this.gw).socketIdentity.has(socketId);
  }

  /** 替代 `(gw as any).awarenessDriftLogged.add(socketId)` */
  addAwarenessDriftLogged(socketId: string): void {
    sessionGuardOf(this.gw).awarenessDriftLogged.add(socketId);
  }

  /** 替代 `(gw as any).awarenessDriftLogged.has(socketId)` */
  awarenessDriftLoggedHas(socketId: string): boolean {
    return sessionGuardOf(this.gw).awarenessDriftLogged.has(socketId);
  }

  /** 替代 `((gw as any).connEstablishedAt as Map<string, number>).set(socketId, ms)`（寿命 4402 装置） */
  seedConnEstablishedAt(socketId: string, ms: number): void {
    sessionGuardOf(this.gw).connEstablishedAt.set(socketId, ms);
  }

  /** 替代 `m.has(socketId)`（connEstablishedAt 键控清理断言面） */
  connEstablishedAtHas(socketId: string): boolean {
    return sessionGuardOf(this.gw).connEstablishedAt.has(socketId);
  }

  /** 替代 `(gw as any).authAttemptBuckets.set(key, entry)`（防线桶同批清装置） */
  seedAuthAttemptBucket(key: string, entry: AuthAttemptEntry): void {
    sessionGuardOf(this.gw).authAttemptBuckets.set(key, entry);
  }

  /** 替代 `(gw as any).authAttemptBuckets.has(key)` */
  authAttemptBucketHas(key: string): boolean {
    return sessionGuardOf(this.gw).authAttemptBuckets.has(key);
  }

  /** 替代 `(gw as any).overPush.set(socketId, state)` */
  seedOverPush(socketId: string, state: OverPushEntry): void {
    docRegistryOf(this.gw).overPush.set(socketId, state);
  }

  /** 替代 `(gw as any).overPush.has(socketId)` */
  overPushHas(socketId: string): boolean {
    return docRegistryOf(this.gw).overPush.has(socketId);
  }

  /** 替代 `[...(gw as any).overPush.values()]`（返回活 entry 引用数组——firstAt/lastAt 白盒
   *  改写语义保留：`st.firstAt -= 10_000` 直接落台账，禁复制） */
  overPushStates(): OverPushEntry[] {
    return [...docRegistryOf(this.gw).overPush.values()];
  }

  /** 替代 `(gw as any).writeFreeze.has(conn)`（purge/中止恢复终态断言面） */
  writeFreezeHas(conn: object): boolean {
    return writeFreezeMap(this.gw).has(conn);
  }

  // ── 限流桶操作化族（TokenBucket 私有 options/buckets 经 bucketInternals 镜像） ──

  /** 替代 `(gw as any).upgradeBucket.consume(key)`（429 排空装置——consume 是 TokenBucket 公有面） */
  consumeUpgradeBucket(key: string): boolean {
    return sessionGuardOf(this.gw).upgradeBucket.consume(key);
  }

  /** 替代 `(gw as any).bytesBuckets.options.capacity`（桶容量≥最大合法帧不变量断言面） */
  bytesBucketCapacity(): number {
    return bucketInternals(sessionGuardOf(this.gw).bytesBuckets).options.capacity;
  }

  /** 替代 `(gw as any).bytesBuckets.consume(key, cost)`（cost>capacity 结构性恒 false 断言面） */
  consumeBytesBucket(key: string, cost: number): boolean {
    return sessionGuardOf(this.gw).bytesBuckets.consume(key, cost);
  }

  /** 替代 `((gw as any).bytesBuckets.buckets.get(key) as { tokens: number }).tokens`（白盒排空证据） */
  bytesBucketTokens(key: string): number | undefined {
    return bucketInternals(sessionGuardOf(this.gw).bytesBuckets).buckets.get(key)?.tokens;
  }

  /** 替代 `(gw as any).{msgBuckets|bytesBuckets|awareBuckets}.buckets.has(key)`（onDisconnect
   *  三桶清理断言——三形态一操作归并） */
  rateBucketHasKey(kind: 'msg' | 'bytes' | 'aware', key: string): boolean {
    const bucket = kind === 'msg' ? sessionGuardOf(this.gw).msgBuckets
      : kind === 'bytes' ? sessionGuardOf(this.gw).bytesBuckets
        : sessionGuardOf(this.gw).awareBuckets;
    return bucketInternals(bucket).buckets.has(key);
  }

  // ── 依赖引用/stub 族扩 ──

  /** 替代 `(gw as any).pgBreaker as CollabPgBreakerService`（身份引用——recordFailure/
   *  recordSuccess/stateName 均 breaker 公有面；推闸/半开/状态断言消费） */
  pgBreakerRef(): GatewayInternals['pgBreaker'] {
    return internals(this.gw).pgBreaker;
  }

  /** 替代 `(gw as any).sweepIntervalMs = fn`（jitter 隔离装置——方法实例属性遮蔽，
   *  stubTransition 同款白盒形态） */
  stubSweepInterval(fn: () => number): void {
    (this.gw.sessionGuard as unknown as Record<string, unknown>).sweepIntervalMs = fn;   // W3b：sweepIntervalMs 随域迁 SG——实例属性遮蔽落 SG 实例（startSessionSweep schedule() 的 this.sweepIntervalMs() 命中）
  }

  // ── spy 组缺口扩（偏离 64——spyOn 字符串成员形态替代面；M-4 镜像模式收敛） ──

  /** 替代 `vi.spyOn(gw as any, 'heapUsedNow')`（heap 倍率合成采样装置；W3a 随域迁 DR service——
   *  docRegistryOf 单点，实例属性 spy 对 service 内部 this. 调用同命中〔B1 spyStoreSerialized 同款〕） */
  spyHeapUsedNow() {
    return vi.spyOn(docRegistryOf(this.gw), 'heapUsedNow');
  }

  /** 替代 `vi.spyOn(gw as any, 'peekSpoolFrames')`（Y2 IO 逃逸注入装置；B1 随域迁 service） */
  spyPeekSpoolFrames() {
    return vi.spyOn(persistOf(this.gw), 'peekSpoolFrames');
  }

  /** 替代 `vi.spyOn(gw as any, 'sweepSessions')`（风暴合并恰一次执行断言面） */
  spySweepSessions() {
    return vi.spyOn(sessionGuardOf(this.gw), 'sweepSessions');   // W3b：随域迁 SG（sessionGuardOf 单点）
  }

  /** 替代 `vi.spyOn(g, 'measureTruth')`（recheck 分支可达装置；W3a 随域迁 DR service） */
  spyMeasureTruth() {
    return vi.spyOn(docRegistryOf(this.gw), 'measureTruth');
  }

  /** 替代 `vi.spyOn(g, 'updateResidue')`（全根真空重建重活跳过装置；W3a 随域迁 DR service） */
  spyUpdateResidue() {
    return vi.spyOn(docRegistryOf(this.gw), 'updateResidue');
  }

  /** 替代 `vi.spyOn(gw as any, 'allowedOrigins')`（fail-open 兜底 TypeError 注入装置） */
  spyAllowedOrigins() {
    return vi.spyOn(sessionGuardOf(this.gw), 'allowedOrigins');   // W3b：随域迁 SG（sessionGuardOf 单点）
  }

  /** 替代 `vi.spyOn(gw as any, 'graceDirectConnections')`（步骤 0 先于步骤 1.5 时序断言面） */
  spyGraceDirectConnections() {
    return vi.spyOn(methods(this.gw), 'graceDirectConnections');
  }

  // ══ T41 W2 扩面（B2 前置穷举单测——collab-doc-lifecycle 清理点普查读面/播种面+⑦代际读面
  //    +常驻探针读面；操作化归并同款（Of/Has/seed 族——1:1 成员暴露禁项不破） ══

  /** 替代 `(gw as any).docGeneration.get(pid)`（⑦代际 doc-status generation 产生源读面） */
  docGenerationOf(pid: string): ReturnType<DocRegistryInternals['docGeneration']['get']> {
    return docRegistryOf(this.gw).docGeneration.get(pid);
  }

  /** 替代 `(gw as any).docStatusState.has(pid)`（上次广播复合键存在——清理点普查断言面） */
  docStatusStateHas(pid: string): boolean {
    return docRegistryOf(this.gw).docStatusState.has(pid);
  }

  /** 替代 `(gw as any).recheckRounds.has(pid)`（冻结重测轮数台账——清理点普查断言面） */
  recheckRoundsHas(pid: string): boolean {
    return docRegistryOf(this.gw).recheckRounds.has(pid);
  }

  /** 替代 `(gw as any).freezePendingTimers.has(pid)`（确认定时器在飞——scheduleFreezePending
   *  去重判据读面+清理点普查断言面） */
  freezePendingTimersHas(pid: string): boolean {
    return docRegistryOf(this.gw).freezePendingTimers.has(pid);
  }

  /** 替代 `(gw as any).freezePendingTimers.set(pid, timer)`（清理点普查播种装置——
   *  seedPersistRetry 同款先例；timer 由被测清理入口负责 clear） */
  seedFreezePendingTimer(pid: string, timer: Parameters<DocRegistryInternals['freezePendingTimers']['set']>[1]): void {
    docRegistryOf(this.gw).freezePendingTimers.set(pid, timer);
  }

  /** 替代 `(gw as any).autoVacuumLastAt.has(pid)`（Z66 自动触发时点台账——purge 专属清理键断言面） */
  autoVacuumLastAtHas(pid: string): boolean {
    return docRegistryOf(this.gw).autoVacuumLastAt.has(pid);
  }

  /** 替代 `(gw as any).autoVacuumLastAt.set(pid, ms)`（普查播种——三入口差异键钉死装置） */
  seedAutoVacuumLastAt(pid: string, ms: number): void {
    docRegistryOf(this.gw).autoVacuumLastAt.set(pid, ms);
  }

  /** 替代 `(gw as any).unloadHeapAnchors.get(pid)`（beforeUnload 播种→afterUnload 结算——
   *  卸载边界锚生命周期断言面） */
  unloadHeapAnchorOf(pid: string): ReturnType<DocRegistryInternals['unloadHeapAnchors']['get']> {
    return docRegistryOf(this.gw).unloadHeapAnchors.get(pid);
  }

  /** 替代 `(gw as any).residentSessionsProbe?.() ?? 0`（T18 hangReason resident-session-open 档
   *  判据读面——未注册〔直构 gateway 无 residency〕=0 语义断言） */
  residentSessionsProbeCount(): number {
    return docRegistryOf(this.gw).residentSessionsProbe?.() ?? 0;
  }
}

/** 工厂（spec 消费形态：const g = gatewayFacade(kit.gateway)） */
export function gatewayFacade(gw: CollabGateway): GatewayTestFacade {
  return new GatewayTestFacade(gw);
}
