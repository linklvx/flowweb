-- C3a-2（spec 2026-11-11-foundation-batch-design.md §0 水位不变量/§3.2-6）：binding 投影 schema 地基
-- （additive）——CanvasDoc 水位两列（mediaBindingSeq=连续投影前缀/bindingsDirty=脏标记）+Media.deletionState
-- （ACTIVE|DELETING，消费归 C3b-4）+ProjectionBackfillState 持久表（projectId @id 独立状态行，无 FK——
-- 项目删除清行由 scope-column.registry PROJECT_COLUMN_MODELS 批删承载）。updatedAt 自第一天即
-- timestamptz(3)（C2-1 tsz 纪律——新表不欠账）。
-- 迁移内数据回填：UPDATE "CanvasDoc" SET "bindingsDirty"=true（既有项目全置 dirty——修 0==0 假覆盖，
-- 第七轮 P0-5；新建行仍走 schema 默认 false，genesis 同事务置 dirty 归 C3a-6）。
-- 人工裁剪声明（20261020211610 media_v3 先例，本批第 9 次）：migrate dev 生成物附带的无关语句
-- DROP INDEX "pricing_rule_natural_key" 已裁（NULLS NOT DISTINCT raw 形态 Prisma diff 不可见=硬拦名单
-- CRITICAL_INDEXES 对象，绝不删除）。

-- AlterTable
ALTER TABLE "CanvasDoc" ADD COLUMN     "bindingsDirty" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mediaBindingSeq" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "deletionState" TEXT NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "ProjectionBackfillState" (
    "projectId" TEXT NOT NULL,
    "backfillEpoch" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "verifiedSeq" BIGINT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProjectionBackfillState_pkey" PRIMARY KEY ("projectId")
);

-- 数据回填：既有 CanvasDoc 行全置 dirty（迁移时点行集——之后新建行走 schema 默认 false）
UPDATE "CanvasDoc" SET "bindingsDirty" = true;

-- 域约束（Prisma 无法表达 CHECK——raw 附，MediaFact.factType 同款先例）
ALTER TABLE "Media" ADD CONSTRAINT "Media_deletionState_check" CHECK ("deletionState" IN ('ACTIVE','DELETING'));
ALTER TABLE "ProjectionBackfillState" ADD CONSTRAINT "ProjectionBackfillState_state_check" CHECK ("state" IN ('PENDING','RUNNING','DONE','FAILED'));
