#!/usr/bin/env node
// A0 CSS 审计脚本（五路输出 → e2e/audit/audit-A0.json + audit-A0.md）
// 纪律：只读分析，不改任何源文件。稳定键 = 文件 + 宿主元素签名（tag + 文件内序号），非行号。
// 用法：node scripts/css-audit.mjs [--rebuild]
//   --rebuild 强制重跑 pnpm build（默认：dist/assets/*.css 缺失才构建）
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'); // apps/web
const OUT_DIR = path.join(ROOT, 'e2e', 'audit');
const FORCE_REBUILD = process.argv.includes('--rebuild');

/* ------------------------------------------------------------------ *
 * 基础设施：文件枚举 / 字符串字面量扫描 / 产物 CSS 类存在性判定
 * ------------------------------------------------------------------ */

/** 镜像 tailwind.config content（index.html + src 下全部 js/ts/jsx/tsx）*/
function listSourceFiles() {
  const files = [path.join(ROOT, 'index.html')];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|ts|jsx|tsx)$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  return files;
}

const rel = (p) => path.relative(ROOT, p).replaceAll('\\', '/');

/** 字符串字面量扫描器：产出现成字面量（'…" / "…" / `…` 模板静态块）。
 * 模板含 ${…} 的静态块标记 dynamic=true（用于死类判定的"动态拼接存疑"分流）；
 * 插值体（三元分支等）内的字符串字面量递归提取——分支类串是真类，漏扫会造成统计缺口。
 * 与 Tailwind 一致按原始文本扫描——JS 语义（注释/普通字符串）不区分，这是刻意的对齐。 */
function extractLiterals(text, out = [], base = 0) {
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    if (c === "'" || c === '"') {
      const start = i; i++;
      let buf = '';
      while (i < n && text[i] !== c) {
        if (text[i] === '\\') { buf += text[i + 1] ?? ''; i += 2; continue; }
        buf += text[i]; i++;
      }
      i++; // closing quote
      out.push({ text: buf, start: base + start, quote: c, dynamic: false, template: false });
      continue;
    }
    if (c === '`') {
      const start = i; i++;
      let buf = '';
      let hasInterp = false;
      while (i < n && text[i] !== '`') {
        if (text[i] === '\\') { buf += text[i + 1] ?? ''; i += 2; continue; }
        if (text[i] === '$' && text[i + 1] === '{') {
          hasInterp = true;
          buf += ' ';
          const interpStart = i + 2;
          let depth = 1;
          let j = interpStart;
          while (j < n && depth > 0) { // 大括号计数定位插值体边界（嵌套对象/三元安全）
            if (text[j] === '{') depth++;
            else if (text[j] === '}') depth--;
            else if (text[j] === '\\') j++;
            j++;
          }
          // 插值体内的字符串字面量（如三元分支类串）递归提取
          extractLiterals(text.slice(interpStart, j - 1), out, base + interpStart);
          i = j;
          continue;
        }
        buf += text[i]; i++;
      }
      i++;
      out.push({ text: buf, start: base + start, quote: '`', dynamic: hasInterp, template: true });
      continue;
    }
    i++;
  }
  return out;
}

/** 最近的前置 JSX 开标签（宿主元素签名）：向前找最近的 `<Tag` 形态 */
function nearestTagBefore(text, pos) {
  const before = text.slice(Math.max(0, pos - 400), pos);
  const matches = [...before.matchAll(/<([A-Za-z][A-Za-z0-9.]*)/g)];
  return matches.length ? matches[matches.length - 1][1] : '(root)';
}

