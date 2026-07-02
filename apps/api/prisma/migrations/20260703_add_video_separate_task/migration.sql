-- CreateTable
CREATE TABLE "VideoSeparateTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'split',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "videoFileId" TEXT,
    "audioFileId" TEXT,
    "errorMsg" TEXT,
    "errorType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "VideoSeparateTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoSeparateTask_nodeId_idx" ON "VideoSeparateTask"("nodeId");

-- CreateIndex
CREATE INDEX "VideoSeparateTask_userId_idx" ON "VideoSeparateTask"("userId");

-- CreateIndex
CREATE INDEX "VideoSeparateTask_sourceFileId_idx" ON "VideoSeparateTask"("sourceFileId");
