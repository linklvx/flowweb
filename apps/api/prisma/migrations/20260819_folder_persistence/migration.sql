-- 1. 创建枚举类型
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'SAVED');

-- 2. 创建 Folder 表
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "parentId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- 3. 创建 Folder 表索引
CREATE INDEX "Folder_userId_parentId_idx" ON "Folder"("userId", "parentId");

-- 4. 创建 Folder 表外键
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. 为 Template 表添加新列
ALTER TABLE "Template" ADD COLUMN "folderId" TEXT;
ALTER TABLE "Template" ADD COLUMN "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT';

-- 6. 删除旧的 (name, userId) 唯一约束
ALTER TABLE "Template" DROP CONSTRAINT IF EXISTS "Template_name_userId_key";

-- 7. 数据修复：清理无效的 projectId
UPDATE "Template" SET "projectId" = NULL
WHERE "projectId" IS NOT NULL
  AND "projectId" NOT IN (SELECT "id" FROM "CanvasProject");

-- 8. 数据修复：确保每个 projectId 只指向一个最新的 template
UPDATE "Template" SET "projectId" = NULL
WHERE "projectId" IS NOT NULL
  AND "id" NOT IN (
    SELECT DISTINCT ON ("projectId") "id" FROM "Template"
    WHERE "projectId" IS NOT NULL
    ORDER BY "projectId", "createdAt" DESC
  );

-- 9. 数据修复：设置现有模板状态为 SAVED
UPDATE "Template" SET "status" = 'SAVED';

-- 10. 添加外键（必须在数据修复之后）
ALTER TABLE "Template" ADD CONSTRAINT "Template_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Template" ADD CONSTRAINT "Template_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 11. 添加索引（必须在数据修复之后）
CREATE INDEX "Template_folderId_idx" ON "Template"("folderId");
CREATE UNIQUE INDEX "Template_projectId_key" ON "Template"("projectId");
