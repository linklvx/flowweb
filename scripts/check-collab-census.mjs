#!/usr/bin/env node
// Y0b-4 T14（plan TDD 纪律节 census 十组+⑪ readOnly 直写点）：collab 面生产代码普查脚本。
// 形态=check-spec-consistency.mjs 同族（grep 语义 + PASS/FAIL 明细 + exit 1）。词表按 2026-10-11
// HEAD 实际落地形态写就（先 grep 实况再写断言）——白名单④逐点列名，新增编码/桶/直写点必须同批补注。
// 退出码：0=全 PASS；1=任一 FAIL；2=结构性错误。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
// ⑬detail 白名单锚单源：schema 从 shared dist 导入（TS 源不可直接 import .ts——verify 链
// shared-build 步在前，dist 恒新；standalone 跑依赖 dist 已构建——与 check-shared-dist 同前提）。
import { TELEMETRY_DETAIL_SCHEMA } from '../packages/shared/dist/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 生产文件面：apps 两端 src 下 ts/tsx，排除测试（.spec./.test.）与 test-utils 装置。 */
export function collectProductionFiles() {
  const bases = [path.join(ROOT, 'apps/api/src'), path.join(ROOT, 'apps/web/src')];
  const out = [];
  for (const base of bases) {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return p.includes('test-utils') ? [] : walk(p);
      return /\.(ts|tsx)$/.test(e.name) && !/\.(spec|test)\./.test(e.name) ? [p] : [];
    });
    out.push(...walk(base));
  }
  return out.sort();
}

/** 剥注释与字符串内容（保换位——报错行号可跳转）：行/块注释、'…'/"…"/`…`（含 ${} 嵌套）。
 *  正则字面量不处理（本脚本词表无 `/close(nn/` 形态，误伤面为零）。 */
export function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  let mode = 'code';                       // code | line | block | single | double | template
  const tplStack = [];                     // template ${} 嵌套深度栈
  let quote = '';
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { out += '  '; i += 2; mode = 'line'; continue; }
      if (c === '/' && n === '*') { out += '  '; i += 2; mode = 'block'; continue; }
      if (c === "'" || c === '"') { out += c; i += 1; mode = c === "'" ? 'single' : 'double'; quote = c; continue; }
      if (c === '`') { out += c; i += 1; mode = 'template'; tplStack.push(0); continue; }
      out += c; i += 1;
    } else if (mode === 'line') {
      if (c === '\n') { out += '\n'; mode = 'code'; } i += 1;
    } else if (mode === 'block') {
      if (c === '*' && n === '/') { out += '  '; i += 2; mode = 'code'; continue; }
      out += c === '\n' ? '\n' : ' '; i += 1;
    } else if (mode === 'single' || mode === 'double') {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === quote) { out += quote; i += 1; mode = 'code'; continue; }
      out += c === '\n' ? '\n' : ' '; i += 1;
    } else {                                // template（栈帧=0 模板文本/＞0 插值花括号深度）
      const frame = tplStack[tplStack.length - 1];
      if (frame === 0) {                    // 模板文本：内容剥为空格（`${` 入插值、反引号出栈）
        if (c === '\\') { out += '  '; i += 2; continue; }
        if (c === '`') { out += '`'; i += 1; tplStack.pop(); if (!tplStack.length) mode = 'code'; continue; }
        if (c === '$' && n === '{') { out += '  '; i += 2; tplStack[tplStack.length - 1] = 1; continue; }
        out += c === '\n' ? '\n' : ' '; i += 1;
      } else {                              // 插值体：代码按原文透传（嵌套字符串/行注释/模板局部处理）
        if (c === '{') { tplStack[tplStack.length - 1] += 1; out += c; i += 1; continue; }
        if (c === '}') {
          // T34（§0.6 偏离 53）：插值自身闭合 `}`（frame 1→0）置空格——`${` 开括号上方已剥为两空格，
          // closer 原样透传=每处插值一枚孤儿 `}`⇒computeBraceDepth 负漂移⇒㉒〔M〕分类假阳性
          // （intent-key/gateway/team-recharge/recharge 误标根因）。嵌套花括号（frame>1）成对透传自平衡。
          const nextFrame = (tplStack[tplStack.length - 1] -= 1);   // T35 微修（R6①）：内层 frame 遮蔽外层（:57）改名——纯改名零行为
          out += nextFrame === 0 ? ' ' : '}';
          i += 1; continue;
        }
        if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i += 1; } continue; }
        if (c === "'" || c === '"') {       // 插值内字符串：剥内容保换位
          const q = c; out += q; i += 1;
          while (i < src.length && src[i] !== q) { out += src[i] === '\n' ? '\n' : ' '; if (src[i] === '\\') { out += ' '; i += 1; } i += 1; }
          out += q; i += 1; continue;
        }
        if (c === '`') { out += '`'; i += 1; tplStack.push(0); continue; }   // 嵌套模板新帧
        out += c; i += 1;
      }
    }
  }
  return out;
}

/** ①裸 close 码命中（1008/1011/4404——backoff/终态码禁裸字面量，必须走 CollabCloseCode）。 */
export function classifyCloseLiteral(line) {
  return /close\(\s*(?:1008|1011|4404)\s*[,)]/.test(line) ? 'bare close code' : null;
}

/** ⑨.consume( 全显式 cost 纪律：省参（默认 cost=1）在生产调用面禁止——显式 `, 1)`/`, bytes)` 形态。 */
export function classifyConsumeCall(line) {
  const m = line.match(/\.consume\(([^)]*)\)/);
  if (!m) return null;
  const args = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  return args.length >= 2 ? null : '省参 cost（生产调用必须显式 `, 1`/按量——禁默认参形态）';
}

/** ⑬recordCollabDiag/recordRingOnlyCollabDiag 调用点静态提取（组⑬ detail 白名单锚输入面）。
 *  raw 源扫描——type 与 detail 值均字符串字面量，stripCommentsAndStrings 会结构性剥掉（组⑦同则）；
 *  行首注释行/定义行（function recordCollabDiag(）排除；import 语句无 `(` 天然不命中。
 *  返回 { channel: 'batch'|'ring-only', type, keys, literals, line, problem }——
 *  keys=对象首层键（花括号深度 1）；简写键按变量名解析（裁定 25⑵）；展开（…）problem 报红禁入；
 *  literals=值表达式内全部字符串字面量（三元两支等静态可比面；动态值归运行时 sanitize 单源）。 */
export function extractDiagCalls(src) {
  const calls = [];
  const re = /\brecord(?:CollabDiag|RingOnlyCollabDiag)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 16), m.index))) continue;
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const lineEnd = src.indexOf('\n', m.index);
    if (/^\s*(?:\/\/|\*|\/\*)/.test(src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd))) continue;
    const entry = {
      channel: m[0].startsWith('recordRingOnly') ? 'ring-only' : 'batch',
      type: null,
      keys: [],
      literals: {},
      line: src.slice(0, m.index).split('\n').length,
      problem: null,
    };
    let i = m.index + m[0].length;
    const ws = () => { while (i < src.length && /\s/.test(src[i])) i += 1; };
    /** 值表达式扫描：跨到首层 `,`/`}`（嵌套 ()[]{ } 计深；字符串字面量整体跳过并可选收集；模板串跳过不收集） */
    const skipValue = (lits) => {
      let d = 0;
      while (i < src.length) {
        const c = src[i];
        if (c === "'" || c === '"' || c === '`') {
          const end = src.indexOf(c, i + 1);
          if (end === -1) { i = src.length; return; }
          if (lits && c !== '`') lits.push(src.slice(i + 1, end));
          i = end + 1;
          continue;
        }
        if (c === '(' || c === '[' || c === '{') { d += 1; i += 1; continue; }
        if (c === ')' || c === ']') { d -= 1; i += 1; continue; }
        if (c === '}') { if (d === 0) return; d -= 1; i += 1; continue; }
        if (c === ',' && d === 0) return;
        i += 1;
      }
    };
    ws();
    if (src[i] === "'" || src[i] === '"') {
      const end = src.indexOf(src[i], i + 1);
      entry.type = src.slice(i + 1, end);
      i = end + 1;
    } else {
      entry.problem = 'type 非字符串字面量（锚不可静态校验）';
    }
    ws();
    if (src[i] === ',') {
      i += 1;
      ws();
      if (src[i] !== '{') entry.problem = entry.problem ?? 'detail 非对象字面量（须 { … } 形态）';
      else {
        i += 1;
        for (;;) {
          ws();
          if (i >= src.length) { entry.problem = entry.problem ?? 'detail 对象未闭合'; break; }
          if (src[i] === '}') { i += 1; break; }
          if (src.startsWith('...', i)) {
            entry.problem = 'detail 展开禁入（裁定 25⑵——键集不可静态校验）';
            i += 3;
            skipValue();
            continue;
          }
          let key = null;
          if (src[i] === "'" || src[i] === '"') {
            const end = src.indexOf(src[i], i + 1);
            key = src.slice(i + 1, end);
            i = end + 1;
          } else {
            const km = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
            if (km) { key = km[0]; i += km[0].length; }
          }
          if (key === null) { entry.problem = entry.problem ?? 'detail 键不可解析'; skipValue(); continue; }
          entry.keys.push(key);
          ws();
          if (src[i] === ':') {
            i += 1;
            const lits = [];
            skipValue(lits);
            if (lits.length) entry.literals[key] = lits;
          }
          ws();
          if (src[i] === ',') { i += 1; continue; }
          if (src[i] === '}') { i += 1; break; }
          // 既非分隔符——顺推防死循环
          skipValue();
        }
      }
    }
    calls.push(entry);
  }
  return calls;
}

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

/** ── Y0c T2 组⑭⑮ helpers ──
 *  ⑮闭包边解析：仅认 ./ ../ 起头的相对 spec（apps/api 生产 import 实况=相对路径+包名两态——
 *  tsconfig 无 paths alias、@flowweb/shared 经 grep 实证零 yjs/hocuspocus/applyUpdate 依赖，
 *  包名即闭包边界停）；候选 .ts/.tsx/index.ts/index.tsx。 */
export function resolveRelativeImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    try { if (fs.statSync(cand).isFile()) return cand; } catch { /* 试下一候选 */ }
  }
  return null;
}

/** import 边行级提取：raw 行抽 spec，stripped 同行须仍有 from/require/import 骨架——
 *  注释/字符串里的伪 import 被剥离器结构性消失（组⑦特例的行级反用）。多行 import 的尾行
 *  `} from './x';` 原样命中；export-from 同算边（barrel 再导出拉文件入闭包）。 */
