// scripts/verify-chain.test.mjs —— T-prep 元测试（plan 2026-10-12-y0b-5 Step 1 ①②③⑤⑥；裁定 24⑶ 三正交轴）
// 消费形态：verify 链 scripts-node-test 步列举本文件（node --test，非 glob——空 glob 假绿已修）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERIFY_STEPS, FAST_PREFIX_LEN, selectSteps } from './verify-manifest.mjs';
import { parseArgs } from './verify-chain.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ids = VERIFY_STEPS.map((s) => s.id);

// ③ 引入时 25 步基线常量（改门禁=改常量=有意识动作——防步骤被无声增删/重排；
//   Y0b-5 T12 授权插两步：immutability 紧随 additive、fresh-replay 紧随 migrate-diff；
//   Y0c T39b B0 授权插一步：check-collab-test-facade 紧随 check-collab-census〔façade 门禁
//   进 verify 链——plan T39b「B0 步门」，census 邻位=本批新门禁全在 fast 外惯例〕=26 步；
//   Y0c T42 B3 授权插一步：check-collab-module-size 紧随 check-collab-test-facade〔行数防倒退锚
//   进 verify 链——plan T42「B3 步门」，fast 外惯例同款〕=27 步）
const BASELINE_IDS = [
  'doc-gate', 'verify-indexes', 'check-migration-additive', 'check-migration-immutability', 'check-migrate-diff',
  'check-fresh-replay', 'check-pricing-coverage', 'check-ledger-single-writer', 'check-nginx-budget', 'shared-build',
  'shared-typecheck', 'shared-test', 'web-tsc', 'api-tsc', 'api-tsc-scripts',
  'api-nest-build', 'check-no-testutils-in-dist', 'web-test', 'api-test', 'web-lint',
  'check-ecosystem', 'check-spec-consistency', 'check-collab-census', 'check-collab-test-facade',
  'check-collab-module-size', 'scripts-node-test', 'api-eslint',
];

test('③ full 的 id 序列逐字等于引入时的 27 步基线常量（T42 +check-collab-module-size）', () => {
  assert.deepEqual(ids, BASELINE_IDS);
});

test('① 每个步骤 id 唯一', () => {
  assert.equal(new Set(ids).size, ids.length);
});

test('① cmd 引用的 scripts/*.mjs 存在（防拼写漂移）', () => {
  for (const s of VERIFY_STEPS) {
    for (const m of s.cmd.matchAll(/[A-Za-z0-9._/-]*scripts\/[A-Za-z0-9._/-]+\.mjs/g)) {
      assert.ok(fs.existsSync(path.join(ROOT, m[0])), `${s.id}: 引用的 ${m[0]} 不存在`);
    }
  }
});

test('① pnpm --filter 目标均为 workspace 包名', () => {
  const names = new Set();
  for (const dir of ['apps', 'packages']) {
    for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
      const pj = path.join(ROOT, dir, ent.name, 'package.json');
      if (fs.existsSync(pj)) names.add(JSON.parse(fs.readFileSync(pj, 'utf8')).name);
    }
  }
  for (const s of VERIFY_STEPS) {
    for (const m of s.cmd.matchAll(/--filter\s+(\S+)/g)) {
      assert.ok(names.has(m[1]), `${s.id}: --filter 目标 ${m[1]} 不在 workspace 包名集`);
    }
  }
});

test('② fast 的 id 序列逐字等于 full.slice(0, N)——前缀切片结构（两档不可能漂移）', () => {
  assert.deepEqual(selectSteps({ tier: 'fast' }).map((s) => s.id), ids.slice(0, FAST_PREFIX_LEN));
});

test('② nest build 与 check-no-testutils-in-dist 同档（fail-open 修复后拆开即空转/必红）', () => {
  const inFast = (id) => ids.indexOf(id) < FAST_PREFIX_LEN;
  assert.equal(inFast('api-nest-build'), inFast('check-no-testutils-in-dist'),
    'api-nest-build 与 check-no-testutils-in-dist 必须同在 fast 内或同在 fast 外');
});

test('db:true 恰为四步 DB 硬依赖（无 DATABASE_URL 即非零退出——口径"非零"：verify-indexes 是 throw exit 1）', () => {
  assert.deepEqual(ids.filter((_, i) => VERIFY_STEPS[i].db),
    ['verify-indexes', 'check-migrate-diff', 'check-fresh-replay', 'check-pricing-coverage']);
});

test('skip-db(full)===full.filter(s=>!s.db)——db 轴独立于前缀轴', () => {
  assert.deepEqual(
    selectSteps({ tier: 'full', skipDb: true }).map((s) => s.id),
    VERIFY_STEPS.filter((s) => !s.db).map((s) => s.id),
  );
});

test('② --static-only=fast∩skip-db（组合快捷）+ 默认 full + 参数矛盾拒绝', () => {
  assert.deepEqual(parseArgs([]), { tier: 'full', skipDb: false });
  assert.deepEqual(parseArgs(['--tier=fast', '--static-only']), { tier: 'fast', skipDb: true });
  assert.deepEqual(parseArgs(['--skip-db']), { tier: 'full', skipDb: true });
  assert.throws(() => parseArgs(['--tier=full', '--static-only']), /static-only.*fast/);
  assert.deepEqual(
    selectSteps(parseArgs(['--tier=fast', '--static-only'])).map((s) => s.id),
    selectSteps({ tier: 'fast', skipDb: true }).map((s) => s.id),
  );
});

test('⑤ plans/specs 无未跟踪 md（未跟踪的 plan 无门禁——本文件首 commit 即自证）', () => {
  const out = execSync('git ls-files --others --exclude-standard -- docs/superpowers/plans docs/superpowers/specs',
    { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(out, '', `未跟踪的计划/规格文档（门禁盲区）：\n${out}`);
});

test('⑥ scripts-node-test 列举集合 === 磁盘实际集合（根 scripts/+apps/api/scripts/ 双目录——空 glob 假绿修复的防漂移面）', () => {
  const dirs = ['scripts', 'apps/api/scripts'];
  const onDisk = dirs.flatMap((d) =>
    fs.readdirSync(path.join(ROOT, d))
      .filter((f) => f.endsWith('.test.mjs'))
      .map((f) => `${d}/${f}`))
    .sort();
  const step = VERIFY_STEPS.find((s) => s.id === 'scripts-node-test');
  const listed = step.cmd.split(/\s+/)
    .filter((t) => t.endsWith('.test.mjs'))
    .map((t) => t.replace(/^\.\//, ''))
    .sort();
  assert.deepEqual(listed, onDisk, '列举与磁盘漂移——新增/删除 *.test.mjs 未同步 manifest');
});
