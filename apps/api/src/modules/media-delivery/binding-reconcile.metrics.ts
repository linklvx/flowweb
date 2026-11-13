// apps/api/src/modules/media-delivery/binding-reconcile.metrics.ts —— Y1a+Y1b T16
//（spec :25 裁决③/:80 Z7''/:91 Z18''）：MediaBinding current-state reconcile+media GC 观测面。
// *.metrics.ts 载面=spec §10 metric-names 块同 commit 同步（check-spec-consistency 双向核——
// code 为源，--write-metric-names 落盘先例，projection-outbox.metrics 同款）。
import { Counter, register } from 'prom-client';

/** reconcile 逐动作计数（T16 指标面：扫描行数/upsert 数/删行数/跨 team 拒+missing-media 拒）。
 *  outcome=upserted（current-state upsert 命中——含同槽位换 media 改行）/deleted（stale 清扫——
 *  doc 无引用的槽位行删除）/cross-team-rejected（Media.teamId≠project.teamId 拒+不建行——
 *  恶意/跨队 paste 面单端可见）/missing-media（doc 引用行已灭失的 mediaId 拒建——FK 防线）/
 *  scan-failed（doc 读失败〔lease/vacuum 503 等〕——本轮跳过，下轮触发重扫）。
 *  **C3a-8 退役注记**：reconcile 已只读漂移检测化（零 MediaBinding 写）——upserted/deleted/
 *  cross-team-rejected/missing-media 四 label 已退役零 producer（保留登记=dashboard/历史序列连续性）；
 *  **仅 scan-failed 保留现役**（候选扫描异常计数——见 binding-reconcile.service I-2）；漂移观测面=
 *  media_binding_drift_total。 */
export const mediaBindingReconcileOutcomeTotal = new Counter({
  name: 'media_binding_reconcile_outcome_total',
  help: 'MediaBinding reconcile 计数（C3a-8 起**仅 scan-failed 现役**——候选扫描异常；upserted/deleted/cross-team-rejected/missing-media 随写面退役保留登记；漂移观测面=media_binding_drift_total）',
  labelNames: ['outcome'],
  registers: [register],
});

/** media GC 逐动作计数（T16 指标面：GC 护栏命中/删除/对象删除失败）。
 *  outcome=deleted（软删+过 grace+引用图无引用→对象+行硬删——**无 mediaId FK**；孤儿 binding 行由
 *  只读漂移检测→置 dirty→runner rebuild 清理）/
 *  guarded（引用图命中——binding/NodeArtifact/VideoWork/VideoProject/doc 扫描任一引用真实命中）/
 *  valve-bailout（安全阀 bail-out——doc 扫描超阀/VideoProject 超阀/扫描读失败 503 族的保守
 *  保留；T19 登记收口分桶：与 guarded 区分「引用增长」vs「扫描面异常」两个 SLO 信号）/
 *  object-delete-failed（MinIO 非 404 失败——行保留待下轮，pending-upload sweep 同语义）。 */
export const mediaGcOutcomeTotal = new Counter({
  name: 'media_gc_outcome_total',
  help: 'Y1b T16：media GC 引用图判定逐动作计数（outcome=deleted/guarded/valve-bailout/object-delete-failed——guarded=引用命中，valve-bailout=安全阀 bail-out 保守保留〔超阀/读失败〕两 SLO 信号分桶）',
  labelNames: ['outcome'],
  registers: [register],
});

/** DELETING 删除中止计数（C3b-4——spec 2026-11-11 foundation-batch §3.4-5 :81：删除事务 recheck 命中
 *  任一证人→删除中止+DELETING→ACTIVE 回退+复核窗重置）。reason=两删除流闭集：media-gc（GC sweep
 *  ——引用图命中或删除事务 isMediaReferenced recheck 命中）/project-erasure（擦除两阶段复核集漂移
 *  ——首扫后新引用出现，独占候选中止回退）。 */
export const mediaDeletionConflictTotal = new Counter({
  name: 'media_deletion_conflict_total',
  help: 'C3b-4：DELETING 删除中止计数（reason=media-gc/project-erasure——recheck 命中任一证人→中止回 ACTIVE+复核窗重置；spec §3.4-5）',
  labelNames: ['reason'],
  registers: [register],
});