/** 产物 CSS 就绪：dist/assets/*.css 全量拼接 */
function loadProdCss() {
  const distDir = path.join(ROOT, 'dist', 'assets');
  const cssFiles = fs.existsSync(distDir) ? fs.readdirSync(distDir).filter((f) => f.endsWith('.css')) : [];
  if (FORCE_REBUILD || cssFiles.length === 0) {
    console.log('[audit] 构建产物缺失或 --rebuild，执行 pnpm build …');
    const r = spawnSync('pnpm', ['build'], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (r.status !== 0) throw new Error('pnpm build 失败');
  }
  const files = fs.readdirSync(distDir).filter((f) => f.endsWith('.css')).map((f) => path.join(distDir, f));
  return { css: files.map((f) => fs.readFileSync(f, 'utf8')).join('\n'), files: files.map(rel) };
}

/** 变体链模式：普通变体（hover:/focus-within:）+ 具名组变体（group-hover/row:）都吃掉 */
const V = '(?:[a-z0-9-]+(?:/[a-z0-9-]+)?:)*';

/** 类是否在产物 CSS 中生成规则：从产物 CSS 解析选择子类名集合（含反转义），
 *  免疫 Tailwind 转义形态差异（如 2xl: 前缀数字转义为 \32xl） */
function unescapeCssIdent(s) {
  return s
    .replace(/\\([0-9a-fA-F]{1,6})[ \t]?/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\(.)/g, '$1');
}
function makeClassProbe(prodCss) {
  const set = new Set();
  for (const m of prodCss.matchAll(/\.((?:\\(?:[0-9a-fA-F]{1,6})[ \t]?|\\.|[A-Za-z0-9_-])+)/g)) {
    set.add(unescapeCssIdent(m[1]));
  }
  return (token) => set.has(token);
}

/* ------------------------------------------------------------------ *
 * 域归属草案（route ⑤ 产出 D4 草案，route ①②⑤ 消费）
 * 判据顺序：1) D4 域图（目录+渲染证据，路径只是初筛） 2) 岛根祖先链 3) 跟随域。
 * 反例登记：HistorySidebar.tsx 在 components/ 下但消费 --canvas-controls-*（画布壳）→ 跟随。
 * ------------------------------------------------------------------ */
const BOARD_DIRS = ['src/pages/canvas/components/nodes/', 'src/pages/canvas/components/edges/', 'src/pages/canvas/components/groups/'];
const ISLAND_DIRS = ['src/pages/canvas/video-editor/', 'src/components/MaterialLibrary/'];
const CANVAS_SHELL_ANNOTATION = '画布壳（canvas shell）= 跟随域：画布页 DOM 骨架（菜单/调板/顶栏/侧栏），主题化时随站点走';

function domainOf(relFile) {
  if (BOARD_DIRS.some((d) => relFile.startsWith(d))) return 'board'; // 画板恒深
  if (ISLAND_DIRS.some((d) => relFile.startsWith(d))) return 'island'; // 岛内
  return 'following'; // 跟随
}
const DOMAIN_LABEL = { board: '画板恒深', island: '岛内', following: '跟随' };

/** 类字符串上下文里是否给出了 border 颜色（裸边框判定的配对侧） */
const BORDER_COLOR_RE = new RegExp(
  '^' + V + 'border(?:-[a-z0-9]+)*-(?:\\[[^\\]]*\\]|white|black|transparent|current|inherit|brand(?:-[a-z]+)?|(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|grey|zinc|neutral|stone)(?:-\\d{2,3}|\\/\\d+)?|white\\/\\d+|black\\/\\d+)$'
);

/* ------------------------------------------------------------------ *
 * 扫描主循环：产出现场记录（occurrence）
 * ------------------------------------------------------------------ */
function scanOccurrences(files) {
  const occs = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const literals = extractLiterals(text);
    for (const lit of literals) {
      const tokens = lit.text.split(/\s+/).filter(Boolean);
      if (!tokens.length) continue;
      const tag = nearestTagBefore(text, lit.start);
      const line = text.slice(0, lit.start).split('\n').length;
      const isTest = /\.(test|spec)\.[jt]sx?$/.test(file) || file.includes('__tests__');
      // 模板插值边界：token 是首/尾且紧贴插值（字面量以替代空格开头/结尾）→ 才可能被拼接截断（存疑判据）
      const edgeUncertain = (idx) =>
        lit.template && ((idx === 0 && lit.text.startsWith(' ')) || (idx === tokens.length - 1 && lit.text.endsWith(' ')));
      for (let idx = 0; idx < tokens.length; idx++) {
        occs.push({
          file: rel(file), line, tag, token: tokens[idx], start: lit.start,
          ctx: lit.text, // 该类串所在字面量（裸边框颜色配对判定用）
          dynamic: edgeUncertain(idx), template: lit.template, isTest,
        });
      }
    }
  }
  return occs;
}

/* ------------------------------------------------------------------ *
 * Route ① 颜色债 + 涌现面（裁定拆列）+ 主题色工具类宿主岛归属
 * ------------------------------------------------------------------ */
const COLOR_PROPS = 'bg|text|border|ring|fill|stroke|from|via|to|divide|outline|shadow|decoration|accent|caret';
const HEX_IN_BRACKET = new RegExp(`^${V}(?:${COLOR_PROPS})(?:-[a-z0-9]+)*-\\[(#[0-9a-fA-F]{3,8}[a-zA-Z0-9]*)\\]$`);
const BORDER_WIDTH_RE = new RegExp('^' + V + 'border(?:-(?:t|r|b|l|x|y|s|e))?(?:-(?:0|1|2|4|8))?$');
const BORDER_BRACKET_COLOR_RE = new RegExp('^' + V + 'border(?:-[a-z0-9]+)*-\\[(#[0-9a-fA-F]{3,8}|var\\(--[^)]+\\))\\](\\/\\d+)?$');
const DIVIDE_RE = new RegExp('^' + V + 'divide-(?:x|y)(?:-\\d+)?$');
const DIVIDE_COLOR_RE = new RegExp('^' + V + 'divide-(?:white|black)(?:\\/\\d+)?$');
const WHITE_BLACK_UTIL_RE = new RegExp(`^(${V})(bg|text|border|ring|divide|fill|stroke|from|via|to|outline|shadow|decoration|accent|caret)-(white|black)(/(\\d+))?$`);
const BORDER_STYLE_BRACKET_RE = /\[border-(?:[a-z]+-)?style:[a-z]+\]/;

function withKeys(items) {
  // 稳定键：file#tag#文件内同族序号（后任务 diff 依据；行号只作展示）
  const seq = new Map();
  return items.map((it) => {
    const k = `${it.file}#${it.tag}`;
    const i = seq.get(k) ?? 0;
    seq.set(k, i + 1);
    return { ...it, key: `${k}@${i}` };
  });
}

