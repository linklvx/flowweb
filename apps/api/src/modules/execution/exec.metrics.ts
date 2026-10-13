import { Counter, Histogram, register } from 'prom-client';
import { ServiceUnavailableException } from '@nestjs/common';
import { COLLAB_AUTH_REASONS } from '@flowweb/shared';

/** Y0b-2 T2 新指标单文件（Z85/Z108）——spec §10 metric-names 块同 commit 同步
 *  （check-spec-consistency 双向核：code 集合 ≡ spec fenced 块）。
 *  syncPending/artifactDiscarded/claimResult/groupDuration 定义先行——消费接线归 T4/T7（定义先行先例：
 *  store.metrics.ts yjsStoreTailAnomalyTotal）。 */

/** Z41/Z69：外呼全程时长（call 域——claim 之后到 Deliverable；不含排队）。 */
export const outboundDuration = new Histogram({
  name: 'exec_outbound_duration_seconds',
  help: 'Y0b-2（Z41/Z69）：外呼全程时长（call 域——claim 之后到 Deliverable；不含排队）',
  labelNames: ['kind'],
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1200, 1800],
  registers: [register],
});

/** Z68/Z84：deadline 强制收敛计数（phase=queue 排队期/call 外呼期/waiting 队列升级）。 */
export const intentDeadlineExceededTotal = new Counter({
  name: 'intent_deadline_exceeded_total',
  help: 'Y0b-2（Z68/Z84）：deadline 强制收敛计数（phase=queue 排队期/call 外呼期/waiting 队列升级）',
  labelNames: ['kind', 'phase'],
  registers: [register],
});

/** SV 支配门拒绝计数（phase=first/retry）——消费接线归 T4。 */
export const syncPendingTotal = new Counter({
  name: 'exec_sync_pending_total',
  help: 'Y0b-2：SV 支配门拒绝计数（phase=first/retry）',
  labelNames: ['phase'],
  registers: [register],
});

/** Z85：外呼产物丢弃计量——cause=precall-miss 断言恒 0（非 0 即 pre-call 断言被绕过）；
 *  cause=node-deleted 在飞窗口真实计量；cause=deadline-voided。消费接线归 T4。 */
export const artifactDiscardedTotal = new Counter({
  name: 'ai_artifact_discarded_total',
  help: 'Y0b-2（Z85）：外呼产物丢弃计量（cause=precall-miss 断言恒 0/node-deleted 在飞窗口真实计量/deadline-voided）',
  labelNames: ['cause'],
  registers: [register],
});

/** Z85：claim 出口三分——"用户以为重新生成实际被回放"的唯一可观测面（result=replay|rearm|new|busy）。
 *  消费接线归 T4。 */
export const intentClaimResultTotal = new Counter({
  name: 'intent_claim_result_total',
  help: 'Y0b-2（Z85）：claim 出口三分计数（result=replay|rearm|new|busy——"重新生成实为回放"的唯一可观测面）',
  labelNames: ['result'],
  registers: [register],
});

/** Z90：组执行全程墙钟（nodeCount 标签）——消费接线归 T4。 */
export const groupDuration = new Histogram({
  name: 'execution_group_duration_seconds',
  help: 'Y0b-2（Z90）：组执行全程墙钟（label=nodeCount）',
  labelNames: ['nodeCount'],
  buckets: [5, 15, 30, 60, 120, 300, 600, 1200, 1800],
  registers: [register],
});

/** Z90/Z105：轮询停滞触发计数（连续异常——fetch 抛错/非 2xx/解析失败，不含"处理中"稳态）。 */
export const pollStallTotal = new Counter({
  name: 'exec_poll_stall_total',
  help: 'Y0b-2（Z90/Z105）：轮询停滞触发计数（连续异常——fetch 抛错/非 2xx/解析失败，不含"处理中"稳态）',
  labelNames: ['kind'],
  registers: [register],
});

