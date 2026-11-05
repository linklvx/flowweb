// apps/api/src/modules/collab/collab-canary.metrics.ts
// C2-2a（plan Task C2-2 捕获侧——生产就绪收尾批，spec v5 §3 C2）：replay canary 指标面。
// *.metrics.ts 单源惯例（THRESHOLDS it1 机器断言键 ⊆ 本文件提取集——新指标落本文件非 service 模块级）。
// source=api 3000：CollabReplayCanaryPoller 仅 api 进程装配（collab.module——role api|all）——捕获
// 面（withFrozenPrefix 冻结读）只存在于持活 doc 的 api 进程；worker 3002 无此族（C2-2b worker verify
// 面指标另族登记）。标签纪律：全低基数禁 projectId（E54 基调）；result=闭集词表。
import { Counter, Histogram, register } from 'prom-client';

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
 *  （lease 未持有不触 withFrozenPrefix）/ skip-lifecycle=lifecycleState!='ACTIVE' / skip-maintenance=
 *  维护窗（CanvasDoc.maintenanceId 在∨进程内 freeze 面）/ skip-pin-active=同 pid 未过期 pin 在场
 *  （worker verify 承接不重复捕获）/ skip-no-doc=活 doc 不在（withFrozenPrefix no-doc 档）/ skip-freeze=
 *  冻结临界区拒（gate-timeout/flush-timeout——调用方回退 PG 重建档，下轮再试）/ error=tick 异常。 */
export const collabCanaryPollTickTotal = new Counter({
  name: 'collab_canary_poll_tick_total',
  help: 'C2-2 canary poller tick 结果计数（result 闭集：captured/captured-hash-skipped/capture-failed/skip-not-serving/skip-lifecycle/skip-maintenance/skip-pin-active/skip-no-doc/skip-freeze/error——api 进程轮转捕获面；source=api 3000）',
  labelNames: ['result'],
  registers: [register],
});
