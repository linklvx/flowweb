// packages/shared/src/collab/runtime-exec-status.ts
// Y3 Task 1（plan 2026-11-19-y3-protocol-retirement 第一笔——spec §3 S2/词表表）：shared 组装器+
// 投影函数+封闭句常量（/execution socket.io 退役→RuntimeFeed 收口面）。
// - assembleExecStatusPayload：writeExecStatus/deliverArtifact 两写面同调——允许键恰八
//   （status/attempts/execSeq/errorCode/artifactRev/intentId/rearmable/error）；必填键定死；
//   fileId/jobId/reason/nodeVersion/v/kind 一律不写（nodeVersion 由 appendEventInTx 以本事件
//   feedSeq 单源盖上——组装器/调用方禁自带）。
// - error 封闭句等值检查：Feed 只用封闭句（err.message 禁入 Feed——异常原文只进日志）；先 trim、
//   全文必须等于封闭句表某句否则整段换「生成失败」（不截断不保留残段）。
// - feedError(errorCode, sentence, row|null)：Feed error 唯一出口——句子与原因码分开（同码异句
//   无法从码推句——TEXT_PROVIDER_UNKNOWN marked/unmarked 两句、INTENT_DEADLINE_EXCEEDED 执行链
//   vs reaper 两句）；rearmable 按码与有无行。
// - execStatusSlotOfPayload：payload→RuntimeProjectionExecStatusFact（服务端 slotOfEvent 与客户端
//   slotOfEventWire 同调——键有值才拷；缺合法 nodeVersion 不算一条状态返回 null）。
// - 受理四档联合类型：api 与 web 同源（新建/交付重放/作废重放/去重）。
// - mergeSlot execStatus execSeq 代际规则（runtime-projection.ts mergeRuntimeProjection 消费——
//   两边都有十进制 execSeq 大者胜〔BigInt 数值比较非字符串〕→相同比 nodeVersion→任一边缺仍只比
//   nodeVersion；execStatus 槽专用，artifact/deletedAt/restored 槽不动）。
import type { RuntimeProjectionExecStatusFact } from './runtime-projection';

// ═══ §1 FEED_SENTENCES 封闭句表（单源——句子表只在这一处）══════════════════════════════════

/** 封闭句 id（closed——同码异句靠 id 分立：TEXT_UNKNOWN_HELD/UNMARKED、REAPER_DEADLINE/STALE、
 *  EXEC_DEADLINE 与 REAPER_DEADLINE 分开但事件码均维持现码）。 */
export type FeedSentenceId =
  // 扣费五码词表（controller ruling：grep 现有词表逐字搬——spec 表四句+兜底句）
  | 'CREDIT_INSUFFICIENT'
  | 'QUOTA_EXCEEDED'
  | 'NOT_MEMBER'
  | 'TEAM_BALANCE_MISSING'
  | 'RESERVE_GATE_LOST'
  // 编辑通用失败→「AI 处理失败」
  | 'EDIT_FAILED'
  // 节点执行通用失败→「生成失败」（实际码缺省 EXECUTION_FAILED）
  | 'EXEC_GENERIC'
  // 资金不变量→暂缓交付句
  | 'FUNDS_HELD'
  // 执行链超时句（编辑/打光 intent-stale——事件码 INTENT_DEADLINE_EXCEEDED、与 REAPER 分立）
  | 'EXEC_DEADLINE'
  // 主路径 planMap 缺失（「节点缺少定价快照」不拼节点 id）
  | 'PLAN_MISSING'
  // 冻结输入缺节点（errorCode:'FROZEN_INPUT_MISSING'、不写 PLAN_MISSING 句）
  | 'FROZEN_INPUT_MISSING'
  // TEXT_PROVIDER_UNKNOWN 两句（无 err.message 前缀——封闭句正文恰此形态）
  | 'TEXT_UNKNOWN_HELD'
  | 'TEXT_UNKNOWN_UNMARKED'
  // reaper 两句维持现句（intent-reconcile.service.ts projectReaped 逐字——事件码仍现两码）
  | 'REAPER_DEADLINE'
  | 'REAPER_STALE';

/** 封闭句表（FeedSentenceId→句全文）。等值检查留最后一道（不代替封闭句——表外句整段换「生成失败」）。 */
export const FEED_SENTENCES: Record<FeedSentenceId, string> = {
  // 扣费失败五码（spec §3 词表表——未命中码兜底句同 RESERVE_GATE_LOST）
  CREDIT_INSUFFICIENT: '积分不足',
  QUOTA_EXCEEDED: '本月额度已用尽',
  NOT_MEMBER: '不在该团队，无法扣费',
  TEAM_BALANCE_MISSING: '团队积分账户不存在',
  RESERVE_GATE_LOST: '扣费失败，请重试',
  EDIT_FAILED: 'AI 处理失败',
  EXEC_GENERIC: '生成失败',
  FUNDS_HELD: '生成结果暂缓交付（资金核销异常，待对账处理）',
  EXEC_DEADLINE: '生成已被系统回收（超时）——产物未投递',
  PLAN_MISSING: '节点缺少定价快照',
  FROZEN_INPUT_MISSING: '节点缺少冻结输入',
  TEXT_UNKNOWN_HELD: '可能重复生成、不会重复扣费（请稍后查询或重试）',
  TEXT_UNKNOWN_UNMARKED: '外呼结果不明，扣费状态待对账（请稍后查询或重试）',
  REAPER_DEADLINE: '生成超时已被系统回收',
  REAPER_STALE: '生成心跳失联已被系统回收（进程/调度异常）',
};

