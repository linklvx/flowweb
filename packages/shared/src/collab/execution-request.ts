// packages/shared/src/collab/execution-request.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段——spec v5.4 §6.1，偏离 37⑤+38⑨⑩）：执行受理三表契约冻结。
// **CONTRACT-FREEZE**——类型+常量+纯函数；零生产行为变更（消费方=T21 G4 门受理实现/T23 资金收口）。
// 不是 Prisma 迁移（T7/T21 落 DDL）、不是运行时实现——与 T5a doc-protocol.ts 同构的契约单源。
// 单源纪律：EXEC_MAX_NODES=20 与 apps/api config env EXEC_DEFAULTS.MAX_NODES 同值——T21 消费时改引本常量
// （禁双数值真源，COLLAB_WS_MAX_PAYLOAD_BYTES 同款注记）；8MiB/2MiB/256KiB/200/50/15min/2s/500ms/30d
// 本文件即唯一真源。DDL 契约（列/索引/约束）以类型+注释冻结，migration 归 T7/T21。
// 契约测试=execution-request.spec.ts（TDD 红先行）。

// ═══ §1 ExecutionRequest 父行（每请求一行——v5.4⑨ 内部 id 主键）══════════════════════════════

/** ExecutionRequest 父行（spec §6.1 DDL——`@@unique([projectId, requestId])`）：
 *  - id=内部主键 cuid（**客户端字符串禁作全局 PK**——v5.4⑨）；requestId=客户端幂等键（项目内唯一）
 *  - historyId=受理时 SystemHistory 值——**PITR 后同 requestId 重试不匹配→409 REQUEST_STALE**（v5.4⑨）
 *  - docSeq=客户端下界（save barrier 回执 committedSeq）；frozenDocSeq=服务端实际冻结值（>=docSeq；
 *    同 requestId 重试幂等返回原值）
 *  - inputHash=ExecutionInput.contentHash（单源——不另算）
 *  - 受理读=PG 一致前缀（§5.1——不读「已 apply 未 PG」的 live doc）；worker 零 doc 读（只读子行+ExecutionInput） */
export interface ExecutionRequestRow {
  id: string;
  requestId: string;
  projectId: string;
  generation: number;
  historyId: string;
  docSeq: bigint;
  frozenDocSeq: bigint;
  userId: string;
  teamId: string;
  /** text|video|image|outpaint|erase|redraw|lighting（GenerationIntent.kind 同域——T21 对齐） */
  kind: string;
  /** 请求状态（T21 定值——受理/终态扫描面；本契约不冻结值域） */
  state: string;
  /** Σ子行 reservedCredit（受理事务内逐 item 预留合计——对账基线） */
  reservedCredit: number;
  /** Σ子行 creditCost（计划总价——预留与结算对账基线） */
  totalCredit: number;
  /** sha256hex(canonicalPlanHashPayload(子行按 order 排序、只含不可变字段))——Char(64)；调用点=T21/T26 */
  planHash: string;
  /** =ExecutionInput.contentHash——Char(64) 单源 */
  inputHash: string;
  /** =now+EXEC_REQUEST_EXPIRES_AT_MS（15min——未 claim 由 sweeper 逐 item void） */
  expiresAtMs: number;
}

// ═══ §2 ExecutionNodePlan 子行（每节点一行——claim/retry/退款/artifact 关系性载体）═════════════

/** ExecutionNodePlan 子行（spec §6.1 DDL——`@@id([requestId, nodeId])`+`@@index([requestId, order])`）：
 *  - **scopeNodeIds 不落列——从本表派生**（plan Json 数组废止——偏离 37⑤）
 *  - reservedCredit=per-item 预留载体（v5.4⑨——受理事务内逐 item 写；sweeper 逐 item void）
 *  - status/generationIntentId/execSeq=可变执行态——**不进 planHash**（PLAN_HASH_EXCLUDED_FIELDS）
 *  - 上游节点不进子行——上游内容进 ExecutionInput 作冻结输入（直接父节点 only，与 topology 现状语义一致不扩多级） */