const IMPORT_EDGE_RE = /\bfrom\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/;
export function extractImportSpec(rawLine, strippedLine) {
  if (!/\b(?:from|require|import)\b/.test(strippedLine)) return null;
  const m = IMPORT_EDGE_RE.exec(rawLine);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

/** ⑮闭包收集：roots 出发沿相对 import 边传递收集（含 export-from）；resolve 命中立闭包外
 *  （包边界）不追踪；环安全（seen 去重）。files=Map<file,{raw,stripped}>（main 的 byFile）。 */
export function collectImportClosure(roots, files, resolve = resolveRelativeImport) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f) || !files.has(f)) continue;
    seen.add(f);
    const { raw, stripped } = files.get(f);
    const rawLines = raw.split('\n');
    const stLines = stripped.split('\n');
    for (let i = 0; i < rawLines.length; i += 1) {
      const spec = extractImportSpec(rawLines[i], stLines[i] ?? '');
      if (!spec) continue;
      const target = resolve(f, spec);
      if (target && files.has(target) && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

/** ⑮禁令符号判定（Z43 符号级）：openDirectConnection（方法引用）/applyUpdate（含 V2 变体——
 *  同族写通道）。yjs 纯函数（mergeUpdates/encodeStateAsUpdate/decodeStateVector）天然不在
 *  禁令词表=放行（另行白名单登记）。 */
export function classifyWorkerBannedSymbol(line) {
  if (/\bopenDirectConnection\b/.test(line)) return 'openDirectConnection';
  if (/\bapplyUpdate(?:V2)?\b/.test(line)) return 'applyUpdate';
  return null;
}

/** ⑮@hocuspocus/server import 判定：raw 行含包名字面量 ∧ stripped 同行仍有 import 骨架
 *  （剥串器保引号、内容置换为空格——骨架须配 `['"][^'"]*['"]` 非相邻空引号；注释提及/
 *  字符串值形态放行——同 extractImportSpec 反伪机制）。 */
export function isHocuspocusServerImport(rawLine, strippedLine) {
  if (!/['"]@hocuspocus\/server['"]/.test(rawLine)) return false;
  return /\b(?:from|require|import)\s*[(\s]*['"][^'"]*['"]/.test(strippedLine);
}

/** ⑮登记红对账（元纪律⑥预登记红机制）：hits 与 registered 须精确双向相等——
 *  命中未登记=unregistered（FAIL）/登记命中缺失=stale（转绿达成→须显式移除登记，防陈旧
 *  登记吞回归）/同键计数不等=drift（FAIL）。 */
export function reconcileRegisteredRed(hits, registered) {
  const unregistered = [];
  const drift = [];
  const stale = [];
  for (const [f, syms] of Object.entries(hits)) {
    for (const [sym, n] of Object.entries(syms)) {
      const reg = registered[f]?.[sym];
      if (!reg) unregistered.push({ file: f, symbol: sym, n });
      else if (reg.n !== n) drift.push({ file: f, symbol: sym, want: reg.n, n });
    }
  }
  for (const [f, syms] of Object.entries(registered)) {
    for (const [sym, reg] of Object.entries(syms)) {
      if (!hits[f]?.[sym]) stale.push({ file: f, symbol: sym, until: reg.until });
    }
  }
  return { unregistered, drift, stale };
}

/** ── Y0c T3 组㉑㉒ helpers ──
 *  ㉒process.env 直读键提取（stripped 行级，matchAll 逐出现计数——同行多读点全可见，T3 评审
 *  I-1a：line.match 无 g 标志曾漏报同行第二读点）：process.env.KEY 与 process.env['KEY']/
 *  ["KEY"] 两形态归一键名，返回键名数组（出现序；重复键多元素=按出现次数计数）；整对象形态
 *  （safeParse(process.env)/const env = process.env——env 单源 config/env.ts 入口本体）不归键
 *  =词表外（Z79 裸读面指「按键裸读」，单源入口是判据本原）。T34 起 env.ts 唯一命中=validateEnv
 *  成功后的字面量写回 `process.env.NODE_ENV =`（Z45② 单源写回点——白名单登记，读写同则命中）。
 *  动态方括号键边界（T3 评审 I-1b）：process.env[<非字面量>]（process.env[feature]/
 *  process.env[key]——键静态不可知）不进键级对账（键级词表原理上无法命中），由
 *  countDynamicEnvAccess 计数进 advisory（读/写两态同报——main.ts DB 配置预热为动态键写点
 *  实况）；T34 归属核定=运行期动态键设计使然（feature flag/预热白名单门/admin 面），advisory
 *  口径维持。 */
const PROCESS_ENV_KEY_RE = /process\.env\.([A-Za-z_$][\w$]*)|process\.env\[\s*['"]([^'"]+)['"]\s*\]/g;
export function extractProcessEnvKeys(line) {
  return [...line.matchAll(PROCESS_ENV_KEY_RE)].map((m) => m[1] ?? m[2]);
}

const PROCESS_ENV_DYN_RE = /process\.env\[\s*[^'"\]]/g;
export function countDynamicEnvAccess(line) {
  return [...line.matchAll(PROCESS_ENV_DYN_RE)].length;
}

/** ㉒{} 净深累计（输入须先经剥离器——本 helper 不剥串）：行扫描前缀深度=0 ⇔ 模块顶层
 *  执行位（Z79 违规面=模块加载期读）；>0 ⇔ 类/方法体内（允许面候选）。advisory 标注用，
 *  非执法（执法=白名单+登记红对账）。 */
export function computeBraceDepth(text) {
  let d = 0;
  for (const c of text) { if (c === '{') d += 1; else if (c === '}') d -= 1; }
  return d;
}

/** ㉑.env 键集解析：KEY=VALUE 行取 KEY（首段）；# 注释与空行忽略。仅取键集（值不进
 *  census——禁密钥落日志/报告）。 */
export function parseDotEnvKeys(text) {
  return text.split('\n').flatMap((l) => {
    const t = l.trim();
    if (!t || t.startsWith('#')) return [];
    const i = t.indexOf('=');
    return i > 0 ? [t.slice(0, i).trim()] : [];
  });
}

/** ㉑ecosystem.config.cjs env 块键集：多 app env 键并集（T30 双进程后两 app 各自 env 块——
 *  并集=分叉键须显式登记的判定面）。apps 非数组/缺 apps=结构性错误上抛（main 捕获 exit 2）。 */
export function ecosystemEnvKeys(mod) {
  if (!Array.isArray(mod?.apps)) throw new Error('ecosystem.config.cjs 结构性错误（apps 非数组）');
  return [...new Set(mod.apps.flatMap((a) => Object.keys(a.env ?? {})))];
}

/** ── Y0c T6 组㉔ helpers（Z58 双等价索引 census——Y0b-4 偏离 52 门禁化） ──
 *  机制=纯静态两半：schema.prisma 全部唯一声明（@@unique 块级+字段级 @unique）按 Prisma 命名
 *  规则拼生成唯一索引名（<Model>_<col1>_<col2>_key）→ 与 deployment-db-baseline.md raw unique
 *  对象锚（```json raw-indexes fenced 块）比对——full（非 partial）手写唯一同表同列集⇒红
 *  duplicate-equivalent-index（双等价索引=同名不同写法语义等价，重复占用写入放大——偏离 52 形态）。
 *  partial unique（WHERE 子集语义）与 full @@unique 不等价不判红；deliberate constraint 形态
 *  （=schema @@unique 的 DB 物化登记，CanvasDocUpdate 先例）豁免但 schema 失配即 stale。 */

/** schema.prisma 唯一声明解析。模型边界=model 行起 `}` 行止（Prisma DSL 无嵌套块）；列别名 @map
 *  本 schema 零使用（Z58 静态近似——引入时同批补注）；@@unique 可选 map 参不参与命名（本 schema 无）。 */
export function parsePrismaUniques(schemaText) {
  const out = [];
  let model = null;
  for (const line of schemaText.split('\n')) {
    const t = line.trim();
    const mModel = /^model\s+([A-Za-z_]\w*)\s*\{/.exec(t);
    if (mModel) { model = mModel[1]; continue; }
    if (model && t === '}') { model = null; continue; }
    if (!model) continue;
    const mBlock = /@@unique\(\s*\[([^\]]*)\]/.exec(t);
    if (mBlock) {
      const columns = mBlock[1].split(',').map((s) => s.trim()).filter(Boolean);
      out.push({ model, columns, name: `${model}_${columns.join('_')}_key` });
      continue;
    }
    const mField = /^([A-Za-z_]\w*)\s+[A-Za-z_\[]/.exec(t);
    if (mField && /(^|\s)@unique\b/.test(t)) {
      out.push({ model, columns: [mField[1]], name: `${model}_${mField[1]}_key` });
    }
  }
  return out;
}

/** baseline md raw unique 对象锚解析：取 info string 含 raw-indexes 标记的 fenced json 块；
 *  缺块/坏 JSON 上抛（main 转 exit 2——锚是断言面，静默缺失=假绿禁入）。 */
export function parseRawIndexAnchor(mdText) {
  const m = /```json[ \t]+[^\n]*raw-indexes[^\n]*\n([\s\S]*?)\n```/.exec(mdText);
  if (!m) throw new Error('deployment-db-baseline.md 缺 raw-indexes 机器锚（```json raw-indexes fenced 块）');
  return JSON.parse(m[1]);
}

/** 双等价判定（列集相等按排序归一——列序无关）。返回 { violations, staleDeliberate }：
 *  - violations：full raw unique（unique∧!partial）与生成唯一同表同列集且非 deliberate
 *    ⇒ { code:'duplicate-equivalent-index', raw, generated, table, columns }；
 *  - staleDeliberate：deliberate 豁免登记在 schema 已无对应生成唯一（登记须撤防陈旧豁免吞红）。 */
export function findEquivalentIndexes(generated, raws) {
  const violations = [];
  const staleDeliberate = [];
  const keyOf = (table, columns) => `${table}(${columns.map((c) => c.trim()).sort().join(',')})`;
  const genByKey = new Map(generated.map((g) => [keyOf(g.model, g.columns), g]));
  for (const r of raws) {
    if (!r.unique || r.partial) continue;
    const g = genByKey.get(keyOf(r.table, r.columns));
    if (r.deliberate) {
      if (!g) staleDeliberate.push(r.name);
      continue;
    }
    if (g) violations.push({ code: 'duplicate-equivalent-index', raw: r.name, generated: g.name, table: r.table, columns: r.columns });
  }
  return { violations, staleDeliberate };
}

/** ⑭withDoc 登记对账：counts（file→命中数）对 WITHDOC_REGISTRY（file→{三态→数}）——
 *  未登记文件=红（防新增调用点漏登记）/分类合计≠命中数=漂移（红）/登记文件命中消失=红
 *  （清单需同步——④同则）。 */
export function reconcileWithDocRegistry(counts, registry) {
  const details = [];
  for (const [f, n] of Object.entries(counts)) {
    const reg = registry[f];
    if (!reg) { details.push(`未登记 withDoc 调用点 ${f} ×${n}`); continue; }
    const want = Object.values(reg).reduce((a, b) => a + b, 0);
    if (want !== n) details.push(`登记计数漂移 ${f}: 登记合计 ${want} 实际 ${n}`);
  }
  for (const f of Object.keys(registry)) if (!counts[f]) details.push(`登记点消失 ${f}（B4 v2 清单需同步）`);
  return details;
}

/** ④encodeStateAsUpdate 生产白名单（现行清单——2026-10-11 实况逐点列名+Y0b-5 T6 增补；新增编码点必须同批补注）：
 *  gate-canvas-state ×1=A0-0 门禁画布种子构造（种子编码非测量）；
 *  canvas-doc-update.repository ×2=compact 快照重编码+tombstone delete set 余量测量（Y0b-5 T10——
 *   全 SV 滤零 structs 段的近似编码，compact ≥60s 时间门内成本有界）；
 *  collab-shrink.service ×5=export-fresh 落地校验/shrink 影子预演（apply 进 scratch+预演结果编码）
 *   /shrink 写后校准（recalibrate truth）/vacuum 真空编码（newDoc 落库快照——T9a）；
 *  collab.gateway ×3=装载真值（cheap≥soft 才实测）/vacuum residue 评估（全根真空重建编码）
 *   /over 检查 measureTruth（冷却窗外实测）；
 *  project.service ×1=项目创建种子快照；
 *  web canvasCollabRuntime ×3=客户端漂移 idle 实测自校准/measureLocalDocNow 同步实测（判据④超大兜底）
 *   /buildCacheRecord 本地缓存快照编码（Y0b-5 T8——去抖/到期/隐藏强制三触发共用单点）；
 *  web canvas-local-backup ×1=本地备份双产物导出编码（Y0b-5 T6——.yjs 可回灌产物）。 */
const ENCODE_WHITELIST = {
  'apps/api/src/gate-canvas-state.ts': 1,
  'apps/api/src/modules/collab/canvas-doc-update.repository.ts': 2,
  'apps/api/src/modules/collab/collab-shrink.service.ts': 5,
  'apps/api/src/modules/collab/collab.gateway.ts': 3,
  'apps/api/src/modules/project/project.service.ts': 1,
  'apps/web/src/stores/canvasCollabRuntime.ts': 3,
  'apps/web/src/collab/canvas-local-backup.ts': 1,
};

const results = [];
function report(id, title, pass, details) {
  results.push({ id, title, pass, details });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id} ${title}`);
  for (const d of details) console.log(`      - ${d}`);
}

function isMain() { return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href; }

if (isMain()) {
  const files = collectProductionFiles();
  if (!files.length) { console.error('check-collab-census: 结构性错误（exit 2）——生产文件面为空'); process.exit(2); }
  const byFile = new Map(files.map((p) => {
    const src = fs.readFileSync(p, 'utf8');
    return [p, { raw: src, stripped: stripCommentsAndStrings(src) }];
  }));
  const relOf = (p) => rel(p);
  const scanLines = (p, use, fn) => {
    const hits = [];
    (use === 'stripped' ? byFile.get(p).stripped : byFile.get(p).raw).split('\n').forEach((l, idx) => {
      const r = fn(l, p);
      if (r) hits.push({ file: relOf(p), line: idx + 1, text: l.trim(), why: r });
    });
    return hits;
  };

  // ①close(1008|1011|4404) 裸字面量清零（生产——注释/字符串/help 文本不拦）
  {
    const hits = files.flatMap((p) => scanLines(p, 'stripped', (l) => classifyCloseLiteral(l)));
    report('①', 'close(1008|1011|4404) 裸字面量清零（须走 CollabCloseCode+hardClose）', hits.length === 0, hits.map((h) => `${h.file}:${h.line} ${h.text}`));
  }
  // ②Connection.close( 应用侧清零（P7：库 Connection.close 丢 code——须 webSocket.close 先行）
  {
    const hits = files.flatMap((p) => scanLines(p, 'stripped', (l) =>
      /(?:connection|conn|directConn\w*)\.close\(/.test(l) ? 'Connection.close( 应用侧调用（P7：webSocket.close 先行）' : null));
    report('②', 'Connection.close( 应用侧清零（库内部调用不在此面）', hits.length === 0, hits.map((h) => `${h.file}:${h.line} ${h.text}`));
  }
  // ③frame[0]/update[0] 字节猜型清零（判型=readFrameType 库解析单源）
  {
    const hits = files.flatMap((p) => scanLines(p, 'stripped', (l) =>
      /(?:frame|update)\[0\]/.test(l) ? '字节猜型（禁 frame[0]/update[0]——readFrameType 单源）' : null));
    report('③', 'frame[0]|update[0] 字节猜型清零', hits.length === 0, hits.map((h) => `${h.file}:${h.line} ${h.text}`));
  }
  // ④encodeStateAsUpdate 生产白名单外清零（白名单逐点列名见 ENCODE_WHITELIST 注释）
  {
    const details = [];
    const counts = new Map();
    for (const p of files) {
      const n = (byFile.get(p).stripped.match(/encodeStateAsUpdate/g) ?? []).length;
      if (n) counts.set(relOf(p), n);
    }
    for (const [f, n] of counts) {
      const want = ENCODE_WHITELIST[f];
      if (want === undefined) details.push(`白名单外命中 ${f} ×${n}`);
      else if (want !== n) details.push(`白名单计数漂移 ${f}: 期望 ${want} 实际 ${n}`);
    }
    for (const f of Object.keys(ENCODE_WHITELIST)) if (!counts.has(f)) details.push(`白名单点消失 ${f}（清单需同步）`);
    report('④', `encodeStateAsUpdate 生产白名单外清零（现行 ${Object.values(ENCODE_WHITELIST).reduce((a, b) => a + b, 0)} 点/7 文件）`, details.length === 0, details);
  }
  // ⑤.bufferedAmount 仅 collab.gateway.ts 背压段（生产读点唯一——spec 装置除外）
  {
    const filesHit = files.filter((p) => byFile.get(p).stripped.includes('bufferedAmount')).map(relOf);
    report('⑤', '.bufferedAmount 生产读点唯一=collab.gateway.ts（wrapBackpressure）', filesHit.length === 1 && filesHit[0] === 'apps/api/src/modules/collab/collab.gateway.ts',
      filesHit.map((f) => `命中文件 ${f}`));
  }
  // ⑥new TokenBucket gateway 内恰四处定义点（upgrade/msg/bytes/aware——参数不同不可共实例）
  {
    const gw = files.find((p) => relOf(p) === 'apps/api/src/modules/collab/collab.gateway.ts');
    const lines = scanLines(gw, 'stripped', (l) => /new TokenBucket/.test(l) ? 'def' : null);
    const fields = lines.map((h) => (h.text.match(/this\.(\w+)\s*=\s*new TokenBucket/) ?? [])[1]).filter(Boolean);
    const want = ['upgradeBucket', 'msgBuckets', 'bytesBuckets', 'awareBuckets'];
    const stray = files.filter((p) => p !== gw && byFile.get(p).stripped.includes('new TokenBucket')).map(relOf);
    const pass = fields.length === 4 && want.every((w) => fields.includes(w)) && stray.length === 0;
    report('⑥', 'new TokenBucket 恰四处定义点（upgrade/msg/bytes/aware）且无库外实例', pass,
      [...(fields.length !== 4 || !want.every((w) => fields.includes(w)) ? [`实得字段集 [${fields.join(', ')}]（期望 [${want.join(', ')}]）`] : []), ...stray.map((f) => `gateway 外命中 ${f}`)]);
  }
  // ⑦web setSelection(/setAwarenessField('selection' 仅 awareness.ts 去抖单点（CanvasView 经桥调用）。
  //  raw 行扫描+注释行过滤：词表本身是字符串字面量实参——字符串内容剥离后会结构性消失（⑦特例）。
  {
    const aware = 'apps/web/src/collab/awareness.ts';
    const view = 'apps/web/src/pages/canvas/components/CanvasView.tsx';
    const isCommentLine = (l) => /^\s*(?:\/\/|\*|\/\*)/.test(l);
    const fieldHits = files.filter((p) => byFile.get(p).raw.split('\n').some((l) => !isCommentLine(l) && /setAwarenessField\(\s*['"]selection['"]/.test(l))).map(relOf);
    const selHits = files.filter((p) => byFile.get(p).raw.split('\n').some((l) => !isCommentLine(l) && /setSelection\(/.test(l))).map(relOf);
    const pass = fieldHits.length === 1 && fieldHits[0] === aware && selHits.every((f) => f === aware || f === view);
    report('⑦', "setAwarenessField('selection') 仅 awareness.ts；setSelection( 仅 awareness.ts+CanvasView.tsx（经桥去抖）", pass,
      [...(fieldHits.filter((f) => f !== aware).map((f) => `selection 直写越面 ${f}`)), ...(selHits.filter((f) => f !== aware && f !== view).map((f) => `setSelection 越面 ${f}`))]);
  }
  // ⑧write-frozen 服务端清零（Y0b-4 T5 起并入 doc-status〔writeFrozen 维度〕——spec 史档注释除外=剥离面）
  {
    const hits = files.filter((p) => relOf(p).startsWith('apps/api/') && byFile.get(p).stripped.includes('write-frozen')).map(relOf);
    report('⑧', "'write-frozen' 服务端生产清零（已并入 doc-status writeFrozen 维度）", hits.length === 0, hits.map((f) => `命中 ${f}`));
  }
  // ⑨.consume( 生产调用全显式 cost（msg/aware=1、bytes=帧字节、upgrade=1——禁默认参形态）
  {
    const hits = files.flatMap((p) => scanLines(p, 'stripped', (l) => classifyConsumeCall(l)));
    report('⑨', '.consume( 生产调用全显式 cost 参数', hits.length === 0, hits.map((h) => `${h.file}:${h.line} ${h.text}——${h.why}`));
  }
  // ⑩pendingStructs 装载断言存在性（Q-O 双查——存在性检查非清零）
  {
    const gw = byFile.get(files.find((p) => relOf(p) === 'apps/api/src/modules/collab/collab.gateway.ts')).stripped;
    const hasStructs = /pendingStructs\s*!==\s*null/.test(gw);
    const hasDs = /pendingDs\s*!==\s*null/.test(gw);
    report('⑩', 'pendingStructs&&pendingDs 装载双查断言存在（loadDocument 降级可观测——Q-O）', hasStructs && hasDs,
      [...(hasStructs ? [] : ['缺 pendingStructs !== null 断言']), ...(hasDs ? [] : ['缺 pendingDs !== null 断言'])]);
  }
  // ⑪readOnly 生产直写点清单（Q-A 单源：applyWriteFreeze 唯一出口+auth connectionConfig 两点；
  // Y0b-5 T16：viewer 改 auth 期意图+connected 登记=直写 3→2）
  {
    const gwPath = files.find((p) => relOf(p) === 'apps/api/src/modules/collab/collab.gateway.ts');
    const gwLines = byFile.get(gwPath).stripped.split('\n');
    const configWrites = [];
    const connWrites = [];
    const strayWrites = [];
    gwLines.forEach((l, idx) => {
      for (const m of l.matchAll(/([A-Za-z_$][\w$]*)\.readOnly\s*=/g)) {
        const lhs = m[1];
        if (lhs === 'connectionConfig') configWrites.push(idx + 1);
        else if (lhs === 'conn') connWrites.push(idx + 1);
        else strayWrites.push(`${idx + 1}: ${l.trim()}`);
      }
    });
    const methodStart = gwLines.findIndex((l) => l.includes('private') && l.includes('applyWriteFreeze('));
    const applyEnd = methodStart < 0 ? -1 : gwLines.slice(methodStart + 1).findIndex((l) => /^  (?:private|public|protected|readonly|async) /.test(l)) + methodStart + 1;
    const inApply = connWrites.length === 1 && methodStart >= 0 && connWrites[0] > methodStart && connWrites[0] < (applyEnd < 0 ? Infinity : applyEnd);
    const literalBans = files.filter((p) => /readOnly:\s*true/.test(byFile.get(p).stripped) && relOf(p).startsWith('apps/api/')).map(relOf);   // doc-status 快照 readOnly 字段防回潮（Q-A）
    const pass = configWrites.length === 2 && inApply && strayWrites.length === 0 && literalBans.length === 0;
    report('⑪', 'readOnly 直写=auth connectionConfig×2（spool 降级/quotaFrozen——viewer 走意图+connected 登记）+applyWriteFreeze×1（唯一出口）；readOnly:true 字面量清零', pass,
      [...(configWrites.length !== 2 ? [`connectionConfig.readOnly 直写 ${configWrites.length} 处（期望 2——spool 降级/quotaFrozen）`] : []),
       ...(inApply ? [] : [`conn.readOnly 直写 ${connWrites.length} 处且须恰 1 处位于 applyWriteFreeze 体内`]),
       ...strayWrites.map((s) => `越面直写 gateway:${s}`),
       ...literalBans.map((f) => `readOnly: true 字面量命中 ${f}`)]);
  }

  // ⑫裸 location.reload() 白名单（Y0b-5 T6 safeReload 九处收敛——唯一裸 reload 点=safeReload 内部；
  //  其余 reload 面一律经 safeReload(reason)：unsyncedDirty 真→导出对话框不刷新。新增越权点即红）。
  {
    const RELOAD_WHITELIST = {
      'apps/web/src/stores/canvasCollabRuntime.ts': 1,   // safeReload 内部唯一裸点
    };
    const details = [];
    const counts = new Map();
    for (const p of files) {
      const n = (byFile.get(p).stripped.match(/location\.reload\(\)/g) ?? []).length;
      if (n) counts.set(relOf(p), n);
    }
    for (const [f, n] of counts) {
      const want = RELOAD_WHITELIST[f];
      if (want === undefined) details.push(`白名单外裸 location.reload() ${f} ×${n}——改道 safeReload(reason)`);
      else if (want !== n) details.push(`reload 白名单计数漂移 ${f}: 期望 ${want} 实际 ${n}`);
    }
    for (const f of Object.keys(RELOAD_WHITELIST)) if (!counts.has(f)) details.push(`reload 白名单点消失 ${f}（清单需同步）`);
    report('⑫', `裸 location.reload() 白名单=safeReload 内部唯一点（现行 ${Object.values(RELOAD_WHITELIST).reduce((a, b) => a + b, 0)} 点——9 处收敛锚）`, details.length === 0, details);
  }

  // ⑬detail 白名单锚（Y0b-5 T18 ㉒）：生产面每个 recordCollabDiag(type,detail) 调用点
  //  键集⊆TELEMETRY_DETAIL_SCHEMA[type] 允许键集 ∧ 枚举键字面量值⊆受控值域（动态值归运行时
  //  sanitize 单源——静态只判字面量）；type∈12 值封闭集两通道同判；ring-only 通道结构性永不
  //  触达服务端 sanitize 面——键域不受 schema 约束（容量预警等本地诊断自由键），仅判 type。
  //  表=shared dist 单源导入；无清单白名单——新增调用点自动生效。
  {
    const schema = TELEMETRY_DETAIL_SCHEMA;
    const details = [];
    let nBatch = 0;
    let nRing = 0;
    for (const p of files) {
      for (const c of extractDiagCalls(byFile.get(p).raw)) {
        if (c.channel === 'batch') nBatch += 1; else nRing += 1;
        const at = `${relOf(p)}:${c.line}`;
        if (c.problem) { details.push(`${at} ${c.problem}`); continue; }
        if (!(c.type in schema)) { details.push(`${at} type '${c.type}' ∉ 12 值封闭集`); continue; }
        if (c.channel !== 'batch') continue;
        const allowed = schema[c.type];
        for (const k of c.keys) if (!(k in allowed)) details.push(`${at} detail 键 '${k}' ∉ ${c.type} 允许键集`);
        for (const [k, lits] of Object.entries(c.literals)) {
          const spec = allowed[k];
          if (spec?.values) for (const v of lits) if (!spec.values.includes(v)) details.push(`${at} ${c.type}.${k} 字面量 '${v}' ∉ 受控值域`);
        }
      }
    }
    report('⑬', `detail 白名单锚：recordCollabDiag 键集⊆schema∧字面量值域⊆枚举（现行 ${nBatch} 批量点+${nRing} ring-only 点——新增调用点自动生效）`, details.length === 0, details);
  }

  // ⑳setDefaultLabels 引导层单点（Y0c T0 Z138 A 结构断言）：prom-client register 是进程级单例且
  //  clear() 连清 _defaultLabels（di-smoke.int.spec 既有 clear+注释自陈 isolate 前提——模块级调用的
  //  效果会被后续用例的 clear 静默消灭）。调用点=main.ts+main-worker.ts 两引导序列各恰 1（Y0c T26
  //  兑现 T0 注释预告「main-worker.ts 落地时同批扩白名单」/spec §0.6 偏离 34——双进程各单点，模块级
  //  调用禁入不变）。先红构造=把调用点放 store.metrics.ts 顶层⇒红。
  {
    const BOOTSTRAP_SETLABELS_FILES = {
      'apps/api/src/main.ts': 1,
      'apps/api/src/main-worker.ts': 1,
    };
    const hits = files.flatMap((p) => scanLines(p, 'stripped', (l) =>
      /setDefaultLabels\s*\(/.test(l) ? 'call' : null));
    const details = [];
    const byFileCount = {};
    for (const h of hits) byFileCount[h.file] = (byFileCount[h.file] ?? 0) + 1;
    for (const [f, n] of Object.entries(byFileCount)) {
      if (!(f in BOOTSTRAP_SETLABELS_FILES)) details.push(`引导层外命中 ${f} ×${n}（Z138 模块级禁入）`);
      else if (n !== BOOTSTRAP_SETLABELS_FILES[f]) details.push(`${f} 调用点 ${n} 处（期望恰 ${BOOTSTRAP_SETLABELS_FILES[f]}）`);
    }
    for (const f of Object.keys(BOOTSTRAP_SETLABELS_FILES)) {
      if (!byFileCount[f]) details.push(`引导文件 ${f} 缺 setDefaultLabels 调用（清单需同步）`);
    }
    report('⑳', 'setDefaultLabels 两引导序列各恰 1（main.ts+main-worker.ts——Z138 A 双进程形态，模块级禁入）', details.length === 0, details);
  }

  // ⑭withDoc 全枚举（Y0c T2，B4 v2 形态）：生产代码每个 .withDoc( 调用点都必须在登记清单
  //  （file+三态分类合计）；清单外新调用点即红（防漏登记），登记点消失即红（清单需同步——④同则）。
  //  三态=read-only（只读 doc）/write-via-writer（经门面写 API）/待收编（直写 doc——直写域收编后清零）。
  //  Y0c T12 直写收编清零：shrink（deleteNodes/预演/fillDoc）与 intent-reconcile（exec-GC）直写段
  //  改道 doc 域应用核心 applyWriteOpsToDoc/writeBatch 单点，待收编态废止。
  //  Y0c T15（A2 读写二分）重标：readServerSV/readCanvas/writeNodeData/writeExecStatus/writeBatch
  //  全部改道 withSession（collab-residency.service.ts 承载——openDirectConnection 不经 withDoc，
  //  其 worker 闭包登记见 ⑮）——两文件 withDoc 点位归零从清单移除；withDoc 保留面=非常驻「用完即走」：
  //  逐点标注（清单；行号=2026-10-14 快照 advisory，按语义定位）：
  //   collab-shrink.service.ts    shrink（deleteNodes 经 applyWriteOpsToDoc——预演 scratch 不经 withDoc）=write-via-writer
  //                               / exportFresh 源读=read-only / exportFresh fillDoc 段（经 applyWriteOpsToDoc）=write-via-writer
  //   collab-write.port.ts        DirectCollabWritePort.withDoc 一行委托=write-via-writer（Y0c T13b——写端口 Direct 形态，
  //                               透传 CollabDocumentService.withDoc；7 方法面=8 改道文件实测用面，spec §0.6 偏离 21）
  const WITHDOC_REGISTRY = {
    'apps/api/src/modules/collab/collab-shrink.service.ts': { 'read-only': 1, 'write-via-writer': 2 },
    'apps/api/src/modules/collab/collab-write.port.ts': { 'write-via-writer': 1 },
  };
  {
    const counts = {};
    for (const p of files) {
      const n = (byFile.get(p).stripped.match(/\.withDoc\s*\(/g) ?? []).length;
      if (n) counts[relOf(p)] = n;
    }
    const details = reconcileWithDocRegistry(counts, WITHDOC_REGISTRY);
    const nPending = Object.values(WITHDOC_REGISTRY).reduce((a, r) => a + (r['待收编'] ?? 0), 0);
    const nTotal = Object.values(counts).reduce((a, b) => a + b, 0);
    report('⑭', `withDoc 全枚举登记（B4 v2 三态——现行 ${nTotal} 点/${Object.keys(counts).length} 文件，待收编 ${nPending} 点〔Y0c T12 直写收编已清零〕）`, details.length === 0, details);
  }

  // ⑮worker 符号级禁令先红（Y0c T2，Z43；片 D 冻结契约 spec:549）：17 个 @Processor 根文件出发
  //  沿相对 import 边（含 export-from）的传递闭包内，禁 openDirectConnection / @hocuspocus/server
  //  import / applyUpdate（含 V2）三符号；yjs 纯函数（mergeUpdates/encodeStateAsUpdate/
  //  decodeStateVector——repository compact 等离线用途合法）白名单登记防 worker 侧长出 doc 编码机器。
  //  预登记红机制（元纪律⑥）：现状 processor 闭包命中禁令=登记红（PASS 但逐项可见+转绿条件），
  //  未登记命中/登记红项消失/计数漂移=FAIL；片 D 完成时移除登记断言必须绿。
  //  后续组号预登记（plan T2 v4=Z147②——只登记号与用途，落地时实现）：
  //   ⑯ 裸 Y.Doc 清零（Y0c T3——createCanvasDoc() 工厂收编 B9 7 处，gate-canvas-state 豁免 Z57）
  //   ⑰ worker 模块图闭包（Y0.5 T25——worker.module 传递 imports 闭包 ∩ {*HttpModule,*Controller} ≡ ∅）
  //   ⑱ CanvasDocUpdate INSERT 唯一写点（Y0.5 T27——repo 单写点断言）
  //   ⑲ 测试 façade（T39b）
  const WORKER_BAN_REGISTERED_RED = {
    // 2026-10-14 实况登记（census 空登记跑出真红后回填——元纪律⑥）。转绿条件一律=片 D：
    // worker 拆分后 processor 链改道 HttpCollabWritePort，collab 家族（gateway/doc service/
    // repository/frame-type）整体离开 worker 闭包——届时逐项移除登记，断言必须绿。
    'apps/api/src/modules/collab/collab-document.service.ts': {
      openDirectConnection: { n: 1, until: '片D' },      // withDoc 直连入口（三入口③——Y0c T15 后=非常驻面保留通道；常驻读写经 residency）
      applyUpdate: { n: 2, until: '片D' },               // :123,:124 decodeSnapshot 快照重放（scratch doc）
    },
    'apps/api/src/modules/collab/collab-residency.service.ts': {
      openDirectConnection: { n: 1, until: '片D' },      // Y0c T15：常驻会话 acquire 新开通道（Z59 钉住谓词载体——读改写抖动终结面）
    },
    'apps/api/src/modules/collab/canvas-doc-update.repository.ts': {
      applyUpdate: { n: 2, until: '片D' },               // :255,:256 compact 方法内 temp doc 行集重放（scratch 离线，非 readSnapshotOnly——后者不 apply）
    },
    'apps/api/src/modules/collab/collab.gateway.ts': {
      'hocuspocus-server-import': { n: 2, until: '片D' },   // :3,:4 Server/hook payload 类型（经 doc service 引入闭包）
      applyUpdate: { n: 2, until: '片D' },               // :1008,:1028 loadDocument 重放/装载
    },
    'apps/api/src/modules/collab/collab-frame-type.ts': {
      'hocuspocus-server-import': { n: 1, until: '片D' },   // :6 IncomingMessage/MessageType（经 gateway 引入）
    },
  };
  // 纯函数白名单（Z43 允许面——离线 yjs 纯函数；闭包内逐文件逐符号列名，漂移/越界即红）：
  const WORKER_PUREFN_WHITELIST = {
    'apps/api/src/modules/collab/canvas-doc-update.repository.ts': { encodeStateAsUpdate: 2 },   // compact 快照重编码+tombstone 余量测量（④同源）
    'apps/api/src/modules/collab/collab.gateway.ts': { mergeUpdates: 8, decodeStateVector: 2, encodeStateAsUpdate: 3 },   // Y0c T16：handoffPendingToSpool +1（Z129 强制淘汰交接——:2491 卸载交接同款形态）
    'apps/api/src/modules/collab/collab-spool.service.ts': { mergeUpdates: 1 },                  // spool 批合并
  };
  {
    const roots = files.filter((p) => byFile.get(p).stripped.includes('@Processor('));
    const closure = collectImportClosure(roots, byFile);
    const hits = {};
    const pureCounts = {};
    const pureSyms = ['mergeUpdates', 'encodeStateAsUpdate', 'decodeStateVector'];
    for (const p of closure) {
      const { raw, stripped } = byFile.get(p);
      const fRel = relOf(p);
      const rawLines = raw.split('\n');
      const stLines = stripped.split('\n');
      for (let i = 0; i < rawLines.length; i += 1) {
        if (isHocuspocusServerImport(rawLines[i], stLines[i] ?? '')) {
          hits[fRel] ??= {};
          hits[fRel]['hocuspocus-server-import'] = (hits[fRel]['hocuspocus-server-import'] ?? 0) + 1;
        }
        const sym = classifyWorkerBannedSymbol(stLines[i] ?? '');
        if (sym) {
          hits[fRel] ??= {};
          hits[fRel][sym] = (hits[fRel][sym] ?? 0) + 1;
        }
      }
      for (const ps of pureSyms) {
        const n = (stripped.match(new RegExp(`\\b${ps}\\b`, 'g')) ?? []).length;
        if (n) (pureCounts[fRel] ??= {})[ps] = n;
      }
    }
    const { unregistered, drift, stale } = reconcileRegisteredRed(hits, WORKER_BAN_REGISTERED_RED);
    const pureDetails = [];
    for (const [f, syms] of Object.entries(pureCounts)) {
      const want = WORKER_PUREFN_WHITELIST[f];
      if (!want) {
        pureDetails.push(`纯函数白名单外命中 ${f} ×${Object.values(syms).reduce((a, b) => a + b, 0)}`);
      } else {
        for (const [ps, n] of Object.entries(syms)) {
          if (want[ps] === undefined) pureDetails.push(`纯函数白名单外命中 ${f} ${ps} ×${n}`);
          else if (want[ps] !== n) pureDetails.push(`纯函数白名单计数漂移 ${f} ${ps}: 期望 ${want[ps]} 实际 ${n}`);
        }
      }
    }
    for (const [f, syms] of Object.entries(WORKER_PUREFN_WHITELIST)) {
      for (const ps of Object.keys(syms)) if (!pureCounts[f]?.[ps]) pureDetails.push(`纯函数白名单点消失 ${f} ${ps}（清单需同步）`);
    }
    const nReg = Object.values(WORKER_BAN_REGISTERED_RED).reduce((a, syms) => a + Object.keys(syms).length, 0);
    const pass = unregistered.length === 0 && drift.length === 0 && stale.length === 0 && pureDetails.length === 0;
    report('⑮', `worker 闭包符号级禁令（Z43——闭包 ${closure.size} 文件/${roots.length} processor 根；登记红 ${nReg} 项待片 D 清零）`, pass,
      [...unregistered.map((h) => `闭包内未登记禁令命中 ${h.file} ${h.symbol} ×${h.n}`),
       ...drift.map((h) => `登记红计数漂移 ${h.file} ${h.symbol}: 登记 ${h.want} 实际 ${h.n}`),
       ...stale.map((h) => `登记红项已消失——转绿达成请移除登记（until=${h.until}）${h.file} ${h.symbol}`),
       ...pureDetails,
       ...Object.entries(WORKER_BAN_REGISTERED_RED).flatMap(([f, syms]) =>
         Object.entries(syms).map(([sym, reg]) => `登记红（until=${reg.until}）${f} ${sym} ×${reg.n}`))]);
  }

  // ⑯生产裸 new Y.Doc() 清零（Y0c T3，B9 v2/Z57——本片即绿）：api 生产面裸 new Y.Doc() 白名单外
  //  清零——单源工厂 createCanvasDoc()（canvas-doc.factory.ts）收编。现状 6 处全部无参构造
  //  （gc=true 默认），工厂同语义零行为变化；Server 级 yDocOptions{gc:true,gcFilter:()=>true}
  //  （gateway 装载 options）只覆盖 Hocuspocus 托管 doc，独立 doc（scratch/vacuum/seed/compact
  //  /快照重放）不受其管辖。白名单：工厂自身+gate-canvas-state.ts（Z57：非生产——头注自证+
  //  仅 gate-seed/spec 消费）。web 客户端面（ydocBuilder/canvasCollabRuntime×2）不在 B9/Z57
  //  清单面（客户端 doc 生命周期归 Y0a-3 provider 重建语义）——本组断言面=apps/api/src。
  const YDOC_WHITELIST = {
    'apps/api/src/gate-canvas-state.ts': 1,
    'apps/api/src/modules/collab/canvas-doc.factory.ts': 1,
  };
  {
    const details = [];
    const counts = {};
    for (const p of files) {
      if (!relOf(p).startsWith('apps/api/')) continue;
      const n = (byFile.get(p).stripped.match(/\bnew Y\.Doc\(/g) ?? []).length;
      if (n) counts[relOf(p)] = n;
    }
    for (const [f, n] of Object.entries(counts)) {
      const want = YDOC_WHITELIST[f];
      if (want === undefined) details.push(`白名单外裸 new Y.Doc() ${f} ×${n}——改道 createCanvasDoc()`);
      else if (want !== n) details.push(`Y.Doc 白名单计数漂移 ${f}: 期望 ${want} 实际 ${n}`);
    }
    for (const f of Object.keys(YDOC_WHITELIST)) if (!(f in counts)) details.push(`Y.Doc 白名单点消失 ${f}（清单需同步）`);
    const nWl = Object.values(YDOC_WHITELIST).reduce((a, b) => a + b, 0);
    report('⑯', `生产裸 new Y.Doc() 清零（api 面——createCanvasDoc() 工厂收编，白名单 ${nWl} 点/2 文件）`, details.length === 0, details);
  }

  // ⑰worker 模块图闭包（Y0c T25，Z131）：worker.module（T26 建）传递 imports 闭包 ∩ {*HttpModule,
  //  *Controller} ≡ ∅——ECONNREFUSED 是结果断言（可因端口被占等别的原因绿），闭包断言防「worker.module
  //  不小心带进 Http 子模块⇒controller 实例化⇒连带 CollabModule⇒gateway 抢租约」（Z42 依赖链的门禁化）。
  //  判定口径=worker.module.ts 出发的相对 import 传递闭包（collectImportClosure——⑮ 同机制，Nest 模块
  //  图的 ES import 近似）：闭包内任一文件声明 *HttpModule 类（export class \w*HttpModule）或含
  //  @Controller( 装饰器 ⇒ FAIL。worker.module 尚不存在（T26 建）＝登记红 until=T26（文件缺失=暂不
  //  执法，落地即闭包执法）；先红证据=临时建含 ExecutionHttpModule 的 worker.module ⇒ 本组红（T25
  //  报告贴档——元纪律⑥）。
  {
    const workerModuleRel = 'apps/api/src/worker.module.ts';
    const workerModulePath = path.join(ROOT, workerModuleRel);
    const details = [];
    let pass = true;
    if (!fs.existsSync(workerModulePath)) {
      details.push(`登记红（until=T26）${workerModuleRel} 不存在——T26 落地后本组闭包执法生效（Z131）`);
    } else {
      const closure = collectImportClosure([workerModulePath], byFile);
      const violations = [];
      for (const p of closure) {
        const st = byFile.get(p).stripped;
        const httpMods = [...st.matchAll(/export class (\w*HttpModule)\b/g)].map((m) => m[1]);
        if (httpMods.length) violations.push(`${relOf(p)} 声明 ${httpMods.join('/')}`);
        if (/@Controller\s*\(/.test(st)) violations.push(`${relOf(p)} 含 @Controller(`);
      }
      if (violations.length) {
        pass = false;
        details.push(...violations.map((v) => `worker 闭包违禁（Z131）：${v}`));
      }
      details.push(`闭包执法中：${closure.size} 文件`);
    }
    report('⑰', 'worker 模块图闭包 ∩ {*HttpModule,*Controller} ≡ ∅（Z131——结构断言强于 ECONNREFUSED 结果断言）', pass, details);
  }

  // ㉑env 两分（Y0c T3，Z89）：分叉键（双进程间值将不同的键）只进 ecosystem env 块/同值键只进
  //  服务器 .env（单文件双进程共读——Z49）。分叉键集（plan T3 三键——键名按仓内实测定准）：
  //  COLLAB_BIND_ADDR（gateway:484 既有）/COLLAB_SPOOL_DIR（ecosystem 既有）/COLLAB_ROLE（片 D
  //  T23 新键）；API_BIND_ADDR（E 片 T36 新键）已随 T36 落地入清单（:829 预留兑现——main.ts
  //  listen 第二参，ecosystem api env 块显式 127.0.0.1，worker env 块不加=部分进程语义，B/C 向并集口径自洽）。
  //  三向断言：A 分叉键∩.env 键集=∅；B ecosystem env 块键集⊆分叉键集（同值键禁混入）；C 分叉键
  //  ⊆ecosystem env 块键集（「分叉键必须显式登记于 ecosystem」）。.env 为本地文件不在 git：
  //  不存在=跳过 A 向+提示（CI/无 .env 环境可跑）；ecosystem 半边恒执法。
  //  与 check-ecosystem.mjs ENV_ALLOWLIST 同源事实（T30 扩 COLLAB_ROLE、T36 扩 API_BIND_ADDR——白名单=四分叉键全集）。
  const FORKED_ENV_KEYS = ['COLLAB_ROLE', 'COLLAB_BIND_ADDR', 'COLLAB_SPOOL_DIR', 'API_BIND_ADDR'];
  // 方向 C 登记红（元纪律⑥）：分叉键尚未落 ecosystem=登记红。T30 转绿达成——COLLAB_ROLE 已随
  //  ecosystem 双 app（api/worker）显式携带，登记按双向对账纪律移除（残留=stale 红）。
  const ECOSYSTEM_MISSING_REGISTERED_RED = {};
  {
    const fatal = [];
    let ecoKeys = [];
    try {
      const require = createRequire(import.meta.url);   // 以本脚本（scripts/）为基准——上级=仓根
      ecoKeys = ecosystemEnvKeys(require('../ecosystem.config.cjs'));
    } catch (e) {
      console.error(`check-collab-census: 结构性错误（exit 2）——ecosystem.config.cjs 加载失败：${e.message}`);
      process.exit(2);
    }
    const dotEnvPath = path.join(ROOT, 'apps', 'api', '.env');
    const dotEnvKeys = fs.existsSync(dotEnvPath) ? parseDotEnvKeys(fs.readFileSync(dotEnvPath, 'utf8')) : null;
    for (const k of (dotEnvKeys?.filter((k2) => FORKED_ENV_KEYS.includes(k2)) ?? [])) {
      fatal.push(`分叉键 ${k} 不得进 .env（双进程值将分叉——只进 ecosystem env 块）`);
    }
    for (const k of ecoKeys.filter((k2) => !FORKED_ENV_KEYS.includes(k2))) {
      fatal.push(`ecosystem env 块同值键 ${k}（两进程共读键应留 .env——ENV_ALLOWLIST 外禁入）`);
    }
    const missing = FORKED_ENV_KEYS.filter((k) => !ecoKeys.includes(k));
    for (const k of missing) {
      if (!ECOSYSTEM_MISSING_REGISTERED_RED[k]) fatal.push(`分叉键 ${k} 未显式登记于 ecosystem（方向 C——登记红 until=片D 须显式登记）`);
    }
    for (const k of Object.keys(ECOSYSTEM_MISSING_REGISTERED_RED)) {
      if (!missing.includes(k)) fatal.push(`分叉键 ${k} 已落 ecosystem——转绿达成请移除登记（until=${ECOSYSTEM_MISSING_REGISTERED_RED[k].until}）`);
    }
    const nReg = Object.keys(ECOSYSTEM_MISSING_REGISTERED_RED).length;
    report('㉑', `env 两分（Z89——分叉键 ${FORKED_ENV_KEYS.join('/')}：.env∩∅+ecosystem 子集+显式登记；登记红 ${nReg} 项）`,
      fatal.length === 0,
      [...(dotEnvKeys === null ? ['.env 不存在——方向 A（分叉键∩.env=∅）跳过（CI 形态）；ecosystem 半边恒执法'] : []),
       ...Object.entries(ECOSYSTEM_MISSING_REGISTERED_RED).map(([k, r]) => `登记红（until=${r.until}）分叉键 ${k} 未落 ecosystem`),
       ...fatal]);
  }

  // ㉒env 裸读两分（Y0c T3 建组，T34 重划终态，Z79/Z147①）：生产面 process.env 直读=键级白名单
  //  +登记红两分。判定口径不变：剥离器后行级 extractProcessEnvKeys（matchAll 同行多读点逐出现
  //  计数）键级计数精确相等（执法面）；模块级/方法内两分分类=computeBraceDepth 前缀深度近似
  //  （advisory 标注非执法——T34 偏离 53 根修模板插值孤儿 `}` 负漂移后，假阳性清零）。
  //  T34 重划终态（2026-10-16）：登记红清零（原 103 项 until=T34 全处置——Z147① 前置全仓枚举
  //  实测 107 键项/34 文件〔与登记口径 103红+4白 同源对账吻合；键项变动=dto NODE_ENV 出现数
  //  3→1〔constraint 单点读〕+main.ts NODE_ENV 移除〔改 env.NODE_ENV 单源〕+config/env.ts
  //  NODE_ENV +1〔Z45② 单源写回点〕——键项数净持平、文件 +1；T35 增量=106 键项/33 文件——
  //  auth.ts/update-profile.dto NODE_ENV 读点改调 env.ts resolveSecureTransport 消失〔dto 条目
  //  整文件核销〕+env.ts COOKIE_SECURE/NODE_ENV resolver 单点惰性读入白名单〔§0.6 偏离 55〕）。
  //  模块加载期违规面（9 文件 14
  //  键项）已惰性化/useFactory 化/constraint 化（各文件行内注「T34 整改」），其余按实测形态入
  //  白名单——形态分类口径（每文件行尾注）：构造器=DI 构造期读（NestFactory.create，恒在
  //  validateEnv 后）｜uF装配期=useFactory/register()/动态模块装配期读（同前）｜方法内=运行期
  //  每调即读｜函数内=导出的纯/惰性函数调用期读｜惰性单例=首调用构造缓存（auth.ts getAuth 族）
  //  ｜defarg=函数默认参数（调用期求值）｜装饰器回调=元数据内存函数、请求期求值（cors origin）
  //  ｜constraint=class-validator 校验期读｜单源写回点=env.ts validateEnv 赋值（非决策读）。
  //  模块级 const 仅存历史豁免 1 处：collab.gateway COMPACT_INTERVAL_MS（T34 复核=确认保留——
  //  值经 dotenv 先行在位、无 NODE_ENV 类 default 归一化需求、消费面 compact 判据非部署档位）。
  //  advisory 已知形态边界（非缺陷，白名单在案）：①depth0 惰性箭头（provider-adapters
  //  fakeAiEnabled——调用期求值合规，brace 启发式见不到箭头体）②defarg 参数默认值在花括号体
  //  外（platform-team.seed ADMIN_EMAIL）③上述历史豁免。动态键 4 点（process.env[<非字面量>]
  //  ——键级词表原理外）T34 归属核定=运行期动态键设计使然：feature flag 读（subscription-
  //  feature.guard:18）/DB 配置预热写点（main.ts:58——ALLOWED_DB_OVERRIDE_KEYS 白名单门控）/
  //  settings.service:56,74（admin 面读写同门）——advisory 口径维持。config/env.ts 的
  //  safeParse(process.env)=env 单源入口本体（整对象形态词表外不命中——唯一命中是写回点）。
  const ENV_READ_WHITELIST = {
    'apps/api/src/auth/auth.ts': {                    // T34 整改：惰性单例/函数（getAuth/getSessionCookieOptions/getAuthRedis——调用期读）；T35：NODE_ENV 读点改调 resolveSecureTransport 消失
      REDIS_URL: 1, BETTER_AUTH_URL: 1, CORS_ORIGIN: 1,
    },
    'apps/api/src/auth/wechat/wechat.controller.ts': { // 方法内
      WECHAT_APP_ID: 1,
    },
    'apps/api/src/auth/wechat/wechat.service.ts': {   // 方法内
      WECHAT_APP_ID: 1, WECHAT_APP_SECRET: 1,
    },
    'apps/api/src/common/redis/managed-redis.ts': {   // 函数内（createManagedRedis defarg 兜底——调用期求值）
      REDIS_URL: 1,
    },
    'apps/api/src/common/services/rate-limiter.service.ts': {   // T34 整改：函数内（ipWhitelist() 惰性）；T36 已兑现：键入 zod schema（env.ts 形态校验）+手写 XFF 解析删除（req.ip 单源）——默认 '127.0.0.1,::1' 唯一落使用点
      RATE_LIMIT_IP_WHITELIST: 1,
    },
    'apps/api/src/config/env.ts': {                   // 单源写回点（Z45②——validateEnv 成功后 process.env.NODE_ENV 赋值，非决策读）+T35 Z13 resolver 单点（resolveSecureTransport 惰性读 COOKIE_SECURE/NODE_ENV——update-profile.dto 白名单条目随改道核销）
      NODE_ENV: 2, COOKIE_SECURE: 1,
    },
    'apps/api/src/main.ts': {                         // 函数内（preloadDbConfig 引导层应急开关；NODE_ENV 读点 T34 改 env.NODE_ENV 单源已移除）
      DISABLE_DB_CONFIG_PRELOAD: 1,
    },
    'apps/api/src/metrics/prometheus-auth.guard.ts': {   // 方法内（canActivate 惰性——Z45② 写回等价）
      PROMETHEUS_TOKEN: 1, NODE_ENV: 1,
    },
    'apps/api/src/modules/collab/collab-admin-auth.guard.ts': {   // 方法内（canActivate 惰性——同上）
      COLLAB_ADMIN_TOKEN: 1, NODE_ENV: 1,
    },
    'apps/api/src/modules/collab/collab-lease.service.ts': {   // 构造器
      COLLAB_LEASE_TTL_MS: 1, COLLAB_LEASE_HEARTBEAT_MS: 1,
    },
    'apps/api/src/modules/collab/collab-ready.controller.ts': {   // 方法内（授权档视图双 token 同行读）
      COLLAB_ADMIN_TOKEN: 1, PROMETHEUS_TOKEN: 1,
    },
    'apps/api/src/modules/collab/collab-residency.service.ts': {   // 构造器（reaper 三键——默认值落使用点纪律）
      COLLAB_SESSION_IDLE_TTL_MS: 1, COLLAB_MAX_RESIDENT_BYTES: 1, COLLAB_MAX_LOADED_DOCS: 1,
    },
    'apps/api/src/modules/collab/collab-spool.service.ts': {   // 构造器（DIR/CAPACITY）+方法内（validateDir 二次读）
      COLLAB_SPOOL_DIR: 2, COLLAB_SPOOL_CAPACITY_BYTES: 1,
    },
    'apps/api/src/modules/collab/collab.gateway.ts': {   // 构造器（quota/upgradeBucket）+方法内每调即读族（allowedOrigins/refusalTtl 等）+函数内（resolveCollabDebounce）+模块级 const 历史豁免 1（COMPACT_INTERVAL_MS——T34 复核保留）
      COMPACT_INTERVAL_MS: 1, COLLAB_DEBOUNCE: 1, NODE_ENV: 2, COLLAB_UPGRADE_RATE_PER_MIN: 1,
      COLLAB_MAX_DOC_BYTES: 1, COLLAB_MAX_TX_BYTES: 1, COLLAB_MSG_RATE_PER_CONN: 1, COLLAB_BYTES_RATE_PER_CONN: 1,
      COLLAB_PORT: 1, COLLAB_TIMEOUT: 1, COLLAB_BIND_ADDR: 2, COLLAB_ALLOWED_ORIGINS: 1, BETTER_AUTH_URL: 1,
      COLLAB_TRUSTED_PROXY: 1, COLLAB_REFUSAL_CACHE_TTL_MS: 1, COLLAB_AUTH_ATTEMPTS_PER_MIN: 1,
      COLLAB_AUTH_INFLIGHT_MAX: 1, COLLAB_ROLE: 1, COLLAB_RSS_TRIP_BYTES: 1, COLLAB_RSS_RELEASE_BYTES: 1,
      COLLAB_HEAP_PRESSURE_RATIO: 1, COLLAB_CONN_MAX_LIFETIME_MS: 1, COLLAB_SWEEP_ENABLED: 1,
    },
    'apps/api/src/modules/collab/collab.module.ts': {   // T34 整改：uF装配期（三 token useValue→useFactory；REDIS_CLIENT uF 既有）
      COLLAB_PORT: 1, COLLAB_TIMEOUT: 1, REDIS_URL: 1,
    },
    'apps/api/src/modules/collab/worker-write-auth.guard.ts': {   // 方法内（canActivate 惰性——同上）
      WORKER_WRITE_TOKEN: 1, NODE_ENV: 1,
    },
    'apps/api/src/modules/execution/api-caller.service.ts': {   // 方法内（onModuleInit 预算锁+submit/poll 超时族）
      EXEC_SYNC_HARD_CAP: 1, EXEC_SUBMIT_TIMEOUT_MS: 2, EXEC_POLL_TIMEOUT_MS: 3,
    },
    'apps/api/src/modules/execution/execution-core.module.ts': {   // uF装配期（EmitPort 工厂 COLLAB_ROLE）
      COLLAB_ROLE: 1,
    },
    'apps/api/src/modules/execution/execution-daemon.module.ts': {   // uF装配期（register() 静态方法体 COLLAB_ROLE）
      COLLAB_ROLE: 1,
    },
    'apps/api/src/modules/execution/intent-key.util.ts': {   // 函数内（deadlineMsForKind/execMaxNodes/syncHardCapMs 调用期读+EXEC_DEFAULTS 兜底单源）
      EXEC_DEADLINE_TEXT_MS: 1, EXEC_DEADLINE_IMAGE_MS: 1, EXEC_DEADLINE_VIDEO_MS: 1,
      EXEC_DEADLINE_EDIT_MS: 2, EXEC_DEADLINE_LIGHTING_MS: 1, EXEC_MAX_NODES: 3, EXEC_SYNC_HARD_CAP: 3,
    },
    'apps/api/src/modules/execution/provider-adapters.ts': {   // 惰性函数（fakeAiEnabled depth0 箭头=advisory 已知边界）+函数内（seedEnvValue switch 字面量族）
      COLLAB_FAKE_AI: 1, PROVIDER_MOONSHOT_API_KEY: 1, PROVIDER_TENCENT_API_KEY: 1, DASHSCOPE_API_KEY: 1,
    },
    'apps/api/src/modules/execution/video-trim.constants.ts': {   // T34 整改：函数内（ffmpegPath/ffprobePath 惰性——原模块级 const 导出退役）
      FFMPEG_PATH: 1, FFPROBE_PATH: 1,
    },
    'apps/api/src/modules/execution/video-trim.processor.ts': {   // 构造器（ffmpegConfig 类字段初始化=DI 构造期）
      VIDEO_TRIM_ENCODER: 1, VIDEO_TRIM_PRESET: 1, VIDEO_TRIM_CRF: 1,
    },
    'apps/api/src/modules/gateway/execution.gateway.ts': {   // T34 整改：装饰器回调（cors origin 函数形态——请求期读 CORS_ORIGIN）
      CORS_ORIGIN: 1,
    },
    'apps/api/src/modules/media-process/media-process.service.ts': {   // T34 整改：函数内（ffmpegPath/ffprobePath 惰性）
      FFMPEG_PATH: 1, FFPROBE_PATH: 1,
    },
    'apps/api/src/modules/minio/minio.module.ts': {   // 方法内（ensureBucket 工厂/生命周期——MINIO_INIT 显式裁剪门）
      MINIO_INIT: 1,
    },
    'apps/api/src/modules/recharge/recharge.module.ts': {   // uF装配期（PAYMENT_PROVIDER 工厂）+函数内（validateWeChatPayConfig 启动断言）
      WECHAT_PAY_APP_ID: 3, WECHAT_PAY_MCH_ID: 1, WECHAT_PAY_API_V3_KEY: 1, WECHAT_PAY_MERCHANT_SERIAL_NO: 1,
      WECHAT_PAY_PRIVATE_KEY: 3, WECHAT_PAY_PUBLIC_KEY_ID: 1, WECHAT_PAY_PUBLIC_KEY: 3, WECHAT_PAY_MERCHANT_CERT: 2,
    },
    'apps/api/src/modules/sms/sms.service.ts': {   // 构造器（SmsClient 凭据）+方法内（SendSms 模板三键）
      TENCENT_SMS_SECRET_ID: 1, TENCENT_SMS_SECRET_KEY: 1, TENCENT_SMS_SDK_APP_ID: 1,
      TENCENT_SMS_TEMPLATE_ID: 1, TENCENT_SMS_SIGN_NAME: 1,
    },
    'apps/api/src/modules/subscription/subscription-order.service.ts': {   // 方法内（notifyUrl 同行双读）
      WECHAT_PAY_NOTIFY_URL: 1, CORS_ORIGIN: 1,
    },
    'apps/api/src/modules/team/task/team-recharge-active-query.processor.ts': {   // 方法内
      WECHAT_PAY_APP_ID: 1, WECHAT_PAY_MCH_ID: 1,
    },
    'apps/api/src/modules/team/team-recharge.service.ts': {   // 方法内（notifyUrl 同行双读+回调 appid/mchid 校验双读）
      WECHAT_PAY_NOTIFY_URL: 1, CORS_ORIGIN: 1, WECHAT_PAY_APP_ID: 2, WECHAT_PAY_MCH_ID: 2,
    },
    'apps/api/src/prisma/platform-team.seed.ts': {   // defarg（seed 函数默认参数——调用期求值；advisory depth0 已知边界）
      ADMIN_EMAIL: 1,
    },
    'apps/api/src/worker.module.ts': {   // uF装配期（PAYMENT_PROVIDER 工厂=recharge.module 同款 verbatim）
      WECHAT_PAY_APP_ID: 2, WECHAT_PAY_MCH_ID: 1, WECHAT_PAY_API_V3_KEY: 1, WECHAT_PAY_MERCHANT_SERIAL_NO: 1,
      WECHAT_PAY_PRIVATE_KEY: 1, WECHAT_PAY_PUBLIC_KEY_ID: 1, WECHAT_PAY_PUBLIC_KEY: 1,
    },
  };
  // T34（Z79/Z147①）登记红清零——2026-10-14 实况登记 103 项 until='T34' 全部处置完毕：
  // 模块加载期违规面（9 文件 14 键项——auth.ts/update-profile.dto/execution.gateway 装饰器/
  // collab.module useValue/rate-limiter/media-process/video-trim.constants；provider-adapters
  // 与 gateway COMPACT_INTERVAL_MS 为合规/豁免形态）已惰性化/useFactory 化/constraint 化
  // （改道详情见白名单「T34 整改」注），其余按实测形态重划入白名单；main.ts NODE_ENV 改读
  // env 单源（读点消失）。双向对账 stale 机制保证本表不可再积压（登记项处置即须移除否则红）。
  // 后续新增直读点：整改/入白名单（同批注释形态分类）或重新登记红（until=显式任务号）。
  const ENV_READ_REGISTERED_RED = {};
  {
    const hits = {};
    const advisory = [];
    const atMap = new Map();   // `file|key` → { lines, module }——登记红展开输出的行号/〔M〕定位（I-2）
    for (const p of files) {
      if (!relOf(p).startsWith('apps/api/')) continue;
      const { stripped } = byFile.get(p);
      const lines = stripped.split('\n');
      let depth = 0;
      lines.forEach((l, i) => {
        const beforeDepth = depth;
        depth = computeBraceDepth(l) + depth;
        for (const key of extractProcessEnvKeys(l)) {
          const f = relOf(p);
          (hits[f] ??= {})[key] = (hits[f]?.[key] ?? 0) + 1;
          advisory.push(`${f}:${i + 1} ${key}${beforeDepth === 0 ? '（module-level）' : ''}`);
          const at = atMap.get(`${f}|${key}`) ?? { lines: [], module: false };
          at.lines.push(i + 1);
          at.module ||= beforeDepth === 0;
          atMap.set(`${f}|${key}`, at);
        }
        for (let d = 0; d < countDynamicEnvAccess(l); d += 1) {
          advisory.push(`${relOf(p)}:${i + 1} 动态键直接访问点（process.env[<非字面量>] 键静态不可知）——键级普查词表外；T34 归属核定=运行期动态键设计使然（feature flag/DB 预热写点/settings admin 面——advisory 口径维持）`);
        }
      });
    }
    const merged = {};
    for (const [f, syms] of Object.entries(ENV_READ_WHITELIST)) {
      merged[f] = {};
      for (const [k, n] of Object.entries(syms)) merged[f][k] = { n, until: '白名单（T34 实测重划）' };
    }
    for (const [f, syms] of Object.entries(ENV_READ_REGISTERED_RED)) {
      merged[f] ??= {};
      for (const [k, reg] of Object.entries(syms)) merged[f][k] = reg;
    }
    const whiteSet = new Set(Object.entries(ENV_READ_WHITELIST).flatMap(([f, syms]) => Object.keys(syms).map((k) => `${f}|${k}`)));
    const { unregistered, drift, stale } = reconcileRegisteredRed(hits, merged);
    const nRed = Object.values(ENV_READ_REGISTERED_RED).reduce((a, syms) => a + Object.keys(syms).length, 0);
    const nWhite = Object.values(ENV_READ_WHITELIST).reduce((a, syms) => a + Object.keys(syms).length, 0);
    const nHit = Object.values(hits).reduce((a, o) => a + Object.keys(o).length, 0);
    report('㉒', `env 裸读两分（Z79/T34 重划终态——${nHit} 键项/${Object.keys(hits).length} 文件；白名单 ${nWhite} 键项/${Object.keys(ENV_READ_WHITELIST).length} 文件+登记红 ${nRed} 项）`,
      unregistered.length === 0 && drift.length === 0 && stale.length === 0,
      [...unregistered.map((h) => `白名单外未登记直读 ${h.file} ${h.symbol} ×${h.n}——整改（Z79）或入白名单（同批注释形态分类）；须暂留则登记红 until=任务号`),
       ...drift.map((h) => `直读计数漂移 ${h.file} ${h.symbol}: 登记 ${h.want} 实际 ${h.n}`),
       ...stale.map((h) => whiteSet.has(`${h.file}|${h.symbol}`)                        // 白名单≠转绿——消息分叉（T3 评审 M-3）
         ? `直读白名单点已消失——清单需同步核销 ${h.file} ${h.symbol}`
         : `直读登记项已消失——转绿达成请移除登记 ${h.file} ${h.symbol}`),
       ...advisory.filter((a) => a.includes('（module-level）')).map((a) => `module-level 直读（Z79 违规面 advisory）${a}`),
       ...advisory.filter((a) => a.includes('动态键直接访问点')).map((a) => `动态键读点 advisory ${a}`),
       ...Object.entries(ENV_READ_REGISTERED_RED).map(([f, syms]) => {                 // 登记红 PASS 可见展开（T3 评审 I-2——组⑮同则）
         const items = Object.entries(syms).map(([k, reg]) => {
           const at = atMap.get(`${f}|${k}`);
           return at ? `${k}:${at.lines.join(',')}${at.module ? '〔M〕' : ''}` : `${k}×${reg.n}`;
         });
         return `登记红 ${f} ${items.join('+')}`;
       })]);
  }

  // ㉓E27 嵌套类型创建点（Y0c T4，E27/E17 层②）：生产面 `new Y.Map()/Y.Array()/Y.Text()` 逐文件
  //  计数白名单——嵌套 Y 类型创建点全登记，未登记新写点红（创建者唯一性语义登记面=shared
  //  canvas-doc-manifest NESTED_TYPE_CREATORS；本组=lexical 执法面）。词表按 2026-10-14 HEAD
  //  实际落地形态写就（先跑真红再登记——T2/T3 惯例）：fillDoc 适配工厂 3 文件（gate-canvas-state/
  //  doc-like.util/ydocBuilder——gate-canvas-state 为 Z57 非 生产 gate 面）+canvasIntents 4 点
  // （nodes.*.data/nodes.*.position×2 工厂实参/edges 复用守卫）+collab-document.service 2 点
  // （nodes.*.data 懒建/exec.* 唯一创建者）+gateway deepCopyYMap 1 点（vacuum 真空重建）。
  //  Y.Text/Y.Array 现状生产零创建点（词表含入=将来引入即红，登记须同批补注）。
  const NESTED_CREATOR_WHITELIST = {
    'apps/api/src/gate-canvas-state.ts': 1,
    'apps/api/src/modules/collab/collab-document.service.ts': 2,
    'apps/api/src/modules/collab/collab.gateway.ts': 1,
    'apps/api/src/modules/collab/doc-like.util.ts': 1,
    'apps/web/src/collab/ydocBuilder.ts': 2,
    'apps/web/src/stores/canvasIntents.ts': 4,
  };
  {
    const details = [];
    const counts = {};
    for (const p of files) {
      const n = (byFile.get(p).stripped.match(/\bnew Y\.(?:Map|Array|Text)\(/g) ?? []).length;
      if (n) counts[relOf(p)] = n;
    }
    for (const [f, n] of Object.entries(counts)) {
      const want = NESTED_CREATOR_WHITELIST[f];
      if (want === undefined) details.push(`白名单外嵌套创建点 ${f} ×${n}——登记 NESTED_CREATOR_WHITELIST+NESTED_TYPE_CREATORS 同批补注`);
      else if (want !== n) details.push(`嵌套创建点计数漂移 ${f}: 期望 ${want} 实际 ${n}`);
    }
    for (const f of Object.keys(NESTED_CREATOR_WHITELIST)) if (!(f in counts)) details.push(`嵌套创建点白名单点消失 ${f}（清单需同步）`);
    const nWl = Object.values(NESTED_CREATOR_WHITELIST).reduce((a, b) => a + b, 0);
    report('㉓', `E27 嵌套类型创建点全登记（Y0c T4——new Y.Map/Array/Text 白名单 ${nWl} 点/6 文件；Y.Text/Y.Array 零创建点）`, details.length === 0, details);
  }

  // ㉔双等价索引 census（Y0c T6，Z58/偏离 52 门禁化）：schema.prisma 全部唯一声明按 Prisma 命名
  //  规则拼生成唯一索引名 → 与 deployment-db-baseline.md raw unique 对象锚比对——full（非 partial）
  //  手写唯一同表同列集⇒红 duplicate-equivalent-index。两半皆静态（本脚本无 DB）；库侧实存形态由
  //  verify-indexes.sql 块族钉守（fake-pricing-unique-gone/pricing_rule_natural_key 等）。
  //  纪律面=baseline §七：新 raw 唯一对象必须同批登记锚（漏登记=锚失效——本组只判已登记面）。
  {
    const details = [];
    let generated = [];
    let raws = [];
    try {
      generated = parsePrismaUniques(fs.readFileSync(path.join(ROOT, 'apps', 'api', 'prisma', 'schema.prisma'), 'utf8'));
      raws = parseRawIndexAnchor(fs.readFileSync(path.join(ROOT, 'docs', 'superpowers', 'deployment-db-baseline.md'), 'utf8'));
    } catch (e) {
      console.error(`check-collab-census: 结构性错误（exit 2）——${e.message}`);
      process.exit(2);
    }
    const { violations, staleDeliberate } = findEquivalentIndexes(generated, raws);
    for (const v of violations) details.push(`${v.code} raw '${v.raw}' ≡ 生成 '${v.generated}'（${v.table}(${v.columns.join(',')})）——schema @@unique 与 raw SQL 唯一二选一`);
    for (const n of staleDeliberate) details.push(`stale-deliberate 豁免登记失配 ${n}（schema 已无对应 @@unique——撤登记或补声明）`);
    report('㉔', `双等价索引 census（Z58——schema 生成唯一 ${generated.length} 名 × raw 锚 ${raws.length} 对象，full 同表同列集零碰撞）`, violations.length === 0 && staleDeliberate.length === 0, details);
  }

  // ㉕unloadDocument 库直调唯一调用点（Y0c T19，Z65②/A2 冻结契约）：生产面 `.unloadDocument(` 调用
  //  形态恰 2 处，且各自形态锁定：
  //  - 库 API 直调（`hocuspocus.unloadDocument(`）唯一命中=collab-residency.service.ts forceEvictStoreFailed
  //    内（Z110 store 失败强制淘汰——Z65 唯一调用点；调用前断言三条件/失败告警计数由 reaper spec
  //    Z110 组承载，本组=词法面唯一性执法）；
  //  - 豁免形态：collab.gateway.ts `beforeUnloadDocument: (p) => this.unloadDocument(p)` 钩子接线——
  //    调的是 gateway 私有同名方法（X4 清账钩子本体），库经 beforeUnloadDocument 钩子回调触达非应用
  //    主动直调；私有方法定义行（`private async unloadDocument(`）无点号调用形态天然不命中。
  //  他处任何 `.unloadDocument(` 直调即红（先红验证=临时在另一生产文件注入库直调——元纪律⑥）。
  {
    const hits = files.flatMap((p) => scanLines(p, 'stripped', (l) => /\.unloadDocument\s*\(/.test(l) ? 'call' : null));
    const direct = hits.filter((h) => /hocuspocus\.unloadDocument\s*\(/.test(h.text));
    const wiring = hits.filter((h) => h.file === 'apps/api/src/modules/collab/collab.gateway.ts'
      && /beforeUnloadDocument:[^=]*=>\s*this\.unloadDocument\s*\(/.test(h.text));
    const stray = hits.filter((h) => !direct.includes(h) && !wiring.includes(h));
    const pass = direct.length === 1 && direct[0]?.file === 'apps/api/src/modules/collab/collab-residency.service.ts'
      && wiring.length === 1 && stray.length === 0;
    report('㉕', 'unloadDocument 库直调唯一调用点=residency forceEvict（Z65②——gateway 钩子接线/私有同名方法豁免）', pass,
      [...(direct.length !== 1 ? [`库直调命中 ${direct.length} 处（期望恰 1——residency forceEvictStoreFailed）`] : []),
       ...(direct.length === 1 && direct[0].file !== 'apps/api/src/modules/collab/collab-residency.service.ts' ? [`库直调越面 ${direct[0].file}:${direct[0].line}`] : []),
       ...(wiring.length !== 1 ? [`gateway 钩子接线形态漂移（期望恰 1 处 beforeUnloadDocument 接线）：${wiring.length} 处`] : []),
       ...stray.map((h) => `白名单外 .unloadDocument( 直调 ${h.file}:${h.line} ${h.text}`)]);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\ncheck-collab-census: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) { console.error(`check-collab-census FAIL: ${failed.map((f) => f.id).join(' ')}`); process.exit(1); }
}
