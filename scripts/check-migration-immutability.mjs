#!/usr/bin/env node
// scripts/check-migration-immutability.mjs —— Y0b-5 T12-0b：迁移 sha256 棘轮（裁定 16⑫/22⑼）。
// 已提交迁移（=基线内目录）文件内容变更/删除/重命名（基线键消失——同事故类）/目录内加文件→红；
// 新增迁移→exit 0+提示，--write 落盘自增基线（有意识动作，同 --write-metric-names 先例——基线变更可 diff 审阅）。
// 棘轮单向：--write 只增新目录条目，绝不吸收既有条目漂移（漂移仍红，须人工改基线文件）。
// C1-1 rebaseline（2026-11-12）：squash 删除旧目录后单向棘轮永不收敛（missingDirs 恒红）——显式
// `--rebaseline --confirm` 双旗标重建基线（整文件替换，git diff 可审阅；纯函数 rebaselineTree 打印
// removed/added 供审阅）。裸 --rebaseline 或缺 --confirm=fail-closed；空迁移树拒绝重建（防清空基线）。
// 参数面 fail-closed（2026-11-13 评审 Minor-5）：--write/--rebaseline/--confirm 之外任意旗标=用法错误
// exit 2（拼写错误不得静默降级为裸跑）；rebaselineTree 目录内文件键排序（确定性落盘 diff）。
// 基线缺失且无 --write→红（fail-closed——防"无基线恒绿"静默失效，对齐 additive 的基线存在性断言）。
// ★双载体：pnpm verify（静态步）+ deploy preflight（deploy.sh:67 段）+ 服务器侧 cutover ③（单载体=服务器侧可绕过）。
// 第三消费=deploy-guard --post-restart（scripts/migration-checksums.json 键作集合断言的仓内侧——T12-0a）。
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const MIG_DIR = join(ROOT, 'apps/api/prisma/migrations');
const BASELINE_FILE = join(ROOT, 'scripts/migration-checksums.json');
const ALLOWED_ARGS = ['--write', '--rebaseline', '--confirm'];

/** CLI 参数判定（纯函数）：未知旗标 fail-closed（main 捕获→exit 2 用法错误；拼写错误不得静默裸跑）。 */
export function parseArgs(argv) {
  const unknown = argv.filter((a) => !ALLOWED_ARGS.includes(a));
  if (unknown.length) throw new Error(`未知参数: ${unknown.join(' ')}（仅支持 ${ALLOWED_ARGS.join(' / ')}）`);
  return { write: argv.includes('--write'), rebaseline: argv.includes('--rebaseline'), confirm: argv.includes('--confirm') };
}

/** 扫描迁移树：{ <dir>: { <relpath（'/' 分隔）>: sha256 } }——仅 /^\d+_/ 目录，目录内文件全量（含子目录）。
 * 哈希域=LF 归一化内容（\r\n→\n）：core.autocrlf=true 材料化（clone/checkout 重写）会翻行尾——
 * 裸字节哈希对同一 git 内容产生假红；归一化与 git blob 内容模型对齐（实测锚：checkout 重写前后同 hash）。 */
export function scanTree(migDir) {
  const tree = {};
  const hashLf = (p) => createHash('sha256').update(readFileSync(p).toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
  const walk = (dir, files, prefix) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) walk(join(dir, ent.name), files, `${prefix}${ent.name}/`);
      else files[prefix + ent.name] = hashLf(join(dir, ent.name));
    }
  };
  if (!existsSync(migDir)) return tree;
  for (const d of readdirSync(migDir, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d+_/.test(e.name)).map((e) => e.name).sort()) {
    tree[d] = {};
    walk(join(migDir, d), tree[d], '');
  }
  return tree;
}

/** 纯判据：tree 对 baseline 的四态分型。ok=无违规（newDirs 非空不算违规——合法新增走 --write）。 */
export function diffAgainstBaseline(tree, baseline) {
  const changedFiles = [], missingDirs = [], extraFiles = [], newDirs = [];
  for (const dir of Object.keys(baseline).sort()) {
    if (!tree[dir]) { missingDirs.push(dir); continue; }
    for (const f of Object.keys(baseline[dir]).sort()) {
      if (tree[dir][f] === undefined) extraFiles.push(`${dir}/${f}`);   // 基线文件被删=目录内容集变化，同事故类
      else if (tree[dir][f] !== baseline[dir][f]) changedFiles.push(`${dir}/${f}`);
    }
    for (const f of Object.keys(tree[dir]).sort()) if (baseline[dir][f] === undefined) extraFiles.push(`${dir}/${f}`);
  }
  for (const dir of Object.keys(tree).sort()) if (baseline[dir] === undefined) newDirs.push(dir);
  return { ok: missingDirs.length === 0 && changedFiles.length === 0 && extraFiles.length === 0, changedFiles, missingDirs, extraFiles, newDirs };
}

