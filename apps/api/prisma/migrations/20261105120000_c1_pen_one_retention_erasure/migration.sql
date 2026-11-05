-- C1-0（生产就绪收尾批——迁移笔一：C1 前置+C3/C4 表列一次到位）：全 additive（新索引/新列/新表/enum
-- 加值零破坏）。spec v5 §2 R15/R17/R18+§3 各卡；锁/fence 单源=collab/project-lock.ts；job 词表单源=
-- shared collab/retention.ts。迁移串行纪律：时间戳序在 20261026120000_y1c_t23_resource_recovery 之后。
--  - 三索引：ExecutionInput(expiresAt)〔retention 过期扫〕+RuntimeEvent(projectId,createdAt)〔retention
--    7d 扫〕+ExecutionRequest(teamId,state)〔stuck 扫+team 资金域扫（C4 扩查）〕。
--  - CanvasProject +lifecycleState（R15 持久 fence 判据列——ACTIVE|DELETING，状态机接线归 C4）+origin
--    （谱系——clone/draft，C4 接线）+lifecycleState 索引。
--  - CanvasDocCoalesced：T30b 同内容幂等吞行记录侧表（C3 审计行间衔接断点覆盖豁免载体）。
--  - CollabJobCursor：worker tick 轮转游标+边沿状态（C3 audit 消费——job 值域单源 shared retention.ts）。
--  - ProjectErasureRun：R17 scope 化擦除状态机（C4 状态机/worker 接线；manifest 主载体=data-dir 外部
--    文件〔R16〕——本表只作索引行）+active 态 scope 唯一 partial unique（raw SQL——Prisma 不可表达：
--    DONE/FAILED 后允许新 run〔restore 再擦/dry-run 后真实擦〕）。
--  - TeamStatus +DISBANDING（team 维擦除进行态）：**语句置迁移末**（PG enum 加值不与使用同事务——
--    本笔不消费该值，C4 fenceTeam/接线消费）。

-- CreateIndex
CREATE INDEX "ExecutionInput_expiresAt_idx" ON "ExecutionInput"("expiresAt");

-- CreateIndex
CREATE INDEX "RuntimeEvent_projectId_createdAt_idx" ON "RuntimeEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ExecutionRequest_teamId_state_idx" ON "ExecutionRequest"("teamId", "state");

-- AlterTable
ALTER TABLE "CanvasProject" ADD COLUMN     "lifecycleState" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "origin" TEXT;

-- CreateIndex
CREATE INDEX "CanvasProject_lifecycleState_idx" ON "CanvasProject"("lifecycleState");

-- CreateTable
CREATE TABLE "CanvasDocCoalesced" (
    "projectId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "seq" BIGINT NOT NULL,
    "updateHash" CHAR(64) NOT NULL,
    "sourceSeq" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanvasDocCoalesced_pkey" PRIMARY KEY ("projectId","generation","seq")
);

-- CreateIndex
CREATE INDEX "CanvasDocCoalesced_projectId_generation_updateHash_idx" ON "CanvasDocCoalesced"("projectId", "generation", "updateHash");

-- CreateTable
CREATE TABLE "CollabJobCursor" (
    "job" TEXT NOT NULL,
    "lastKey" TEXT,
    "lastGap" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollabJobCursor_pkey" PRIMARY KEY ("job")
);

-- CreateTable
CREATE TABLE "ProjectErasureRun" (
    "erasureId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "parentRunId" TEXT,
    "teamId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "stage" TEXT,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "manifestPath" TEXT,
    "manifestSha256" CHAR(64),
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectErasureRun_pkey" PRIMARY KEY ("erasureId")
);

-- CreateIndex
CREATE INDEX "ProjectErasureRun_state_updatedAt_idx" ON "ProjectErasureRun"("state", "updatedAt");

-- CreateIndex
CREATE INDEX "ProjectErasureRun_scopeType_scopeId_idx" ON "ProjectErasureRun"("scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "ProjectErasureRun_parentRunId_idx" ON "ProjectErasureRun"("parentRunId");

-- CreateIndex（raw SQL partial unique——active 态 scope 唯一：DONE/FAILED 后允许新 run）
CREATE UNIQUE INDEX "project_erasure_active_uq" ON "ProjectErasureRun"("scopeType","scopeId") WHERE state IN ('PENDING','RUNNING','DRAINING','WAITING_CHILDREN','PURGING_DB','PURGING_OBJECTS','PURGING_CACHE','VERIFYING');

-- AlterEnum（置末——PG enum 加值不与使用同事务；本笔零消费，C4 接线）
ALTER TYPE "TeamStatus" ADD VALUE 'DISBANDING';