export interface ExecutionNodePlanRow {
  requestId: string;
  nodeId: string;
  order: number;
  type: string;
  model?: string;
  resolution?: string;
  styleId?: string;
  pricingRuleId?: string;
  creditCost: number;
  reservedCredit: number;
  paramsHash: string;
  status: string;
  generationIntentId?: string;
  /** 节点执行序（PG 数值 BigInt——wire/JSON 一律 string 化） */
  execSeq?: bigint;
}

/** planHash 只盖不可变计划字段（v5.4⑨——冻结后不可变的单源证明；次序=canonical 元组序） */
export const PLAN_HASH_IMMUTABLE_FIELDS = [
  'nodeId', 'order', 'type', 'model', 'resolution', 'styleId', 'pricingRuleId', 'creditCost', 'paramsHash',
] as const;
export type PlanHashImmutableField = typeof PLAN_HASH_IMMUTABLE_FIELDS[number];

/** 负控名单：可变执行态字段——**禁入 planHash**（同 requestId 重试的幂等比对面不受执行进度污染） */
export const PLAN_HASH_EXCLUDED_FIELDS = ['status', 'execSeq', 'generationIntentId'] as const;
export type PlanHashExcludedField = typeof PLAN_HASH_EXCLUDED_FIELDS[number];

/** planHash canonical payload（纯函数——**不含 sha256**：shared 无 crypto 先例且需 web 同构，
 *  sha256hex 调用点归 api 侧消费卡 T21/T26；不引第三方库）：
 *  =JSON.stringify(按 order 升序〔并列按 nodeId tie-break〕子行的不可变字段元组数组，可选字段归一 null)。
 *  只读 PLAN_HASH_IMMUTABLE_FIELDS 九字段——status/execSeq/generationIntentId 任意变化不改变输出（负控由测试锁定）。 */
export function canonicalPlanHashPayload(plans: readonly ExecutionNodePlanRow[]): string {
  const tuples = [...plans]
    .sort((a, b) => a.order - b.order || (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0))
    .map((p) => [
      p.nodeId, p.order, p.type,
      p.model ?? null, p.resolution ?? null, p.styleId ?? null, p.pricingRuleId ?? null,
      p.creditCost, p.paramsHash ?? null,
    ]);
  return JSON.stringify(tuples);
}

// ═══ §3 ExecutionInput（冻结输入——PG Bytes/TOAST，不引对象存储依赖）══════════════════════════

/** encoding 值域（v5.4⑩——**禁 zstd 原生依赖**：json 内容+gzip|brotli 二选一，node:zlib 承载；
 *  api 侧压缩调用点=T21；「对象存储 ExecutionInput bundle」=登记项非本批——T29 挂 gate 触发条件） */
export const EXEC_INPUT_ENCODING_KINDS = ['json+gzip', 'json+brotli'] as const;
export type ExecutionInputEncoding = typeof EXEC_INPUT_ENCODING_KINDS[number];

/** ExecutionInput 行（spec §6.1 DDL——`requestId String @id`）：
 *  - content=压缩后字节（stored≤2MiB ∧ raw≤8MiB 双限任一超限 413——**不截断不分片**）
 *  - contentHash=SHA-256(content) hex 64——**inputHash=contentHash 单源**（ExecutionRequest.inputHash 引本列）
 *  - expiresAt **必填**（无值禁插——终态 30d 清理 worker 消费）
 *  - 共享上游按 sha256 去重只存一份；媒体只存 mediaId+元数据；日志禁整 payload（Sentry 只带 requestId/contentHash/bytes） */
export interface ExecutionInputRow {
  requestId: string;
  encoding: ExecutionInputEncoding;
  content: Uint8Array;
  contentHash: string;
  rawBytes: number;
  storedBytes: number;
  schemaVersion: number;
  expiresAtMs: number;
}

