-- CreateEnum
CREATE TYPE "MaintenanceStage" AS ENUM ('REQUESTED', 'FREEZING', 'DRAINING', 'DRAINED', 'EXPORTING', 'REBUILDING', 'SWITCHING', 'VERIFYING', 'COMPLETED', 'FAILED', 'ABORTED');

-- Y1c T7 勘误注记：prisma migrate diff 产物附带的无关 DROP INDEX "pricing_rule_natural_key"
-- 已人工裁剪（check-migration-additive 头注既定纪律——该索引=CRITICAL_INDEXES 硬拦名单，
-- NULLS NOT DISTINCT 语义 Prisma 不可表达=diff 双盲，与 migrate-diff-allowlist.txt 唯一永久豁免同源）。

-- AlterTable
ALTER TABLE "CanvasDoc" ADD COLUMN     "currentSnapshotRev" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "maintenanceId" TEXT,
ADD COLUMN     "pgSeq" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "purgeBelowSeq" BIGINT,
ADD COLUMN     "vacuumEpoch" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "walCheckpointSeq" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SystemHistory" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "historyId" TEXT NOT NULL,
    "epochStartedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuntimeFeedCursor" (
    "projectId" TEXT NOT NULL,
    "lastSeq" BIGINT NOT NULL DEFAULT 0,
    "minRetainedSeq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "RuntimeFeedCursor_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "CanvasDocSnapshot" (
    "projectId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "snapshotRev" BIGINT NOT NULL,
    "stateSeq" BIGINT NOT NULL,
    "state" BYTEA NOT NULL,
    "stateHash" CHAR(64) NOT NULL,
    "vacuumEpoch" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanvasDocSnapshot_pkey" PRIMARY KEY ("projectId","generation","snapshotRev")
);

-- CreateTable
CREATE TABLE "DocAuditEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceOperation" (
    "maintenanceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stage" "MaintenanceStage" NOT NULL,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "sourceGeneration" INTEGER NOT NULL,
    "targetGeneration" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "cutoffPgSeq" BIGINT NOT NULL,
    "drainedAt" TIMESTAMP(3),
    "error" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "leaseOwner" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceOperation_pkey" PRIMARY KEY ("maintenanceId")
);

-- CreateIndex
CREATE INDEX "DocAuditEvent_projectId_createdAt_idx" ON "DocAuditEvent"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceOperation_idempotencyKey_key" ON "MaintenanceOperation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MaintenanceOperation_projectId_status_idx" ON "MaintenanceOperation"("projectId", "status");

-- AddForeignKey
ALTER TABLE "CanvasDocSnapshot" ADD CONSTRAINT "CanvasDocSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══ Y1c T7：raw SQL 段（Prisma 不可表达——CHECK/单行约束/partial unique/引导行） ═══

-- 同行水位约束（spec §4.4/§5.1 偏离 26）：pgSeq ≤ walCheckpointSeq。
-- 跨表不变量 Snapshot.stateSeq≤pgSeq 非 CHECK 可表达——由快照发布事务行锁+条件更新保证（T11 落地，spec 偏离 26 v5.2 勘误）。
ALTER TABLE "CanvasDoc" ADD CONSTRAINT "canvas_doc_watermark_order_check" CHECK ("pgSeq" <= "walCheckpointSeq");

-- SystemHistory 全局单行唯一权威（Controller 裁定 1——Prisma 无法表达单行约束）：
-- CHECK (id = 1) 使 id≠1 行不可插入（负控锚）。
ALTER TABLE "SystemHistory" ADD CONSTRAINT "system_history_single_row_check" CHECK ("id" = 1);

-- 快照 16MiB 上限（卡文 CanvasDocSnapshot raw CHECK；与 CanvasDocUpdate 同额上限随 T9 表改形同批落）。
ALTER TABLE "CanvasDocSnapshot" ADD CONSTRAINT "canvas_doc_snapshot_state_size_check" CHECK (octet_length("state") <= 16777216);

-- 活跃维护 partial unique：一项目一活跃（卡文 MaintenanceOperation raw SQL——唯一性在此不在 CanvasDoc）。
-- 活跃 = stage 不在三终态（COMPLETED/FAILED/ABORTED）；REQUESTED..VERIFYING 任一段即占位。
CREATE UNIQUE INDEX "maintenance_operation_one_active_idx" ON "MaintenanceOperation" ("projectId")
WHERE "stage" NOT IN ('COMPLETED'::"MaintenanceStage", 'FAILED'::"MaintenanceStage", 'ABORTED'::"MaintenanceStage");

-- SystemHistory 引导行（Controller 裁定 3——安装语义非运行时自动修复；PG≥13 内建 gen_random_uuid，
-- 本机 16.13 已核）：ON CONFLICT DO NOTHING=幂等重放安全。运行时启动校验/genesis 读取对缺失/为零
-- 仍 fail-closed（勘误语义不变——bump 纪律归 §4.4，restore 工具收尾必须 bump historyId）。
INSERT INTO "SystemHistory" ("id", "historyId", "epochStartedAt", "updatedAt")
VALUES (1, gen_random_uuid()::text, now(), now())
ON CONFLICT DO NOTHING;
