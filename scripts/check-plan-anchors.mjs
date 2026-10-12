#!/usr/bin/env node
// scripts/check-plan-anchors.mjs —— T-prep ④（裁定 23⑭ 符号锚形态——行号 advisory 防腐烂）+
// 语义冲突扫描（裁定 22⑫：已修订条款旧短语不得以活条款残留——v2→v2.x 多轮修订的双源漂移人工清理不可靠）。
// 主断言 = 文件存在 ∧ 引用行 ±5 内含引用处标识符（从 path:line 后符号文本提取）；纯行号越界只 WARN
// （本批大改 canvasCollabRuntime 后行号必漂——纯行号硬门=必关之门）；坏路径/坏符号 → exit 非 0。
// 简称（runtime:/gateway:/esm: 等无法唯一定位）与裸名多命中/零命中 → skip（WARN 计数，不红）。
// 自动执行面 = check-plan-anchors.test.mjs 集成用例（verify 链 scripts-node-test 步列举）；本 bin 支持手动跑。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 锚点/语义冲突的扫描面 = 活跃文档显式白名单（历史 plans/specs 是写作当时的事实快照——行号/文件必漂，
// 对历史硬门=门禁永远红；doc-gate 五分状态同因。后续批次新 plan/spec 进入执行期时在此登记——有意识动作，
// 同 doc-gate REQUIRED_C1 显式名单先例）。条目不存在 → exit 2（防改名后静默扫零）。
export const ACTIVE_DOCS = [
  'docs/superpowers/plans/2026-10-12-y0b-5-terminal-and-observability.md',
];

// 已修订条款旧表述黑名单（裁定 22⑫ 起步集——从 Y0b-5 plan §0 裁决表提取；后续修订在此登记）。
// 合法形态：处于 ~~删除线~~ 区间内，或所在行含修订标记（引用性提及，如 原"…"废）。
export const STALE_PHRASES = [
  { phrase: '部分唯一索引', note: '裁定 16⑪ 唯一→普通' },
  { phrase: '复用 isRetryableAppendError', note: '裁定 6 v2.2 删——被裁定 20 连接族码表推翻' },
  { phrase: 'getTracker=req.user', note: '裁定 18④ v2.2 撤回——ThrottlerGuard→AuthGuard 顺序使 req.user 恒 undefined' },
];

// path:line 引用 token：有扩展名形态（裸文件名/相对/全路径）；无点简称（runtime:/gateway:/esm:/schema:）不进入检查。
const REF_RE = /([A-Za-z_][A-Za-z0-9_@\-./]*\.[A-Za-z0-9]+):(\d+)(?:-\d+)?/g;
const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$.]+/g;
const SYMBOL_WINDOW = 5;

// 从 path:line 之后的文本提取"该行引用的标识符"——首个拉丁/中文位置定界、拉丁首词即止：
//   遇中文（引用性叙述行）→ null（降为存在性检查）；拉丁首词须为代码符号——驼峰（shouldConnect/
//   CloseActionKind）/全大写 ≥4（AUTH_WAIT_TIMEOUT_MS）/含下划线 ≥4；
//   批次版本编号（Y0b-3/v2.3/T13）、纯小写短词（spec/close）、相邻文件名 token（QuotaBanner.tsx）不算。
//   首词即止防表格单元格里相邻条款的词被跨条款抓取（前瞻性新符号 safeReload/PG_CONNECTION_CODES 类误报同源）。
export function extractSymbol(after) {
  const first = after.match(/[一-鿿]|[A-Za-z_$]/);
  if (!first || /[一-鿿]/.test(first[0])) return null;
  const word = (after.slice(first.index).match(IDENT_RE) || [])[0];
  if (!word) return null;
  if (/^[A-Z]\d/.test(word)) return null;
  if (/^v\d/i.test(word)) return null;
  if (/\.(ts|tsx|js|jsx|mjs|cjs|json|yml|yaml|sql|vue|css|scss|md|sh)$/.test(word)) return null;
  if (/[a-z][A-Z]/.test(word)) return word;
  if (/^[A-Z][A-Z0-9_]{3,}$/.test(word)) return word;
  if (word.includes('_') && word.length >= 4) return word;
  return null;
}

