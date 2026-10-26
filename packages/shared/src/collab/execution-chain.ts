// packages/shared/src/collab/execution-chain.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段——spec v5.4 §6.2 执行链+§6.3 交付状态机与退款 fencing）：
// NodeExecution/ExecutionOutbox/MaterializeRun/RefundObligation/ObjectManifest 五表契约冻结。
// **CONTRACT-FREEZE**（T21 解冻窗口已消费——头注改记消费落地）：类型+常量+纯函数；
// 消费方=T21（G4 门——**已落地**：nodeExecutionUpdateAllowed 改道 compareExecSeq 单源+LifecycleObligation
// 队列契约 §5 确认点①附带裁定 #11）/T22（G5 切交付）/T23（UNKNOWN 纪律+资源）。
// 执行链：ExecutionRequest→GenerationIntent（claim 创建/关联 requestId）→Worker（零 doc 读）→
// NodeArtifact（权威交付）→ExecutionOutbox。契约测试=execution-chain.spec.ts（TDD 红先行）。
// #4 族分离纪律（确认点①附带裁定）：**execSeq=执行代际族**（NodeExecution 更新守卫/GenerationIntent
// 代际/RefundObligation·MaterializeRun fencing 锚——比较单源 compareExecSeq）；**lifecycleSeq/fenceSeq=
// 生命周期族**（NodeLifecycle/DeliveryFence——lifecycle.ts 单源）——两族序**永不互换/互指**。

import { compareExecSeq } from '../canvas/media-fact';
import type { FrameEffectKind } from './frame-effects';
import type { ObligationKind } from './lifecycle';

// ═══ §1 NodeExecution（当前行表——spec §6.2）════════════════════════════════════════════════

/** NodeExecution 行（**当前行表** PK(projectId,nodeId)——历史留 GenerationIntent；artifact 槽位版本
 *  读 NodeArtifact 不建第二套）：generation 列+更新守卫（CAS）+nodeVersion（=该节点末次事件 feedSeq
 *  ——v5.4 删 projected 元组，单名单义见 §5.2/§7；BigInt wire string 化）。 */
export interface NodeExecutionRow {
  projectId: string;
  nodeId: string;
  generation: number;
  execSeq: bigint;
  nodeVersion: bigint;
  status: string;
  attempts: number;
  errorCode?: string;
  artifactRev?: number;
  updatedAtMs: number;
}

/** 更新守卫（纯函数——truth table 锁定）：generation 匹配且 execSeq **严格单调**才写——旧 worker
 *  迟到更新拒绝（同 execSeq 亦拒；换代后旧代写全拒）。PG 侧 CAS 化（WHERE generation=? AND execSeq<?）
 *  归 T21——本函数为受理判据单源。
 *  T21 ④根修（解冻窗口）：execSeq 比较**改道 compareExecSeq 单源**（media-fact.ts——数值比较+
 *  BigInt 精度+2^53 边界语义；bigint 入参外形不变、内部经 string 十进制签名域）。裸比禁令
 *  =check-plan-census ④（登记红 until=T21 已随本根修归零撤销）。 */
export function nodeExecutionUpdateAllowed(
  current: { generation: number; execSeq: bigint },
  incoming: { generation: number; execSeq: bigint },
): boolean {
  return current.generation === incoming.generation
    && compareExecSeq(incoming.execSeq.toString(), current.execSeq.toString()) > 0;
}

/** NodeExecution 契约注记（spec §6.2） */
export const NODE_EXECUTION_CONTRACT = {
  historyHome: '历史留 GenerationIntent——NodeExecution 只当前行（PK projectId+nodeId）',
  artifactRevSource: 'artifact 槽位版本读 NodeArtifact——不建第二套',
  nodeVersion: 'nodeVersion=该节点末次事件 feedSeq（单名单义——eventVersion/projected 元组废止）',
} as const;

// ═══ §2 ExecutionOutbox（工作队列——**禁作 feed 日志**）══════════════════════════════════════

