#!/usr/bin/env node
// scripts/check-raw-sql-time.mjs —— C1-4（plan v3 Task C1-4；spec 2026-11-11-foundation-batch-design.md
// §3.3-5「raw SQL 门」）：生产 raw SQL 时间语义静态门。三规则：
//   ① `timestamp` 无时区类型（cast/声明/字面量）：双冒号 + timestamp（含 (3) 精度）、`CAST(x AS timestamp)`、
//      `timestamp '...'`、DDL `timestamp(3)`——红；`timestamptz`（含 `with time zone` 明示）字面量
//      （显式时区的目标形态）=绿（**按 cast 解析分类**——字面 grep 双冒号 timestamp 会误命中 timestamptz
//      子串，C1-3 验收）。
//   ② 补偿式 `AT TIME ZONE`——红。**放行通道=文件白名单+reason**（spec「放行须白名单化+注释」；
//      唯一合法语义=`date_trunc/date_part/extract` 等日历分桶显式带 IANA 时区，例如
//      `date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai')`——当前仓内零消费，白名单为空）。
//   ③ 无显式时区的日历函数——`date_trunc(...)`、`date_part(非 'epoch',...)`、`extract(非 epoch FROM ...)`
//      红；`extract(epoch ...)`/`date_part('epoch',...)` **瞬时安全豁免**（spec §3.3-5——非空转由自测锚定）。
//      同一 raw SQL 实参文本内出现 `AT TIME ZONE` 时，日历函数视为「显式时区」——放行归规则②白名单裁决。
// 扫描域：apps/api/src/**/*.ts + scripts/**/*.mjs + apps/api/scripts/**/*.mjs（生产面）；测试文件
// （*.spec.* / *.test.mjs / test-utils）豁免（布景/断言素材合法——先例 check-media-binding-writers）。
// 只扫 `$queryRaw/$executeRaw/$queryRawUnsafe/$executeRawUnsafe` 实参文本（标签模板/括号实参两形态；
// 模板/字符串内括号不计深）——普通字符串/注释里的字样不误伤。SQL 注释（`--`/`/* */`）剥除后判定。
// 【已知边界（静态绊线非对抗性沙箱）】变量间接传 SQL、动态拼接函数名不覆盖——绕过需评审显式引入。
// 退出码：0=PASS；1=FAIL（清单输出）。自测=scripts/check-raw-sql-time.test.mjs（负控红证+豁免绿证）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 放行白名单（空=当前仓内零合法 `AT TIME ZONE` 消费；新增须 file+reason——评审显式引入）。 */
export const AT_TIME_ZONE_ALLOWLIST = [];

const RAW_CALL = /\$(?:queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)\b(?:<[^()]*>)?\s*(?=[(`])/g;

const isTestFile = (rel) => rel.includes('.spec.') || rel.includes('.test.mjs') || rel.includes('/test-utils/') || rel.endsWith('-spec.ts');

/** 跳过引号段（返回闭合引号下标；\x 转义跳过；未闭合=末尾）。 */
function skipQuoted(src, i, quote) {
  for (let j = i + 1; j < src.length; j += 1) {
    if (src[j] === '\\') { j += 1; continue; }
    if (src[j] === quote) return j;
  }
  return src.length;
}

/** 跳过模板字面量（返回闭合反引号下标；${} 插值内字符串/嵌套模板递归跳过）。 */
function skipTemplate(src, i) {
  for (let j = i + 1; j < src.length; j += 1) {
    const ch = src[j];
    if (ch === '\\') { j += 1; continue; }
    if (ch === '`') return j;
    if (ch === '$' && src[j + 1] === '{') {
      let depth = 1;
      for (j += 2; j < src.length && depth > 0; j += 1) {
        if (src[j] === '`') { j = skipTemplate(src, j); continue; }
        if (src[j] === "'" || src[j] === '"') { j = skipQuoted(src, j, src[j]); continue; }
        if (src[j] === '{') depth += 1;
        else if (src[j] === '}') depth -= 1;
      }
      j -= 1;
    }
  }
  return src.length;
}

/** raw 调用实参文本：从 `(` 起平衡括号扫描（模板/字符串内括号不计深——SQL 内括号安全）。 */
export function rawCallArgText(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '`') { i = skipTemplate(src, i); continue; }
    if (ch === "'" || ch === '"') { i = skipQuoted(src, i, ch); continue; }
    if (ch === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl === -1 ? src.length : nl; continue; }
    if (ch === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end === -1 ? src.length : end + 1; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') { depth -= 1; if (depth === 0) return src.slice(openIdx + 1, i); }
  }
  return src.slice(openIdx + 1);
}

/** 剥除 SQL 注释（行注释与块注释）——注释里的字样不作判据。 */
export function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

