-- Y1b T2 质评收口（Important-1）：Media 补列 delta——natural/sniffed 族+origin/审计锚+objectKey/sha256
-- + size INTEGER→BIGINT 破坏性硬切（v10 裁决：Int 2.147GB 上限根修——spec v14 reset runbook 全表部署，
-- 无存量数据；check-migration-additive EXEMPTIONS 登记放行）。materializeError 不加（v11 由
-- NodeArtifact.state=failed+MATERIALIZE_FAILED errorCode 路径取代——T12）。
-- 人工裁剪声明（T2 先例——check-migration-additive.mjs 头注）：migrate dev 生成物附带两条无关语句已裁——
-- ①DROP INDEX "pricing_rule_natural_key"（NULLS NOT DISTINCT raw 形态 Prisma diff 不可见=金标登记漂移，
--   硬拦名单对象，绝不删除）；
-- ②GenerationIntent.execSeq SET/DROP DEFAULT+DROP SEQUENCE "exec_seq"（Sequence vs DbGenerated
--   introspect 形态差=金标登记漂移——序列与列默认维持 20261020200300 原状不动）。

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "artifactIndex" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "naturalHeight" INTEGER,
ADD COLUMN     "naturalRotation" INTEGER,
ADD COLUMN     "naturalSource" TEXT,
ADD COLUMN     "naturalWidth" INTEGER,
ADD COLUMN     "objectKey" TEXT,
ADD COLUMN     "objectSha256" TEXT,
ADD COLUMN     "sniffedMimeType" TEXT,
ADD COLUMN     "sourceExecSeq" BIGINT,
ADD COLUMN     "sourceIntentRowId" TEXT,
ALTER COLUMN     "size" SET DATA TYPE BIGINT;