/** ExecutionOutbox 行（spec §6.2——唯一键含 generation+业务幂等键 businessKey+claim lease（SKIP LOCKED）） */
export interface ExecutionOutboxRow {
  id: string;
  projectId: string;
  generation: number;
  /** 业务幂等键（如 exec-finalize:<requestId>:<nodeId>——T22 定形） */
  businessKey: string;
  kind: string;
  payload: unknown;
  state: 'PENDING' | 'CLAIMED' | 'DONE';
  claimOwner?: string;
  claimUntilMs?: number;
  attempts: number;
  createdAtMs: number;
}

export const EXECUTION_OUTBOX_CONTRACT = {
  uniqueKey: '(projectId, generation, businessKey)',
  claim: 'SKIP LOCKED 租约（claimOwner/claimUntilMs——crash 后租约到期重派）',
  /** 负控（spec §7 末行）：可变工作队列 claim/state/delete 会使 feed 游标出洞——feed 日志=RuntimeEvent */
  role: '工作队列职责——不作 feed 日志（feed=RuntimeEvent §7）',
  reconciliation: 'pending outbox 行不按 watermark 过滤；冷装载/换代/恢复全量对账',
} as const;

// ═══ §3 MaterializeRun+RefundObligation+ObjectManifest（spec §6.3——承袭 v4 §2.9）══════════════

/** MaterializeRun 行（materializeRunId+expectedExecSeq 双锚 fencing——B12/B17 承袭 v4 §2.9；
 *  文件生成/对象存储上传/DB 事务非原子→可恢复交付状态机；state 值域 T23 消费定形） */
export interface MaterializeRunRow {
  /** materializeRunId */
  id: string;
  projectId: string;
  nodeId: string;
  expectedExecSeq: bigint;
  state: string;
  createdAtMs: number;
}

export const MATERIALIZE_FENCING_CONTRACT = {
  anchors: ['materializeRunId', 'expectedExecSeq'],
  pipeline: '受控上传任务→受限 objectKey+版本标识→校验身份/大小/完整性/权限→带执行身份 fencing 的 DB 事务终局→outbox 事件→未完成/失效/孤儿可重试清理',
} as const;

/** RefundObligation 行（spec §6.3——**unique+reversesId 幂等**：退款/删除引用精确业务记录，
 *  exact settle row/reversesId；不依据客户端 doc 字段或过期 worker 状态） */
export interface RefundObligationRow {
  id: string;
  /** 指向 GenerationIntent 行（intentRowId——资金审计 join 键） */
  intentRowId: string;
  execSeq: bigint;
  /** 逆转指向的 exact settle 行 id——同 reversesId 二次逆转拒绝（幂等） */
  reversesId: string;
  creditAmount: number;
  state: 'PENDING' | 'SETTLED';
  createdAtMs: number;
}

export const REFUND_IDEMPOTENCY_CONTRACT = {
  uniqueKey: '(intentRowId, execSeq)',
  reversesId: 'reversesId 指向 exact settle 行——同键二次逆转拒绝（幂等）',
  evidence: '不依据客户端 doc 字段或过期 worker 状态（资金记录=精确业务记录）',
} as const;

/** ObjectManifest 行（spec §6.3——claimOwner/claimUntil GC delete-claim；有界 orphan；
 *  StorageReservation 终态释放同段承袭 v4 §2.9） */
export interface ObjectManifestRow {
  id: string;
  objectKey: string;
  sizeBytes: number;
  /** delete-claim 在位（claimOwner+claimUntil 未过）=GC 禁删 */
  claimOwner?: string;
  claimUntilMs?: number;
  state: string;
  updatedAtMs: number;
}

export const OBJECT_MANIFEST_CLAIM_CONTRACT = {
  gc: 'GC delete-claim（claimOwner/claimUntil）+有界 orphan 清扫——承袭 v4 §2.9；T23 落地',
} as const;