/** 输入预算（spec §6.1 冻结数字——全新数字，本文件唯一真源） */
export const EXEC_INPUT_RAW_MAX_BYTES = 8 * 1024 * 1024;        // 8MiB——解压后上限（列超限 nodeId 不落请求）
export const EXEC_INPUT_STORED_MAX_BYTES = 2 * 1024 * 1024;      // 2MiB——压缩存储上限
export const EXEC_PROMPT_MAX_BYTES = 256 * 1024;                 // 256KiB——promptText 413 不截断（组执行超限 UI 提示缩小范围）
export const EXEC_UPSTREAM_MEDIA_IDS_MAX = 200;                  // upstreamMediaIds 上限
export const EXEC_REFERENCED_IMAGE_IDS_MAX = 50;                 // referencedImageIds 上限
/** 终态后输入保留期（清理 worker——生产前置常驻，T29 挂 gate） */
export const EXEC_INPUT_RETENTION_AFTER_FINAL_DAYS = 30 as const;

/** 受理 scope 上限（spec §6.1——≤EXEC_MAX_NODES(20)；api EXEC_DEFAULTS.MAX_NODES 同值，T21 改引本单源） */
export const EXEC_MAX_NODES = 20 as const;

/** 父行过期（spec §6.1——expiresAt=now+15min；未 claim 由 sweeper 逐 item void 释放） */
export const EXEC_REQUEST_EXPIRES_AT_MS = 15 * 60 * 1000;        // 15min

// ═══ §4 受理校验纯函数族（插入前一次性——任一失败整请求 4xx 不落半行）════════════════════════

export type ExecutionScopeAdmission =
  | { ok: true }
  | { ok: false; code: 'EXEC_SCOPE_EMPTY' | 'EXEC_SCOPE_DUPLICATE_NODE' | 'EXEC_SCOPE_TOO_LARGE'; detail: string };

/** nodeIds 纯数组面校验（非空/去重/≤20）——「全部属于本项目/frozenDocSeq 前缀存在且 type 与 plan 一致/
 *  拓扑无环/至少一个 executable」为 PG 侧+服务端读校验（T21 注记——本函数零 IO）。 */
export function validateExecutionScopeNodeIds(nodeIds: readonly string[]): ExecutionScopeAdmission {
  if (nodeIds.length === 0) {
    return { ok: false, code: 'EXEC_SCOPE_EMPTY', detail: 'nodeIds 非空（受理插入前一次性——任一失败不落半行）' };
  }
  const seen = new Set<string>();
  for (const id of nodeIds) {
    if (seen.has(id)) return { ok: false, code: 'EXEC_SCOPE_DUPLICATE_NODE', detail: `nodeId 重复：${id}` };
    seen.add(id);
  }
  if (nodeIds.length > EXEC_MAX_NODES) {
    return { ok: false, code: 'EXEC_SCOPE_TOO_LARGE', detail: `组执行节点数 ${nodeIds.length} 超上限 ${EXEC_MAX_NODES}（EXEC_MAX_NODES）` };
  }
  return { ok: true };
}

export type ExecutionInputAdmission =
  | { ok: true }
  | {
      ok: false;
      code: 'EXEC_INPUT_TOO_LARGE' | 'PROMPT_TOO_LARGE' | 'UPSTREAM_MEDIA_TOO_MANY' | 'REFERENCED_IMAGES_TOO_MANY';
      detail: string;
    };

/** 输入预算校验（纯函数——raw≤8MiB ∧ stored≤2MiB **任一超限 413 EXEC_INPUT_TOO_LARGE**；
 *  prompt/upstream/引用图各自 413——不截断、不分片；首违确定序 raw·stored→prompt→upstream→referenced；
 *  HTTP 状态码映射（413）与列超限 nodeId 不落请求的细节归 T21 消费）。 */
