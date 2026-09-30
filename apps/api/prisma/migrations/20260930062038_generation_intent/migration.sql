-- CreateEnum
CREATE TYPE "IntentStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'VOIDED');

-- AlterEnum
ALTER TYPE "TeamCreditTransactionType" ADD VALUE 'refund';

-- CreateTable
CREATE TABLE "GenerationIntent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "paramsHash" TEXT NOT NULL,
    "status" "IntentStatus" NOT NULL DEFAULT 'RUNNING',
    "jobId" TEXT,
    "creditsConsumed" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "resultRef" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GenerationIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GenerationIntent_projectId_nodeId_status_idx" ON "GenerationIntent"("projectId", "nodeId", "status");

-- CreateIndex
CREATE INDEX "GenerationIntent_jobId_idx" ON "GenerationIntent"("jobId");

-- CreateIndex
CREATE INDEX "GenerationIntent_status_updatedAt_idx" ON "GenerationIntent"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "GenerationIntent_status_completedAt_idx" ON "GenerationIntent"("status", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationIntent_projectId_intentId_key" ON "GenerationIntent"("projectId", "intentId");

-- F1: per-node in-flight mutex (takes over from SETNX) — at most one active intent per node;
-- terminal-state rows fall out of index range, naturally allowing new intents; group execution = one row per node, unaffected.
-- PENDING deleted (F13 补强) — claim creates RUNNING directly.
CREATE UNIQUE INDEX "generation_intent_active_node_unique"
ON "GenerationIntent"("projectId", "nodeId")
WHERE status = 'RUNNING';