// ═══ §4 外部副作用幂等（spec §6.3 偏离 36-④——注记冻结）════════════════════════════════════

/** 外呼幂等纪律：submit-poll 链三层防护已在（write-ahead providerRequestId+providerTaskId 先落库+
 *  query-first resume——§1.7 实证）；**text 生成链补外呼锚**（现零键零锚——T23：超时/5xx→UNKNOWN
 *  不自动重呼，用户显式查询/重试才开新 attempt；计费 at-most-once（requestId,attemptNo=1）只扣一次）；
 *  供应商不认键的 submit→落库窗=外部 at-least-once 诚实登记，资金由 execSeq CAS 保 exactly-once——
 *  **数据库 fencing 无法撤销已发生的外部调用，外部幂等键是唯一屏障**。 */
export const EXTERNAL_SIDE_EFFECT_IDEMPOTENCY = {
  submitPollChain: 'write-ahead providerRequestId+providerTaskId 先落库+query-first resume（§1.7 实证——三层防护维持不重建）',
  textChain: 'text 生成链补外呼锚（T23——write-ahead 键+UNKNOWN 纪律+计费 at-most-once）',
  fencingLimit: '数据库 fencing 无法撤销已发生的外部调用——外部幂等键是唯一屏障',
} as const;

// ═══ §5 LifecycleObligation 定队列（确认点①附带裁定 #11——T21 解冻窗口落定）══════════════

/** 队列状态（closed 4 值）：PENDING（待处理）→CLAIMED（租约在持）→DONE（幂等终态）；
 *  DEAD=attempts 耗尽 fail-closed 告警档（义务丢失=投影/资金悬挂，人工处理——非静默丢弃）。 */
export const LIFECYCLE_OBLIGATION_STATES = ['PENDING', 'CLAIMED', 'DONE', 'DEAD'] as const;
export type LifecycleObligationState = typeof LIFECYCLE_OBLIGATION_STATES[number];

/** 租约纪律（T26 观察器/sweeper 消费——SKIP LOCKED 同 §2 ExecutionOutbox claim 先例；
 *  attempts 上限冻结值 5）。 */
export const LIFECYCLE_OBLIGATION_LEASE = {
  claim: 'SKIP LOCKED 租约（claimOwner/claimUntilMs——租约到期回 PENDING 可重派）',
  maxAttempts: 5 as const,
  retry: '失败/租约到期 attempts+1；<maxAttempts 回 PENDING 重派，≥maxAttempts 置 DEAD（fail-closed 告警非静默丢）',
} as const;

/** LifecycleObligation 队列行（#11）：lifecycle.ts LifecycleObligationRow（观察器生成面——帧↔义务
 *  原子锚）之上的**队列执行面**（state/attempts/lease——T26 消费；kind=义务 closed enum 单源
 *  lifecycle.ts OBLIGATION_KINDS，必含 FEED_TOMBSTONE）。 */
export interface LifecycleObligationQueueRow {
  id: string;
  projectId: string;
  nodeId: string;
  kind: ObligationKind;
  /** 触发帧（帧↔义务原子锚——lifecycle.ts 同名域） */
  walSeq: bigint;
  state: LifecycleObligationState;
  attempts: number;
  claimOwner?: string;
  claimUntilMs?: number;
  createdAtMs: number;
  updatedAtMs: number;
}

/** effect→obligation 映射（#11 单源纯函数——T26 观察器按 FrameEffect.kind 派生应发射义务集）：
 *  NODE_DELETED→三义务（FEED_TOMBSTONE=feed 墓碑投递+NODE_DELETED=三消费面清扫+EXEC_FINALIZE=
 *  在飞 GenerationIntent 资金收口）；NODE_RESTORED/其余 effect 零义务（undo 重建=新 lifecycleSeq
 *  无删除义务；EDGE 与 MEDIA_REF 族清扫=NODE_DELETED 消费面自带不另立义务——负控由测试锁定）。 */
