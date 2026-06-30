-- CreateTable
CREATE TABLE "VideoTrimTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "startTime" DOUBLE PRECISION NOT NULL,
    "endTime" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "outputFileId" TEXT,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "VideoTrimTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoTrimTask_nodeId_idx" ON "VideoTrimTask"("nodeId");

-- CreateIndex
CREATE INDEX "VideoTrimTask_userId_idx" ON "VideoTrimTask"("userId");
