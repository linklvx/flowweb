import { Counter, Histogram, register } from 'prom-client';

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
