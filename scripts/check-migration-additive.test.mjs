// scripts/check-migration-additive.test.mjs —— Y0b-5 T12：DROP INDEX 硬拦名单（红测先行）。
// analyzeSql 接收的是剥注释后的 bare SQL（主循环职责维持）；此处直测分类纯函数。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSql, CRITICAL_INDEXES } from './check-migration-additive.mjs';

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

test('硬拦名单与 migrate-diff-allowlist 唯一永久豁免同源（人工同步锚——allowlist 文本含该索引名）', () => {
  assert.deepEqual([...CRITICAL_INDEXES], ['pricing_rule_natural_key']);
});
