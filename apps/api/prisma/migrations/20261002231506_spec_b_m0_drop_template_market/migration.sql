-- M0-1 (a1): 官方种子行无 projectId——boot seed 调用已删不再重建；drop 列前先清市场行
DELETE FROM "Template" WHERE "projectId" IS NULL;

-- DropIndex
DROP INDEX "Template_isPublic_idx";

-- AlterTable
ALTER TABLE "Template" DROP COLUMN "description",
DROP COLUMN "isPublic",
DROP COLUMN "status",
DROP COLUMN "templateData";
