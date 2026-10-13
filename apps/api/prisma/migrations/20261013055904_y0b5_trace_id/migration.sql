-- Y0b-5 T13：GenerationIntent.traceId 列+普通索引（审计读面"该 trace 下所有 intent"）。
-- 人工裁剪记录：migrate dev --create-only 产物附带的无关 `DROP INDEX "pricing_rule_natural_key"`
-- 已删除（Prisma 不可表达 NULLS NOT DISTINCT 语义的永久豁免对象——migrate diff 每次都想删它；
-- 硬拦名单 CRITICAL_INDEXES 同源，禁确认放行）。

-- AlterTable
ALTER TABLE "GenerationIntent" ADD COLUMN     "traceId" TEXT;

-- CreateIndex
CREATE INDEX "GenerationIntent_traceId_idx" ON "GenerationIntent"("traceId");
