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

// ── 锚表结构（T42 B3 执法面钉死四文件+CI 双故障根修批 T10 扩三新文件=七文件+C3a-5/6/8 三新文件=十文件+C3b-2 oracle worker=十一文件+C3b-3 media-reference 两新文件=十三文件+C3b-4a deletion-barrier 四新文件=十七文件；residency 不入锚=片 A 文件非片 B 产物，设计 §7.2 口径） ──

test('SIZE_LIMITS：恰十七文件（gateway B3 实测终标+SG/DR/persistence 偏离 65/74 锚+CI 修复批三新文件+C3a-5 projector+C3a-6 binding-rebuild+C3a-8 backfill runner+C3b-2 oracle worker+C3b-3 media-reference 两新文件+C3b-4a deletion-barrier 四新文件），residency 不入锚', () => {
  const keys = Object.keys(SIZE_LIMITS);
  assert.equal(keys.length, 17);
  assert.ok(keys.every((k) => k.startsWith('apps/api/src/modules/collab/')));
  assert.ok(!keys.some((k) => k.includes('residency')), 'residency=片 A 文件非片 B 产物——不入锚');
  assert.ok(keys.some((k) => k.endsWith('collab.gateway.ts')));
  assert.ok(keys.some((k) => k.endsWith('collab-session-guard.service.ts')));
  assert.ok(keys.some((k) => k.endsWith('collab-doc-registry.service.ts')));
  assert.ok(keys.some((k) => k.endsWith('collab-persistence.service.ts')));
  assert.ok(keys.some((k) => k.endsWith('collab-limits.ts')));
  assert.ok(keys.some((k) => k.endsWith('collab-outbound-budget.ts')));
  assert.ok(keys.some((k) => k.endsWith('collab-heartbeat.ts')));
  assert.ok(keys.some((k) => k.endsWith('media-binding-projector.ts')));
  assert.ok(keys.some((k) => k.endsWith('binding-rebuild.service.ts')));
  assert.ok(keys.some((k) => k.endsWith('projection-backfill.runner.ts')));
  assert.ok(keys.some((k) => k.endsWith('oracle-worker.service.ts')));
  assert.ok(keys.some((k) => k.endsWith('media-reference.service.ts')));
  assert.ok(keys.some((k) => k.endsWith('media-referrer.registry.ts')));
  assert.ok(keys.some((k) => k.endsWith('deletion-barrier.service.ts')));
  assert.ok(keys.some((k) => k.endsWith('deletion-barrier.port.ts')));
  assert.ok(keys.some((k) => k.endsWith('deletion-barrier.metrics.ts')));
  assert.ok(keys.some((k) => k.endsWith('deletion-barrier.seal.ts')));
});

test('SIZE_LIMITS 锚值=B3 出口终标（gateway=实测重标〔偏离 65 兑现——plan ≤600 字面为防倒退锚非可达值〕；SG 1238/DR 1082=任务卡钉死值；persistence T14 实测重标 950→1037）+CI 修复批三新文件（T10 实测+1.3 余量：limits 42→55/budget 119→155/heartbeat 31→40）', () => {
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/collab.gateway.ts'], 1162);   // …→Y1c T24 1103→Y1c T27 1144→T27 收口 1150（boot replayAll 重派生接线 +6——净增面非膨胀，锚=实测同批）→C3a-8 修复批 1162（+1：C1 sink 申报道透传注释）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/collab-session-guard.service.ts'], 1414);   // T25 收口 +13→T30b 演练 1405（+34：P-2 反查双轨〔sec-websocket-key 键控台账+headerOf 双形态读取——T24 close 帧 live 投递断链修复，净增面非膨胀〕）→provider 4.8.0 升级批 1414（+9：removedClients 直通面归属判定〔forged-remove〕——净增面非膨胀）   // …→T12 1298→T22 收口批补账 1304→Y1c T24 1348（版本门 4406 terminal close 投递 closeUpgradeTerminal +44——净增面非膨胀，锚=实测同批）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/collab-doc-registry.service.ts'], 1162);   // T25 收口 +5（serverRestoredForm 方向标记）   // …→复核残留 1144→T22 收口批补账 1150（T26 三轮 loadPgSeq 装载缝 +6——净增面非膨胀，锚=实测同批）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/collab-persistence.service.ts'], 1215);   // …→T12 1091→T22 收口批补账 1105→Y1c T24 1123（origin 枚举计数 doc_update_origin_total +18——净增面非膨胀，锚=实测同批）→C3a-8 1160（+14：bindingRecoveryFace setter+reconciler 两钩）→C3a-8 修复批 1200（+40：C1 importPending/维护申报未覆盖/settle 入队/回退闭包）→复审 1211（+11：settle spool 清空门+replay onReplayed 清标记——恢复链假覆盖收口）→质量收口 1215（+4：settle 次序 I-1）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/collab-limits.ts'], 55);
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/collab-outbound-budget.ts'], 155);
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/collab-heartbeat.ts'], 42);   // …40→T22 收口批补账 42（enricher 钩 +2——净增面非膨胀，锚=实测同批）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/media-binding-projector.ts'], 147);   // C3a-5 新文件入锚（实测 112+1.3 余量）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/binding-rebuild.service.ts'], 273);   // C3a-6 新文件入锚（147+1.3）→C3b-5 重标 273（实测 210+1.3——controlledRebuildForMedia+置 dirty 锁门禁合规）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/projection-backfill.runner.ts'], 271);   // C3a-8 新文件入锚（实测 208+1.3 余量）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/oracle-worker.service.ts'], 380);   // C3b-2 新文件入锚（实测 295+定档 380 余量）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/media-reference.service.ts'], 231);   // C3b-3 新文件入锚（实测 177+1.3 余量）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/media-referrer.registry.ts'], 207);   // C3b-3 新文件入锚（实测 159+1.3 余量）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/deletion-barrier.service.ts'], 280);   // C3b-4a 新文件入锚（P1-2 后实测 204+1.3 余量）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/deletion-barrier.port.ts'], 130);   // C3b-4a 新文件入锚（P1-1 后实测 100+1.3 余量）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/deletion-barrier.metrics.ts'], 25);   // C3b-4a 新文件入锚（实测 15+1.3 余量）
  assert.equal(SIZE_LIMITS['apps/api/src/modules/collab/deletion-barrier.seal.ts'], 55);   // C3b-4a 新文件入锚（实测 39+1.3 余量——seal 叶子模块：SG import 本体即环的根修载体）
});

test('现状实测：十七文件全部限内（端到端触盘——真锚真文件，门禁 PASS 前提自证）', () => {
  const { structural, results } = checkSizes(SIZE_LIMITS, (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  assert.equal(structural, null);
  for (const r of results) assert.ok(r.pass, `${r.file} 实测 ${r.lines} > 锚 ${r.limit}`);
});
