// apps/api/src/modules/worker-presence/worker-presence.metrics.ts
// Y0c T29-II（Z130①/Z148②）：worker 缺席拒绝计数——*.metrics.ts 单源惯例（THRESHOLDS it1 机器
// 断言键 ⊆ collectMetricFiles 提取集，故落 metrics 文件而非 service 模块级）。role 标签由引导层
// setDefaultLabels 附带（Z138——模块级禁 setDefaultLabels，注册指标合规）。
import { Counter, register } from 'prom-client';

export const collabWorkerAbsentTotal = new Counter({
  name: 'collab_worker_absent_total',
  help: '付费队列 enqueue fail-closed 拒绝计数（Z148②：getWorkers registered=0 ⇒ 503 WORKER_ABSENT；唯一生产者=WorkerPresenceService.assertAdmittable 拒绝路径；health 以 counter-delta 消费）',
  labelNames: ['queue'],
  registers: [register],
});
