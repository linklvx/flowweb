// apps/api/src/modules/collab/deletion-barrier.metrics.ts
// C3b-4a（plan v3 Task C3b-4a——spec 2026-11-11-foundation-batch-design.md §3.4-4 :79 观测面）：
// DeletionBarrier 持久 fence 观测 gauge（无 label——禁逐 team 标签，单实例 ADR 前提；oracle-worker.metrics
// 同族体例）。
//   · deletion_barrier_active_seconds：最近一次 barrier 持有时长（acquire→release/bail-out 距秒——
//     release 单点置值；spec :79「deletion_barrier_active_seconds 观测」——barrier 总预算 10s 的
//     实际占用面，常态应远小于预算；超预算逼近=删除窗内长扫描/慢 flush 的分诊锚）。
import { Gauge, register } from 'prom-client';

/** 最近一次 barrier 持有时长秒（release/bail-out 置值——单测/运维面读 prom registry）。 */
export const deletionBarrierActiveSeconds = new Gauge({
  name: 'deletion_barrier_active_seconds',
  help: 'DeletionBarrier 最近一次持有时长秒（acquire→release；barrier 总预算 10s 的实际占用面——逼近预算=删除窗内长扫描/慢 flush 分诊锚）',
  registers: [register],
});
