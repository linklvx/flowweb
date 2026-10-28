// apps/api/src/modules/collab/collab-maintenance.metrics.ts
// Y1c T27（spec §6.6）：维护窗口状态机观测——REQUESTED 结果/4413·4410 完整投递/stage 推进。
// 新增 metric 走 spec §10 metric-names 锚表（check-spec-consistency --write-metric-names 单向落盘）。
import { Counter } from 'prom-client';

/** REQUESTED 结果（source=rest|cli|vacuum；result=ok|maintenance-active|in-flight|project-not-found） */
export const collabMaintenanceRequestedTotal = new Counter({
  name: 'collab_maintenance_requested_total',
  help: 'Y1c T27 维护 REQUESTED 结果（行级关闸写入面）',
  labelNames: ['source', 'result'] as const,
});

/** freeze/换代 close 完整投递（附言①：stateless 载荷+hardClose 两段——4413 maintenance-freeze/4410 doc-vacuuming） */
export const collabMaintenanceCloseTotal = new Counter({
  name: 'collab_maintenance_close_total',
  help: 'Y1c T27 维护窗口连接 close 完整投递（码权威——禁半投递）',
  labelNames: ['code'] as const,
});

/** stage 推进（to=11 值态；result=ok|cas-miss）——幂等续跑（重启从 PG stage 继续）可观测面 */
export const collabMaintenanceStageAdvanceTotal = new Counter({
  name: 'collab_maintenance_stage_advance_total',
  help: 'Y1c T27 维护状态机 stage CAS 推进',
  labelNames: ['to', 'result'] as const,
});
