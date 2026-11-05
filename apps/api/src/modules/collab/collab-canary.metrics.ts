// apps/api/src/modules/collab/collab-canary.metrics.ts
// C2-2a（plan Task C2-2 捕获侧——生产就绪收尾批，spec v5 §3 C2）：replay canary 指标面。
// *.metrics.ts 单源惯例（THRESHOLDS it1 机器断言键 ⊆ 本文件提取集——新指标落本文件非 service 模块级）。
// source=api 3000：CollabReplayCanaryPoller 仅 api 进程装配（collab.module——role api|all）——捕获
// 面（withFrozenPrefix 冻结读）只存在于持活 doc 的 api 进程；worker 3002 无此族（C2-2b worker verify
// 面指标另族登记）。标签纪律：全低基数禁 projectId（E54 基调）；result=闭集词表。
import { Counter, Gauge, Histogram, register } from 'prom-client';

/** 单次捕获耗时（含短事务①-③+fn 内④哈希+⑤READY——采集挂 finally：失败样本同观测，家族纪律
 *  docCompactionDuration/retention_sweeper_run_duration 同款。spec §3 C2 命名原字 canary_capture_ms
 *  （ms 量纲——10k doc 单次捕获阻塞预算护栏的观测面）。 */
export const collabCanaryCaptureMs = new Histogram({
  name: 'collab_canary_capture_ms',
  help: 'C2-2 canary 单次捕获耗时 ms（withFrozenPrefix fn 内：CanvasDoc FOR SHARE 短事务+快照选择+CAPTURING pin INSERT+SV/canonical hash+READY——采集挂 finally 失败样本同观测；source=api 3000）',
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000],
  registers: [register],
});

/** 尺寸阈值超限跳 hash 计数（超限只取 SV+坐标 hashSkipped=true——10k doc 单次捕获阻塞预算护栏；
 * 持续增长=大 doc 捕获面退化信号，比对降级 SV 辅助判〔C2-2b〕覆盖面扩大）。 */
export const collabCanaryHashSkippedTotal = new Counter({
  name: 'collab_canary_hash_skipped_total',
  help: 'C2-2 canary 捕获尺寸阈值超限跳 hash 计数（canonical 编码超 CANARY_HASH_MAX_BYTES——hashSkipped=true 只取 SV；持续增长=大 doc 捕获退化/比对降级面扩大信号；source=api 3000）',
  registers: [register],
});

/** pin 建立失败重试计数（捕获协议失败面：pg-drift 漂移守卫/pending-structs canonical 不成立/
 * INSERT 冲突等——失败→DELETE pin 下轮重捕；plan「pin_retry_total 告警」=持续增长捕获链异常）。 */
export const collabCanaryPinRetryTotal = new Counter({
  name: 'collab_canary_pin_retry_total',
  help: 'C2-2 canary pin 建立失败计数（漂移守卫/pendingStructs 非空/落库异常——失败 pin 即删不残留，poller 下轮重捕；持续增长=捕获链异常（冻结预算不足/布景漂移）须分诊；THRESHOLDS counter-delta P1；source=api 3000）',
  registers: [register],
});

/** poller tick 结果计数（result 低基数闭集）：captured=捕获成 READY / captured-hash-skipped=捕获成
 *  超限跳 hash 档 / capture-failed=捕获协议失败（pin 已清）/ skip-not-serving=首步 isLeaseServing 拒
 *  （lease 未持有不触 withFrozenPrefix）/ skip-lifecycle=候选查询已排除（SQL lifecycleState='ACTIVE'
 *  谓词——保留档位防回归）/ skip-maintenance=维护窗（候选 SQL maintenanceId IS NULL∨进程内 freeze 面
 *  竞态窗）/ skip-no-doc=活 doc 不在（withFrozenPrefix no-doc 档）/ skip-lag=flush 滞留（withFrozenPrefix
 *  flush-timeout——C2-2b：spec §3 C2「skip_lag 连续 3→P0」分层兜底第一层，THRESHOLDS 承接）/
 *  skip-freeze=冻结临界区拒（gate-timeout——freeze mutex 争用/换代窗）/ skip-pin-active=候选查询已
 *  排除（SQL 未过期 pin NOT EXISTS）/ error=tick 异常。 */
export const collabCanaryPollTickTotal = new Counter({
  name: 'collab_canary_poll_tick_total',
  help: 'C2-2 canary poller tick 结果计数（result 闭集：captured/captured-hash-skipped/capture-failed/skip-not-serving/skip-lifecycle/skip-maintenance/skip-no-doc/skip-lag/skip-freeze/skip-pin-active/error——api 进程轮转捕获面；source=api 3000）',
  labelNames: ['result'],
  registers: [register],
});

