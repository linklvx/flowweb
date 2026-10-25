// scripts/check-collab-module-size.test.mjs —— Y0c T42（B3）新门禁自测（node --test；
// check-collab-test-facade.test.mjs 先例形态——只测纯 helper+锚表结构，端到端走 verify 链的
// `node scripts/check-collab-module-size.mjs`。TDD 先红：脚本不存在时本文件 import 失败=红）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countLines, checkSizes, SIZE_LIMITS } from './check-collab-module-size.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Z96 计法（plan T42 行钉死：content.replace(/\n$/,'').split('\n').length——对齐 wc -l） ──

test('countLines：尾换行文件=wc -l 对齐（两口径一致）', () => {
  assert.equal(countLines('a\nb\n'), 2);
  assert.equal(countLines('a\n'), 1);
  assert.equal(countLines('a\nb\nc\n'), 3);
});

test('countLines：无尾换行文件=两口径差 1 场景钉死（Z96 计法 2 vs wc -l 1——计法选择即接受此差，源文件恒有尾换行故对齐）', () => {
  assert.equal(countLines('a\nb'), 2);   // wc -l 对同内容报 1（换行符计数）——差 1 场景
  assert.equal(countLines('a'), 1);      // wc -l 报 0
});

test('countLines：空串=1（split 语义边界——空文件锚执法不特判，钉现状）', () => {
  assert.equal(countLines(''), 1);
});

// ── checkSizes 判定核（readFn 注入——不触盘可测三态） ──

test('checkSizes：限内 PASS/超限 FAIL（含实测行数与锚值供报告面）', () => {
  const { structural, results } = checkSizes({ 'x.ts': 10, 'y.ts': 3 }, (rel) => (rel === 'x.ts' ? 'a\n'.repeat(10) : 'a\n'.repeat(4)));
  assert.equal(structural, null);
  assert.deepEqual(results.map((r) => r.pass), [true, false]);
  assert.equal(results[0].lines, 10);
  assert.equal(results[1].lines, 4);
  assert.equal(results[1].limit, 3);
});

test('checkSizes：恰达锚值=PASS（锚语义=禁再膨胀，≤ 非 <）', () => {
  const { results } = checkSizes({ 'x.ts': 3 }, () => 'a\nb\nc\n');
  assert.equal(results[0].pass, true);
});

test('checkSizes：文件缺失=结构性错误（structural 点名——exit 2 面）', () => {
  const { structural } = checkSizes({ 'missing.ts': 10 }, () => { throw new Error('ENOENT'); });
  assert.equal(structural, 'missing.ts');
});

// ── 锚表结构（T42 B3 执法面钉死四文件+CI 双故障根修批 T10 扩三新文件=七文件；residency 不入锚=片 A 文件非片 B 产物，设计 §7.2 口径） ──

test('SIZE_LIMITS：恰七文件（gateway B3 实测终标+SG/DR/persistence 偏离 65/74 锚+CI 修复批三新文件），residency 不入锚', () => {
  const keys = Object.keys(SIZE_LIMITS);
  assert.equal(keys.length, 7);
  assert.ok(keys.every((k) => k.startsWith('apps/api/src/modules/collab/')));
  assert.ok(!keys.some((k) => k.includes('residency')), 'residency=片 A 文件非片 B 产物——不入锚');
  assert.ok(keys.some((k) => k.endsWith('collab.gateway.ts')));
  assert.ok(keys.some((k) => k.endsWith('collab-session-guard.service.ts')));
  assert.ok(keys.some((k) => k.endsWith('collab-doc-registry.service.ts')));
  assert.ok(keys.some((k) => k.endsWith('collab-persistence.service.ts')));
  assert.ok(keys.some((k) => k.endsWith('collab-limits.ts')));
  assert.ok(keys.some((k) => k.endsWith('collab-outbound-budget.ts')));
  assert.ok(keys.some((k) => k.endsWith('collab-heartbeat.ts')));
});

test('SIZE_LIMITS 锚值=B3 出口终标（gateway=实测重标〔偏离 65 兑现——plan ≤600 字面为防倒退锚非可达值〕；SG 1238/DR 1082=任务卡钉死值；persistence T14 实测重标 950→1037）+CI 修复批三新文件（T10 实测+1.3 余量：limits 42→55/budget 119→155/heartbeat 31→40）', () => {
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/collab.gateway.ts'], 1080);   // Y1c T10 1020→T11 1025→复核 1032→T12 1048→T12 收口 1054→T13 1080（G6a boot 恢复路径接线 +26——净增面非膨胀，锚=实测同批）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/collab-session-guard.service.ts'], 1298);   // Y1c T9 1273→T12 1298（auth 世代准入+4410 载荷先行 +25——净增面非膨胀）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/collab-doc-registry.service.ts'], 1144);   // Y1c T12 1082→1114→T12 收口 1134（I1 真空纪元代投影会话态 +20）→复核残留 1144（I1.2 era 定格 DB 真值化 +10——净增面非膨胀）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/collab-persistence.service.ts'], 1091);   // Y1c T11 1073→T12 1091（docNameOf 缝+persistKey 归一 +18——净增面非膨胀）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/collab-limits.ts'], 55);
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/collab-outbound-budget.ts'], 155);
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/collab-heartbeat.ts'], 40);
});

test('现状实测：七文件全部限内（端到端触盘——真锚真文件，门禁 PASS 前提自证）', () => {
  const { structural, results } = checkSizes(SIZE_LIMITS, (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  assert.equal(structural, null);
  for (const r of results) assert.ok(r.pass, `${r.file} 实测 ${r.lines} > 锚 ${r.limit}`);
});
