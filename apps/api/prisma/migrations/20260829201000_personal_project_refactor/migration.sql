-- AlterEnum
BEGIN;
CREATE TYPE "TeamCreditTransactionType_new" AS ENUM ('recharge', 'subscription_grant', 'consumption', 'expire_clear', 'register_grant', 'upgrade_clear', 'admin_grant', 'admin_clear');
ALTER TABLE "TeamCreditTransaction" ALTER COLUMN "type" TYPE "TeamCreditTransactionType_new" USING ("type"::text::"TeamCreditTransactionType_new");
ALTER TYPE "TeamCreditTransactionType" RENAME TO "TeamCreditTransactionType_old";
ALTER TYPE "TeamCreditTransactionType_new" RENAME TO "TeamCreditTransactionType";
DROP TYPE "TeamCreditTransactionType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "TeamSubscription" DROP CONSTRAINT "TeamSubscription_teamId_fkey";

-- DropIndex
DROP INDEX "Folder_userId_parentId_idx";

-- DropIndex
DROP INDEX "MaterialFolder_userId_parentId_idx";

-- DropIndex
DROP INDEX "TeamSubscription_teamId_key";

-- AlterTable
ALTER TABLE "Folder" ADD COLUMN     "teamId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "LightingTask" ADD COLUMN     "teamId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "MaterialFolder" ADD COLUMN     "teamId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN     "storageLimitBytes" BIGINT NOT NULL;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TeamSubscription" ALTER COLUMN "teamId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "teamId" TEXT;

-- AlterTable
ALTER TABLE "VideoSeparateTask" ADD COLUMN     "teamId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "VideoTrimTask" ADD COLUMN     "teamId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Folder_teamId_idx" ON "Folder"("teamId");

-- CreateIndex
CREATE INDEX "LightingTask_teamId_idx" ON "LightingTask"("teamId");

-- CreateIndex
CREATE INDEX "MaterialFolder_teamId_idx" ON "MaterialFolder"("teamId");

-- CreateIndex
CREATE INDEX "Media_teamId_idx" ON "Media"("teamId");

-- CreateIndex
CREATE INDEX "Template_teamId_idx" ON "Template"("teamId");

-- CreateIndex
CREATE INDEX "VideoSeparateTask_teamId_idx" ON "VideoSeparateTask"("teamId");

-- CreateIndex
CREATE INDEX "VideoTrimTask_teamId_idx" ON "VideoTrimTask"("teamId");

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialFolder" ADD CONSTRAINT "MaterialFolder_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LightingTask" ADD CONSTRAINT "LightingTask_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoTrimTask" ADD CONSTRAINT "VideoTrimTask_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoSeparateTask" ADD CONSTRAINT "VideoSeparateTask_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSubscription" ADD CONSTRAINT "TeamSubscription_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 默认团队每用户唯一
CREATE UNIQUE INDEX "team_owner_default_unique" ON "Team"("ownerId") WHERE "isDefault" = true;
CREATE INDEX "team_owner_id_idx" ON "Team"("ownerId");

-- Folder 同级重名（root 与 parent 分开：PG 中 NULL 互不相等）
CREATE UNIQUE INDEX "folder_team_root_name_unique" ON "Folder"("teamId", "name") WHERE "parentId" IS NULL;
CREATE UNIQUE INDEX "folder_team_parent_name_unique" ON "Folder"("teamId", "parentId", "name") WHERE "parentId" IS NOT NULL;

-- MaterialFolder 同级重名
CREATE UNIQUE INDEX "material_folder_team_root_name_unique" ON "MaterialFolder"("teamId", "name") WHERE "parentId" IS NULL;
CREATE UNIQUE INDEX "material_folder_team_parent_name_unique" ON "MaterialFolder"("teamId", "parentId", "name") WHERE "parentId" IS NOT NULL;

-- 个人/团队订阅各仅一个 active
CREATE UNIQUE INDEX "user_subscription_one_active" ON "UserSubscription"("userId") WHERE status = 'active';
CREATE UNIQUE INDEX "team_subscription_one_active" ON "TeamSubscription"("teamId") WHERE status = 'active';
