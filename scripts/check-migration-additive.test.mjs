// scripts/check-migration-additive.test.mjs —— Y0b-5 T12：DROP INDEX 硬拦名单（红测先行）。
// analyzeSql 接收的是剥注释后的 bare SQL（主循环职责维持）；此处直测分类纯函数。
// Y1a+Y1b T2（裁定1）：显式豁免机制用例——命中放行 / 未命中维持硬拦。
// T2 质评收口（Minor-1）：judgeMigration 双盲红测——豁免放行不得影响 critical 拦截/dropIndex 警告。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSql, judgeMigration, CRITICAL_INDEXES, EXEMPTIONS, breakingTable, resolveExemptions } from './check-migration-additive.mjs';

test('T12 硬拦：DROP INDEX "pricing_rule_natural_key"→criticalIndex（资金唯一索引——migrate-diff 对比源不可见的双盲对象）', () => {
  const r = analyzeSql('DROP INDEX "pricing_rule_natural_key";');
  assert.equal(r.criticalIndex, 'pricing_rule_natural_key');
  assert.equal(r.breaking, null);
});

test('T12 硬拦形态容差：IF EXISTS / CONCURRENTLY / 无引号 / 小写关键字均命中', () => {
  assert.equal(analyzeSql('DROP INDEX IF EXISTS "pricing_rule_natural_key";').criticalIndex, 'pricing_rule_natural_key');
  assert.equal(analyzeSql('DROP INDEX CONCURRENTLY "pricing_rule_natural_key";').criticalIndex, 'pricing_rule_natural_key');
  assert.equal(analyzeSql('drop index pricing_rule_natural_key;').criticalIndex, 'pricing_rule_natural_key');
});

test('名单外 DROP INDEX 维持 WARNING 档（性能非正确性——不训练绕过）', () => {
  const r = analyzeSql('DROP INDEX "CanvasDoc_generation_idx";');
  assert.equal(r.criticalIndex, null);
  assert.equal(r.dropIndex, true);
  assert.equal(r.breaking, null);
});

test('良性迁移全绿 + 既有 BREAKING 断言不回归', () => {
  const ok = analyzeSql('ALTER TABLE "GenerationIntent" ADD COLUMN "traceId" TEXT;');
  assert.equal(ok.breaking, null); assert.equal(ok.criticalIndex, null); assert.equal(ok.dropIndex, false);
  assert.equal(analyzeSql('ALTER TABLE "X" DROP COLUMN "legacy";').breaking !== null, true);
  assert.equal(analyzeSql('CREATE UNIQUE INDEX "i" ON "T"("a");').breaking, null);
});

test('硬拦名单与 migrate-diff-allowlist 唯一永久豁免同源（人工同步 pin——allowlist 按列描述不含索引名）', () => {
  assert.deepEqual([...CRITICAL_INDEXES], ['pricing_rule_natural_key']);
});

test('裁定1 豁免命中：登记迁移+登记表的 DROP COLUMN→exempted（不计违规）', () => {
  const sql = 'ALTER TABLE "Media" ADD COLUMN "a" TEXT,\nDROP COLUMN "status",\nADD COLUMN "status" "MediaStatus" NOT NULL DEFAULT \'pending\';';
  const { exempted, violations } = resolveExemptions('20261020200300_nodeartifact_projection_v3', sql);
  assert.equal(exempted.length, 1);
  assert.equal(exempted[0].table, 'Media');
  assert.ok(exempted[0].reason.length > 0);
  assert.equal(violations.length, 0);
});