function collectRoute1(occs, files) {
  const colorDebt = [];
  const bareBorder = [];
  const borderColorExplicit = [];
  const divide = [];
  const fourGridCode = [];
  const fourGridTest = [];
  const fourGridInline = [];
  const themeWhiteBlack = [];
  let borderWidthTotal = 0;

  for (const o of occs) {
    if (HEX_IN_BRACKET.test(o.token)) colorDebt.push(o);
    if (BORDER_BRACKET_COLOR_RE.test(o.token)) borderColorExplicit.push(o);
    if (DIVIDE_RE.test(o.token) || DIVIDE_COLOR_RE.test(o.token)) divide.push(o);
    if (BORDER_WIDTH_RE.test(o.token)) {
      borderWidthTotal++;
      // 裸边框：宽度类出现，且同字面量（同 className 串/同分支）内无任何 border 颜色类
      const hasColor = o.ctx.split(/\s+/).some((t) => BORDER_COLOR_RE.test(t));
      if (!hasColor) bareBorder.push(o);
    }
    if (BORDER_STYLE_BRACKET_RE.test(o.token)) (o.isTest ? fourGridTest : fourGridCode).push(o);
    const m = o.token.match(WHITE_BLACK_UTIL_RE);
    if (m) themeWhiteBlack.push({ ...o, variant: m[1], prop: m[2], colorName: m[3], opacity: m[5] ?? null });
  }

  // [border-*-style] 四格阵的内联样式列：tsx 源里 border*Style: '…'
  for (const file of files.filter((f) => f.endsWith('.tsx'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/border(?:Top|Right|Bottom|Left)?Style\s*:/g)) {
      const line = text.slice(0, m.index).split('\n').length;
      fourGridInline.push({ file: rel(file), line, tag: nearestTagBefore(text, m.index), snippet: m[0], isTest: /\.(test|spec)\.[jt]sx?$/.test(file) || file.includes('__tests__') });
    }
  }

  // textarea 清单：标签出现点 + 是否带显式文本颜色
  const textareaInv = [];
  for (const file of files.filter((f) => f.endsWith('.tsx'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/<textarea\b/g)) {
      const window = text.slice(m.index, m.index + 800);
      const clsMatch = window.match(/className\s*=\s*(?:"([^"]*)"|\{?`([^`]*)`)/);
      const cls = clsMatch ? (clsMatch[1] ?? clsMatch[2] ?? '') : '';
      const hasTextColor = new RegExp('(?:^|\\s)' + V + 'text-\\S+').test(cls);
      textareaInv.push({
        file: rel(file), line: text.slice(0, m.index).split('\n').length, tag: 'textarea',
        className: cls.slice(0, 200), hasExplicitTextColor: hasTextColor,
        isTest: /\.(test|spec)\.[jt]sx?$/.test(file) || file.includes('__tests__'),
      });
    }
  }

  // 主题色工具类三列归属
  const attribution = { board: [], island: [], following: [] };
  for (const o of themeWhiteBlack) attribution[domainOf(o.file)].push(o);
  const attrSummary = Object.fromEntries(
    Object.entries(attribution).map(([k, v]) => [k, { count: v.length, files: [...new Set(v.map((x) => x.file))].length }])
  );

  const byFileTop = (items) => {
    const c = new Map();
    for (const it of items) c.set(it.file, (c.get(it.file) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([f, n]) => `${f} (${n})`);
  };

  return {
    colorDebt: {
      count: colorDebt.length,
      byProp: countBy(colorDebt, (o) => o.token.replace(/^((?:[a-z0-9-]+(?:\/[a-z0-9-]+)?:)+)/, '').split('-')[0]),
      byFileTop: byFileTop(colorDebt),
      items: withKeys(colorDebt),
    },
    bareBorder: { count: bareBorder.length, borderWidthTotal, productCount: bareBorder.filter((o) => !o.isTest).length, byFileTop: byFileTop(bareBorder), items: withKeys(bareBorder) },
    borderColorExplicit: { count: borderColorExplicit.length, byFileTop: byFileTop(borderColorExplicit), items: withKeys(borderColorExplicit) },
    divide: { count: divide.length, items: withKeys(divide) },
    textarea: { count: textareaInv.filter((t) => !t.isTest).length, countAll: textareaInv.length, items: textareaInv },
    fourGrid: {
      codeCount: fourGridCode.length,
      testCount: fourGridTest.length,
      inlineCount: fourGridInline.length,
      code: withKeys(fourGridCode),
      test: withKeys(fourGridTest),
      inline: fourGridInline,
    },
    themeUtilityAttribution: {
      total: themeWhiteBlack.length,
      columns: attrSummary,
      textWhiteExact: themeWhiteBlack.filter((o) => o.prop === 'text' && o.colorName === 'white' && !o.opacity).length,
      textWhiteExactInPagesCanvas: themeWhiteBlack.filter((o) => o.prop === 'text' && o.colorName === 'white' && !o.opacity && o.file.startsWith('src/pages/canvas/')).length,
      textBlackExact: themeWhiteBlack.filter((o) => o.prop === 'text' && o.colorName === 'black' && !o.opacity).length,
      filesAll: [...new Set(themeWhiteBlack.map((o) => o.file))].length,
      board: withKeys(attribution.board),
      island: withKeys(attribution.island),
      following: withKeys(attribution.following),
    },
  };
}

function countBy(items, fn) {
  const c = new Map();
  for (const it of items) { const k = fn(it); c.set(k, (c.get(k) ?? 0) + 1); }
  return Object.fromEntries([...c.entries()].sort((a, b) => b[1] - a[1]));
}

/* ------------------------------------------------------------------ *
 * Route ② 半透明族按属性×透明度分列（五通道，变体前缀必须吃掉）
 * ------------------------------------------------------------------ */
const TRANSLUCENT_RE = new RegExp('^(' + V + ')(bg|border|text|ring|divide)-white\\/(\\d{1,3})$');
const DIVIDE_WHITE_BARE_RE = new RegExp('^' + V + 'divide-white$');

function collectRoute2(occs) {
  const channels = { bg: [], border: [], text: [], ring: [], divide: [] };
  const divideWhiteBare = [];
  for (const o of occs) {
    const m = o.token.match(TRANSLUCENT_RE);
    if (m) channels[m[2]].push({ ...o, variant: m[1], tier: m[3] });
    else if (DIVIDE_WHITE_BARE_RE.test(o.token)) divideWhiteBare.push(o);
  }
  const mk = (items) => ({
    count: items.length,
    tiers: countBy(items, (o) => o.tier),
    variants: [...new Set(items.map((o) => o.variant).filter(Boolean))],
    files: [...new Set(items.map((o) => o.file))],
    items: withKeys(items),
  });
  return {
    bgWhite: mk(channels.bg),
    borderWhite: mk(channels.border),
    textWhite: mk(channels.text),
    ringWhite: mk(channels.ring),
    divideWhite: { count: divideWhiteBare.length + channels.divide.length, items: withKeys([...divideWhiteBare, ...channels.divide]) },
  };
}

/* ------------------------------------------------------------------ *
 * Route ③ 死类家族冻结清单（compile-diff：源类字符串 − 产物 CSS 选择子）
 * 只对 content globs 内文件判定（假阳性拦截）；动态拼接产物单独列"存疑"，不判死。
 * ------------------------------------------------------------------ */
const KNOWN_UTILITY_ROOTS = new Set(
  ('flex grid block inline table flow-root contents hidden visible invisible static fixed absolute relative sticky isolate ' +
    'antialiased italic not-italic underline overline line-through no-underline uppercase lowercase capitalize normal-case ' +
    'truncate text-ellipsis text-clip break-normal break-words break-all break-keep wrap wrap-reverse nowrap ' +
    'box-border box-content box-clip box-fill sr-only not-sr-only appearance-none cursor-pointer select-none resize-none ' +
    'list-none list-disc list-decimal list-inside list-outside list-image ' +
    // 复合族：前缀匹配（下方 rootPrefixes）
    '').split(/\s+/)
);
const KNOWN_UTILITY_PREFIXES = (
  'text bg border ring divide outline decoration accent caret fill stroke shadow opacity inset top right bottom left ' +
  'w h min-w max-w min-h max-h size z basis gap space p px py pt pr pb pl m mx my mt mr mb ml ' +
  'font tracking leading align whitespace indent list order col row cols rows grid-cols grid-rows col-span col-start col-end ' +
  'aspect columns object overflow overscroll isolation justify items content self place justify-items justify-self ' +
  'transition duration ease delay animate transform scale rotate translate skew origin filter backdrop ' +
  'blur brightness contrast grayscale hue-rotate invert saturate sepia drop-shadow ' +
  'mix-blend bg-blend from via to placeholder ' +
  'border-x border-y border-s border-e rounded outline-offset underline-offset'
).split(/\s+/);
// 注：group/peer/dark/not/first/last/odd/even/data 等是变体词不是独立工具类——变体链已被剥掉，
// 剩下这些裸词（散文常见）不判类；纯前缀裸词（text/gap/duration 等）同理要求必须带值部分。

function looksLikeUtility(token) {
  if (!/^[!-~]+$/.test(token)) return false; // 仅可打印 ASCII（拦中英混排散文串）
  const bare = token.replace(/^((?:[a-z0-9-]+(?:\/[a-z0-9-]+)?:)+)/, ''); // 剥变体链（含具名组变体）
  if (KNOWN_UTILITY_ROOTS.has(bare)) return true;
  return KNOWN_UTILITY_PREFIXES.some((p) => bare.startsWith(p + '-') || bare.startsWith(p + '[') || bare.startsWith(p + '/'));
}

const isContentFile = (relFile) => relFile === 'index.html' || relFile.startsWith('src/');

function collectRoute3(occs, classPresent) {
  const dead = [];
  const uncertain = [];
  const seen = new Set();
  const literalIsClassString = new Map(); // ctx → 是否类字符串字面量（≥1 真类 + 类密度判据，拦测试标题等英文散文）
  const qualifies = (ctx) => {
    if (!literalIsClassString.has(ctx)) {
      const toks = ctx.split(/\s+/).filter(Boolean);
      const real = toks.filter((t) => classPresent(t)).length;
      literalIsClassString.set(ctx, real >= 1 && (toks.length <= 3 || real / toks.length >= 0.4));
    }
    return literalIsClassString.get(ctx);
  };
  for (const o of occs) {
    if (!isContentFile(o.file)) continue;
    if (!looksLikeUtility(o.token)) continue;
    if (!qualifies(o.ctx)) continue; // 散文/URL/data 属性值等非类字符串字面量——整串跳过
    if (o.token.endsWith('-') || o.token.endsWith(':')) continue; // 拼接残片
    const k = `${o.file}|${o.token}|${o.start ?? o.line}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (classPresent(o.token)) continue;
    if (o.dynamic) uncertain.push(o);
    else dead.push(o);
  }
  const family = (items) => {
    const byToken = new Map();
    for (const o of items) {
      if (!byToken.has(o.token)) byToken.set(o.token, []);
      byToken.get(o.token).push(o);
    }
    return [...byToken.entries()]
      .map(([token, occ]) => ({ token, count: occ.length, productCount: occ.filter((x) => !x.isTest).length, occurrences: withKeys(occ) }))
      .sort((a, b) => b.count - a.count);
  };
  return {
    dead: { total: dead.length, families: family(dead) },
    uncertain: { total: uncertain.length, families: family(uncertain) },
  };
}

/* ------------------------------------------------------------------ *
 * Route ④ 斜杠零输出检测基线：var() 型 token 键 + /NN 的组合（现状应为 0）
 * 另登记现存 [#hex]/NN 用法（合法——hex+斜杠可用），供 B0 后 diff。
 * ------------------------------------------------------------------ */
function collectRoute4(occs, files) {
  const configText = fs.readFileSync(path.join(ROOT, 'tailwind.config.ts'), 'utf8');
  const colorEntries = [...configText.matchAll(/([a-zA-Z][a-zA-Z0-9]*)\s*:\s*['"]([^'"]+)['"]/g)]
    .map((m) => ({ key: m[1], value: m[2] }));
  const varValuedKeys = colorEntries.filter((e) => /^var\(--/.test(e.value));
  const varSlashTokens = occs.filter((o) => /\[var\(--[^)]+\)\]\/\d+$/.test(o.token) || /-\[var\(--[^)]+\)\]:\d+$/.test(o.token));
  const hexSlash = occs.filter((o) => /\[#[0-9a-fA-F]{3,8}[a-zA-Z0-9]*\]\/\d+$/.test(o.token));
  // var 键名 + /NN 直接组合（如未来 token 化后 text-canvas-text/60）——现状无 var 键，恒 0
  const varKeys = new Set(varValuedKeys.map((e) => e.key));
  const varKeySlash = occs.filter((o) => {
    const m = o.token.match(new RegExp('^' + V + '(?:[a-z-]+)-([a-zA-Z][a-zA-Z0-9-]*)(?:\\/\\d+)$'));
    return m && varKeys.has(m[1]);
  });
  return {
    varValuedColorKeys: varValuedKeys,
    varSlashViolations: { count: varSlashTokens.length + varKeySlash.length, items: [...varSlashTokens, ...varKeySlash] },
    hexSlashBaseline: { count: hexSlash.length, items: withKeys(hexSlash) },
    note: 'B0 落地 var() 型颜色键后，此路转为产物 CSS 存在性回归检查；当前基线冻结为 0',
  };
}

/* ------------------------------------------------------------------ *
 * Route ⑤ 域 token 引用点 × 宿主域 + 变量引用图 + D4 画板清单草案
 * ------------------------------------------------------------------ */
const TOKEN_VAR_RE = /var\((--(?:canvas|ve|vw)-[a-z0-9-]+)\)/g;
const NEVER_MIGRATE = ['--canvas-handle-*', '--edge-flow-*', '--canvas-shadow-*', '--z-panel'];

function listCssFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.css')) out.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  return out;
}

function collectRoute5(files) {
  // (a) ts/tsx 引用点：形态分类——className 任意值（-[var(--x)]）vs 内联 style 对象值
  const refs = [];
  for (const file of files.filter((f) => /\.(tsx|ts)$/.test(f))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(TOKEN_VAR_RE)) {
      const line = text.slice(0, m.index).split('\n').length;
      // 判据：var( 紧前是 "-["（className 任意值语法），否则按 style 对象值
      const form = /-\[$/.test(text.slice(Math.max(0, m.index - 2), m.index)) ? 'className-arbitrary' : 'inline-style-object';
      refs.push({
        file: rel(file), line, tag: nearestTagBefore(text, m.index), token: m[1], form,
        domain: domainOf(rel(file)),
        isTest: /\.(test|spec)\.[jt]sx?$/.test(file) || file.includes('__tests__'),
      });
    }
  }
  // (b) 手写 CSS 文件引用点（声明 vs var() 使用，按所在行形态初判）
  const cssRefs = [];
  const graphEdges = [];
  for (const file of listCssFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (const m of text.matchAll(/--(?:canvas|ve|vw)-[a-z0-9-]+/g)) {
      const line = text.slice(0, m.index).split('\n').length;
      const lineText = lines[line - 1] ?? '';
      cssRefs.push({ file: rel(file), line, token: m[0], kind: /--[\w-]+\s*:/.test(lineText) ? 'declaration' : 'var-usage' });
    }
    // 变量引用图：自定义属性值里引用其它自定义属性
    for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]*var\((--[a-z0-9-]+)\)[^;{}]*)/g)) {
      graphEdges.push({
        from: m[1], to: m[3], file: rel(file),
        line: text.slice(0, m.index).split('\n').length,
        value: m[2].trim().slice(0, 80),
      });
    }
  }
  // (c) D4 画板组件清单草案：BOARD_DIRS 全量 tsx + 证据（节点经 CanvasView nodeTypes 注册/目录渲染链）
  const nodeTypesText = fs.readFileSync(path.join(ROOT, 'src/pages/canvas/components/CanvasView.tsx'), 'utf8');
  const boardList = files
    .filter((f) => BOARD_DIRS.some((d) => rel(f).startsWith(d)) && f.endsWith('.tsx') && !rel(f).includes('.test.'))
    .map((f) => {
      const rf = rel(f);
      const comp = path.basename(rf, '.tsx');
      const registered = new RegExp(`:\\s*${comp}\\b`).test(nodeTypesText);
      const tokenUse = refs.filter((r) => r.file === rf).length;
      return {
        component: comp, path: rf,
        evidence: [
          registered ? 'CanvasView.tsx nodeTypes/edgeTypes 注册（渲染进 React Flow viewport）' : null,
          tokenUse ? `消费域 token ${tokenUse} 处` : null,
          '目录归属 nodes/edges/groups（画板子树初筛，路径仅初筛判据）',
        ].filter(Boolean),
      };
    });
  return {
    tokenRefs: {
      total: refs.filter((r) => !r.isTest).length,
      byToken: countBy(refs.filter((r) => !r.isTest), (r) => r.token),
      items: refs,
    },
    cssRefs: { total: cssRefs.length, items: cssRefs },
    graphEdges,
    draftBoardList: boardList,
    neverMigrate: NEVER_MIGRATE,
    counterExample: {
      component: 'HistorySidebar.tsx',
      path: 'src/components/HistoryPage/HistorySidebar.tsx',
      note: '路径前缀反例：位于 components/ 但消费 --canvas-controls-text/hover（index.css 画布壳 token）→ 域=跟随（' + CANVAS_SHELL_ANNOTATION + '）。判据顺序=域图→岛根祖先链→跟随域，路径不可作为判据',
    },
  };
}

/* ------------------------------------------------------------------ *
 * Probe 登记（A1 断言靶点事实冻结）
 * ------------------------------------------------------------------ */
function collectProbes(files) {
  // 裸 <button>（无 className 属性）：整标签跨行扫描
  const bareButtons = [];
  for (const file of files.filter((f) => f.endsWith('.tsx'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/<button\b/g)) {
      const close = text.indexOf('>', m.index);
      const tagText = text.slice(m.index, close + 1);
      const line = text.slice(0, m.index).split('\n').length;
      const aria = tagText.match(/aria-label\s*=\s*"([^"]*)"/);
      const isTest = /\.(test|spec)\.[jt]sx?$/.test(file) || file.includes('__tests__');
      if (!/className/.test(tagText)) {
        bareButtons.push({
          file: rel(file), line, tag: 'button', ariaLabel: aria ? aria[1] : null,
          hasStyleAttr: /style\s*=/.test(tagText),
          probeCandidate: /login|register/.test(rel(file)) || !!aria,
          isTest,
        });
      }
    }
  }
  // aria-disabled 现状清单（预期 4 行：产品 1 + 测试 3）
  const ariaDisabled = [];
  for (const file of files.filter((f) => /\.(tsx|ts)$/.test(f))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/aria-disabled/g)) {
      ariaDisabled.push({
        file: rel(file), line: text.slice(0, m.index).split('\n').length,
        kind: /'aria-disabled'|"aria-disabled"|getAttribute/.test(text.slice(m.index - 60, m.index + 40)) ? 'test-assertion' : 'attribute',
      });
    }
  }
  return {
    bareButtons: {
      productCount: bareButtons.filter((b) => !b.isTest).length,
      testCount: bareButtons.filter((b) => b.isTest).length,
      note: 'A1-1 四属性归零断言靶点：登记"无 className 的 <button>"；父级 font-size 基准由 before 基线快照的 fontSize 字段承接（本表登记哪些元素合格——login/register 页与带 aria-label 者为优先探针）',
      items: bareButtons,
    },
    workspaceTabBar: {
      file: 'src/pages/workspace/components/WorkspaceTabBar.tsx',
      note: 'A1-2 双臂分模断言靶点（选中臂 vs 未选中臂）',
      selectors: {
        personalTab: 'getByRole("button", { name: "个人项目" })',
        teamTab: 'getByRole("button", { name: "团队项目" })',
      },
      selectedArmClasses: 'text-white border-b-2 border-white border-x-0 border-t-0',
      unselectedArmClasses: 'text-white/50 border-none',
    },
    ariaDisabled: { expect: '产品 1 + 测试 3 = 4 行', items: ariaDisabled },
  };
}

/* ------------------------------------------------------------------ *
 * 主流程 + 输出（audit-A0.json 主产物 / audit-A0.md 人读）
 * ------------------------------------------------------------------ */
function getCommit() {
  try { return execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(); }
  catch { return '(unknown)'; }
}

function renderMd(audit) {
  const L = [];
  const p = (s = '') => L.push(s);
  p('# A0 CSS 审计报告（before 基线冻结）');
  p();
  p(`- 生成时间：${audit.meta.generatedAt}`);
  p(`- 基线 commit：\`${audit.meta.commit}\``);
  p(`- 产物 CSS：${audit.meta.prodCssFiles.join(', ')}（compile-diff 的"产物侧"）`);
  p(`- 统计口径：按**类字符串出现次**计（任务参考值为 grep 行数口径，同行多次/含 \`text-white/NN\` 子串等会造成偏差——本表为冻结权威口径）`);
  p(`- 稳定键：\`file#tag@序号\`（宿主元素签名，非行号）；行号仅辅助人读`);
  p();
  p('## Route ① 颜色债 + 涌现面（裁定拆列）+ 主题色工具类归属');
  p();
  p('| 维度 | 计数 | 参考 | 说明 |');
  p('|---|---|---|---|');
  p(`| 颜色债（任意值硬编码 hex） | ${audit.route1.colorDebt.count}（产品 ${audit.route1.colorDebt.items.filter((i) => !i.isTest).length}） | — | bg/text/border/ring/…-[#hex] 全量 |`);
  p(`| 边框宽度类总数 | ${audit.route1.bareBorder.borderWidthTotal} | ~324 | 参考口径即此数（含配了色的） |`);
  p(`| 裸边框（宽度无色） | ${audit.route1.bareBorder.count}（产品 ${audit.route1.bareBorder.productCount}） | — | 同 className 串/同分支内无 border 颜色类——真"忘配色"裁定族 |`);
  p(`| border-[color]（宽度+显式色） | ${audit.route1.borderColorExplicit.count} | ~238 | [\#hex]/[var(--…)] 两形，绝大多数保留 |`);
  p(`| 分隔线 divide 族 | ${audit.route1.divide.count} | 1 处 | divide-y + divide-white/5 同点（TeamBillingPage）；子元素 UA border-style:none → 全站不可见 |`);
  p(`| textarea 清单 | ${audit.route1.textarea.count}（产品，含测试 ${audit.route1.textarea.countAll}） | ~7 | 逐个登记是否带显式文本色 |`);
  p(`| [border-*-style:*] 四格阵 | 代码 ${audit.route1.fourGrid.codeCount}（solid 18 + dashed 1） + 测试断言 ${audit.route1.fourGrid.testCount} + 内联 ${audit.route1.fourGrid.inlineCount} | 18+1+1 | dashed 在 VideoEditNode |`);
  p();
  const a = audit.route1.themeUtilityAttribution;
  p('### 主题色工具类（white/black 族）宿主岛归属（三列）');
  p();
  p('| 列 | 计数 | 文件数 |');
  p('|---|---|---|');
  for (const [k, v] of Object.entries(a.columns)) p(`| ${DOMAIN_LABEL[k]}（${k}） | ${v.count} | ${v.files} |`);
  p();
  p(`- text-white（精确 token，不含 /NN）：**${a.textWhiteExact}**（参考 213 为 grep 行数口径：同行多记 + 含 text-white/NN 行；src/pages/canvas/ 下 ${a.textWhiteExactInPagesCanvas}，参考 83）`);
  p(`- text-black（精确 token）：**${a.textBlackExact}**（参考 16 = 行数口径，此处一致量级）`);
  p(`- white/black 族总出现：${a.total}，涉及 ${a.filesAll} 文件`);
  p('- 归属判据顺序：D4 域图草案（route ⑤）→ 岛根祖先链 → 跟随域；路径前缀不可作判据（反例 HistorySidebar）');
  p();
  p('## Route ② 半透明族（属性 × 透明度分列，五通道，变体前缀已吃）');
  p();
  p('| 通道 | 计数 | 透明度档 | 变体前缀 | 参考 |');
  p('|---|---|---|---|---|');
  const r2ref = { bgWhite: '~197/12 档', borderWhite: '~54/10 档', textWhite: '~93/11 档', ringWhite: '5（宿主元素口径；此处为出现次口径，WorkspaceToolbar:43 同点 2 类）', divideWhite: '1' };
  for (const k of ['bgWhite', 'borderWhite', 'textWhite', 'ringWhite', 'divideWhite']) {
    const c = audit.route2[k];
    p(`| ${k} | ${c.count} | ${Object.keys(c.tiers || {}).sort((x, y) => Number(x) - Number(y)).join(', ') || '—'} | ${(c.variants || []).join(' ') || '—'} | ${r2ref[k]} |`);
  }
  p();
  p('## Route ③ 死类家族（compile-diff，content globs 内，动态拼接单列存疑）');
  p();
  p(`- 判死总数：**${audit.route3.dead.total}**（参考 ~25-27）；动态拼接存疑：${audit.route3.uncertain.total}`);
  p();
  p('| 类 token | 总次 | 产品次 |');
  p('|---|---|---|');
  for (const f of audit.route3.dead.families) p(`| \`${f.token}\` | ${f.count} | ${f.productCount} |`);
  p();
  if (audit.route3.uncertain.families.length) {
    p('存疑（动态拼接，不判死）：');
    p();
    p('| 类 token | 次数 |');
    p('|---|---|');
    for (const f of audit.route3.uncertain.families) p(`| \`${f.token}\` | ${f.count} |`);
    p();
  }
  p('## Route ④ 斜杠零输出基线');
  p();
  p(`- var() 型颜色键：${JSON.stringify(audit.route4.varValuedColorKeys)}（现状 0）`);
  p(`- var 键 + /NN 组合违规：**${audit.route4.varSlashViolations.count}**（基线冻结为 0；B0 后转产物 CSS 存在性回归检查）`);
  p(`- 现存 [\`#hex\`]/NN（合法，hex+斜杠可用）：**${audit.route4.hexSlashBaseline.count}**（参考 ~28）`);
  p();
  p('## Route ⑤ 域 token 引用 × 宿主域 + 变量引用图 + D4 画板清单草案');
  p();
  p(`- ts/tsx var() 引用点（产品码）：**${audit.route5.tokenRefs.total}**`);
  p();
  p('| token | 引用次数 |');
  p('|---|---|');
  for (const [t, n] of Object.entries(audit.route5.tokenRefs.byToken)) p(`| \`${t}\` | ${n} |`);
  p();
  p('### 变量引用图（手写 CSS 内自定义属性 → 其它自定义属性间接链）');
  p();
  for (const e of audit.route5.graphEdges) p(`- \`${e.file}:${e.line}\` — \`${e.from}: ${e.value}\` → 引用 \`${e.to}\``);
  p();
  p('### D4 画板组件清单草案（恒深保留 + 禁 token 化），证据逐条');
  p();
  for (const b of audit.route5.draftBoardList) p(`- **${b.component}**（\`${b.path}\`）：${b.evidence.join('；')}`);
  p();
  p(`- 岛内草案：${ISLAND_DIRS.join('、')}（video-editor 壳 / MaterialLibrary 自带 CSS 弹层）`);
  p(`- 永不迁移清单：${NEVER_MIGRATE.join('、')}`);
  p(`- 反例登记：${audit.route5.counterExample.note}`);
  p();
  p('## Probe 登记（A1 断言靶点）');
  p();
  const bb = audit.probes.bareButtons;
  p(`- 裸 \`<button>\`（无 className）：产品 ${bb.productCount} + 测试 ${bb.testCount}；优先探针=login/register 页与带 aria-label 者（父级 font-size 基准由基线快照承接）`);
  p(`- WorkspaceTabBar 双臂：选中 \`${audit.probes.workspaceTabBar.selectedArmClasses}\` / 未选中 \`${audit.probes.workspaceTabBar.unselectedArmClasses}\`；选择器 \`${audit.probes.workspaceTabBar.selectors.personalTab}\``);
  p(`- aria-disabled 现状：${audit.probes.ariaDisabled.items.length} 行（${audit.probes.ariaDisabled.expect}）`);
  p();
  p('## 判断与口径备忘（本脚本自决项）');
  p();
  p('- 归属三列的"岛内"草案含 video-editor 与 MaterialLibrary 子树（自带独立 CSS 的暗色自持区）；videos 预览弹层暂归跟随，D4 定稿时复核');
  p('- border-[color] 计入 `[#hex]` 与 `[var(--…)]` 两形（后者现值域 token，同属"宽度+显式色"裁定列）');
  p('- 死类判定 = 类字符串字面量内的静态完整 token（content globs 内、产物 CSS 无规则）；判据三重：字面量需含真类（密度≥40%）、token 需完整工具类形状（纯前缀裸词/以 - 结尾的拼接残片不判）、模板插值边缘 token 只入存疑');
  p('- 与 grep 口径的已解释偏差：① grep 子串匹配会把测试标题里黏连中文的类名计入（bg-white/NN 差 1）；② grep 行数把同行多类少记（text-white 参考 213）；③ ring-white 参考按宿主元素 5 记、本表按出现次 7 记（WorkspaceToolbar:43 同点 ring-white/10 + focus-within:ring-white/20）');
  p('- 产物 CSS 类存在性判定 = 解析选择子类名集合后精确比对（含反转义），免疫 2xl: 等前缀数字的 hex 转义形态（\\32xl）');
  p('- 颜色债口径含颜色属性全族（bg/text/border/ring/fill/stroke/from/via/to/divide/outline/shadow/decoration/accent/caret）的 `[#hex]` 任意值');
  p('- audit 明细（含全部 items/稳定键）见 audit-A0.json');
  return L.join('\n');
}

function main() {
  const started = new Date();
  const files = listSourceFiles();
  const { css: prodCss, files: prodCssFiles } = loadProdCss();
  const classPresent = makeClassProbe(prodCss);
  const occs = scanOccurrences(files);
  console.log(`[audit] 扫描 ${files.length} 个 content 文件，${occs.length} 个类 token 现场`);

  const audit = {
    meta: {
      generatedAt: started.toISOString(),
      commit: getCommit(),
      node: process.version,
      tailwind: '3.4.19',
      prodCssFiles: prodCssFiles,
      contentGlobs: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
      invocation: 'node scripts/css-audit.mjs [--rebuild]',
      stableKeyFormat: 'file#tag@seq（宿主元素签名，非行号）',
    },
    route1: collectRoute1(occs, files),
    route2: collectRoute2(occs),
    route3: collectRoute3(occs, classPresent),
    route4: collectRoute4(occs),
    route5: collectRoute5(files),
    probes: collectProbes(files),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, 'audit-A0.json');
  fs.writeFileSync(jsonPath, JSON.stringify(audit, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'audit-A0.md'), renderMd(audit));
  console.log(`[audit] 输出 ${rel(jsonPath)}（${(fs.statSync(jsonPath).size / 1024).toFixed(0)} KB）+ audit-A0.md`);
  // 摘要
  console.log(`[audit] ① 颜色债 ${audit.route1.colorDebt.count} | 裸边框 ${audit.route1.bareBorder.count} | border-[color] ${audit.route1.borderColorExplicit.count} | divide ${audit.route1.divide.count} | textarea ${audit.route1.textarea.count} | 四格阵 ${audit.route1.fourGrid.codeCount}+${audit.route1.fourGrid.testCount}+${audit.route1.fourGrid.inlineCount}`);
  console.log(`[audit] ① white/black 归属 board=${audit.route1.themeUtilityAttribution.columns.board.count} island=${audit.route1.themeUtilityAttribution.columns.island.count} following=${audit.route1.themeUtilityAttribution.columns.following.count}`);
  console.log(`[audit] ② bg-white/NN ${audit.route2.bgWhite.count} | border-white/NN ${audit.route2.borderWhite.count} | text-white/NN ${audit.route2.textWhite.count} | ring-white/NN ${audit.route2.ringWhite.count} | divide-white ${audit.route2.divideWhite.count}`);
  console.log(`[audit] ③ 死类 ${audit.route3.dead.total} | 存疑 ${audit.route3.uncertain.total}`);
  console.log(`[audit] ④ var 键/NN 违规 ${audit.route4.varSlashViolations.count} | [#hex]/NN ${audit.route4.hexSlashBaseline.count}`);
  console.log(`[audit] ⑤ token 引用 ${audit.route5.tokenRefs.total} | 引用图边 ${audit.route5.graphEdges.length} | D4 草案 ${audit.route5.draftBoardList.length} 组件`);
}

main();



