// scripts/check-exact-pins.test.mjs —— 判据载体自测（node --test scripts/ 消费——import 零副作用）
// Y1a T0：checkExactPins 六违反面（range spec/缺 dep/override 缺失/override 错值/file-type 误入
// overrides/lockfile 条目缺失）+全绿夹具。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkExactPins, EXACT_PINS, OVERRIDES, LOCKFILE_ENTRIES } from './check-exact-pins.mjs';

const okApi = { dependencies: { yjs: '13.6.32', sharp: '0.34.5', 'file-type': '16.5.4' } };
const okWeb = { dependencies: { yjs: '13.6.32', 'fast-deep-equal': '3.1.3' } };
const okRoot = { pnpm: { overrides: { yjs: '13.6.32', sharp: '0.34.5', 'fast-deep-equal': '3.1.3' } } };
const okLock = [
  'lockfileVersion: 9.0',
  'importers:',
  'packages:',
  '  sharp@0.34.5:',
  '  fast-deep-equal@3.1.3: {}',
  '  file-type@16.5.4:',
  '  file-type@20.4.1:',   // @nestjs/common 传递条目——合法共存（非 exact 断言对象）
  '    dependencies:',
  '      @nestjs/common: 10.4.18',
].join('\n');
const okArgs = () => ({
  pkgJsons: { 'apps/api/package.json': structuredClone(okApi), 'apps/web/package.json': structuredClone(okWeb) },
  rootJson: structuredClone(okRoot),
  lock: okLock,
});

test('全绿夹具：spec 逐字 exact+overrides 齐+lockfile 条目在（file-type@20 共存不误伤）', () => {
  assert.deepEqual(checkExactPins(okArgs()), []);
});

test('range spec 红（^13.6.32≠exact——现状起点即此形态）', () => {
  const a = okArgs();
  a.pkgJsons['apps/api/package.json'].dependencies.yjs = '^13.6.32';
  assert.deepEqual(checkExactPins(a), [
    'apps/api/package.json: dependencies.yjs="^13.6.32"（必须 exact "13.6.32"——禁 ^/~ range）',
  ]);
});

test('~ range 与错版本同红（sharp）', () => {
  const a = okArgs();
  a.pkgJsons['apps/api/package.json'].dependencies.sharp = '~0.34.5';
  const b = okArgs();
  b.pkgJsons['apps/api/package.json'].dependencies.sharp = '0.34.6';
  assert.equal(checkExactPins(a).length, 1);
  assert.equal(checkExactPins(b).length, 1);
});

test('依赖缺失红（file-type 未安装=T0 实现前形态）', () => {
  const a = okArgs();
  delete a.pkgJsons['apps/api/package.json'].dependencies['file-type'];
  assert.deepEqual(checkExactPins(a), ['apps/api/package.json: dependencies.file-type 缺失']);
});

test('文件不可读红', () => {
  const a = okArgs();
  delete a.pkgJsons['apps/web/package.json'];
  assert.deepEqual(checkExactPins(a), ['apps/web/package.json: 不可读']);
});

test('overrides 缺键/错值红', () => {
  const a = okArgs();
  delete a.rootJson.pnpm.overrides.yjs;
  assert.deepEqual(checkExactPins(a), ['package.json pnpm.overrides.yjs="(缺失)"（必须 "13.6.32"）']);
  const b = okArgs();
  b.rootJson.pnpm.overrides.sharp = '^0.34.5';
  assert.equal(checkExactPins(b).length, 1);
});

test('overrides 整段缺失=三键全红（根 package.json 无 pnpm 字段）', () => {
  const a = okArgs();
  a.rootJson = {};
  assert.equal(checkExactPins(a).length, Object.keys(OVERRIDES).length);
});

test('file-type 误入 overrides 红（@nestjs/common 硬依赖 20.x——强降禁令）', () => {
  const a = okArgs();
  a.rootJson.pnpm.overrides['file-type'] = '16.5.4';
  assert.deepEqual(checkExactPins(a), [
    'package.json pnpm.overrides 含 file-type（禁——@nestjs/common 硬依赖 file-type 20.x，全局 override 强降=破坏 Nest 用面；api 直依赖 exact 已锁自身消费面）',
  ]);
});

test('lockfile pinned 条目缺失红（改 package.json 未 install 形态）', () => {
  const a = okArgs();
  a.lock = a.lock.replace('  file-type@16.5.4:\n', '');
  assert.deepEqual(checkExactPins(a), [
    'pnpm-lock.yaml: file-type@16.5.4 packages 段条目缺失（改 package.json 后须 pnpm install 更新 lockfile）',
  ]);
});

test('lockfile snapshots 段条目（四空格）不满足锚（两空格行首锚——check-hocuspocus-pin 同手法）', () => {
  const a = okArgs();
  a.lock = a.lock.replace('  sharp@0.34.5:', '    sharp@0.34.5:');
  assert.equal(checkExactPins(a).length, 1);
});

test('常量表自恰：EXACT_PINS 两文件/OVERRIDES 三键/LOCKFILE_ENTRIES 三键（manifest 契约防无声缩水）', () => {
  assert.deepEqual(Object.keys(EXACT_PINS), ['apps/api/package.json', 'apps/web/package.json']);
  assert.deepEqual(Object.keys(EXACT_PINS['apps/api/package.json']).sort(), ['file-type', 'sharp', 'yjs']);
  assert.deepEqual(Object.keys(EXACT_PINS['apps/web/package.json']).sort(), ['fast-deep-equal', 'yjs']);
  assert.deepEqual(Object.keys(OVERRIDES).sort(), ['fast-deep-equal', 'sharp', 'yjs']);
  assert.deepEqual(Object.keys(LOCKFILE_ENTRIES).sort(), ['fast-deep-equal', 'file-type', 'sharp']);
});
