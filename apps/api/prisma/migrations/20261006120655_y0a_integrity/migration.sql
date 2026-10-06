-- DropIndex
DROP INDEX "CanvasDocUpdate_projectId_seq_idx";

-- AlterTable
ALTER TABLE "CanvasDoc" ADD COLUMN     "stateSeq" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CollabLease" (
    "scope" TEXT NOT NULL,
    "owner" TEXT,
    "epoch" BIGINT NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "CollabLease_pkey" PRIMARY KEY ("scope")
);

-- 手工调整段（Y0a-1）：唯一性落为约束而非裸索引（非 prisma migrate dev 原生成形态——原为 CREATE UNIQUE
-- INDEX，纯唯一索引不进 pg_constraint）。ADD CONSTRAINT 自动建同名唯一索引（写放大/查询语义等价）且在
-- pg_constraint 留痕：spec §3 Y0a-1 1.1 "直加约束"+verify-indexes 块 3 pg_constraint 口径依赖此形态。
ALTER TABLE "CanvasDocUpdate" ADD CONSTRAINT "CanvasDocUpdate_projectId_seq_key" UNIQUE ("projectId", "seq");

-- ============ 手工段（Y0a-1）：租约种子行（幂等）——非 prisma migrate dev 生成 ============
INSERT INTO "CollabLease" ("scope", "owner", "epoch") VALUES ('primary', NULL, 0)
ON CONFLICT ("scope") DO NOTHING;