/** 扣费失败码→词表句（五码逐字；未命中码→「扣费失败，请重试」兜底）。 */
export function reserveFailSentence(code: string): string {
  switch (code) {
    case 'CREDIT_INSUFFICIENT': return FEED_SENTENCES.CREDIT_INSUFFICIENT;
    case 'QUOTA_EXCEEDED': return FEED_SENTENCES.QUOTA_EXCEEDED;
    case 'NOT_MEMBER': return FEED_SENTENCES.NOT_MEMBER;
    case 'TEAM_BALANCE_MISSING': return FEED_SENTENCES.TEAM_BALANCE_MISSING;
    default: return FEED_SENTENCES.RESERVE_GATE_LOST;   // 含 RESERVE_GATE_LOST 及其他一切未命中码
  }
}

// ═══ §2 assembleExecStatusPayload（八键恰+必填键定死+封闭句等值检查）═══════════════════════

/** exec.status 载荷（八键全可选面——必填键由组装器定死补齐）。 */
export interface ExecStatusPayloadPatch {
  status?: unknown;
  attempts?: unknown;
  execSeq?: unknown;
  errorCode?: unknown;
  artifactRev?: unknown;
  intentId?: unknown;
  rearmable?: unknown;
  error?: unknown;
  [key: string]: unknown;   // 开放签名（writeExecStatus/deliverArtifact 传递面——禁写键一律丢弃）
}

/** exec.status 组装产物（八键恰——服务端 appendEvent 再补 v/kind/nodeId/nodeVersion）。 */
export interface ExecStatusAssembledPayload {
  status: string;
  attempts: number;
  execSeq?: string;
  errorCode?: string;
  artifactRev?: number;
  intentId?: string;
  rearmable?: boolean;
  error?: string;
}

/** error 封闭句等值检查（先 trim、全文必须等于封闭句表某句否则整段换「生成失败」——不截断
 *  不保留残段；表内句原样通过；非字符串/空白→null 键不写）。 */
function sanitizeFeedErrorSentence(error: unknown): string | null {
  if (typeof error !== 'string') return null;
  const trimmed = error.trim();
  if (trimmed === '') return null;
  for (const sentence of Object.values(FEED_SENTENCES)) {
    if (trimmed === sentence) return sentence;
  }
  return FEED_SENTENCES.EXEC_GENERIC;   // 「生成失败」——表外句整段替换（最后一道，不代替封闭句）
}

/** 有限数字判据（NaN/Infinity 一律不算——attempts 缺则 0）。 */
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 八键恰组装器（writeExecStatus 与 deliverArtifact 同调——nodeId 由调用方单独拼）：
 *  - status=非空字符串否则抛错（业务 bug 非静默）；
 *  - attempts=有限数字、缺则 0、始终写入；
 *  - execSeq=仅 /^\d+$/ 字符串才写入（typeof 收敛会把数字 execSeq 写进 JSON——破坏 wire 纪律
 *    BigInt 一律 string）；
 *  - errorCode/intentId=非空字符串才写入；artifactRev=有限数字才写入；rearmable=布尔才写入；
 *  - error=封闭句等值检查（sanitizeFeedErrorSentence）；
 *  - fileId/jobId/reason/nodeVersion/v/kind 一律不写。 */
export function assembleExecStatusPayload(patch: ExecStatusPayloadPatch): ExecStatusAssembledPayload {
  const { status } = patch;
  if (typeof status !== 'string' || status === '') {
    throw new Error(`EXEC_STATUS_BAD_STATUS: patch.status 须为非空 string（组装器必填键定死）`);
  }
  const attempts = isFiniteNumber(patch.attempts) ? patch.attempts : 0;
  const payload: ExecStatusAssembledPayload = { status, attempts };   // attempts 始终写入（缺则 0）
  if (typeof patch.execSeq === 'string' && /^\d+$/.test(patch.execSeq)) payload.execSeq = patch.execSeq;
  if (typeof patch.errorCode === 'string' && patch.errorCode !== '') payload.errorCode = patch.errorCode;
  if (isFiniteNumber(patch.artifactRev)) payload.artifactRev = patch.artifactRev;
  if (typeof patch.intentId === 'string' && patch.intentId !== '') payload.intentId = patch.intentId;
  if (typeof patch.rearmable === 'boolean') payload.rearmable = patch.rearmable;
  const error = sanitizeFeedErrorSentence(patch.error);
  if (error !== null) payload.error = error;
  return payload;
}

