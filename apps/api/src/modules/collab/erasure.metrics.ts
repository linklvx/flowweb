// apps/api/src/modules/collab/erasure.metrics.ts
// C4-c2（plan Task C4-3——生产就绪收尾批·project-erasure，spec §3 C4 P1-13）：erasure 指标面。
// *.metrics.ts 单源惯例（THRESHOLDS it1 机器断言键 ⊆ 本文件提取集——新指标落本文件非 service 模块级）。
// source=worker 3002：ProjectErasureRunPoller 仅 worker 进程装配——api 进程零注册零计数；
// check-collab-health 双端点采集消费（THRESHOLDS：erasure_pending_age P0@1h/erasure_runs_total{state=FAILED}
// P1——scripts/collab-health-thresholds.mjs）。标签纪律：全低基数禁 projectId（E54 基调）——state 标签=
// 状态机闭集（ERASURE_ACTIVE_STATES+DONE/FAILED）、stage 标签=stage 名闭集、capability=三值闭集。
import { Counter, Gauge, Histogram, register } from 'prom-client';

/** run 状态转移计数（观察面=告警消费 erasure_runs_total{state="FAILED"} 增量 P1〔毒丸 run 上界
 *  兜底后的人工分诊面〕。发码集=七态：DRAINING/PURGING_DB/PURGING_OBJECTS/PURGING_CACHE/VERIFYING
 *  活跃转移+DONE/FAILED 终态——RUNNING/WAITING_CHILDREN=claim/会合簿记无 inc（help 与发码集一致——
 *  C4-c2 评审 P3-1：闭集描述列不发码态=告警面读文案误期）。 */
export const erasureRunsTotal = new Counter({
  name: 'erasure_runs_total',
  help: 'C4 project-erasure run 状态转移计数（state 发码集七态：DRAINING/PURGING_DB/PURGING_OBJECTS/PURGING_CACHE/VERIFYING 活跃转移+DONE/FAILED 终态；RUNNING/WAITING_CHILDREN 簿记无计数；worker 3002 进程触发面——FAILED 增量=P1 告警 THRESHOLDS 消费）',
  labelNames: ['state'],
  registers: [register],
});

/** 最老非终态 run 的 requestedAt 年龄（毫秒——gauge 每 tick 重算：max(now-requestedAt) over
 * state IN active 态 ∧ dryRun=false。PENDING>1h=P0（tombstone 后无 worker 推进=擦除管道停摆
 * ——项目对用户已消失而介质残留）。 */
export const erasurePendingAge = new Gauge({
  name: 'erasure_pending_age',
  help: 'C4 project-erasure 最老非终态 run 年龄毫秒（max(now-requestedAt) over active 态∧非 dryRun——每 poller tick 重算；PENDING>1h=P0：tombstone 后无推进=擦除管道停摆〔项目对用户已消失而介质残留〕）',
  registers: [register],
});

/** 对象删除计数（DeleteObjects 请求键数——含版本化逐版本；幂等重跑对不存在键的请求也计入
 * 〔S3 语义静默成功——计数=请求面非实际删除面，观察量级用〕）。 */
export const erasureObjectsDeletedTotal = new Counter({
  name: 'erasure_objects_deleted_total',
  help: 'C4 project-erasure 对象删除请求计数（PURGING_OBJECTS DeleteObjects 键数含版本化逐版本+multipart Abort；S3 对不存在键静默成功——幂等重跑计数=请求面非实际删除面）',
  registers: [register],
});

/** stage 执行耗时（stage 闭集：DRAINING/PURGING_DB/PURGING_OBJECTS/PURGING_CACHE/VERIFYING——
 * 采集挂 finally：throw 的慢尾恰是最该被看见的样本〔retentionSweeperRunDuration 家族纪律〕）。 */
export const erasureStageDuration = new Histogram({
  name: 'erasure_stage_duration_seconds',
  help: 'C4 project-erasure stage 执行耗时秒（stage=DRAINING/PURGING_DB/PURGING_OBJECTS/PURGING_CACHE/VERIFYING 闭集——采集挂 finally，异常 stage 同观测）',
  labelNames: ['stage'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register],
});

/** capability 披露计数（capability=replication/object-lock/lifecycle 三值闭集——桶能力在位即计：
 * 诚实披露非假绿〔spec §3 C4——副本桶/锁定对象的远端保留期超出本系统权限域，runbook §13 残余披露段〕）。 */
export const erasureCapabilityDisclosureTotal = new Counter({
  name: 'erasure_capability_disclosure_total',
  help: 'C4 project-erasure capability 披露计数（capability=replication/object-lock/lifecycle——PURGING_OBJECTS detect 到规则在位即计：诚实披露非假绿，远端保留语义见 runbook §13）',
  labelNames: ['capability'],
  registers: [register],
});
