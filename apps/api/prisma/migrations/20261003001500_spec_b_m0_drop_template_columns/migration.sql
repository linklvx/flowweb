-- DropIndex
DROP INDEX "Template_category_idx";

-- DropIndex
DROP INDEX "Template_importCount_idx";

-- AlterTable
ALTER TABLE "Template" DROP COLUMN "category",
DROP COLUMN "coverUrl",
DROP COLUMN "dataUrl",
DROP COLUMN "importCount";

-- DropEnum
DROP TYPE "TemplateCategory";

-- DropEnum
DROP TYPE "TemplateStatus";

