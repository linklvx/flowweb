// apps/api/src/modules/collab/oracle-worker.metrics.ts
// C3b-2（plan v3 Task C3b-2——spec 2026-11-11-foundation-batch-design.md §3.4-3/§3.5 指标面
// 「oracle coverage_ratio+scan_age——低基数」）：PG oracle 证人观测面两 gauge（无 label——
// 禁逐项目标签，单实例 ADR 前提）：
//   · coverage_ratio：ACTIVE 项目宇宙内 `header.status='COMPLETE' ∧ verifiedSeq==pgSeq` 占比
//     （coverage 只认 COMPLETE∧verifiedSeq===决策时 pgSeq——spec §3.4-2；空宇宙=1 真空完备）。
//   · scan_age_seconds：最老扫描年龄（COALESCE(scannedAt, CanvasDoc.updatedAt) 起算——未扫项目
//     以 doc.updatedAt 起算不虚高，collab_canary_last_check_age 同族口径）。
import { Gauge, register } from 'prom-client';

/** oracle coverage 占比（每 tick 末刷新——refreshMetrics 失败保持最后值）。 */
export const oracleCoverageRatio = new Gauge({
  name: 'oracle_coverage_ratio',
  help: 'CanvasReferenceOracleScan coverage 占比（ACTIVE 项目宇宙内 status=COMPLETE ∧ verifiedSeq==pgSeq——coverage 只认 COMPLETE 且水位对齐决策时 pgSeq；空宇宙=1）',
  registers: [register],
});

/** 最老扫描年龄秒（COALESCE(scannedAt, doc.updatedAt) 起算——never-scanned 项目以 doc.updatedAt 不虚高）。 */
export const oracleScanAgeSeconds = new Gauge({
  name: 'oracle_scan_age_seconds',
  help: 'oracle 最老扫描年龄秒（ACTIVE 宇宙 MIN(COALESCE(scan.scannedAt, doc.updatedAt)) 距 now——staleness 观测，canary last_check_age 同族口径）',
  registers: [register],
});