export function obligationsForFrameEffect(effectKind: FrameEffectKind): readonly ObligationKind[] {
  return effectKind === 'NODE_DELETED' ? ['FEED_TOMBSTONE', 'NODE_DELETED', 'EXEC_FINALIZE'] : [];
}

/** 队列转移事件（claim/complete/fail/lease-expired——sweeper/worker 两消费方） */
export type ObligationQueueEvent =
  | { type: 'claim'; owner: string; untilMs: number }
  | { type: 'complete' }
  | { type: 'fail' }
  | { type: 'lease-expired' };

/** 队列状态转移（纯函数——truth table 锁定）：
 *  - PENDING+claim→CLAIMED（租约落位）；PENDING+complete→DONE（幂等直达——重建面：义务从帧前缀
 *    确定性重建后工作已完成，complete 免租约合法）；PENDING+fail→attempts+1<max?PENDING:DEAD；
 *    PENDING+lease-expired=no-op（无租约可过期）。
 *  - CLAIMED+complete→DONE；CLAIMED+fail/lease-expired→attempts+1<max?PENDING:DEAD（到期重派计
 *    一次尝试）；CLAIMED+claim→null（双 claim 结构性禁——重派必经 lease-expired）。
 *  - DONE/DEAD+*→null（终态免疫——DEAD 人工处理归 T26 运维面）。 */
export function nextObligationQueueState(
  row: Pick<LifecycleObligationQueueRow, 'state' | 'attempts'>,
  ev: ObligationQueueEvent,
  maxAttempts: number = LIFECYCLE_OBLIGATION_LEASE.maxAttempts,
): Pick<LifecycleObligationQueueRow, 'state' | 'attempts'> & Partial<Pick<LifecycleObligationQueueRow, 'claimOwner' | 'claimUntilMs'>> | null {
  if (row.state === 'DONE' || row.state === 'DEAD') return null;   // 终态免疫
  if (ev.type === 'claim') {
    if (row.state !== 'PENDING') return null;                      // 双 claim 结构性禁
    return { state: 'CLAIMED', attempts: row.attempts, claimOwner: ev.owner, claimUntilMs: ev.untilMs };
  }
  if (ev.type === 'complete') return { state: 'DONE', attempts: row.attempts };   // PENDING/CLAIMED 均可达（幂等终态）
  const nextAttempts = row.attempts + 1;
  const retryState: LifecycleObligationState = nextAttempts >= maxAttempts ? 'DEAD' : 'PENDING';
  if (ev.type === 'fail') return { state: retryState, attempts: nextAttempts };
  // lease-expired：CLAIMED→重派档（计一次尝试）；PENDING→no-op（attempts 不动）
  return row.state === 'CLAIMED' ? { state: retryState, attempts: nextAttempts } : { state: 'PENDING', attempts: row.attempts };
}

/** 义务退款路径（#11——EXEC_FINALIZE 义务的收口链）：删除节点的在飞 GenerationIntent 资金收口经
 *  §3 RefundObligation 精确逆转（unique(intentRowId,execSeq)+reversesId 幂等——**execSeq=执行代际族**，
 *  与 walSeq/lifecycleSeq 两无关）；FEED_TOMBSTONE/NODE_DELETED 无资金面（投递/清扫即 DONE）。 */
export const LIFECYCLE_OBLIGATION_REFUND_PATH = {
  EXEC_FINALIZE: 'EXEC_FINALIZE→RefundObligation（unique(intentRowId,execSeq)+reversesId 幂等逆转 exact settle row——删除节点在飞意图资金收口）',
  FEED_TOMBSTONE: 'FEED_TOMBSTONE 无资金面（投递 node.deleted 事件即 DONE）',
  NODE_DELETED: 'NODE_DELETED 无资金面（MediaBinding/ArtifactProjection/VideoProject 三消费面清扫即 DONE）',
} as const;