// resolve(token) → { rel } | { missing: true } | { skip: reason }；readLines(rel) → string[]
export function scanAnchors(docRel, text, resolve, readLines) {
  const errors = [];
  const warns = [];
  let checked = 0;
  for (const m of text.matchAll(REF_RE)) {
    const token = m[1];
    const lineNo = Number(m[2]);
    const r = resolve(token);
    if (r.skip) {
      warns.push(`skip ${token}（${r.skip}）：${docRel}`);
      continue;
    }
    if (r.missing) {
      errors.push(`坏路径：${docRel} 引用 ${token} 不存在`);
      continue;
    }
    const lines = readLines(r.rel);
    if (lineNo > lines.length) {
      warns.push(`行号越界（advisory）：${docRel} 引用 ${token}:${lineNo} 超出 ${r.rel} 总行数 ${lines.length}`);
      continue;
    }
    checked++;
    const after = text.slice(m.index + m[0].length);
    const nl = after.indexOf('\n');
    const sym = extractSymbol(nl === -1 ? after : after.slice(0, nl));
    if (sym) {
      const window = lines.slice(Math.max(0, lineNo - 1 - SYMBOL_WINDOW), lineNo + SYMBOL_WINDOW).join('\n');
      if (!window.includes(sym)) {
        errors.push(`坏符号：${docRel} 引用 ${token}:${lineNo} 附近 ±${SYMBOL_WINDOW} 行不含 ${sym}（${r.rel}）`);
      }
    }
  }
  return { errors, warns, checked };
}

// 语义冲突：黑名单短语出现位置若不在 ~~删除线~~ 区间内、且所在行无修订标记（引用性提及）→ error。
export function scanStalePhrases(docRel, text, phrases = STALE_PHRASES) {
  const errors = [];
  const REVISED_MARK = /修正|撤销|撤回|废除|已废|删除|推翻|旧/;
  text.split(/\r?\n/).forEach((lineText, i) => {
    const struck = [...lineText.matchAll(/~~[^~]+~~/g)].map((m) => [m.index, m.index + m[0].length]);
    for (const { phrase, note } of phrases) {
      let idx = lineText.indexOf(phrase);
      while (idx !== -1) {
        const inStrike = struck.some(([s, e]) => idx >= s && idx < e);
        if (!inStrike && !REVISED_MARK.test(lineText)) {
          errors.push(`${docRel}:${i + 1} 旧表述「${phrase}」仍以活条款出现（${note}）`);
        }
        idx = lineText.indexOf(phrase, idx + 1);
      }
    }
  });
  return errors;
}

// 仓内文件解析器：含 "/" 的 token 按 git 风格相对路径精确判（missing=坏路径红）；
// 裸文件名按全仓 basename 索引（唯一命中才检查；零命中/多命中 skip——migration.sql 多迁移目录等）。
export function createResolver(ROOT) {
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.turbo', 'coverage', 'test-results', 'playwright-report', '.worktrees', '.claude', 'backups', '.data', 'vendor']);
  const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.sql', '.sh', '.vue', '.css', '.scss', '.md']);
  const byBasename = new Map();
  const relSet = new Set();
  (function walk(dir, rel) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), relPath);
      else if (e.isFile() && CODE_EXT.has(path.extname(e.name))) {
        relSet.add(relPath);
        if (!byBasename.has(e.name)) byBasename.set(e.name, []);
        byBasename.get(e.name).push(relPath);
      }
    }
  })(ROOT, '');
  return (token) => {
    const norm = token.replace(/\/+/g, '/');
    if (norm.includes('/')) return relSet.has(norm) ? { rel: norm } : { missing: true };
    const hits = byBasename.get(norm);
    if (!hits || hits.length === 0) return { skip: 'unresolved-basename' };
    if (hits.length > 1) return { skip: `ambiguous ×${hits.length}` };
    return { rel: hits[0] };
  };
}

function main() {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const resolve = createResolver(ROOT);
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
  const missingDoc = ACTIVE_DOCS.find((rel) => !fs.existsSync(path.join(ROOT, rel)));
  if (missingDoc) {
    console.error(`check-plan-anchors: ACTIVE_DOCS 条目不存在（改名后未同步白名单——静默扫零防护）：${missingDoc}`);
    process.exit(2);
  }
  const errors = [];
  const warns = [];
  let checked = 0;
  for (const rel of ACTIVE_DOCS) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const r = scanAnchors(rel, text, resolve, read);
    checked += r.checked;
    errors.push(...r.errors, ...scanStalePhrases(rel, text));
    warns.push(...r.warns);
  }
  if (warns.length) console.warn(`check-plan-anchors: WARN ${warns.length} 条（skip/advisory，不阻断）`);
  if (errors.length) {
    console.error(`check-plan-anchors: ${errors.length} 条违规（坏路径/坏符号/旧表述残留）——\n${errors.slice(0, 60).map((e) => `  ${e}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`check-plan-anchors: PASS（${ACTIVE_DOCS.length} 份活跃文档，符号锚检查 ${checked} 处）`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
