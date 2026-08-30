/*
  Warnings:

  - You are about to alter the column `message` on the `Announcement` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(200)`.
  - You are about to alter the column `linkUrl` on the `Announcement` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(500)`.

*/
-- DropIndex
DROP INDEX "Announcement_active_idx";

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "bgColor" VARCHAR(16) NOT NULL DEFAULT '#0f2761',
ADD COLUMN     "linkText" VARCHAR(32),
ADD COLUMN     "textColor" VARCHAR(16) NOT NULL DEFAULT '#ffffff',
ALTER COLUMN "message" SET DATA TYPE VARCHAR(200),
ALTER COLUMN "linkUrl" SET DATA TYPE VARCHAR(500),
ALTER COLUMN "active" SET DEFAULT false;

-- CreateTable
CREATE TABLE "HomeBanner" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(128),
    "subtitle" VARCHAR(256),
    "linkUrl" VARCHAR(500),
    "imageKey" VARCHAR(255) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeBanner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HomeBanner_active_sortOrder_idx" ON "HomeBanner"("active", "sortOrder");

-- CreateIndex（互斥：启用中的公告至多一条）
CREATE UNIQUE INDEX "announcement_single_active" ON "Announcement"("active") WHERE "active";
