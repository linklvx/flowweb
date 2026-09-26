-- CreateTable
CREATE TABLE "StyleCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StyleCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Style" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "coverKey" TEXT NOT NULL,
    "authorName" TEXT,
    "isCommercial" BOOLEAN NOT NULL DEFAULT false,
    "promptText" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Style_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StyleFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleRecentUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StyleRecentUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StyleCategory_name_key" ON "StyleCategory"("name");

-- CreateIndex
CREATE INDEX "StyleCategory_active_sortOrder_idx" ON "StyleCategory"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "Style_active_sortOrder_usageCount_id_idx" ON "Style"("active", "sortOrder", "usageCount" DESC, "id");

-- CreateIndex
CREATE INDEX "Style_categoryId_active_idx" ON "Style"("categoryId", "active");

-- CreateIndex
CREATE INDEX "StyleFavorite_userId_createdAt_idx" ON "StyleFavorite"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StyleFavorite_userId_styleId_key" ON "StyleFavorite"("userId", "styleId");

-- CreateIndex
CREATE INDEX "StyleRecentUsage_userId_lastUsedAt_idx" ON "StyleRecentUsage"("userId", "lastUsedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StyleRecentUsage_userId_styleId_key" ON "StyleRecentUsage"("userId", "styleId");

-- AddForeignKey
ALTER TABLE "Style" ADD CONSTRAINT "Style_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "StyleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleFavorite" ADD CONSTRAINT "StyleFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleFavorite" ADD CONSTRAINT "StyleFavorite_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleRecentUsage" ADD CONSTRAINT "StyleRecentUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleRecentUsage" ADD CONSTRAINT "StyleRecentUsage_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;
