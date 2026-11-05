-- C2-0（生产就绪收尾批——迁移笔二：C2 前置）：全 additive（新表零破坏）。spec v5 §3 C2+plan v3.1
-- 笔二字段定义；governance 写点单源=collab/project-governance.service.ts（OpsGate 项目行+origin），
-- origin 值域单源=shared collab/project-origin.ts；三档/两阶段读/freeze 归 C2-1，pin 消费归 C2-2。
-- 迁移串行纪律：时间戳序在 20261105120000_c1_pen_one_retention_erasure 之后。
--  - CollabOpsGate：复合 PK 哨兵（全局行 projectId='' + 每项目行）——compact 发布事务两行校验载体
--    （C2-1：IN ('',pid) 行数==2 且全 OPEN，<2=fail-closed）。建路径项目行=governance 接线，
--    本笔回填存量+落全局哨兵行（行数校验 fail-closed 同笔——迁移失败即停，禁半回填态上线）。
--  - CanaryPin/CollabCanaryCursor：C2-2 捕获/比对载体（表先落——pin 谓词 compare-and-delete 归 C2-2）。
--  注：migrate dev --create-only 产物附带的 DROP INDEX "pricing_rule_natural_key" 已人工裁剪
--    （schema 不可表达的 NULLS NOT DISTINCT 唯一——check-migration-additive CRITICAL_INDEXES 硬拦面）。

-- CreateTable
CREATE TABLE "CollabOpsGate" (
    "gate" TEXT NOT NULL,
    "projectId" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "version" BIGINT NOT NULL DEFAULT 0,
    "frozenAt" TIMESTAMP(3),
    "frozenBy" TEXT,
    "unfrozenAt" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "CollabOpsGate_pkey" PRIMARY KEY ("gate","projectId")
);

-- CreateTable
CREATE TABLE "CanaryPin" (
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CAPTURING',
    "generation" INTEGER NOT NULL,
    "snapshotRev" BIGINT NOT NULL,
    "stateSeq" BIGINT NOT NULL,
    "pgSeqAt" BIGINT NOT NULL,
    "contentHash" CHAR(64),
    "hashSkipped" BOOLEAN NOT NULL DEFAULT false,
    "hashVersion" INTEGER NOT NULL,
    "stateVector" BYTEA,
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanaryPin_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "CollabCanaryCursor" (
    "projectId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL,
    "lastResult" TEXT NOT NULL,
    "nextDueAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollabCanaryCursor_pkey" PRIMARY KEY ("projectId")
);

-- 全局哨兵行（gate='compact', projectId=''——C2-1 两行校验的常驻半边；幂等重放安全）
INSERT INTO "CollabOpsGate" ("gate", "projectId", "state") VALUES ('compact', '', 'OPEN') ON CONFLICT DO NOTHING;

-- 存量回填：每存量项目一行 OPEN（建路径行此后由 ensureProjectGovernance 落——本段只补存量；
-- 幂等重放安全=ON CONFLICT DO NOTHING）
INSERT INTO "CollabOpsGate" ("gate", "projectId", "state") SELECT 'compact', "id", 'OPEN' FROM "CanvasProject" ON CONFLICT DO NOTHING;

-- 行数校验（fail-closed）：存量项目数 == gate 项目行数——不等即迁移失败（禁半回填态）。
DO $$
DECLARE
    n_projects BIGINT;
    n_gate_rows BIGINT;
BEGIN
    SELECT COUNT(*) INTO n_projects FROM "CanvasProject";
    SELECT COUNT(*) INTO n_gate_rows FROM "CollabOpsGate" WHERE "gate" = 'compact' AND "projectId" <> '';
    IF n_projects <> n_gate_rows THEN
        RAISE EXCEPTION 'CollabOpsGate backfill mismatch: CanvasProject=% rows vs gate project rows=% (fail-closed)', n_projects, n_gate_rows;
    END IF;
END $$;
