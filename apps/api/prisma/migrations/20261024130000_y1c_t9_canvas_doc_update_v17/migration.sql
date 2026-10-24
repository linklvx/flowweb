-- Y1c T9（Controller 裁定 1：T7 勘误既定切片——T9=新写入方+表改形；T10=applied-driven 批量+水位 CAS；
-- T11=compact 重写）。dev 无存量数据（表已 TRUNCATE——破坏性变更照 T7 先例 EXEMPTIONS 登记）。
-- prisma migrate diff 产物附带的无关 DROP INDEX "pricing_rule_natural_key" 已人工裁剪（T7 同款纪律
-- ——该索引=CRITICAL_INDEXES 硬拦名单，NULLS NOT DISTINCT 语义 Prisma 不可表达=diff 双盲）。

-- DropConstraint（unique 索引背靠约束——prisma diff 的 DROP INDEX 形态在 PG 需 DROP CONSTRAINT）
ALTER TABLE "CanvasDocUpdate" DROP CONSTRAINT "CanvasDocUpdate_projectId_seq_key";

-- AlterTable
ALTER TABLE "CanvasDocUpdate" DROP CONSTRAINT "CanvasDocUpdate_pkey",
DROP COLUMN "id",
ADD COLUMN     "actorRanges" JSONB,
ADD COLUMN     "firstWalSeq" BIGINT NOT NULL,
ADD COLUMN     "frameCount" INTEGER NOT NULL,
ADD COLUMN     "generation" INTEGER NOT NULL,
ADD COLUMN     "updateHash" CHAR(64) NOT NULL,
ADD CONSTRAINT "CanvasDocUpdate_pkey" PRIMARY KEY ("projectId", "generation", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "CanvasDocUpdate_projectId_generation_updateHash_key" ON "CanvasDocUpdate"("projectId", "generation", "updateHash");

-- raw SQL（Prisma 不可表达——卡文 T7 块三条 CHECK 同款先例）
ALTER TABLE "CanvasDocUpdate"
  ADD CONSTRAINT "canvas_doc_update_payload_le_16mib" CHECK (octet_length("update") <= 16777216),
  ADD CONSTRAINT "canvas_doc_update_seq_ge_first_wal_seq" CHECK ("seq" >= "firstWalSeq"),
  ADD CONSTRAINT "canvas_doc_update_frame_count_pos" CHECK ("frameCount" > 0);