/** 棘轮单向合并：只吸收 newDirs，既有条目原样保留（漂移不吸收）。键排序落盘（稳定 diff）。 */
export function mergeBaseline(baseline, tree) {
  const merged = { ...baseline };
  for (const dir of Object.keys(tree)) if (merged[dir] === undefined) merged[dir] = tree[dir];
  return Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
}

/** rebaseline 纯函数（C1-1）：基线**整体替换**为当前 tree（squash/删除旧目录的显式有意识动作——
 *  旧模式 mergeBaseline 只增不删，missingDirs 永红）。removed=旧基线有而 tree 无（审阅面），
 *  added=tree 有而旧基线无。目录键+目录内文件键均排序落盘（readdir 顺序不保证——确定性 diff）。 */
export function rebaselineTree(tree, baseline) {
  const removed = Object.keys(baseline ?? {}).filter((d) => tree[d] === undefined).sort();
  const added = Object.keys(tree).filter((d) => baseline?.[d] === undefined).sort();
  const sorted = Object.fromEntries(Object.keys(tree).sort().map((k) => [
    k,
    Object.fromEntries(Object.keys(tree[k]).sort().map((f) => [f, tree[k][f]])),
  ]));
  return { next: sorted, removed, added };
}

function main() {
  let flags;
  try { flags = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`immutability FAIL: ${e.message}`); process.exit(2); }
  const { write: WRITE, rebaseline: REBASELINE, confirm: CONFIRM } = flags;
  if (!existsSync(MIG_DIR)) { console.error('immutability FAIL: migrations 目录缺失'); process.exit(1); }
  const tree = scanTree(MIG_DIR);
  let baseline = null;
  if (existsSync(BASELINE_FILE)) {
    try { baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')); } catch { /* 损坏走下式 fail-closed */ }
  }
  if (REBASELINE) {
    if (!CONFIRM) { console.error('immutability FAIL: --rebaseline 须与 --confirm 同传（显式重建基线——替换文件 git diff 可审阅；裸 --rebaseline 拒绝执行）'); process.exit(1); }
    if (Object.keys(tree).length === 0) { console.error('immutability FAIL: 迁移目录为空——拒绝 rebaseline 清空基线（fail-closed）'); process.exit(1); }
    const { next, removed, added } = rebaselineTree(tree, baseline);
    writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + '\n');
    console.log(`immutability --rebaseline --confirm: 基线重建 ${Object.keys(baseline ?? {}).length} → ${Object.keys(next).length} 目录 → ${relative(ROOT, BASELINE_FILE)}（整文件替换——git diff 审阅）`);
    if (removed.length) console.log(`  移除 ${removed.length} 目录:\n  - ${removed.join('\n  - ')}`);
    if (added.length) console.log(`  新增 ${added.length} 目录:\n  + ${added.join('\n  + ')}`);
    process.exit(0);
  }
  if (!baseline) {
    if (!WRITE) { console.error(`immutability FAIL: 基线 ${relative(ROOT, BASELINE_FILE)} 缺失/损坏——先跑 --write 首建（fail-closed：无基线不得恒绿）`); process.exit(1); }
    writeFileSync(BASELINE_FILE, JSON.stringify(mergeBaseline({}, tree), null, 2) + '\n');
    console.log(`immutability --write: 基线首建 ${Object.keys(tree).length} 目录 → ${relative(ROOT, BASELINE_FILE)}`);
    process.exit(0);
  }
  const d = diffAgainstBaseline(tree, baseline);
  if (d.missingDirs.length) console.error(`immutability FAIL: 基线目录消失（删除/重命名——已提交迁移不可变）:\n  - ${d.missingDirs.join('\n  - ')}`);
  if (d.changedFiles.length) console.error(`immutability FAIL: 已提交迁移文件内容变更:\n  - ${d.changedFiles.join('\n  - ')}`);
  if (d.extraFiles.length) console.error(`immutability FAIL: 基线目录文件集变化（文件被删/加）:\n  - ${d.extraFiles.join('\n  - ')}`);
  if (!d.ok) { console.error('immutability: 红已提交迁移不可变——修正工作树（git checkout）或人工审阅后改基线文件（可 diff 审阅的有意识动作）'); process.exit(1); }
  if (d.newDirs.length) {
    if (!WRITE) {
      console.log(`immutability NOTICE: 新增迁移（未基线化，暂不受棘轮保护）:\n  + ${d.newDirs.join('\n  + ')}\n  落盘基线: node scripts/check-migration-immutability.mjs --write（与迁移同 commit 审阅）`);
      process.exit(0);
    }
    writeFileSync(BASELINE_FILE, JSON.stringify(mergeBaseline(baseline, tree), null, 2) + '\n');
    console.log(`immutability --write: 基线自增 +${d.newDirs.length} 目录（${d.newDirs.join(', ')}）→ ${relative(ROOT, BASELINE_FILE)}`);
    process.exit(0);
  }
  if (WRITE) console.log('immutability --write: 无新增——基线不变');
  console.log(`check-migration-immutability OK: ${Object.keys(baseline).length} 迁移 ⊆ 基线（内容无漂移）`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
