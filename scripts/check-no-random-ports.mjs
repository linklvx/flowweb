#!/usr/bin/env node
// scripts/check-no-random-ports.mjs —— TD-32/C3 T24：随机端口清零门禁（三 section，零 allowlist）。
// ①随机段宽正则零命中（\d{2,5}+Math.floor(Math.random()*\d{1,5})——随机抽口碰撞面）
// ②freePort 装置零残留（helper 退役；net listen(0) 探口同归）
// ③测试/harness 固定端口档零命中（listen(<非0字面量>——含字符串口 '3001'）/COLLAB_PORT:'<非0数字>'；'0' 与 listen(0) 放行；
//   注释行/门禁自身/测试意图行（safeParse/expect 断言）排除；生产入口与 drill 手测配置不在测试扫描集）
// `--list`：输出全部命中 file:line（附录 A 清单单源=本脚本输出）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOTS = ['apps/api/src', 'apps/api/scripts', 'apps/web/src', 'packages', 'scripts'];
const EXT = /\.(ts|tsx|mjs|cjs|js)$/;
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'dist-drill', '.data', '.verify-logs', '.workbuddy-ai', 'outputs']);
const SELF = new Set(['scripts/check-no-random-ports.mjs', 'scripts/check-no-random-ports.test.mjs']);

const RANDOM_PORT = /\d{2,5}\s*\+\s*Math\.floor\(Math\.random\(\)\s*\*\s*\d{1,5}/;
const FREE_PORT = /\bfreePort\b/;
const FIXED_LISTEN = /\.listen\(\s*[1-9][0-9]{1,4}\s*[,)]|\.listen\(\s*['"][1-9][0-9]{1,4}['"]\s*[,)]/;
const FIXED_COLLAB_ENV = /COLLAB_PORT:\s*'[1-9][0-9]*'/;
const TESTISH = [/\/test-utils\//, /\/collab-harness\//, /\.(spec|int\.spec|e2e-spec)\.ts$/, /\.test\.mjs$/];

function isComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('*/');
}

/** 测试意图行：env 契约断言（safeParse/expect）不是 harness 端口绑定。 */
function isIntentLine(line) {
  return /safeParse\(|expect\(/.test(line);
}

/** 单文件文本扫描（纯函数——自测用）。section: 1|2|3。 */
export function scanSource(relPath, text, { section = 0 } = {}) {
  const testish = TESTISH.some((re) => re.test(relPath.replace(/\\/g, '/')));
  const out = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    if ((section === 0 || section === 1) && RANDOM_PORT.test(line)) out.push({ section: 1, file: relPath, line: i + 1, text: line.trim() });
    if ((section === 0 || section === 2) && FREE_PORT.test(line)) out.push({ section: 2, file: relPath, line: i + 1, text: line.trim() });
    if ((section === 0 || section === 3) && testish && !isIntentLine(line) && (FIXED_LISTEN.test(line) || FIXED_COLLAB_ENV.test(line)))
      out.push({ section: 3, file: relPath, line: i + 1, text: line.trim() });
  });
  return out;
}

function walk(absDir, relDir, files) {
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const rel = path.posix.join(relDir, e.name);
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      walk(path.join(absDir, e.name), rel, files);
      continue;
    }
    if (!EXT.test(e.name)) continue;
    if (SELF.has(rel)) continue;
    files.push(rel);
  }
}

/** 全仓扫描（CLI 与自测共用）。 */
export function scanRepo(root = ROOT) {
  const files = [];
  for (const r of SCAN_ROOTS) walk(path.join(root, r), r, files);
  const hits = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    hits.push(...scanSource(rel, text));
  }
  return { files, hits };
}

function main() {
  const list = process.argv.includes('--list');
  const { files, hits } = scanRepo();
  const bySection = [1, 2, 3].map((s) => hits.filter((h) => h.section === s));
  if (list) {
    console.log(`check-no-random-ports: list（scanned ${files.length} files；§1 ${bySection[0].length} / §2 ${bySection[1].length} / §3 ${bySection[2].length}）`);
    for (const h of hits) console.log(`§${h.section} ${h.file}:${h.line}  ${h.text}`);
    return 0;
  }
  if (hits.length > 0) {
    console.error(`check-no-random-ports: FAIL（§1 ${bySection[0].length} / §2 ${bySection[1].length} / §3 ${bySection[2].length}）`);
    for (const h of hits) console.error(`§${h.section} ${h.file}:${h.line}  ${h.text}`);
    return 1;
  }
  console.log(`PASS  check-no-random-ports（§1 随机段 0 / §2 freePort 0 / §3 固定端口档 0；scanned ${files.length} files）`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
