#!/usr/bin/env node
// scripts/check-raw-sql-time.mjs —— C1-4（plan v3 Task C1-4；spec 2026-11-11-foundation-batch-design.md
// §3.3-5「raw SQL 门」）：生产 raw SQL 时间语义静态门。三规则：
//   ① `timestamp` 无时区类型（cast/声明/字面量）：双冒号 + timestamp（含 (3) 精度）、`CAST(x AS timestamp)`、
//      `timestamp '...'`、DDL `timestamp(3)`——红；`timestamptz`（含 `with time zone` 明示）字面量
//      （显式时区的目标形态）=绿（**按 cast 解析分类**——字面 grep 双冒号 timestamp 会误命中 timestamptz
//      子串，C1-3 验收）。
//   ② 补偿式时区转换——`AT TIME ZONE` 与同义函数形态 `timezone(zone, ts)` 均红。**放行通道=文件
//      白名单 `{file, reason}`**（reason 缺失/空白=fail-closed exit 2；spec「放行须白名单化+注释」；
//      唯一合法语义=日历分桶显式带 IANA 时区，当前仓内零消费，白名单为空）。
//   ③ 无显式时区的日历函数——`date_trunc(...)`、`date_part(非 'epoch',...)`、`extract(非 epoch FROM ...)`
//      红；`extract(epoch ...)`/`date_part('epoch',...)` **瞬时安全豁免**（spec §3.3-5——非空转由自测锚定）。
//      显式时区形态放行：`AT TIME ZONE`/`timezone(...)`（归规则②白名单裁决）与三参
//      `date_trunc(unit, ts, tz)`（tz 为显式第三参——直接放行）。
// 扫描域：apps/api/src/**/*.ts + scripts/**/*.mjs + apps/api/scripts/**/*.mjs（生产面）；测试文件
// （*.spec.* / *.test.mjs / test-utils）豁免（布景/断言素材合法——先例 check-media-binding-writers）。
// 只扫 `$queryRaw/$executeRaw/$queryRawUnsafe/$executeRawUnsafe` 调用实参（标签模板/括号实参两形态；
// 泛型段 `<...>` 平衡扫描——禁跨调用吞扫，R-1）；
// **定位调用头前先掩蔽 JS 注释与普通字符串（单/双引号，含引号本身）**——注释/字符串里的伪调用不误报；
// 模板实参保留。SQL 文本判定前剥 SQL 注释（引号感知）并掩蔽双引号标识符/普通单引号字符串
// （`date_part/date_trunc` 首参与类型字面量前缀保留）——`'timestamp'`/`"timestamp"`/`'AT TIME ZONE'`
// 字样不误红。
// 【已知边界（静态绊线非对抗性沙箱）】变量间接传 SQL、动态拼接表名/函数名、`$queryRawTyped` 与
// 括号属性访问（`prisma['$queryRaw']`）不覆盖——绕过需评审显式引入（TD-30 登记）。
// 退出码：0=PASS；1=FAIL（清单输出）；2=白名单配置错误（fail-closed）。自测=scripts/check-raw-sql-time.test.mjs。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 放行白名单（空=当前仓内零合法 `AT TIME ZONE` 消费；新增须 file+reason——评审显式引入）。 */
export const AT_TIME_ZONE_ALLOWLIST = [];

/** 调用头（仅方法名）——泛型段由 findRawCallArgStart 平衡扫描（R-1：旧正则 `<[^()]*>` 在
 *  JS 注释掩蔽后会跨调用吞吃下一个真实调用）。 */
const RAW_HEAD = /\$(?:queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)\b/g;

/** 调用头之后定位实参起点（`(` 或反引号）；非调用（无实参/非泛型形态）= -1。
 *  泛型段=平衡角括号扫描（允许跨行/嵌套泛型；`=>`/`->`/`>=` 的 `>` 不计；遇反引号即放弃）。 */
export function findRawCallArgStart(src, from) {
  let i = from;
  while (i < src.length && /\s/.test(src[i])) i += 1;
  if (src[i] === '(' || src[i] === '`') return i;
  if (src[i] !== '<') return -1;
  let depth = 0;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '`') return -1;
    if (ch === '<') {
      const prev = src.slice(Math.max(0, i - 2), i).trimEnd();
      if (!prev.endsWith('=') && !prev.endsWith('-')) depth += 1;
      continue;
    }
    if (ch === '>') {
      if (src[i - 1] === '=' || src[i - 1] === '-' || src[i + 1] === '=') continue;
      depth -= 1;
      if (depth === 0) {
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j])) j += 1;
        return src[j] === '(' || src[j] === '`' ? j : -1;
      }
    }
  }
  return -1;
}

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

