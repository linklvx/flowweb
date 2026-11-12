// scripts/check-migration-immutability.test.mjs —— Y0b-5 T12-0b：迁移 sha256 棘轮四态（红测先行）
// 纯函数（scanTree/diffAgainstBaseline/mergeBaseline）+ tmp fixture 目录；main() 旗标接线由验收锚
// （改 y0b2_init 一行注释→红；恢复→绿）实证。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { scanTree, diffAgainstBaseline, mergeBaseline, rebaselineTree, parseArgs } from './check-migration-immutability.mjs';

function fixture(t, files) {
  // files: { '<dir>/<relpath>': '<content>' } —— 每用例独立 tmp 根，t.after 用毕即清
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-imm-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('scanTree：目录→{文件→sha256}（LF 归一化域——autocrlf 材料化翻行尾不产生假红）', (t) => {
  const root = fixture(t, { '20261009140100_y0b2_init/migration.sql': '-- hello\r\n-- world\r\n' });
  const tree = scanTree(root);
  assert.deepEqual(Object.keys(tree), ['20261009140100_y0b2_init']);
  const expect = createHash('sha256').update('-- hello\n-- world\n').digest('hex');
  assert.equal(tree['20261009140100_y0b2_init']['migration.sql'], expect);
});

test('T12-0b 事故类①内容变更→红：基线化 migration.sql 改一行注释即 diff 红', (t) => {
  const root = fixture(t, { '20261010000000_a/migration.sql': '-- v1\n', '20261011000000_b/migration.sql': '-- b\n' });
  const baseline = scanTree(root);
  fs.writeFileSync(path.join(root, '20261010000000_a/migration.sql'), '-- v1\n-- 被改了\n');
  const d = diffAgainstBaseline(scanTree(root), baseline);
  assert.equal(d.ok, false);
  assert.deepEqual(d.changedFiles, ['20261010000000_a/migration.sql']);
});

test('T12-0b 事故类②③删除/重命名（基线键消失）→红', (t) => {
  const root = fixture(t, { '20261010000000_a/migration.sql': '-- a\n', '20261011000000_b/migration.sql': '-- b\n' });
  const baseline = scanTree(root);
  fs.rmSync(path.join(root, '20261011000000_b'), { recursive: true });   // 删除=重命名的另一半（新名走 newDirs，旧名走 missingDirs）
  const d = diffAgainstBaseline(scanTree(root), baseline);
  assert.equal(d.ok, false);
  assert.deepEqual(d.missingDirs, ['20261011000000_b']);
});

test('T12-0b 事故类④基线目录内加文件→红（已提交迁移目录内容集不可变）', (t) => {
  const root = fixture(t, { '20261010000000_a/migration.sql': '-- a\n' });
  const baseline = scanTree(root);
  fs.writeFileSync(path.join(root, '20261010000000_a', 'extra.sql'), '-- smuggled\n');
  const d = diffAgainstBaseline(scanTree(root), baseline);
  assert.equal(d.ok, false);
  assert.deepEqual(d.extraFiles, ['20261010000000_a/extra.sql']);
});

test('T12-0b 新增迁移→非违规（ok=true+newDirs 提示）→ --write 吸收后归零', (t) => {
  const root = fixture(t, { '20261010000000_a/migration.sql': '-- a\n' });
  const baseline = scanTree(root);
  fs.mkdirSync(path.join(root, '20261013120000_traceId'));
  fs.writeFileSync(path.join(root, '20261013120000_traceId', 'migration.sql'), '-- new\n');
  const before = diffAgainstBaseline(scanTree(root), baseline);
  assert.equal(before.ok, true);
  assert.deepEqual(before.newDirs, ['20261013120000_traceId']);
  const merged = mergeBaseline(baseline, scanTree(root));
  const after = diffAgainstBaseline(scanTree(root), merged);
  assert.equal(after.ok, true);
  assert.deepEqual(after.newDirs, []);
  assert.deepEqual(Object.keys(merged), ['20261010000000_a', '20261013120000_traceId']);
});

test('棘轮单向性：--write（mergeBaseline）不吸收内容漂移——改了的行仍红，须人工改基线文件（可 diff 审阅）', (t) => {
  const root = fixture(t, { '20261010000000_a/migration.sql': '-- v1\n' });
  const baseline = scanTree(root);
  fs.writeFileSync(path.join(root, '20261010000000_a/migration.sql'), '-- v2\n');
  const merged = mergeBaseline(baseline, scanTree(root));
  assert.equal(merged['20261010000000_a']['migration.sql'], baseline['20261010000000_a']['migration.sql']);   // 原值不动
  assert.equal(diffAgainstBaseline(scanTree(root), merged).ok, false);
});

test('C1-1 --rebaseline 纯函数：基线整体替换为当前 tree（旧目录消失不再永红；removed/added 供审阅）', (t) => {
  const root = fixture(t, { '20260101000000_old/migration.sql': '-- old\n', '20260201000000_new/migration.sql': '-- new\n' });
  const oldBaseline = { '20250101000000_legacy': { 'migration.sql': 'deadbeef' } };
  const { next, removed, added } = rebaselineTree(scanTree(root), oldBaseline);
  assert.deepEqual(Object.keys(next), ['20260101000000_old', '20260201000000_new']);
  assert.deepEqual(removed, ['20250101000000_legacy']);   // 旧基线有而 tree 无（squash 删除面——审阅输出）
  assert.deepEqual(added, ['20260101000000_old', '20260201000000_new']);   // tree 有而旧基线无（首次基线化同面）
  // 旧棘轮对同一 tree 恒红（missingDirs=legacy 永不吸收）——rebaseline 后归零
  assert.equal(diffAgainstBaseline(scanTree(root), oldBaseline).ok, false);
  assert.equal(diffAgainstBaseline(scanTree(root), next).ok, true);
});

test('C1-1 rebaselineTree：目录内文件键排序（readdir 顺序不保证——确定性落盘 diff）', () => {
  const tree = { b: { 'z.sql': 'z', 'a.sql': 'a' }, a: { 'm.sql': 'm' } };
  const { next } = rebaselineTree(tree, {});
  assert.deepEqual(Object.keys(next), ['a', 'b']);
  assert.deepEqual(Object.keys(next.b), ['a.sql', 'z.sql']);   // 输入非序→输出按字典序
});

test('CLI 参数 fail-closed：未知旗标抛错（拼写错误不得静默裸跑）；三合法旗标解析', () => {
  assert.throws(() => parseArgs(['--rebaselin']), /未知参数: --rebaselin/);
  assert.throws(() => parseArgs(['--write', '--bogus']), /未知参数: --bogus/);
  assert.deepEqual(parseArgs([]), { write: false, rebaseline: false, confirm: false });
  assert.deepEqual(parseArgs(['--write']), { write: true, rebaseline: false, confirm: false });
  assert.deepEqual(parseArgs(['--rebaseline', '--confirm']), { write: false, rebaseline: true, confirm: true });
});
