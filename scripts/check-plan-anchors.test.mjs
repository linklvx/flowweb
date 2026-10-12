// scripts/check-plan-anchors.test.mjs —— T-prep ④（裁定 23⑭ 符号锚——行号 advisory 防腐烂）+
// 语义冲突扫描（裁定 22⑫：已修订条款旧短语不得以活条款残留）。node --test 消费（verify 链列举）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STALE_PHRASES, extractSymbol, scanAnchors, scanStalePhrases, createResolver, ACTIVE_DOCS } from './check-plan-anchors.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── 符号锚形态 ──
const fxFiles = {
  'src/a.ts': ['const x = 1;', 'export const shouldConnect = true;', 'const y = 2;'],
  'src/b.ts': ['export const CloseActionKind = 1;', 'const z = 3;'],
};
const fxResolve = (token) => (token in fxFiles ? { rel: token } : token.includes('/') ? { missing: true } : { skip: 'unresolved-basename' });
const fxRead = (rel) => fxFiles[rel];

test('④ 主断言 pass：文件存在 ∧ 引用行 ±5 内含符号', () => {
  const r = scanAnchors('doc.md', '置位点 `src/a.ts:2` shouldConnect 由库置位', fxResolve, fxRead);
  assert.deepEqual(r.errors, []);
  assert.equal(r.checked, 1);
});

test('④ 坏符号：±5 行不含引用符号 → error', () => {
  const r = scanAnchors('doc.md', '置位 `src/b.ts:2` shouldConnect 锚', fxResolve, fxRead);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /src\/b\.ts:2.*shouldConnect/);
});

test('④ 坏路径（含 / 的明确路径不存在）→ error', () => {
  const r = scanAnchors('doc.md', '见 `src/gone.ts:10` 符号', fxResolve, fxRead);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /src\/gone\.ts/);
});

test('④ 行号越界只 WARN（advisory 防腐烂——大改后行号必漂，纯行号硬门=必关之门）', () => {
  const r = scanAnchors('doc.md', '旧锚 `src/a.ts:999` shouldConnect', fxResolve, fxRead);
  assert.deepEqual(r.errors, []);
  assert.equal(r.warns.filter((w) => /行号越界/.test(w)).length, 1);
});

test('④ 简称（无扩展名）不进入检查；裸名多命中/零命中 skip 不红', () => {
  const r = scanAnchors('doc.md', 'runtime:1023 与 gateway:694 与 esm:257 均为简称；foo.ts:1 为未解析裸名', fxResolve, fxRead);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warns.length >= 1);
});

test('④ 符号提取：批次/版本编号（Y0b-3/v2.3/T13/W3C）不算符号——只验文件存在', () => {
  assert.equal(extractSymbol('，Y0b-3 T9）禁新建'), null);
  assert.equal(extractSymbol('（v2.3 修正：唯一→普通）'), null);
  assert.equal(extractSymbol(' spec §10 metric-names'), null);
  assert.equal(extractSymbol(' shouldConnect 置位'), 'shouldConnect');
  assert.equal(extractSymbol(' CloseActionKind 五档'), 'CloseActionKind');
  assert.equal(extractSymbol(' AUTH_WAIT_TIMEOUT_MS（10s）'), 'AUTH_WAIT_TIMEOUT_MS');
});

test('④ 无可提取符号 → 降为存在性检查（不红）', () => {
  const r = scanAnchors('doc.md', '锚 `src/a.ts:1`（中文注释行）', fxResolve, fxRead);
  assert.deepEqual(r.errors, []);
});

// ── 语义冲突扫描（裁定 22⑫）──
test('删除线内的旧短语合法；活条款位置的旧短语 → error；修正标记行（引用性提及）合法', () => {
  const text = [
    '正常行：~~复用 isRetryableAppendError（旧方案）~~ 已被推翻。',
    '残留行：本方案部分唯一索引约束。',
    '引用行：原"部分唯一索引"废（裁定 16⑪ 修正——唯一→普通）。',
  ].join('\n');
  const errors = scanStalePhrases('doc.md', text, [{ phrase: '部分唯一索引', note: 'test' }, { phrase: '复用 isRetryableAppendError', note: 'test' }]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /doc\.md:2.*部分唯一索引/);
});

test('STALE_PHRASES 起步集来自本 plan §0 裁决表（16⑪/6/18④）且非空', () => {
  assert.ok(STALE_PHRASES.length >= 3);
  assert.ok(STALE_PHRASES.some((p) => p.phrase === '部分唯一索引'));
});

// ── 集成：活跃文档白名单扫描零 error（进 verify 全量——node --test 列举含本文件）──
test('集成：ACTIVE_DOCS 白名单文档扫描零 error（历史 plans/specs 是事实快照不追溯）', () => {
  const resolve = createResolver(ROOT);
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
  const allErrors = [];
  for (const rel of ACTIVE_DOCS) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `ACTIVE_DOCS 条目不存在：${rel}`);
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const r = scanAnchors(rel, text, resolve, read);
    allErrors.push(...r.errors, ...scanStalePhrases(rel, text));
  }
  assert.deepEqual(allErrors, [], `锚点/语义冲突违规：\n${allErrors.slice(0, 30).join('\n')}`);
});