test('裁定1 豁免未命中=维持硬拦：未登记表/未登记迁移/表名不可提取均红（拦截力不变）', () => {
  // 同迁移内未登记表照红——豁免精确到〈迁移,表〉，文件级一刀切禁止
  const two = 'ALTER TABLE "Media" DROP COLUMN "status"; ALTER TABLE "GenerationIntent" DROP COLUMN "paramsHash";';
  const r = resolveExemptions('20261020200300_nodeartifact_projection_v3', two);
  assert.equal(r.exempted.length, 1);
  assert.equal(r.violations.length, 1);
  // 未登记迁移全红
  assert.equal(resolveExemptions('99999999999999_other', two).violations.length, 2);
  // 表名不可提取（裸 DROP CONSTRAINT）→红兜底
  assert.equal(resolveExemptions('20261020200300_nodeartifact_projection_v3', 'DROP CONSTRAINT "x";').violations.length, 1);
});

test('裁定1 breakingTable 形态：ALTER/DROP/TRUNCATE TABLE 与 DROP TYPE 取表名，无表引用=null', () => {
  assert.equal(breakingTable('ALTER TABLE "Media" DROP COLUMN "status"'), 'Media');
  assert.equal(breakingTable('DROP TABLE "CanvasDoc"'), 'CanvasDoc');
  assert.equal(breakingTable('TRUNCATE "Media"'), 'Media');
  assert.equal(breakingTable('TRUNCATE TABLE "Media"'), 'Media');
  assert.equal(breakingTable('DROP TYPE "MediaStatus"'), 'MediaStatus');
  assert.equal(breakingTable('DROP CONSTRAINT "x"'), null);
});

test('裁定1 EXEMPTIONS 登记面 pin（豁免清单变更须同 commit 人工审阅——两登记=Media.status enum 硬切+T2 质评收口 size Int→BigInt）', () => {
  assert.deepEqual(Object.keys(EXEMPTIONS), ['20261020200300_nodeartifact_projection_v3', '20261020211610_media_v3_natural_sniff_size']);
  assert.deepEqual(Object.keys(EXEMPTIONS['20261020200300_nodeartifact_projection_v3']), ['Media']);
  assert.deepEqual(Object.keys(EXEMPTIONS['20261020211610_media_v3_natural_sniff_size']), ['Media']);
});

test('质评 Minor-1 双盲红测：已豁免迁移+critical DROP INDEX→必须红（judgeMigration.bad>0 ⇔ main exit 1——process.exit(bad?1:0)）', () => {
  // 场景：豁免迁移内 BREAKING（命中豁免放行）+ 硬拦名单 DROP INDEX——旧代码走 breaking 分支=双盲放行
  const sql = 'ALTER TABLE "Media" DROP COLUMN "status"; DROP INDEX "pricing_rule_natural_key";';
  const j = judgeMigration('20261020211610_media_v3_natural_sniff_size', sql);
  assert.equal(j.criticalIndex, 'pricing_rule_natural_key');
  assert.equal(j.exempted.length, 1);   // 豁免照常放行（不因 critical 收紧豁免面）
  assert.equal(j.violations.length, 0);
  assert.ok(j.bad >= 1, '豁免放行不得吞掉 critical 拦截——必须红 exit 1');
});

test('质评 Minor-1 连带警告：已豁免迁移+普通 DROP INDEX→豁免放行+dropIndex 警告不丢', () => {
  const j = judgeMigration('20261020211610_media_v3_natural_sniff_size', 'ALTER TABLE "Media" DROP COLUMN "status"; DROP INDEX "Media_legacy_idx";');
  assert.equal(j.criticalIndex, null);
  assert.equal(j.exempted.length, 1);
  assert.equal(j.bad, 0);                // 无 critical=不红
  assert.equal(j.warned, 1);             // 但 WARNING 必须保留
});

test('judgeMigration 基线：纯 additive 迁移全绿（bad=0/warned=0/零豁免零违规）', () => {
  const j = judgeMigration('99999999999999_any', 'ALTER TABLE "Media" ADD COLUMN "a" TEXT; CREATE INDEX "i" ON "T"("a");');
  assert.equal(j.bad, 0);
  assert.equal(j.warned, 0);
  assert.deepEqual(j.exempted, []);
  assert.deepEqual(j.violations, []);
});
