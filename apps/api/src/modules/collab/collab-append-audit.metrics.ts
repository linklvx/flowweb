// apps/api/src/modules/collab/collab-append-audit.metrics.ts
// C3-1（plan Task C3-1——doc-append-gap-alert 生产就绪收尾批）：append 审计 worker 指标面。
// *.metrics.ts 单源惯例（THRESHOLDS it1 机器断言键 ⊆ 本文件提取集——新指标落本文件非 worker 模块级）。
// source=worker 3002：CollabAppendAuditWorker 仅 worker 进程装配（worker.module 平铺）——api 进程零注册
// 零计数；check-collab-health 双端点采集消费（3002 审计族 P0/P1 分诊——runbook §6）。
// 标签纪律：全低基数禁 projectId（E54 基调——病态归 top-N 结构化日志）；result=闭集词表。
import { Counter, Gauge, register } from 'prom-client';

/** tick 结果计数（result 闭集）：ok=批审计完成 / skip-singleflight=advisory 单飞让位（双 worker 第二
 *  实例）/ skip-no-doc=项目无 CanvasDoc 行（红③ skip 面——无审计域）/ skip-inactive=lifecycleState!='ACTIVE'
 *  （红③ skip 面——擦除/删除中项目零触碰假阳性根除）/ error=tick 异常。 */
export const collabAppendAuditTickTotal = new Counter({
  name: 'collab_append_audit_tick_total',
  help: 'C3 append 审计 tick 计数（result=ok 批审计完成/skip-singleflight advisory 单飞让位/skip-no-doc 项目无 CanvasDoc/skip-inactive lifecycleState 非 ACTIVE/error tick 异常——worker 3002 进程触发面）',
  labelNames: ['result'],
  registers: [register],
});

/** 新 gap 边沿计数（charter doc-append-gap-alert：increase(doc_append_gap_total[5m])>0——0 丢失口径，P0）。
 *  仅 (project,generation) gapActive false→true 边沿 inc（CollabJobCursor.lastGap 持久态对比——持续 gap
 *  不每 tick 重发、worker 重启不重基线〔持久边沿判重〕）；配套 collab_doc_append_gap_current=当前存量。 */
export const docAppendGapTotal = new Counter({
  name: 'doc_append_gap_total',
  help: 'C3 append 审计新 gap 边沿计数（(project,generation) false→true 才 inc——lastGap 持久边沿判重；增量>0=行集断链三断言违例且 CanvasDocCoalesced 无覆盖=装载尾静默丢数据前兆，P0 0 丢失口径）',
  registers: [register],
});

/** 当前在 gap (project,generation) 对数 gauge（每 tick 重算——lastGap 持久态全域合并计数，跨批旋转累计）。
 *  新 gap 已由 counter 边沿计过——本 gauge 是「悬而未决」观测面（0=全修复/无 gap）。 */
export const collabDocAppendGapCurrent = new Gauge({
  name: 'collab_doc_append_gap_current',
  help: 'C3 append 审计当前在 gap (project,generation) 对数（每 tick 重算自 CollabJobCursor.lastGap 持久态——跨批旋转全域计数；持续>0=悬而未决断链〔counter 已边沿计过〕，修复后回落 0）',
  registers: [register],
});

/** purge 义务年龄告警边沿计数（红②——purgeBelowSeq 持续非空>阈值：compact resumePurges 收敛链卡死的
 *  独立告警通道，不被审计三断言吞掉；lastGap purgeSince 持久年龄窗 false→true 边沿 inc，衰减/修复不复发）。 */
export const collabAppendAuditPurgeStaleTotal = new Counter({
  name: 'collab_append_audit_purge_stale_total',
  help: 'C3 append 审计 purge 义务年龄告警（purgeBelowSeq 持续非空>30min 边沿计数——compact 清理义务卡死的独立告警非审计吞没；lastGap purgeSince 持久窗，修复/衰减即不重发）',
  registers: [register],
});

/** 末次完成审计 tick 的 unix 秒（红⑥ worker 停跑样本年龄判定面：巡检侧 now−本值>阈值 ⇒ P0——worker
 *  进程活〔3002 可达〕而审计 tick 死的半死面；进程死=worker-metrics-unreachable P0 既有承担。样本冻结=
 *  年龄增长由巡检侧判定，worker 自身无法自证。完成 tick（ok/skip）即推进；error tick 不推进——连续失败
 *  自然升龄告警）。 */
export const collabAppendAuditLastRunUnixSeconds = new Gauge({
  name: 'collab_append_audit_last_run_unix_seconds',
  help: 'C3 append 审计末次完成 tick unix 秒（巡检样本年龄判定：now−值>15min=审计链停跑 P0；ok/skip 完成 tick 推进、error 不推进——连续失败自然升龄）',
  registers: [register],
});