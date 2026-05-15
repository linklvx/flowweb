-- CreateEnum
CREATE TYPE "TemplateCategory" AS ENUM ('OFFICIAL', 'COMMUNITY');

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "coverUrl" TEXT,
    "dataUrl" TEXT,
    "templateData" JSONB,
    "userId" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "importCount" INTEGER NOT NULL DEFAULT 0,
    "category" "TemplateCategory",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- AlterTable (add userId column to existing CanvasProject, plus FK and index handled below)
ALTER TABLE "CanvasProject" ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE INDEX "Template_userId_idx" ON "Template"("userId");
CREATE INDEX "Template_isPublic_idx" ON "Template"("isPublic");
CREATE INDEX "Template_category_idx" ON "Template"("category");
CREATE INDEX "Template_importCount_idx" ON "Template"("importCount");

-- Unique constraint for upsert (one template name per user)
CREATE UNIQUE INDEX "Template_name_userId_key" ON "Template"("name", "userId");

-- Index for CanvasProject userId lookups
CREATE INDEX "CanvasProject_userId_idx" ON "CanvasProject"("userId");

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey for CanvasProject
ALTER TABLE "CanvasProject" ADD CONSTRAINT "CanvasProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
