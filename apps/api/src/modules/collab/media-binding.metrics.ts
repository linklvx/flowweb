// apps/api/src/modules/collab/media-binding.metrics.ts
// C3a-8（plan v3 Task C3a-8——spec 2026-11-11-foundation-batch-design.md §3.2-7 指标清单）：
// MediaBinding 投影/回填/漂移观测面。语义钉死（低基数——禁逐项目标签；单实例 ADR 前提）：
//   · write_total{source}：**成功提交后的行写计数**——source='append'（帧级投影 RELEASE 成功后）
//     /'rebuild'（全量 rebuild 每页短事务提交后）；**rollback 不计数**（计数点=tx 成功返回后）。
//   · skip_total{reason}：投影成功的槽位准入跳过（reason=missing|cross-team|soft-deleted——与
//     projector 预检序单源；失败回滚批次不计数）。
//   · projection_failed_total{reason}：投影闭包失败（reason=typed〔BindingProjectionFailedError〕/
//     unexpected（帧级闭包非 typed 异常）/rebuild-page（rebuild 分页事务失败）——闭集短标签）。
//   · gap_seq（gauge）：**首现 gap 序号**语义——实时帧批（CAS 形态）投影未覆盖且帧水位已推进时，
//     记该批 newPgSeq；仅当 gauge 为 0 时写入（首现）；rebuild CAS 清 dirty 时归 0（gap 闭合）。
//     catch-up 形（expectedPgSeq=null——replayAll 恒不覆盖）不观测（其覆盖由 dirty+rebuild 承载）。
//   · watermark_lag（gauge）：pgSeq−mediaBindingSeq——appendBatch 落定（① RETURNING 实读+② 覆盖
//     判定）/rebuild 清 dirty/backfill 候选观测点更新；全局 gauge=最后观测项目（单实例前提——
//     逐项目分诊=结构化日志+ProjectionBackfillState 行）。
//   · backfill_remaining（gauge）：候选枚举剩余数（`bindingsDirty ∨ mediaBindingSeq<pgSeq`）。
//   · drift_total{kind}：只读 reconcile 漂移检测（kind=missing|extra|mismatch——reconcile 只置
//     dirty+入队，修复唯一路径=rebuild）。
//   · binding_delta_bytes 直方图已存在（store.metrics.ts——C3a-3），本文件不重复定义。
import { Counter, Gauge, register } from 'prom-client';
import type { ProjectionStats } from './media-binding-projector';

/** 投影行写计数（source=append 帧级投影/rebuild 全量 rebuild——提交成功后才计数）。 */
export const mediaBindingWriteTotal = new Counter({
  name: 'media_binding_write_total',
  help: 'MediaBinding 行写计数（source=append 帧级投影 RELEASE 成功/rebuild 每页短事务成功后——rollback 不计数）',
  labelNames: ['source'],
  registers: [register],
});

/** 投影槽位准入跳过计数（reason=missing|cross-team|soft-deleted——projector 预检序单源）。 */
export const mediaBindingSkipTotal = new Counter({
  name: 'media_binding_skip_total',
  help: 'MediaBinding 投影槽位准入跳过（reason=missing 行灭失/cross-team 跨队/soft-deleted 软删——投影成功后按 projector 返回计数，失败回滚不计数）',
  labelNames: ['reason'],
  registers: [register],
});

/** 投影失败计数（reason=typed|unexpected|rebuild-page——闭集短标签；帧照常提交由闭包承接）。 */
export const mediaBindingProjectionFailedTotal = new Counter({
  name: 'media_binding_projection_failed_total',
  help: 'MediaBinding 投影失败（reason=typed BindingProjectionFailedError/unexpected 帧级闭包非 typed/rebuild-page rebuild 分页事务失败）',
  labelNames: ['reason'],
  registers: [register],
});

/** 首现 gap 序号（投影失败致覆盖中断的 newPgSeq；0=无 gap——rebuild 清 dirty 时归零）。 */
export const mediaBindingGapSeq = new Gauge({
  name: 'media_binding_gap_seq',
  help: '首现 gap 的 newPgSeq（实时帧批投影未覆盖且帧水位推进——仅 gauge=0 时写入；rebuild CAS 清 dirty 归 0；catch-up 形不观测）',
  registers: [register],
});

/** 首现 gap 进程内标志（Gauge.get() 在 prom-client 15 返回 Promise——同步观测点经本状态判 0）。 */
let gapSeqObserved = 0;
/** 首现 gap 写入（仅在未有未闭合 gap 时记录——"首现"语义；rebuild clear 时归零可再记）。 */
export function observeMediaBindingGap(newPgSeq: bigint): void {
  if (gapSeqObserved !== 0) return;
  gapSeqObserved = Number(newPgSeq);
  mediaBindingGapSeq.set(gapSeqObserved);
}
/** gap 闭合（rebuild CAS 清 dirty 时调——归零后下一次失败可再记首现）。 */
export function clearMediaBindingGap(): void {
  gapSeqObserved = 0;
  mediaBindingGapSeq.set(0);
}

/** 水位 lag（pgSeq−mediaBindingSeq——appendBatch/rebuild/backfill 观测点更新，全局=最后观测项目）。 */
export const mediaBindingWatermarkLag = new Gauge({
  name: 'media_binding_watermark_lag',
  help: 'pgSeq−mediaBindingSeq 水位 lag（appendBatch 落定/rebuild 清 dirty/backfill 候选观测点更新——低基数全局 gauge=最后观测项目，逐项目分诊见结构化日志+ProjectionBackfillState）',
  registers: [register],
});

/** backfill 候选剩余数（`bindingsDirty ∨ mediaBindingSeq<pgSeq` 全表计数——每枚举拍更新）。 */
export const mediaBindingBackfillRemaining = new Gauge({
  name: 'media_binding_backfill_remaining',
  help: 'ProjectionBackfill 候选剩余数（CanvasDoc 全表 bindingsDirty=true 或 mediaBindingSeq<pgSeq 计数——每枚举拍更新）',
  registers: [register],
});

/** 只读 reconcile 漂移计数（kind=missing|extra|mismatch——修复唯一路径=置 dirty+rebuild）。 */
export const mediaBindingDriftTotal = new Counter({
  name: 'media_binding_drift_total',
  help: 'MediaBinding 只读漂移检测（kind=missing doc 引用缺行/extra 行无 doc 引用/mismatch 同槽异 mediaId——reconcile 只置 dirty+入队 rebuild）',
  labelNames: ['kind'],
  registers: [register],
});

/** 投影统计落地（append/rebuild 成功后统一计数——失败回滚路径禁调）。 */
export function recordMediaBindingProjection(source: 'append' | 'rebuild', stats: ProjectionStats): void {
  if (stats.written > 0) mediaBindingWriteTotal.inc({ source }, stats.written);
  if (stats.skipped.missing > 0) mediaBindingSkipTotal.inc({ reason: 'missing' }, stats.skipped.missing);
  if (stats.skipped['cross-team'] > 0) mediaBindingSkipTotal.inc({ reason: 'cross-team' }, stats.skipped['cross-team']);
  if (stats.skipped['soft-deleted'] > 0) mediaBindingSkipTotal.inc({ reason: 'soft-deleted' }, stats.skipped['soft-deleted']);
}
