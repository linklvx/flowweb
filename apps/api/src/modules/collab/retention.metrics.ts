// apps/api/src/modules/collab/retention.metrics.ts
// C1-1（plan Task C1-1——生产就绪收尾批，spec v5 §6.1/§7）：retention sweeper 指标面。
// *.metrics.ts 单源惯例（THRESHOLDS it1 机器断言键 ⊆ 本文件提取集——新指标落本文件非 service 模块级）。
// source=worker 3002：RetentionSweeperPoller 仅 worker 进程装配（worker.module 平铺）——api 进程
// 零注册零计数；check-collab-health 双端点采集消费（P1/P0 分诊）。标签纪律：全低基数禁 projectId
// （E54 基调——病态归 top-N 结构化日志），table 标签=固定两值闭集（execution_input/runtime_event）。
import { Counter, Gauge, Histogram, register } from 'prom-client';

/** tick 结果计数（result 低基数闭集）：ok=四扫面全面完成 / skip-singleflight=advisory 单飞让位
 *  （红④ 第二实例 skip——同事务内第二取锁者必然失败）/ skip-backoff=连续失败退避窗内跳过 / error=tick 异常。 */
export const retentionSweeperTickTotal = new Counter({
  name: 'retention_sweeper_tick_total',
  help: 'C1 retention sweeper tick 结果计数（result=ok 全面完成/skip-singleflight advisory 单飞让位/skip-backoff 连续失败退避/error tick 异常——worker 3002 进程触发面）',
  labelNames: ['result'],
  registers: [register],
});

/** 删除行数（table=execution_input 过期∧终态输入/runtime_event 保留期外事件——红①判别双档+红⑦
 *  事件面；计数点=tick 事务提交后——tx 回滚不虚计）。 */
export const retentionDeletedRowsTotal = new Counter({
  name: 'retention_deleted_rows_total',
  help: 'C1 retention 删除行数（table=execution_input 过期∧父行终态输入/runtime_event 保留期外事件——计数挂 tick 提交后，回滚不虚计；projectId 禁入标签〔E54 基调〕）',
  labelNames: ['table'],
  registers: [register],
});

/** 扫面积压行数（gauge——按需 count：request 面 claim 满批/input·event 两 loop-to-empty 面 cap 出口
 *  （P0#1 每 tick 批数上界）⇒ 积压可能未尽，count 回填真实余量；cap 未触=正常排空=归零（每 tick
 *  部分进度提交、跨 tick 单调排空）。观测 THRESHOLDS gauge-max 消费——持续高位=排空链异常）。 */
export const retentionBacklogRows = new Gauge({
  name: 'retention_backlog_rows',
  help: 'C1 retention 扫面积压行数（table=execution_request 过期未执行待 void 批——claim 满批时按需 count 回填/execution_input 过期∧终态批删残余/runtime_event 保留期外事件残余——两面 cap 出口按需 count 回填，≤批界/tick 部分进度跨 tick 单调排空；持续高位=排空链异常信号）',
  labelNames: ['table'],
  registers: [register],
});

/** stuck 请求计数（红②——告警不删：stuck 口径=request 侧 expiresAt 15min/deadlineAt，
 *  非 input 侧 30d〔input 只按终态过滤〕；state=ADMITTED 过期未 claim/EXECUTING 过 GenerationIntent
 *  MIN(deadlineAt)/EXECUTING_ORPHAN=EXECUTING∧无 RUNNING intent（P1#2 孤儿档——intent 全终态后
 *  收口链中断的观测盲区补全）——资金在飞收口链滞留信号）。 */
export const retentionStuckRequestsTotal = new Counter({
  name: 'retention_stuck_requests_total',
  help: 'C1（红②）stuck 请求计数（state=ADMITTED 过期未 claim/EXECUTING 过 GenerationIntent deadline/EXECUTING_ORPHAN 无 RUNNING intent 孤儿——告警不删；stuck 口径=request 侧 expiresAt 15min/deadlineAt 非 input 侧 30d）',
  labelNames: ['state'],
  registers: [register],
});

/** 过期未执行请求 void 收口数（红⑤ claim 批内 CAS 命中数——让位/已终态幂等零动作不计）。 */
export const retentionVoidTotal = new Counter({
  name: 'retention_void_total',
  help: 'C1 过期未执行请求 void 收口数（sweeper CAS ADMITTED→VOIDED 同事务逐 item release——幂等让位零动作不计；计数挂 tick 提交后）',
  registers: [register],
});

/** 单 tick 全扫面耗时（采集挂 finally——throw 的慢尾恰是最该被看见的样本，家族纪律同
 *  docCompactionDuration）。 */
export const retentionSweeperRunDuration = new Histogram({
  name: 'retention_sweeper_run_duration_seconds',
  help: 'C1 retention sweeper 单 tick 全扫面耗时秒（advisory 单飞事务内四扫面：stuck 计数/request claim+void/input 批删/event 批删——采集挂 finally，异常 tick 同观测）',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register],
});

/** RuntimeEvent payload 存储字节全局 Σ（spec §7 runtime_feed_bytes——C1-1 形态迁移：原 per-project
 *  gauge 每轮 SUM(octet_length) 全表扫废止；改**计数器维护**=worker boot 基线 SUM 一次+删除批
 *  RETURNING octet_length 累减（RuntimeFeedRetentionService）。projectId 标签删除（E54 基调：
 *  标签基数随项目数无界——病态项目归 top-N 结构化日志）——retention spec 断言零 projectId 标签。
 *  漂移注记：boot 基线后 api 新写入不计数（gauge 低估——容量观测安全方向），worker 重启重播种。 */
export const runtimeFeedBytes = new Gauge({
  name: 'runtime_feed_bytes',
  help: 'RuntimeEvent payload 存储字节全局 Σ（C1 计数器维护：worker boot 基线一次+删除批 RETURNING 累减——每轮 SUM 全表扫废止；无 projectId 标签——病态归 top-N 结构化日志；boot 后新写入低估方向，重启重播种）',
  registers: [register],
});