/** Z105 第五轮修订：2xx 可解析但 status 不在已知词表——WARN 不判停滞（禁词表悬崖：provider 新增
 *  中间态会停刷新 lastGoodResponseAt⇒误杀）——单独计数观测未知面。 */
export const pollUnknownStatusTotal = new Counter({
  name: 'exec_poll_unknown_status_total',
  help: 'Y0b-2（Z105）：轮询遇 2xx 可解析但 status 不在已知词表的计数（WARN 不判停滞——防词表悬崖误杀）',
  labelNames: ['kind'],
  registers: [register],
});

/** Z111：writeExecStatus 守卫 fail-closed 丢弃计数——缺 attempts（违约 patch）/严格更老一律丢
 *  （不看终态——老代 error(1) 不得覆盖新代 loading(2)）。非 0=有投影被拦（观测代次违约面）。 */
export const execProjectionDroppedTotal = new Counter({
  name: 'exec_projection_dropped_total',
  help: 'Y0b-2（Z111）：exec 投影守卫丢弃计数（cause=missing-attempts 缺代次/older-attempts 严格更老——fail-closed 两子句）',
  labelNames: ['cause'],
  registers: [register],
});

/** Z112：reaper 终态投影分治——doc 非常驻跳过 UX 投影计数（重连后 alignExecFromIntents 对齐）。
 *  UX 投影不得成为装载源：provider 故障批量收敛时 withDoc 批量装载=故障自放大（正撞 E39/heap 闸）。 */
export const execProjectionDeferredTotal = new Counter({
  name: 'exec_projection_deferred_total',
  help: 'Y0b-2（Z112）：reaper 终态投影因 doc 非常驻跳过计数（重连 alignExecFromIntents 对齐——UX 投影不成为装载源）',
  registers: [register],
});

/** Y0c T0（Z3）：执行链投影写失败计数——14 处 `.catch(()=>{})` 吞错点加观测不改策略
 *  （Z136④ 口径：execution.service 11+execution.processor 1+ai-image-edit.processor 2；B3 清单逐点实测核对）。
 *  cause 有界词表：CollabAuthReason 词表（带 reason 抛错形态——lease-not-ready/db-unavailable/
 *  server-overloaded/invalid-doc-name/schema-outdated 等）∪ not-serving（503 SUE 无 reason 形态——
 *  租约失守/真空窗/spool 熔断，双进程后从罕见变常态的族）∪ other。 */
export const collabExecProjectionFailedTotal = new Counter({
  name: 'collab_exec_projection_failed_total',
  help: '执行链投影写失败计数（14 处 .catch(()=>{}) 吞错点加观测不改策略；cause=CollabAuthReason 词表/not-serving 503 族/other）',
  labelNames: ['cause'],
  registers: [register],
});

/** reason 词表白名单（COLLAB_AUTH_REASONS 14 值闭集）——非词表 reason 一律折 other，原始值只进日志 */
const EXEC_PROJECTION_REASON_WHITELIST: ReadonlySet<string> = new Set<string>(COLLAB_AUTH_REASONS);

/** 失败分类（label 有界纪律——err.reason 经白名单校验，非词表值（动态错误形态）折 other 不直透
 *  label（故障期恰是本指标流量尖峰，防无界 label 基数）；诊断信息归日志——load 路径
 *  captureCollabException 分工先例。空串/缺失 reason 的 503 SUE 折 not-serving） */
export function classifyExecProjectionFailure(err: unknown): string {
  const reason = (err as { reason?: unknown } | null | undefined)?.reason;
  if (typeof reason === 'string' && EXEC_PROJECTION_REASON_WHITELIST.has(reason)) return reason;
  if (err instanceof ServiceUnavailableException) return 'not-serving';
  return 'other';
}

/** 吞错点单行观测——14 处 `.catch(() => {})` 统一改 `.catch(countExecProjectionFailure)`（签名恰配，不改策略只加计数） */
export function countExecProjectionFailure(err: unknown): void {
  collabExecProjectionFailedTotal.inc({ cause: classifyExecProjectionFailure(err) });
}
