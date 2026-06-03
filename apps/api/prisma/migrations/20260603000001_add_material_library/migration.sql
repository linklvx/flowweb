-- AlterTable: Add material-library columns to Media
ALTER TABLE "Media" ADD COLUMN "folderId" TEXT;
ALTER TABLE "Media" ADD COLUMN "isFavorite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Media" ADD COLUMN "thumbnailKey" TEXT;
ALTER TABLE "Media" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Media" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MaterialFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "userId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MaterialFolder_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey: Media.userId -> User (was missing in the original migration)
ALTER TABLE "Media" ADD CONSTRAINT "Media_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Media.folderId -> MaterialFolder
ALTER TABLE "Media" ADD CONSTRAINT "Media_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MaterialFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: MaterialFolder.parentId -> MaterialFolder (self-referencing)
ALTER TABLE "MaterialFolder" ADD CONSTRAINT "MaterialFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MaterialFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: MaterialFolder.userId -> User
ALTER TABLE "MaterialFolder" ADD CONSTRAINT "MaterialFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Media_userId_folderId_idx" ON "Media"("userId", "folderId");

-- CreateIndex
CREATE INDEX "Media_userId_isFavorite_idx" ON "Media"("userId", "isFavorite");

-- CreateIndex
CREATE INDEX "Media_userId_createdAt_idx" ON "Media"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MaterialFolder_userId_parentId_idx" ON "MaterialFolder"("userId", "parentId");

-- CreateIndex
CREATE INDEX "MaterialFolder_userId_sortOrder_idx" ON "MaterialFolder"("userId", "sortOrder");

-- CreateIndex
CREATE INDEX "MaterialFolder_userId_deletedAt_idx" ON "MaterialFolder"("userId", "deletedAt");
