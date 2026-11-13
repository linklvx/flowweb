-- CreateTable
CREATE TABLE "CanvasReferenceOracle" (
    "projectId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "verifiedSeq" BIGINT NOT NULL,

    CONSTRAINT "CanvasReferenceOracle_pkey" PRIMARY KEY ("projectId","mediaId")
);

-- CreateTable
CREATE TABLE "CanvasReferenceOracleScan" (
    "projectId" TEXT NOT NULL,
    "historyEpoch" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "verifiedSeq" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "refCount" INTEGER NOT NULL,
    "scannedAt" TIMESTAMPTZ(3) NOT NULL,
    "error" TEXT,

    CONSTRAINT "CanvasReferenceOracleScan_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "DeletionBarrier" (
    "teamId" TEXT NOT NULL,
    "barrierId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DeletionBarrier_pkey" PRIMARY KEY ("teamId")
);

-- CreateIndex
CREATE INDEX "CanvasReferenceOracle_mediaId_idx" ON "CanvasReferenceOracle"("mediaId");

-- AddForeignKey
ALTER TABLE "CanvasReferenceOracle" ADD CONSTRAINT "CanvasReferenceOracle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasReferenceOracleScan" ADD CONSTRAINT "CanvasReferenceOracleScan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheckConstraint（Prisma 无 CHECK 语法——raw SQL 手补，init「3. CHECK 约束」段同款形态）
-- 注：prisma migrate dev --create-only 产物附带的 DROP INDEX "pricing_rule_natural_key" 已人工裁剪
--（NULLS NOT DISTINCT 语义 Prisma 不可表达——check-migration-additive CRITICAL_INDEXES 硬拦同源先例）。
ALTER TABLE "CanvasReferenceOracleScan" ADD CONSTRAINT "CanvasReferenceOracleScan_status_check" CHECK ("status" IN ('VERIFYING', 'COMPLETE', 'FAILED'));
ALTER TABLE "DeletionBarrier" ADD CONSTRAINT "DeletionBarrier_state_check" CHECK ("state" IN ('ACQUIRING', 'ACTIVE', 'RELEASING', 'FAILED'));