/** 剥除 SQL 注释（行注释与块注释，引号感知——字符串内的 `--`/`/*` 不误剥）。 */
export function stripSqlComments(sql) {
  let out = '';
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const end = skipQuoted(sql, i, ch);
      out += sql.slice(i, Math.min(end + 1, sql.length));
      i = end;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += ' ';
      i = stop - 1;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = (nl === -1 ? sql.length : nl) - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/** 掩蔽 SQL 引号段（M1）：双引号标识符→`""`；普通单引号字符串→`''`（内容丢弃）——`'timestamp'`/
 *  `"timestamp"`/`'AT TIME ZONE'` 字样不误红。保留：① date_part/date_trunc 首参（epoch 豁免判定）；
 *  ② 类型字面量前缀后的串（timestamp/date/time/interval '...'——规则只判前缀关键字，保留便于诊断）。 */
export function maskSqlQuotedLiterals(sql) {
  let out = '';
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === '"') {
      i = skipQuoted(sql, i, '"');
      out += '""';
      continue;
    }
    if (ch === "'") {
      const end = skipQuoted(sql, i, "'");
      const literal = sql.slice(i, Math.min(end + 1, sql.length));
      const keep = /(?:\btimestamp|\btimestamptz|\bdate|\btime|\binterval)\s+$/i.test(out)
        || /\bdate_part\s*\(\s*$/i.test(out) || /\bdate_trunc\s*\(\s*$/i.test(out)
        || /\bextract\s*\(\s*$/i.test(out);   // R-3：EXTRACT('epoch' FROM …) 合法形态
      out += keep ? literal : "''";
      i = end;
      continue;
    }
    out += ch;
  }
  return out;
}

/** 掩蔽 JS 注释与普通字符串（M1：调用头定位前）——模板字面量原样保留（SQL 实参）。 */
export function maskJsNonCode(src) {
  let out = '';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      const stop = nl === -1 ? src.length : nl;
      out += ' '.repeat(stop - i);
      i = stop - 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += ' '.repeat(stop - i);
      i = stop - 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = skipQuoted(src, i, ch);
      out += ' '.repeat(Math.min(end + 1, src.length) - i);
      i = end;
      continue;
    }
    if (ch === '`') {
      const end = skipTemplate(src, i);
      out += src.slice(i, Math.min(end + 1, src.length));
      i = end;
      continue;
    }
    out += ch;
  }
  return out;
}

/** 白名单 fail-closed 校验（M4）：每项须含非空 file+reason；违规 throw（CLI 映射 exit 2）。 */
export function validateAtTimeZoneAllowlist(list) {
  if (!Array.isArray(list)) throw new Error('AT_TIME_ZONE_ALLOWLIST fail-closed：须为数组');
  for (const entry of list) {
    if (!entry || typeof entry.file !== 'string' || !entry.file.trim()
      || typeof entry.reason !== 'string' || !entry.reason.trim()) {
      throw new Error('AT_TIME_ZONE_ALLOWLIST fail-closed：条目须含非空 file 与 reason（评审显式引入）');
    }
  }
}

