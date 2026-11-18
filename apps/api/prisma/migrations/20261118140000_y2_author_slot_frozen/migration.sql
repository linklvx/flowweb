-- Y2 B1（裁决 16/v6 段序钉死）：冻结两列迁移。
-- 段序是唯一正确性载体：v5「②回填先于④加列」=UPDATE 引用不存在列语句级报错；「守卫命中改走②回填」
-- 两读皆死（宽读=RUNNING 行回填空冻结值、完成时现场非空≠冻结 null 被作废核销；窄读=守卫行三列恒 NULL
-- 致 SET NOT NULL 失败）——故 DELETE 先行（非终态整删=回填覆盖全部余行的前置）。
-- 开发测试档无用户画布（裁决）：非终态行（RUNNING/FAILED/UNKNOWN）与悬空 plan 行整删。

-- ① DELETE 先行——四类死行按依赖序（引用者先于被引用者）
-- ①a RefundObligation：intentRowId 指向非终态者（终态行退款义务保留）
DELETE FROM "RefundObligation"
WHERE "intentRowId" IN (
  SELECT "id" FROM "GenerationIntent" WHERE "status" NOT IN ('SUCCEEDED', 'VOIDED'));
-- ①b 悬空 plan 行：IS NULL/指向将删/指向已删三类一谓词覆盖（现库 288=225 NULL+63 指向已删——
-- GenerationIntent 0 行时 IN 存活终态集空集 ⇒ NOT IN 空集恒真删到后 63）
DELETE FROM "ExecutionNodePlan"
WHERE "generationIntentId" IS NULL
   OR "generationIntentId" NOT IN (
     SELECT "id" FROM "GenerationIntent" WHERE "status" IN ('SUCCEEDED', 'VOIDED'));
-- ①c 置空 Media 锚列：sourceIntentRowId/sourceExecSeq 指向非终态者（有 artifact 的终态意图锚保留）
UPDATE "Media" SET "sourceIntentRowId" = NULL, "sourceExecSeq" = NULL
WHERE "sourceIntentRowId" IN (
  SELECT "id" FROM "GenerationIntent" WHERE "status" NOT IN ('SUCCEEDED', 'VOIDED'));
-- ①d 非终态 GenerationIntent 整删（未冲销 reserve 由既有 releaseOrphanedReserves 15min 收敛）
DELETE FROM "GenerationIntent"
WHERE "status" NOT IN ('SUCCEEDED', 'VOIDED');

-- ② ADD COLUMN——frozen/authorMediaId 可空；released NOT NULL DEFAULT false 直加（无回填依赖）
ALTER TABLE "GenerationIntent" ADD COLUMN "authorSlotFrozen" BOOLEAN;
ALTER TABLE "GenerationIntent" ADD COLUMN "authorMediaId" TEXT;
ALTER TABLE "GenerationIntent" ADD COLUMN "authorSlotReleased" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ExecutionNodePlan" ADD COLUMN "authorSlotFrozen" BOOLEAN;
ALTER TABLE "ExecutionNodePlan" ADD COLUMN "authorMediaId" TEXT;

-- ③ 回填——①后全部余行：终态意图（null 冻结值无删除能力+released=true 精确排除扫描）+余留 plan 行
--（指向存活终态者）
UPDATE "GenerationIntent"
SET "authorSlotFrozen" = true, "authorMediaId" = NULL, "authorSlotReleased" = true
WHERE "status" IN ('SUCCEEDED', 'VOIDED');
UPDATE "ExecutionNodePlan" SET "authorSlotFrozen" = true, "authorMediaId" = NULL;

-- ④ SET NOT NULL 仅 frozen 两表（枚举恰五值删三留二=回填覆盖全部余行；released 已②段直加）
ALTER TABLE "GenerationIntent" ALTER COLUMN "authorSlotFrozen" SET NOT NULL;
ALTER TABLE "ExecutionNodePlan" ALTER COLUMN "authorSlotFrozen" SET NOT NULL;

-- ⑤ 部分索引（migration-SQL-only——同表三先例；四标量谓词：text 永不释放死行不进索引）
CREATE INDEX "GenerationIntent_release_pending_idx" ON "GenerationIntent"("completedAt")
WHERE "status" = 'SUCCEEDED' AND "authorSlotFrozen" AND NOT "authorSlotReleased"
  AND "kind" IN ('video', 'image', 'outpaint', 'erase', 'redraw', 'lighting');
