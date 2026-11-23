-- Y4b T8（spec 2026-11-22-y4b-annotation-security §0 条 2）：CanvasDoc.schemaVersion 缺省值
-- 5→6（threads 第六根物化批——与 CANVAS_DOC_SCHEMA_VERSION/CLIENT_PROTOCOL_VERSION 双常量同笔 bump）。
-- 不 UPDATE 旧行：开发库已 5 的行被装载版本门拒载重置文档（sv≠6 拒载）——无数据迁移。
-- 历史 CREATE TABLE 内 DEFAULT 4 与 v5 迁移 SET DEFAULT 5 均不动（c3a-schema.int.spec 扫历史
-- SQL 锁「缺省插入=常量」——本迁移为唯一缺省值改写点）。
-- 注：prisma migrate dev 产物附带的 DROP INDEX "pricing_rule_natural_key" 已人工裁剪
--（NULLS NOT DISTINCT 语义 Prisma 不可表达——check-migration-additive CRITICAL_INDEXES 硬拦同源
-- 先例：20261113021304_c3b1_oracle_barrier 同款处置）。
ALTER TABLE "CanvasDoc" ALTER COLUMN "schemaVersion" SET DEFAULT 6;
