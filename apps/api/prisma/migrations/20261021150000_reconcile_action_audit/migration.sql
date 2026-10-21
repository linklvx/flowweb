-- T13 R3：自动收敛审计行（spec Z18''⑥ 护栏——每动作一行+pg_advisory_xact_lock 配套）
CREATE TABLE "ReconcileAction" (
    "id" TEXT NOT NULL,
    "intentRowId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconcileAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconcileAction_intentRowId_idx" ON "ReconcileAction"("intentRowId");

-- CreateIndex
CREATE INDEX "ReconcileAction_createdAt_idx" ON "ReconcileAction"("createdAt");
