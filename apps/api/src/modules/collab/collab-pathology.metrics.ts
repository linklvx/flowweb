// apps/api/src/modules/collab/collab-pathology.metrics.ts
// T18（plan v11.2 S5 片·spec Z4''-v14）：order 域病理计数指标面——装载档扫描命中计数
// （kind=ORDER_PATHOLOGY_KINDS 四值：duplicate-key/soft-key/hard-key/missing-key）。
// 计数口径=doc 级（每次装载各命中档至多 +1；成员数在结构化日志——与 yjs_doc_bytes 的
// E54 基调一致：直方图/计数不带 projectId 标签，「哪个 doc 病态」由日志承担）。
import { Counter } from 'prom-client';
import { register } from 'prom-client';

export const collabOrderPathologyTotal = new Counter({
  name: 'collab_order_pathology_total',
  help: 'order 域病理装载档计数（kind=duplicate-key|soft-key|hard-key|missing-key——Z4\'\'-v14：读序容忍+计数告警，修复归 CLI renumber-layer 离线维护窗）',
  labelNames: ['kind'],
  registers: [register],
});
