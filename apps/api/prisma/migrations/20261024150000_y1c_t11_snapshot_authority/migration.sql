-- Y1c T11（plan Task 11——快照发布+compact+WAL 清理 / T7 勘误切片三既定）：快照权威切换。
-- CanvasDoc.state/stateSeq 列退役：doc 态权威=CanvasDocSnapshot+currentSnapshotRev 指针
-- （T7 已落表+genesis 写 Snapshot(g,0,0)；T11 起 hydration 装载=快照+增量尾(>stateSeq)、
-- compact 重写为 PG 前缀重放+发布事务、genesis 头行改纯新形态零 doc 态列）。
-- 破坏性变更照 T9 先例 EXEMPTIONS 登记（check-migration-additive.mjs）——dev 无存量数据。
-- preVacuumSv 列退役归 T12（本批勿动）。
-- prisma migrate diff 产物附带的无关 DROP INDEX "pricing_rule_natural_key" 已人工裁剪
-- （T7/T9 同款纪律——CRITICAL_INDEXES 硬拦名单，diff 双盲，与 migrate-diff-allowlist.txt 唯一永久豁免同源）。

-- AlterTable
ALTER TABLE "CanvasDoc" DROP COLUMN "state",
DROP COLUMN "stateSeq";
