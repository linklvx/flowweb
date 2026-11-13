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

/** shadow 对拍差集计数（C3b-5——spec §3.4-8 :84「抽样长期对拍」：两决策面在 barrier ACTIVE 持有窗内
 *  求值〔同快照——appendBatch 封帧=pgSeq/epoch 冻结，第六轮 P1-7 防假 mismatch〕）。新面=registry∪Oracle
 *  证人面（Binding 臂除外——两面共有投影证人，纳入即互掩：stale binding 永不显形）。
 *  consumer=media-gc|project-erasure（两删除流闭集）；dir=missing（新面独有证人=旧面漏保护向——决策面
 *  〔并集单源〕已阻断保留）/extra（旧面独有=stale binding 过度保留向——告警+触发受控 rebuild 清理，
 *  修「stale binding 永久过度保留」）。低基数：consumer×dir 四系列。 */
export const mediaRefShadowMismatchTotal = new Counter({
  name: 'media_ref_shadow_mismatch_total',
  help: 'C3b-5：shadow 对拍差集（consumer=media-gc/project-erasure；dir=missing=新面独有证人漏保护向〔阻断保留〕/extra=旧面独有 stale binding 过度保留向〔告警+受控 rebuild〕；spec §3.4-8——同 barrier 窗同快照对拍）',
  labelNames: ['consumer', 'dir'],
  registers: [register],
});

/** stale binding 计数（C3b-5——spec §3.4-8 :84：shadow extra 处置=受控 rebuild 的发现面——对拍发现的
 *  stale binding 行数〔doc 已无引用但 MediaBinding 行在〕；rebuild 后行随全量替换清出，持续增长=投影
 *  漂移信号〔binding-rebuild CAS miss/收敛失败分诊锚〕）。 */
export const mediaBindingStaleTotal = new Counter({
  name: 'media_binding_stale_total',
  help: 'C3b-5：shadow extra 处置发现的 stale binding 行计数（doc 无引用但 MediaBinding 行在——受控 rebuild 清理面；持续增长=投影漂移分诊锚；spec §3.4-8）',
  registers: [register],
});

/** shadow 对拍预算跳过计数（C3b-5 质量评审 Important-1：对拍=观测面不得挤占删除窗——窗内剩余预算
 *  低于地板〔MEDIA_REF_SHADOW_MIN_BUDGET_MS〕即跳过本轮对拍，决策/删除照常推进）。consumer=
 *  media-gc|project-erasure（两删除流闭集）。持续增长=中大团队对拍成本常态超预算形态（对拍实际
 *  采样化=后续优化项）——与 valve-bailout 分桶（valve=保留/中止档；skip=删除照常档）。 */
export const mediaRefShadowSkipTotal = new Counter({
  name: 'media_ref_shadow_skip_total',
  help: 'C3b-5：shadow 对拍预算门控跳过计数（consumer=media-gc/project-erasure——窗内剩余预算低于地板跳过本轮对拍，决策/删除照常；持续增长=对拍成本超预算/团队规模分诊锚）',
  labelNames: ['consumer'],
  registers: [register],
});
