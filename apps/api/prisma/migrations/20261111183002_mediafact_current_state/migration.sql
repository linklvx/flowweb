-- C2-1（spec 2026-11-11-foundation-batch-design.md §3.1）：MediaFact 当前态表（additive）——每 media 每
-- factType 一行当前事实（@@id([mediaId,factType])；mediaId 前缀查询被复合主键左前缀覆盖，不加额外索引）；
-- updatedAt 自第一天即 timestamptz(3)（既有 ~167 列 naive 时间墙混用归 C1 终态 rebaseline——新表不欠账）。
-- 人工裁剪声明（20261020211610 media_v3 先例——check-migration-additive.mjs 头注）：migrate dev 生成物
-- 附带的无关语句 DROP INDEX "pricing_rule_natural_key" 已裁（NULLS NOT DISTINCT raw 形态 Prisma diff
-- 不可见=硬拦名单 CRITICAL_INDEXES 对象，绝不删除）。

-- CreateTable
CREATE TABLE "MediaFact" (
    "mediaId" TEXT NOT NULL,
    "factType" TEXT NOT NULL,
    "factVersion" BIGINT NOT NULL,
    "payload" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MediaFact_pkey" PRIMARY KEY ("mediaId","factType")
);

-- AddForeignKey
ALTER TABLE "MediaFact" ADD CONSTRAINT "MediaFact_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- factType 域约束（Prisma 无法表达 CHECK——raw 附）
ALTER TABLE "MediaFact" ADD CONSTRAINT "MediaFact_factType_check" CHECK ("factType" IN ('state','natural'));
