-- Y1a+Y1b T5 质评收口（Important-1）：VideoWork.videoMediaId 补普通索引——
-- 新写热路径兜底（已发布作品读门 assertMediaReadable 对 videoMediaId 做 findFirst 全表扫；
-- 无索引时作品量增长即线性退化）。additive 单语句，零豁免需求。
-- 人工裁剪声明（T2 先例——check-migration-additive.mjs 头注）：migrate diff 生成物附带两族无关语句已裁——
-- ①DROP INDEX "pricing_rule_natural_key"（NULLS NOT DISTINCT raw 形态 Prisma diff 不可见=金标登记漂移，
--   硬拦名单对象，绝不删除）；
-- ②GenerationIntent.execSeq SET/DROP DEFAULT+DROP SEQUENCE "exec_seq"（Sequence vs DbGenerated
--   introspect 形态差=金标登记漂移——序列与列默认维持 20261020200300 原状不动）。

-- CreateIndex
CREATE INDEX "VideoWork_videoMediaId_idx" ON "VideoWork"("videoMediaId");