/** 三参 `date_trunc(unit, ts, tz)`（M4：显式 tz 第三参——放行日历规则）。 */
export function hasExplicitZoneDateTrunc(sql) {
  for (const m of sql.matchAll(/\bdate_trunc\s*\(/gi)) {
    const open = m.index + m[0].length - 1;
    const body = rawCallArgText(sql, open);
    let depth = 0;
    let args = 1;
    for (let i = 0; i < body.length; i += 1) {
      const ch = body[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') { if (depth === 0) break; depth -= 1; }
      else if (ch === ',' && depth === 0) args += 1;
    }
    if (args >= 3) return true;
  }
  return false;
}

const TS_TOKEN = /\btimestamptz\b|\btimestamp(?!tz)\b(?:\s*\(\s*\d+\s*\))?(?:\s+(?:with|without)\s+time\s+zone)?/gi;
const COMPENSATION = /\bAT\s+TIME\s+ZONE\b|\btimezone\s*\(/i;
const CALENDAR = [
  { rx: /\bdate_trunc\s*\(/i, label: 'date_trunc(' },
  { rx: /\bdate_part\s*\(\s*'(?!epoch\b)/i, label: "date_part(非 'epoch'" },
  { rx: /\bextract\s*\(\s*(?!'epoch'|epoch\b)[A-Za-z_'"]/i, label: 'extract(非 epoch 域' },
];

/**
 * 扫描文件集合。files=[{rel, src}]；opts.atTimeZoneAllowlist 覆盖默认白名单（自测放行通道用）。
 * 返回 problems 字符串数组（空=绿）。
 */
/** Unsafe 字符串实参解包（M1 配套）：括号实参恰为 JS 字符串字面量时取内容（保留 SQL 判定面）。 */
function unwrapJsStringArg(arg) {
  const m = arg.match(/^\s*(['"])([\s\S]*)\1\s*$/);
  return m ? m[2].replace(/\\(["'\\])/g, '$1') : arg;
}

export function scanRawSqlTime(files, opts = {}) {
  const allowlist = opts.atTimeZoneAllowlist ?? AT_TIME_ZONE_ALLOWLIST;
  validateAtTimeZoneAllowlist(allowlist);
  const allowReasons = new Map(allowlist.map((a) => [a.file, a.reason]));
  const problems = [];
  for (const { rel, src } of files) {
    if (isTestFile(rel)) continue;
    const atTzAllowed = allowReasons.has(rel);
    // M1：JS 注释/普通字符串掩蔽后**定位调用头**（伪调用不误报）；R-1：泛型段平衡扫描（禁跨调用）
    const maskedSrc = maskJsNonCode(src);
    RAW_HEAD.lastIndex = 0;
    for (const m of maskedSrc.matchAll(RAW_HEAD)) {
      const argIdx = findRawCallArgStart(maskedSrc, m.index + m[0].length);
      if (argIdx < 0) continue;
      const rawArg = src[argIdx] === '`'
        ? src.slice(argIdx + 1, skipTemplate(src, argIdx))
        : unwrapJsStringArg(rawCallArgText(src, argIdx));
      // M1：SQL 注释剥除（引号感知）+ 引号段掩蔽（双引号标识符/普通串内容丢弃）
      const arg = maskSqlQuotedLiterals(stripSqlComments(rawArg));
      // ① 无时区 timestamp 类型/cast/字面量
      for (const t of arg.matchAll(TS_TOKEN)) {
        const text = t[0];
        if (/^timestamptz/i.test(text)) continue;                       // 目标形态
        if (/\bwith\s+time\s+zone\b/i.test(text)) continue;             // 显式时区（等价 timestamptz）
        problems.push(`无时区 timestamp（${text.trim()}）：${rel}（偏移 ${m.index}）——终态用 timestamptz(3)`);
      }
      // ② 补偿式时区转换：AT TIME ZONE 及其同义函数形态 timezone(...)（白名单 file+reason 才放行）
      if (COMPENSATION.test(arg) && !atTzAllowed) {
        problems.push(`补偿式时区转换（AT TIME ZONE/timezone()）：${rel}（偏移 ${m.index}）——显式时区日历分桶须白名单化+注释（本门 AT_TIME_ZONE_ALLOWLIST）`);
      }
      // ③ 无显式时区的日历函数（显式时区=AT TIME ZONE/timezone()/三参 date_trunc——日历规则放行）
      if (!COMPENSATION.test(arg) && !hasExplicitZoneDateTrunc(arg)) {
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

/** 非测试文件的 raw SQL 调用点数（门非空转锚：扫零=判据失效；与扫描同口径掩蔽 JS 非代码）。 */
export function countRawCalls(files) {
  let n = 0;
  for (const { rel, src } of files) {
    if (isTestFile(rel)) continue;
    const masked = maskJsNonCode(src);
    for (const m of masked.matchAll(RAW_HEAD)) {
      if (findRawCallArgStart(masked, m.index + m[0].length) >= 0) n += 1;
    }
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
  let problems;
  try {
    problems = scanRawSqlTime(files);
  } catch (e) {
    console.error(`check-raw-sql-time FAIL（exit 2——门配置错误 fail-closed）: ${e instanceof Error ? e.message : String(e)}`);   // M4
    process.exit(2);
  }
  if (problems.length) { console.error(`check-raw-sql-time FAIL:\n  ${[...new Set(problems)].join('\n  ')}`); process.exit(1); }
  const rawCalls = countRawCalls(files);
  if (rawCalls === 0) { console.error('check-raw-sql-time FAIL: 扫零 raw SQL 调用点（判据失效——拒绝空转假绿）'); process.exit(1); }
  console.log(`check-raw-sql-time OK: ${files.length} 文件 / ${rawCalls} 个 raw SQL 调用点——时间语义（无时区 timestamp=0/补偿式时区转换=0〔白名单 ${AT_TIME_ZONE_ALLOWLIST.length}〕/无显式时区日历函数=0；extract(epoch) 豁免）`);
}