// ═══ §3 feedError（Feed error 唯一出口——rearmable 按码与有无行）═════════════════════════

/** 意图行最小接口（GenerationIntent 消费面列型——intentId=行上 intentId 列〔claim 时 randomUUID()
 *  铸造的行身份，gestureKey 才是客户端手势审计列不进事件〕；execSeq=行 BigInt 列（wire 一律
 *  toString；number/string 行型同档容忍——测试/宽松读面）。 */
export interface FeedIntentRow {
  intentId: string;
  attempts: number;
  execSeq: bigint | number | string;
}

/** Feed error patch（ExecutionService.errorPatch 退役后的唯一出口——status:'error' 恒定 +
 *  errorCode+句子 id 选句；行读取 intentId/attempts/execSeq；票上 intentRowId=行 cuid 非事件
 *  intentId）。 */
export function feedError(errorCode: string, sentence: FeedSentenceId, row: FeedIntentRow | null): ExecStatusAssembledPayload {
  const error = FEED_SENTENCES[sentence];
  // 无行档（主 PLAN_MISSING/冻结 FROZEN_INPUT_MISSING/claim 前失败）：attempts 0+rearmable false+
  // 不写 intentId/execSeq（attempts<3→true 会让面板保留一个没有行可 rearm 的手势）。
  if (row === null) {
    return assembleExecStatusPayload({ status: 'error', attempts: 0, errorCode, rearmable: false, error });
  }
  // 有行档：身份键恒写（intentId=行 intentId 列/execSeq=row.execSeq.toString()）
  const attempts = isFiniteNumber(row.attempts) ? row.attempts : 0;
  const execSeq = String(row.execSeq);
  // rearmable 按码（Controller ruling：判据=errorCode 参数，有行/无行按 row）：
  // TEXT_PROVIDER_UNKNOWN 恒 true（UNKNOWN 不进 reaper 扫描、冻结靠同 token rearm 的 voidInTx 释放——
  // 写成 attempts<3 则次数到 3 面板铸新付费手势、旧冻结滞留 UNKNOWN）；
  // FUNDS_INVARIANT_VIOLATION 与 INTENT_EXHAUSTED 恒 false（资金对账面/服务端上限不靠面板提前轮换）；
  // 其余 attempts<3。
  let rearmable: boolean;
  if (errorCode === 'TEXT_PROVIDER_UNKNOWN') rearmable = true;
  else if (errorCode === 'FUNDS_INVARIANT_VIOLATION' || errorCode === 'INTENT_EXHAUSTED') rearmable = false;
  else rearmable = attempts < 3;
  return assembleExecStatusPayload({ status: 'error', attempts, errorCode, intentId: row.intentId, execSeq, rearmable, error });
}

// ═══ §4 execStatusSlotOfPayload（payload→Fact——服务端 slotOfEvent/客户端 slotOfEventWire 同调）══

/** payload→execStatus 槽（缺合法 nodeVersion〔非十进制 string〕返回 null——不算一条状态；
 *  键有值才拷、缺的可选键不写成 undefined；fileId/jobId/reason/v/kind 等不进 Fact）。 */
export function execStatusSlotOfPayload(p: Record<string, unknown>): { execStatus: RuntimeProjectionExecStatusFact } | null {
  const nodeVersion = p.nodeVersion;
  if (typeof nodeVersion !== 'string' || !/^\d+$/.test(nodeVersion)) return null;
  const fact: RuntimeProjectionExecStatusFact = { status: String(p.status), nodeVersion };
  if (isFiniteNumber(p.attempts)) fact.attempts = p.attempts;
  if (typeof p.execSeq === 'string' && /^\d+$/.test(p.execSeq)) fact.execSeq = p.execSeq;
  if (typeof p.errorCode === 'string' && p.errorCode !== '') fact.errorCode = p.errorCode;
  if (isFiniteNumber(p.artifactRev)) fact.artifactRev = p.artifactRev;
  if (typeof p.intentId === 'string' && p.intentId !== '') fact.intentId = p.intentId;
  if (typeof p.rearmable === 'boolean') fact.rearmable = p.rearmable;
  if (typeof p.error === 'string' && p.error !== '') fact.error = p.error;
  return { execStatus: fact };
}

// ═══ §5 受理四档联合类型（api/web 同源——runGuarded/lighting 受理响应显式结局）════════════

/** 受理显式结局（discriminated union——客户端 handleGenerate 只认 outcome）：
 *  - replayed:false=新建受理（intentId=行 intentId 列+execSeq=行代际 wire string）；
 *  - delivered=交付重放（既有入队字段外带 resultRef）；
 *  - voided=作废重放（对象上没有 resultRef）；
 *  - deduped=去重档（taskId+status——打光控制器刚 claim 的行已 fail 掉，零 Feed 写）。 */
export type AdmissionOutcome =
  | { replayed: false; intentId: string; execSeq: string }
  | { replayed: true; outcome: 'delivered'; resultRef: string }
  | { replayed: true; outcome: 'voided' }
  | { replayed: true; outcome: 'deduped'; taskId: string; status: string };
