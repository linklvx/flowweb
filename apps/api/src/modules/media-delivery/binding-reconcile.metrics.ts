// apps/api/src/modules/media-delivery/binding-reconcile.metrics.ts —— Y1a+Y1b T16
//（spec :25 裁决③/:80 Z7''/:91 Z18''）：MediaBinding current-state reconcile+media GC 观测面。
// *.metrics.ts 载面=spec §10 metric-names 块同 commit 同步（check-spec-consistency 双向核——
// code 为源，--write-metric-names 落盘先例，projection-outbox.metrics 同款）。
import { Counter, register } from 'prom-client';

/** reconcile 逐动作计数（T16 指标面：扫描行数/upsert 数/删行数/跨 team 拒+missing-media 拒）。
 *  outcome=upserted（current-state upsert 命中——含同槽位换 media 改行）/deleted（stale 清扫——
 *  doc 无引用的槽位行删除）/cross-team-rejected（Media.teamId≠project.teamId 拒+不建行——
 *  恶意/跨队 paste 面单端可见）/missing-media（doc 引用行已灭失的 mediaId 拒建——FK 防线）/
 *  scan-failed（doc 读失败〔lease/vacuum 503 等〕——本轮跳过，下轮触发重扫）。 */
export const mediaBindingReconcileOutcomeTotal = new Counter({
  name: 'media_binding_reconcile_outcome_total',
  help: 'Y1b T16：MediaBinding current-state reconcile 逐动作计数（outcome=upserted/deleted/cross-team-rejected/missing-media/scan-failed——spec 裁决③ 惰性 reconcile 观测面）',
  labelNames: ['outcome'],
  registers: [register],
});

/** media GC 逐动作计数（T16 指标面：GC 护栏命中/删除/对象删除失败）。
 *  outcome=deleted（软删+过 grace+引用图无引用→对象+行硬删——行删除级联 MediaBinding）/
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
