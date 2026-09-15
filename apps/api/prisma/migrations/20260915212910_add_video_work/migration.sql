-- CreateEnum
CREATE TYPE "VideoWorkStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "VideoWork" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "authorName" VARCHAR(64) NOT NULL,
    "categoryId" TEXT,
    "videoKey" VARCHAR(512) NOT NULL,
    "videoMediaId" TEXT,
    "coverKey" VARCHAR(512),
    "canvasProjectId" TEXT,
    "durationSec" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "VideoWorkStatus" NOT NULL DEFAULT 'DRAFT',
    "allowViewProcess" BOOLEAN NOT NULL DEFAULT false,
    "allowClone" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoCategory" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoTag" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoWorkSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "carouselEnabled" BOOLEAN NOT NULL DEFAULT true,
    "carouselScope" TEXT NOT NULL DEFAULT 'all',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoWorkSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoWork_status_sortOrder_publishedAt_idx" ON "VideoWork"("status", "sortOrder", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "VideoWork_categoryId_status_idx" ON "VideoWork"("categoryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VideoCategory_name_key" ON "VideoCategory"("name");

-- CreateIndex
CREATE INDEX "VideoCategory_active_sortOrder_idx" ON "VideoCategory"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "VideoTag_name_key" ON "VideoTag"("name");

-- CreateIndex
CREATE INDEX "VideoTag_active_sortOrder_idx" ON "VideoTag"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "Media_type_status_deletedAt_idx" ON "Media"("type", "status", "deletedAt");

-- AddForeignKey
ALTER TABLE "VideoWork" ADD CONSTRAINT "VideoWork_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VideoCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