export function validateExecutionInputLimits(i: {
  rawBytes?: number;
  storedBytes?: number;
  promptBytes?: number;
  upstreamMediaCount?: number;
  referencedImageCount?: number;
}): ExecutionInputAdmission {
  const over: string[] = [];
  if ((i.rawBytes ?? 0) > EXEC_INPUT_RAW_MAX_BYTES) over.push('raw');
  if ((i.storedBytes ?? 0) > EXEC_INPUT_STORED_MAX_BYTES) over.push('stored');
  if (over.length > 0) {
    return { ok: false, code: 'EXEC_INPUT_TOO_LARGE', detail: `${over.join('+')} 超限（raw≤8MiB ∧ stored≤2MiB 任一超限 413——不截断不分片）` };
  }
  if ((i.promptBytes ?? 0) > EXEC_PROMPT_MAX_BYTES) {
    return { ok: false, code: 'PROMPT_TOO_LARGE', detail: `promptText ${i.promptBytes}>${EXEC_PROMPT_MAX_BYTES}（256KiB 413 不截断）` };
  }
  if ((i.upstreamMediaCount ?? 0) > EXEC_UPSTREAM_MEDIA_IDS_MAX) {
    return { ok: false, code: 'UPSTREAM_MEDIA_TOO_MANY', detail: `upstreamMediaIds ${i.upstreamMediaCount}>${EXEC_UPSTREAM_MEDIA_IDS_MAX}` };
  }
  if ((i.referencedImageCount ?? 0) > EXEC_REFERENCED_IMAGE_IDS_MAX) {
    return { ok: false, code: 'REFERENCED_IMAGES_TOO_MANY', detail: `referencedImageIds ${i.referencedImageCount}>${EXEC_REFERENCED_IMAGE_IDS_MAX}` };
  }
  return { ok: true };
}

// ═══ §5 frozenDocSeq 临界区（v5.4⑪——修正 v5.3 顺序错误）+重试冲突+资金 per-item ═══════════════

/** 受理临界区次序冻结（spec §6.1 v5.4⑪）：freeze=**拿 per-project gate mutex**（阻止新 beforeSync 进入
 *  ——非布尔 flag，已过 flag 检查的 beforeSync 不得在读后 apply）→等当前 apply 完成→flushThrough(appliedSeq)
 *  →断言 pgSeq==appliedSeq→校验 generation 未变→**只读 scope 节点+直接父节点（禁全量 readCanvas）**
 *  →frozenDocSeq=pgSeq→释放。T21 实现（G4 门先红用例⑥=frozenDocSeq 竞态前置）。 */
export const FROZEN_DOC_SEQ_CRITICAL_SECTION_STAGES = [
  'acquire-gate-mutex',
  'wait-current-apply',
  'flush-through-appliedSeq',
  'assert-pgSeq-equals-appliedSeq',
  'verify-generation-unchanged',
  'read-scope-and-direct-parents-only',
  'set-frozenDocSeq-equals-pgSeq',
  'release-mutex',
] as const;
export type FrozenDocSeqCriticalSectionStage = typeof FROZEN_DOC_SEQ_CRITICAL_SECTION_STAGES[number];

/** 临界区超时 2s→503 不落行（不无限等 actor） */
export const EXEC_ADMISSION_TIMEOUT_MS = 2_000 as const;
/** freeze 预算 500ms 超时→回退 PG 前缀重建候选 doc（不无限阻塞项目 actor） */
export const EXEC_FREEZE_BUDGET_MS = 500 as const;

/** 同 requestId 重试冲突双 409（spec §6.1——受理幂等语义的两例外）：
 *  - REQUEST_STALE：historyId 不匹配（PITR 后同 requestId 重试）
 *  - IDEMPOTENCY_CONFLICT：同键不同 body（planHash/inputHash 任一不同）
 *  - maintenance active→409/503；doc 已卸载→PG 重载后再读（受理侧注记——T21） */
export const EXEC_REQUEST_CONFLICT_REASONS = {
  REQUEST_STALE: 409,
  IDEMPOTENCY_CONFLICT: 409,
} as const;

/** 资金 per-item 预留契约（v5.4⑨——spec §6.1「资金预留 per-item」段）：
 *  受理事务内按 item 预留（复用 team-credit FOR UPDATE/CAS——写 ExecutionNodePlan.reservedCredit）；
 *  未 claim 过期请求由 sweeper 逐 item void 释放；部分失败按 item 释放/结算；requestId 幂等重试不重复预留。 */
export const EXEC_CREDIT_RESERVATION_CONTRACT = {
  perItem: true as const,
  expiresAtMs: EXEC_REQUEST_EXPIRES_AT_MS,
  unclaimedSweeper: '未 claim 过期请求由 sweeper 逐 item void 释放',
  partialFailure: '部分失败按 item 释放/结算',
  idempotentRetry: '同 requestId 幂等重试不重复预留',
} as const;
