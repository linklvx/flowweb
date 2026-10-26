-- Y1c T21（迁移二——G4 门）：P3 业务族 DDL——ExecutionRequest 父子行+ExecutionInput+RuntimeEvent+
-- NodeExecution（generation 列+更新守卫 CAS 基础）+ExecutionOutbox/MaterializeRun/RefundObligation+
-- NodeLifecycle(lifecycleSeq+当前行 partial unique)/DeliveryFence/LifecycleObligation(#11 队列执行面)
-- +GenerationIntent.executionRequestId（claim 创建关联 requestId）。
-- RuntimeFeedCursor=T7 已建（复用勿重建）；迁移串行 T7(20261024120000)→T21(本)→T23。
-- raw SQL 追加：NodeLifecycle 当前行 partial unique（Prisma 无法表达——lifecycle.ts 冻结契约）；
-- execSeq=执行代际族 / lifecycleSeq·fenceSeq=生命周期族（#4 族分离——列注释见 schema.prisma）。
-- DropIndex
-- Y1c T21 人工裁剪记录：prisma migrate diff 产物附带的无关 DROP INDEX "pricing_rule_natural_key"
-- 已裁剪（check-migration-additive 硬拦名单+T7 勘误同源纪律——该索引=NULLS NOT DISTINCT raw 形态
-- Prisma diff 双盲；生成时点 dev 库该索引曾缺失属环境漂移〔已手工重建〕，非本迁移语义）。

-- AlterTable
ALTER TABLE "GenerationIntent" ADD COLUMN     "executionRequestId" TEXT;

-- CreateTable
CREATE TABLE "ExecutionRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "historyId" TEXT NOT NULL,
    "docSeq" BIGINT NOT NULL,
    "frozenDocSeq" BIGINT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ADMITTED',
    "reservedCredit" INTEGER NOT NULL DEFAULT 0,
    "totalCredit" INTEGER NOT NULL DEFAULT 0,
    "planHash" CHAR(64) NOT NULL,
    "inputHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionNodePlan" (
    "requestId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "model" TEXT,
    "resolution" TEXT,
    "styleId" TEXT,
    "pricingRuleId" TEXT,
    "creditCost" INTEGER NOT NULL DEFAULT 0,
    "reservedCredit" INTEGER NOT NULL DEFAULT 0,
    "paramsHash" CHAR(64) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "generationIntentId" TEXT,
    "execSeq" BIGINT,

    CONSTRAINT "ExecutionNodePlan_pkey" PRIMARY KEY ("requestId","nodeId")
);

-- CreateTable
CREATE TABLE "ExecutionInput" (
    "requestId" TEXT NOT NULL,
    "encoding" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "rawBytes" INTEGER NOT NULL,
    "storedBytes" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionInput_pkey" PRIMARY KEY ("requestId")
);

-- CreateTable
CREATE TABLE "RuntimeEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "feedSeq" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "docSeq" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuntimeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeExecution" (
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "execSeq" BIGINT NOT NULL,
    "nodeVersion" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "errorCode" TEXT,
    "artifactRev" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeExecution_pkey" PRIMARY KEY ("projectId","nodeId")
);

-- CreateTable
CREATE TABLE "ExecutionOutbox" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "businessKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "claimOwner" TEXT,
    "claimUntilMs" BIGINT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterializeRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "expectedExecSeq" BIGINT NOT NULL,
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterializeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundObligation" (
    "id" TEXT NOT NULL,
    "intentRowId" TEXT NOT NULL,
    "execSeq" BIGINT NOT NULL,
    "reversesId" TEXT NOT NULL,
    "creditAmount" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeLifecycle" (
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "lifecycleSeq" BIGINT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "state" TEXT NOT NULL,
    "walSeq" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeLifecycle_pkey" PRIMARY KEY ("projectId","nodeId","lifecycleSeq")
);

-- CreateTable
CREATE TABLE "DeliveryFence" (
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "fenceSeq" BIGINT NOT NULL,
    "state" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryFence_pkey" PRIMARY KEY ("projectId","nodeId")
);

-- CreateTable
CREATE TABLE "LifecycleObligation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "walSeq" BIGINT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimOwner" TEXT,
    "claimUntilMs" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LifecycleObligation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExecutionRequest_projectId_state_expiresAt_idx" ON "ExecutionRequest"("projectId", "state", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionRequest_projectId_requestId_key" ON "ExecutionRequest"("projectId", "requestId");

-- CreateIndex
CREATE INDEX "ExecutionNodePlan_requestId_order_idx" ON "ExecutionNodePlan"("requestId", "order");

-- CreateIndex
CREATE INDEX "RuntimeEvent_projectId_generation_feedSeq_idx" ON "RuntimeEvent"("projectId", "generation", "feedSeq");

-- CreateIndex
CREATE UNIQUE INDEX "RuntimeEvent_projectId_feedSeq_key" ON "RuntimeEvent"("projectId", "feedSeq");

-- CreateIndex
CREATE INDEX "ExecutionOutbox_projectId_state_claimUntilMs_idx" ON "ExecutionOutbox"("projectId", "state", "claimUntilMs");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionOutbox_projectId_generation_businessKey_key" ON "ExecutionOutbox"("projectId", "generation", "businessKey");

-- CreateIndex
CREATE INDEX "MaterializeRun_projectId_state_idx" ON "MaterializeRun"("projectId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "RefundObligation_intentRowId_execSeq_key" ON "RefundObligation"("intentRowId", "execSeq");

-- CreateIndex
CREATE INDEX "NodeLifecycle_projectId_nodeId_isCurrent_idx" ON "NodeLifecycle"("projectId", "nodeId", "isCurrent");

-- CreateIndex
CREATE INDEX "LifecycleObligation_projectId_state_claimUntilMs_idx" ON "LifecycleObligation"("projectId", "state", "claimUntilMs");

-- CreateIndex
CREATE UNIQUE INDEX "LifecycleObligation_projectId_nodeId_kind_walSeq_key" ON "LifecycleObligation"("projectId", "nodeId", "kind", "walSeq");

-- CreateIndex
CREATE INDEX "GenerationIntent_executionRequestId_idx" ON "GenerationIntent"("executionRequestId");


-- NodeLifecycle 当前行 partial unique（spec §6.5/T5b 冻结：UNIQUE(projectId,nodeId) WHERE is_current——历史行保留）
CREATE UNIQUE INDEX "NodeLifecycle_projectId_nodeId_current_key" ON "NodeLifecycle"("projectId", "nodeId") WHERE "isCurrent";