// ══ C2-2b（plan Task C2-2 比对侧——worker verify 面；source=worker 3002：CollabCanaryVerifyWorker
// 仅 worker 进程装配〔worker.module 平铺〕——api 3000 本族恒 0 死键〔retention/C3/ops-gate 同款
// 声明分工；THRESHOLDS 同名条目=声明面，操作判定路径=check-collab-health CANARY_CHECKS 段〕） ══

/** verify 结果闭集计数（result 闭集——plan「verify 结果闭集」）：ok=hash 主判相等 / mismatch=语义
 *  不等（hash 红∧SV 互支失败——freeze 面）/ semantic-equal=hashSkipped 档 SV 互支成立 /
 *  hash-encoding-mismatch=hash 红而 SV 互支成立（编码序差异不 freeze）/ skip-prune=pin 过期窗
 *  prune 竞态 / skip-generation=换代（cursor generation 重置）/ skip-maintenance=维护窗 /
 *  skip-lifecycle=擦除窗 / skip-stale-pin=hashVersion 演进 / skip-budget=重放预算超时 / error。 */
export const collabCanaryCheckedTotal = new Counter({
  name: 'collab_canary_checked_total',
  help: 'C2-2b canary worker verify 结果计数（result 闭集：ok/mismatch/semantic-equal/hash-encoding-mismatch/skip-prune/skip-generation/skip-maintenance/skip-lifecycle/skip-stale-pin/skip-budget/error——readAt 重放→hash 主判→SV 互支语义兜底→compare-and-delete；mismatch=freeze 实弹面；source=worker 3002）',
  labelNames: ['result'],
  registers: [register],
});

/** 覆盖 SLO 年龄 gauge（全局 max 秒——活跃项目宇宙〔CanvasDoc.updatedAt>now−7d∧ACTIVE〕的
 *  COALESCE(cursor.lastCheckedAt, doc.updatedAt) 最老年龄；spec「last_check_age>24h 告警 P1」
 *  ——charter 覆盖 SLO「全局每小时+每活跃项目 ≤24h」的观测面）。维护面=verify worker 每 tick
 *  （boot 首 tick 先行——error 保持最后值）；THRESHOLDS P1@24h 声明+CANARY_CHECKS 操作判定。 */
export const collabCanaryLastCheckAge = new Gauge({
  name: 'collab_canary_last_check_age',
  help: 'C2-2b canary 覆盖 SLO：活跃项目最老检查年龄秒（全局 max——MIN(COALESCE(lastCheckedAt, doc.updatedAt)) 聚合无 projectId 标签；>24h=覆盖 SLO 破 P1〔排程 N=ceil(active×1.25/24)+nextDueAt 轮转〕；source=worker 3002）',
  registers: [register],
});

/** hash 编码差异计数（hash 红而 SV 互支成立——同 op 集不同编码形态，语义等不 freeze；持续增长=
 *  编码口径漂移/同钟篡改盲区观察面〔runbook §14 分诊〕——误报率观察窗的 shadow→实弹切换判据面）。 */
export const collabCanaryHashEncodingMismatchTotal = new Counter({
  name: 'collab_canary_hash_encoding_mismatch_total',
  help: 'C2-2b canary hash 编码差异计数（hash 红而 SV 互支成立=同 op 集编码序差异——语义等不 freeze；Yjs 确定性下生产罕见，持续增长=编码口径漂移信号须分诊；source=worker 3002）',
  registers: [register],
});

/** freeze 实弹计数（reason 闭集）：semantic-mismatch=mismatch→OpsGate FROZEN 落定（P0——人工解冻
 *  ack 处置）/ already-frozen=幂等重入（重复 mismatch 而行已 FROZEN）/ freeze-suppressed=shadow 观察档
 *  告警不 freeze（dev CANARY_FREEZE_ENABLED='false'）/ freeze-error=freeze 调用异常（mismatch 已
 *  告警——人工处置面）。THRESHOLDS P0 counter-delta。 */
export const collabCanaryFreezeTotal = new Counter({
  name: 'collab_canary_freeze_total',
  help: 'C2-2b canary freeze 实弹计数（reason 闭集：semantic-mismatch/already-frozen/freeze-suppressed/freeze-error——mismatch→freezeOpsGateCompact 落定；P0 人工解冻 ack〔runbook §14〕；source=worker 3002）',
  labelNames: ['reason'],
  registers: [register],
});