const TS_TOKEN = /\btimestamptz\b|\btimestamp(?!tz)\b(?:\s*\(\s*\d+\s*\))?(?:\s+(?:with|without)\s+time\s+zone)?/gi;
const AT_TIME_ZONE = /\bAT\s+TIME\s+ZONE\b/i;
const CALENDAR = [
  { rx: /\bdate_trunc\s*\(/i, label: 'date_trunc(' },
  { rx: /\bdate_part\s*\(\s*'(?!epoch\b)/i, label: "date_part(非 'epoch'" },
  { rx: /\bextract\s*\(\s*(?!epoch\b)[A-Za-z_'"]/i, label: 'extract(非 epoch 域' },
];

/**
 * 扫描文件集合。files=[{rel, src}]；opts.atTimeZoneAllowlist 覆盖默认白名单（自测放行通道用）。
 * 返回 problems 字符串数组（空=绿）。
 */
export function scanRawSqlTime(files, opts = {}) {
  const allowlist = opts.atTimeZoneAllowlist ?? AT_TIME_ZONE_ALLOWLIST;
  const allowReasons = new Map(allowlist.map((a) => [a.file, a.reason]));
  const problems = [];
  for (const { rel, src } of files) {
    if (isTestFile(rel)) continue;
    const atTzAllowed = allowReasons.has(rel);
    RAW_CALL.lastIndex = 0;
    for (const m of src.matchAll(RAW_CALL)) {
      const argIdx = m.index + m[0].length;
      const rawArg = src[argIdx] === '`'
        ? src.slice(argIdx + 1, skipTemplate(src, argIdx))
        : rawCallArgText(src, argIdx);
      const arg = stripSqlComments(rawArg);
      // ① 无时区 timestamp 类型/cast/字面量
      for (const t of arg.matchAll(TS_TOKEN)) {
        const text = t[0];
        if (/^timestamptz/i.test(text)) continue;                       // 目标形态
        if (/\bwith\s+time\s+zone\b/i.test(text)) continue;             // 显式时区（等价 timestamptz）
        problems.push(`无时区 timestamp（${text.trim()}）：${rel}（偏移 ${m.index}）——终态用 timestamptz(3)`);
      }
      // ② 补偿式 AT TIME ZONE（白名单 file+reason 才放行）
      if (AT_TIME_ZONE.test(arg) && !atTzAllowed) {
        problems.push(`补偿式 AT TIME ZONE：${rel}（偏移 ${m.index}）——显式时区日历分桶须白名单化+注释（本门 AT_TIME_ZONE_ALLOWLIST）`);
      }
      // ③ 无显式时区的日历函数（实参内带 AT TIME ZONE=显式时区，日历规则放行，交 ② 裁决）
      if (!AT_TIME_ZONE.test(arg)) {
        for (const { rx, label } of CALENDAR) {
          if (rx.test(arg)) {
            problems.push(`无显式时区的日历函数（${label}）：${rel}（偏移 ${m.index}）——extract(epoch) 瞬时安全豁免，date-part 类禁会话时区依赖`);
          }
        }
      }
    }
  }
  return problems;
}

/** 非测试文件的 raw SQL 调用点数（门非空转锚：扫零=判据失效）。 */
export function countRawCalls(files) {
  let n = 0;
  for (const { rel, src } of files) {
    if (isTestFile(rel)) continue;
    n += [...src.matchAll(RAW_CALL)].length;
  }
  return n;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const DIRS = ['apps/api/src', 'scripts', 'apps/api/scripts'];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'dist' ? [] : walk(p);
      return e.name.endsWith('.ts') || e.name.endsWith('.mjs') ? [p] : [];
    });
  };
  const files = DIRS.flatMap((d) => walk(path.join(ROOT, d))).map((f) => ({
    rel: path.relative(ROOT, f).split(path.sep).join('/'),
    src: fs.readFileSync(f, 'utf8'),
  }));
  const problems = scanRawSqlTime(files);
  if (problems.length) { console.error(`check-raw-sql-time FAIL:\n  ${[...new Set(problems)].join('\n  ')}`); process.exit(1); }
  const rawCalls = countRawCalls(files);
  if (rawCalls === 0) { console.error('check-raw-sql-time FAIL: 扫零 raw SQL 调用点（判据失效——拒绝空转假绿）'); process.exit(1); }
  console.log(`check-raw-sql-time OK: ${files.length} 文件 / ${rawCalls} 个 raw SQL 调用点——时间语义（无时区 timestamp=0/AT TIME ZONE=0〔白名单 ${AT_TIME_ZONE_ALLOWLIST.length}〕/无显式时区日历函数=0；extract(epoch) 豁免）`);
}
