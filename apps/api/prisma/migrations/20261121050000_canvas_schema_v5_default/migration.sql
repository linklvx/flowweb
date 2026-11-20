-- Y4a T2（spec §0 条 9）：CanvasDoc.schemaVersion 缺省值 4→5（timelines 顶层根物化批——与
-- CANVAS_DOC_SCHEMA_VERSION/CLIENT_PROTOCOL_VERSION 双常量同笔 bump）。
-- 不 UPDATE 旧行：开发库已 4 的行被装载版本门拒载重置文档（sv≠5 拒载）——无数据迁移。
-- 历史 CREATE TABLE 内 DEFAULT 4 不动（c3a-schema.int.spec 扫历史 SQL 锁「缺省插入=常量」——
-- 本迁移为唯一缺省值改写点）。
ALTER TABLE "CanvasDoc" ALTER COLUMN "schemaVersion" SET DEFAULT 5;
