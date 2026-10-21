-- Y1a+Y1b T9（用户裁定 2026-10-20 二选一）：execSeq 删除 @default(nextval) 兜底默认——
-- 显式 nextval（claim new/rearm 两处）全覆盖后，默认=第三条隐蔽取号路径，与「DB 为唯一权威，
-- 禁第二真源」的代际契约冲突；删默认后 create/createMany 缺列即 tsc 红+DB NOT NULL 红（结构性防漏）。
-- 手写单语句迁移（migrate dev 已知产出坏语句——DROP pricing_rule_natural_key+exec_seq 族，纪律=生成后
-- 手工修剪；本变更单语句直接手写等价修剪产物）。ALTER COLUMN DROP DEFAULT 不在 check-migration-additive
-- BREAKING 词表（DROP COLUMN/TABLE/CONSTRAINT/TYPE/SET NOT NULL/RENAME/TYPE）——无豁免登记必要。
ALTER TABLE "GenerationIntent" ALTER COLUMN "execSeq" DROP DEFAULT;
