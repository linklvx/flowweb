#!/usr/bin/env node
// A5 三层基线 diff：before-A0（冻结）× after-A（HEAD 采集）→ e2e/audit/baseline-diff-A5.{json,md}
//   + e2e/audit/audit-A5-borderwidth.json（A4 删除"零宽度零几何"验证回补）
// 三层口径（spec §2.6-2 / plan A5）：
//   属性层（聚合）：box-sizing / border-*-style / border-*-width / border-*-color / line-height /
//     font-size(表单) / color(表单) 分桶计数 + 预期类别标注；桶外值对（如 solid→none）逐条列意外。
//   几何层（逐元素）：rect w/h/x/y + padding + border-width + font-size 每条标 预期/意外 并归因——
//     归因次序：媒体 display:block → 表单重置 → 自身 line-height 翻转 → box-sizing 翻转算术 → 级联传导。
//   line-height 二分：变/不变计数 + (before→after) 值对分布（对照 A0 冻结值）。
// 采集/断言分离：本脚本只消费两份基线 JSON，不启动浏览器。
// 用法：node scripts/css-baseline-diff.mjs [--before before-A0] [--after after-A] [--out <abs-prefix>]
// 退出码：0=意外为空（已登记例外不计）；1=存在未登记意外项。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'); // apps/web
const BASE = path.join(ROOT, 'e2e', 'baseline');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const BEFORE_DIR = opt('before', 'before-A0');
const AFTER_DIR = opt('after', 'after-A');
const OUT_PREFIX = opt('out', path.join(ROOT, 'e2e', 'audit', 'baseline-diff-A5'));

/* 已登记例外（"page|key" → 理由）：良性/预期但机械分类器覆盖不了的逐元素差异。
 * 空集起步——A5 迭代按调查结论填充；gate = U:意外 为 0（R:registered 不计意外）。 */
const OVERRIDES = {
  // 示例：'login|dom:div[0]/div[1]': 'xxx——登记理由',
};

const SIDES = ['t', 'r', 'b', 'l'];
const FORM_TAGS = new Set(['input', 'textarea', 'select', 'button']);
const MEDIA_TAGS = new Set(['img', 'svg']);
const PAD_RESET_TAGS = new Set(['ul', 'ol', 'fieldset']);
// preflight 全局 border-color 桥接期望值：#333（:root 默认）与 #e5e7eb（.light 恒浅岛 = login 页）
const BRIDGE_DARK = 'rgb(51, 51, 51)';
const BRIDGE_LIGHT = 'rgb(229, 231, 235)';
const CASCADE_MAX = 40; // 级联自动归因的位移上限（px），超过转人工

const px = (v) => parseFloat(v); // "24px"→24；"normal"→NaN
const isNumPx = (v) => typeof v === 'string' && /^-?[\d.]+px$/.test(v);

function loadBaseline(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(BASE, dir, 'meta.json'), 'utf8'));
  const pages = {};
  for (const f of fs.readdirSync(path.join(BASE, dir))) {
    if (!f.endsWith('.json') || f === 'meta.json') continue;
    const data = JSON.parse(fs.readFileSync(path.join(BASE, dir, f), 'utf8'));
    pages[data.page] = data;
  }
  return { dir, meta, pages };
}
const before = loadBaseline(BEFORE_DIR);
const after = loadBaseline(AFTER_DIR);

const bucketCount = {}; // 属性层：桶名 → 计数（桶名 "family.pair"）
const causeCount = {}; // 几何层：cause → 计数
const causeItems = {}; // 几何层：cause → 明细（审查可追溯——意外=0 的证明力靠预期项可查）
const cascadeHist = {}; // `${prop}${+/-}${delta}` → 计数
const lhPairs = {}; // line-height before→after → 计数
let lhChanged = 0, lhUnchanged = 0;
const propUnexpected = []; // 属性层意外
const propRegistered = []; // 属性层已登记
const geomUnexpected = []; // 几何层意外
const geomRegistered = []; // 几何层已登记
const bwVal = { styleFlipWidthZero: 0, emergentSides: [], formVanished: 0, other: [] };
const pairing = {};

const ovKey = (page, key) => `${page}|${key}`;
const bump = (m, k, n = 1) => { m[k] = (m[k] ?? 0) + n; };

for (const page of Object.keys(before.pages).sort()) {
  const bPage = before.pages[page];
  const aPage = after.pages[page];
  if (!aPage) { pairing[page] = { error: 'after 基线缺页' }; continue; }
  const bByKey = new Map(bPage.elements.map((e) => [e.key, e]));
  const aByKey = new Map(aPage.elements.map((e) => [e.key, e]));
  const removed = [...bByKey.keys()].filter((k) => !aByKey.has(k));
  const added = [...aByKey.keys()].filter((k) => !bByKey.has(k));
  pairing[page] = {
    before: bPage.elements.length, after: aPage.elements.length,
    paired: bPage.elements.length - removed.length,
    removed: removed.length, added: added.length, removedKeys: removed, addedKeys: added,
  };

  for (const [key, b] of bByKey) {
    const a = aByKey.get(key);
    if (!a) continue;
    const reg = OVERRIDES[ovKey(page, key)];

    /* ---------------- 属性层 ---------------- */
    if (b.boxSizing !== a.boxSizing) {
      bump(bucketCount, `boxSizing.${b.boxSizing}→${a.boxSizing}`);
      if (b.boxSizing !== 'content-box' || a.boxSizing !== 'border-box') {
        propUnexpected.push({ page, key, tag: a.tag, prop: 'boxSizing', before: b.boxSizing, after: a.boxSizing });
      }
    }
    for (const s of SIDES) {
      const bs = b.borderStyle?.[s], as = a.borderStyle?.[s];
      const bw = b.borderWidth?.[s], aw = a.borderWidth?.[s];
      const bc = b.borderColor?.[s], ac = a.borderColor?.[s];
      if (bs !== as) {
        bump(bucketCount, `borderStyle.${bs}→${as}`);
        const styleOk = ['none→solid', 'outset→solid', 'inset→solid'].includes(`${bs}→${as}`);
        if (!styleOk && !reg) propUnexpected.push({ page, key, tag: a.tag, prop: `border-${s}-style`, before: bs, after: as });
        // A4 验证：style 翻转而宽度 0→0 = 补偿类删除的"零宽度零几何"证明
        if (bw === '0px' && aw === '0px') bwVal.styleFlipWidthZero++;
      }
      if (bw !== aw) {
        bump(bucketCount, `borderWidth.${bw}→${aw}`);
        const bwn = px(bw), awn = px(aw);
        if (bwn === 0 && awn > 0) bwVal.emergentSides.push({ page, key, tag: a.tag, side: s, after: aw });
        else if (bwn > 0 && awn === 0 && FORM_TAGS.has(a.tag)) bwVal.formVanished++;
        else if (reg) propRegistered.push({ page, key, tag: a.tag, prop: `border-${s}-width`, before: bw, after: aw, rationale: reg });
        else {
          bwVal.other.push({ page, key, tag: a.tag, side: s, before: bw, after: aw });
          propUnexpected.push({ page, key, tag: a.tag, prop: `border-${s}-width`, before: bw, after: aw });
        }
      }
      if (bc !== ac) {
        bump(bucketCount, `borderColor.→${ac}`);
        if (ac !== BRIDGE_DARK && ac !== BRIDGE_LIGHT) {
          const item = { page, key, tag: a.tag, prop: `border-${s}-color`, before: bc, after: ac };
          if (reg) propRegistered.push({ ...item, rationale: reg });
          else propUnexpected.push(item);
        }
      }
    }
    if (b.lineHeight !== a.lineHeight) {
      bump(bucketCount, `lineHeight.${b.lineHeight}→${a.lineHeight}`);
      bump(lhPairs, `${b.lineHeight}→${a.lineHeight}`);
      lhChanged++;
      // normal→数值是全局预期；数值→数值仅 UA 按钮字号×unitless 行高传播（13.3333px 只可能源自 UA 按钮字体）
      const lhOk = b.lineHeight === 'normal' || b.lineHeight === '13.3333px';
      if (!lhOk && !reg) {
        propUnexpected.push({ page, key, tag: a.tag, prop: 'lineHeight', before: b.lineHeight, after: a.lineHeight });
      }
    } else lhUnchanged++;
    if (b.fontSize !== a.fontSize) {
      bump(bucketCount, `fontSize.${b.fontSize}→${a.fontSize}`);
      // 预期：表单控件自身（font-size:100%→inherit）+ 按钮后代继承传播（13.3333px = UA 按钮字号标记）
      if (!FORM_TAGS.has(a.tag) && b.fontSize !== '13.3333px' && !reg) {
        propUnexpected.push({ page, key, tag: a.tag, prop: 'fontSize', before: b.fontSize, after: a.fontSize });
      }
    }
    if (b.color != null && a.color != null && b.color !== a.color) {
      // 仅表单控件有采集；preflight color:inherit —— 预期=表单重置族，聚合不逐条
      bump(bucketCount, `color.${b.color}→${a.color}`);
    }

    /* ---------------- 几何层 ---------------- */
    // 尺寸驱动（driver）：padding / border-width / font-size / line-height。
    // boxSizing 翻转单独看：pad+border 全 0 时翻转不改布局，不破坏"自身静态"判定。
    const padStatic = SIDES.every((s) => b.padding[s] === a.padding[s]);
    const bwStatic = SIDES.every((s) => b.borderWidth[s] === a.borderWidth[s]);
    const fsStatic = b.fontSize === a.fontSize;
    const lhFlipped = b.lineHeight !== a.lineHeight;
    const boxFlip = b.boxSizing === 'content-box' && a.boxSizing === 'border-box';
    const padBordAfter = {
      w: px(a.padding.l) + px(a.padding.r) + px(a.borderWidth.l) + px(a.borderWidth.r),
      h: px(a.padding.t) + px(a.padding.b) + px(a.borderWidth.t) + px(a.borderWidth.b),
    };
    // UA 按钮字号标记：13.3333px 只可能源自 UA button 字体（作者规则不会设此值）——
    // 命中即按钮后代，其 font/line-height/位置变化全部归表单重置传播。
    const uaButtonFont = b.fontSize === '13.3333px';
    // 涌现边框（0→N）按轴求和：auto 尺寸元素总 w/h 增长 ≈ 新边框之和
    const newBorderSum = {
      w: (b.borderWidth.l === '0px' && px(a.borderWidth.l) > 0 ? px(a.borderWidth.l) : 0) +
         (b.borderWidth.r === '0px' && px(a.borderWidth.r) > 0 ? px(a.borderWidth.r) : 0),
      h: (b.borderWidth.t === '0px' && px(a.borderWidth.t) > 0 ? px(a.borderWidth.t) : 0) +
         (b.borderWidth.b === '0px' && px(a.borderWidth.b) > 0 ? px(a.borderWidth.b) : 0),
    };
    // dom: 键可寻父（tid: 键无祖先链）：块级填充子元素宽度跟随父容器内容宽
    const parentKey = key.startsWith('dom:') ? key.slice(0, key.lastIndexOf('/')) : null;
    const bParent = parentKey ? bByKey.get(parentKey) : null;
    const aParent = parentKey ? aByKey.get(parentKey) : null;
    const parentDeltaW = bParent && aParent ? aParent.rect.w - bParent.rect.w : null;

    const classifyRect = (prop, delta) => {
      if (MEDIA_TAGS.has(a.tag)) return 'P:media-block';
      if (FORM_TAGS.has(a.tag) || uaButtonFont) return 'P:form-reset';
      if (prop === 'w' || prop === 'h') {
        // box-sizing 翻转收窄：固定/受限宽 + padding/border>0 → 总宽缩（register form −64 实例族；auto 尺寸不受影响）
        if (boxFlip && padBordAfter[prop] > 0 && delta < 0) return 'P:box-sizing-flip';
        // 涌现边框占位：auto 尺寸元素（药丸/卡片）总宽 += 新边框和
        if (newBorderSum[prop] > 0 && Math.abs(delta - newBorderSum[prop]) <= 1) return 'P:emergent-border';
        if (prop === 'h' && lhFlipped && delta > 0) return 'P:line-height';
        // 块级子元素跟随父容器宽度（h1/p 随 form 内容宽 −66 等）
        if (prop === 'w' && parentDeltaW != null && Math.abs(delta - parentDeltaW) <= 2) {
          bump(cascadeHist, `${prop}${delta > 0 ? '+' : ''}${delta}`);
          return 'C:cascade';
        }
      }
      // 位移/尺寸传导：padding+font 静态即可（border 涌现/行高翻转不改变"位移是传导"的性质）
      if (padStatic && fsStatic) {
        if (Math.abs(delta) <= CASCADE_MAX) {
          bump(cascadeHist, `${prop}${delta > 0 ? '+' : ''}${delta}`);
          return 'C:cascade';
        }
        return null;
      }
      return null;
    };

    for (const prop of ['w', 'h', 'x', 'y']) {
      const bv = b.rect[prop], av = a.rect[prop];
      if (bv === av) continue;
      const delta = av - bv;
      const cause = classifyRect(prop, delta);
      if (cause) { bump(causeCount, cause); (causeItems[cause] ??= []).push({ page, key, tag: a.tag, prop, before: bv, after: av, delta }); }
      else if (reg) geomRegistered.push({ page, key, tag: a.tag, prop, before: bv, after: av, delta, rationale: reg });
      else geomUnexpected.push({ page, key, tag: a.tag, prop, before: bv, after: av, delta });
    }
    for (const s of SIDES) {
      if (b.padding[s] !== a.padding[s]) {
        const cause = FORM_TAGS.has(a.tag) || PAD_RESET_TAGS.has(a.tag) ? 'P:form-reset' : null;
        const item = { page, key, tag: a.tag, prop: `padding-${s}`, before: b.padding[s], after: a.padding[s], delta: px(a.padding[s]) - px(b.padding[s]) };
        if (cause) { bump(causeCount, cause); causeItems[cause].push(item); }
        else if (reg) geomRegistered.push({ ...item, rationale: reg });
        else geomUnexpected.push(item);
      }
      if (b.borderWidth[s] !== a.borderWidth[s]) {
        const cause = px(b.borderWidth[s]) === 0 && px(a.borderWidth[s]) > 0 ? 'P:emergent-border' : FORM_TAGS.has(a.tag) ? 'P:form-reset' : null;
        const item = { page, key, tag: a.tag, prop: `borderWidth-${s}`, before: b.borderWidth[s], after: a.borderWidth[s], delta: px(a.borderWidth[s]) - px(b.borderWidth[s]) };
        if (cause) { bump(causeCount, cause); causeItems[cause].push(item); }
        else if (reg) geomRegistered.push({ ...item, rationale: reg });
        else geomUnexpected.push(item);
      }
    }
    if (b.fontSize !== a.fontSize) {
      const item = { page, key, tag: a.tag, prop: 'fontSize', before: b.fontSize, after: a.fontSize, delta: px(a.fontSize) - px(b.fontSize) };
      if (FORM_TAGS.has(a.tag) || b.fontSize === '13.3333px') { bump(causeCount, 'P:form-reset'); (causeItems['P:form-reset'] ??= []).push(item); }
      else if (reg) geomRegistered.push({ ...item, rationale: reg });
      else geomUnexpected.push(item);
    }
  }
}

const emergentSites = [...new Map(bwVal.emergentSides.map((e) => [`${e.page}|${e.key}`, e])).values()];
const gate = propUnexpected.length + geomUnexpected.length;

const report = {
  meta: {
    before: { dir: BEFORE_DIR, commit: before.meta.commit, collectedAt: before.meta.collectedAt },
    after: { dir: AFTER_DIR, commit: after.meta.commit, collectedAt: after.meta.collectedAt },
    generatedAt: new Date().toISOString(),
    classifier: { cascadeMax: CASCADE_MAX, bridgeExpected: [BRIDGE_DARK, BRIDGE_LIGHT], overrides: Object.keys(OVERRIDES).length },
  },
  gate: { unexpectedTotal: gate, propertyUnexpected: propUnexpected.length, geometryUnexpected: geomUnexpected.length, passed: gate === 0 },
  pairing,
  propertyLayer: { buckets: Object.fromEntries(Object.entries(bucketCount).sort((a, b) => b[1] - a[1])), unexpected: propUnexpected, registered: propRegistered },
  geometryLayer: { summary: Object.fromEntries(Object.entries(causeCount).sort((a, b) => b[1] - a[1])), items: causeItems, cascadeHistogram: cascadeHist, unexpected: geomUnexpected, registered: geomRegistered },
  lineHeightLayer: { changed: lhChanged, unchanged: lhUnchanged, pairs: Object.fromEntries(Object.entries(lhPairs).sort((a, b) => b[1] - a[1])) },
  borderWidthValidation: {
    styleFlipWidthZero: bwVal.styleFlipWidthZero,
    emergentWidthSides: bwVal.emergentSides.length,
    emergentWidthSites: emergentSites,
    formVanished: bwVal.formVanished,
    other: bwVal.other,
  },
  notCaptured: [
    'a 链接 text-decoration 移除（19 Link 站点）——冻结属性集未采集；§2.4 目检覆盖',
    '裸 button background-color buttonface→transparent——属性集仅含 color(表单)；A1_RED 组1 四项归零门禁覆盖',
    '::placeholder gray-400 / textarea resize:vertical——伪元素/交互属性不入快照；§2.4 目检覆盖',
    'disabled cursor not-allowed——交互态不入快照（informational）',
    'divide 线涌现（TeamBillingPage:140，唯一站点）——团队账单页不在 8 门禁页；emergence-adjudication-A4.json 已登记',
    'img/video max-width:100%（19 处裸媒体全带 h-full，低风险）——§2.4 目检抽查覆盖',
    'img/svg display:block + vertical-align:middle——display 不在冻结属性集；几何层 rect 归因 + §2.4 目检覆盖',
  ],
};

fs.writeFileSync(`${OUT_PREFIX}.json`, JSON.stringify(report, null, 1));
fs.writeFileSync(
  path.join(ROOT, 'e2e', 'audit', 'audit-A5-borderwidth.json'),
  JSON.stringify({
    meta: {
      task: 'A5 回补：A4 删除类 border-width 验证（plan A4-2——border-box 下加边框不改 rect，几何层必漏，属性层 width 才是判据）',
      before: before.meta.commit, after: after.meta.commit, diffSource: 'e2e/audit/baseline-diff-A5.json',
    },
    ...report.borderWidthValidation,
    conclusion: report.borderWidthValidation.other.length === 0
      ? `A4 删除零副作用实证：style 翻转而宽度恒 0 共 ${bwVal.styleFlipWidthZero} 边（border-none/box-border 等补偿删除 no-op）；涌现宽度 0→N ${bwVal.emergentSides.length} 边/${emergentSites.length} 站点（对应 emergence-adjudication-A4 登记 33 非零代码位点）；表单 UA 边框抵消 N→0 ${bwVal.formVanished} 边（裸 button 归零族）；无非预期宽度变化`
      : '存在非预期 border-width 变化——见 other 列表',
  }, null, 2),
);

/* ---- MD ---- */
const causeDesc = {
  'P:box-sizing-flip': 'box-sizing content-box→border-box：width+padding/border 组合总宽收窄（register form −64 / 手写 CSS 26px·2px 实例族）',
  'P:form-reset': '表单控件 UA padding/border/font 抵消（裸 button 四属性归零族；ul/ol/fieldset reset 同列；含按钮后代 span/svg 传播——13.3333px UA 字号标记）',
  'P:emergent-border': '涌现边框占位（border 宽度类 0→N 真实渲染；auto 尺寸总 w/h += 边框和；A4-c 登记 33 非零站点）',
  'P:media-block': 'img/svg display:block + vertical-align:middle（行内空隙移除/占位变化）',
  'P:line-height': '自身 line-height normal→数值（1.5×font-size）高度增长',
  'C:cascade': '自身驱动静态的传导位移/尺寸（全局行高、表单重置、margin 归零在上游发生；块级子元素跟随父容器宽；量级直方图）',
  'R:registered': '人工登记例外（附理由，§7）',
  'U:意外': '未归类——门禁对象',
};
const bucketMeta = {
  'boxSizing.content-box→border-box': 'P:preflight 全局翻转',
  'borderStyle.none→solid': 'P:preflight *{border-style:solid}（宽度恒 0 → 零几何，A4 删除验证）',
  'borderStyle.outset→solid': 'P:表单控件 UA 斜面→扁平（A4-c 涌现裁定）',
  'borderStyle.inset→solid': 'P:表单控件 UA 斜面→扁平（裸 select 1 处等）',
  'borderWidth.0px→1px': 'P:涌现宽度真实渲染（A4-c 登记 33 非零站点在门禁页的子集，24 站点）',
  'borderWidth.2px→0px': 'P:裸 button UA outset 边框归零（四属性归零族）',
  'lineHeight.*': 'P:html{line-height:1.5}（normal→数值=1.5×font / inherit；text-* 类自带行高免疫）',
  'fontSize.*': 'P:表单控件 font-size:100%→inherit + UA 按钮字号(13.3333px)后代继承传播',
  'color.*': 'P:表单控件 color:inherit（buttontext/canvastext→继承色）',
  [`borderColor.→${BRIDGE_DARK}`]: 'P:preflight *{border-color:var(--fw-border)}——currentColor 解析值→#333 桥接（D2）',
  [`borderColor.→${BRIDGE_LIGHT}`]: 'P:.light 恒浅岛覆盖（login 页 →#e5e7eb）',
};
// 配对说明：键不稳定站点（结构性同位、键含运行时 ID）
const PAIRING_NOTES = [
  'video-editor 3 个未配对键 = 运行时生成 testid（rf__node-node_<时间戳> / video-edit-node-<时间戳> / track-row-<uuid>）——同位同量元素（React Flow 节点包装+编辑节点+轨道行），键不稳定非结构变化；before/after 元素数相同（252/252）',
  '其余 7 页配对率 100%（元素数逐页相等）',
];
const md = [];
md.push('# A5 三层基线 diff 报告（before-A0 × after-A）', '');
md.push(`- before：\`${BEFORE_DIR}\` @ ${before.meta.commit}（采集 ${before.meta.collectedAt}）`);
md.push(`- after：\`${AFTER_DIR}\` @ ${after.meta.commit}（采集 ${after.meta.collectedAt}）`);
md.push(`- 门禁：**${gate === 0 ? 'PASS（意外=0）' : `FAIL（未登记意外 ${gate} 条）`}**（属性层 ${propUnexpected.length} + 几何层 ${geomUnexpected.length}；R:registered 已登记例外另计）`, '');
md.push('## 1. 配对统计（稳定键 tid:@n / dom: 路径）', '', '| page | before | after | paired | removed | added |', '|---|---|---|---|---|---|');
for (const [p, s] of Object.entries(pairing)) md.push(`| ${p} | ${s.before ?? '-'} | ${s.after ?? '-'} | ${s.paired ?? '-'} | ${s.removed ?? '-'} | ${s.added ?? '-'} |`);
for (const n of PAIRING_NOTES) md.push(`- ${n}`);
md.push('', '## 2. 属性层（聚合分桶）', '', '| 桶 | 计数 | 预期类别 |', '|---|---|---|');
for (const [k, v] of Object.entries(bucketCount).sort((a, b) => b[1] - a[1])) {
  const fam = `${k.split('.')[0]}.*`;
  md.push(`| ${k} | ${v} | ${bucketMeta[k] ?? bucketMeta[fam] ?? '—'} |`);
}
md.push('', '## 3. 几何层归因汇总（w/h/x/y/padding/border-width/font-size 逐条）', '', '| 归因 | 条数 | 说明 |', '|---|---|---|');
for (const [c, n] of Object.entries(causeCount).sort((a, b) => b[1] - a[1])) md.push(`| ${c} | ${n} | ${causeDesc[c] ?? ''} |`);
md.push('', `级联位移量级直方图（|Δ|≤${CASCADE_MAX}px 自动归级联）：\`${JSON.stringify(cascadeHist)}\``, '');
md.push('## 4. line-height 二分统计（对照 A0 冻结值）', '', `- changed ${lhChanged} / unchanged ${lhUnchanged}`, '- 值对分布（全量）：');
for (const [p, n] of Object.entries(lhPairs).sort((a, b) => b[1] - a[1])) md.push(`  - \`${p}\` ×${n}`);
md.push('', '## 5. A4 border-width 验证（回补；audit-A5-borderwidth.json 同步落盘）', '',
  `- style 翻转 + 宽度 0→0（A4 删除 no-op 实证）：${bwVal.styleFlipWidthZero} 边`,
  `- 涌现宽度 0→N：${bwVal.emergentSides.length} 边 / ${emergentSites.length} 站点`,
  `- 表单 UA 边框抵消 N→0：${bwVal.formVanished} 边`,
  `- 非预期宽度变化：${bwVal.other.length} 条`, '');
md.push('## 6. 意外项（gate 对象——必须为空或全部转登记）', '');
if (gate === 0) md.push('（空）');
else {
  md.push('### 属性层');
  for (const u of propUnexpected.slice(0, 80)) md.push(`- [${u.page}] ${u.key} <${u.tag}> ${u.prop}: ${u.before} → ${u.after}`);
  md.push('### 几何层');
  for (const u of geomUnexpected.slice(0, 160)) md.push(`- [${u.page}] ${u.key} <${u.tag}> ${u.prop}: ${u.before} → ${u.after} (Δ${u.delta > 0 ? '+' : ''}${u.delta})`);
}
md.push('', '## 7. 已登记例外（R:registered）', '');
if (Object.keys(OVERRIDES).length === 0 && propRegistered.length === 0 && geomRegistered.length === 0) md.push('（无）');
for (const r of propRegistered) md.push(`- [${r.page}] ${r.key} <${r.tag}> ${r.prop}: ${r.before}→${r.after}——${r.rationale}`);
for (const r of geomRegistered) md.push(`- [${r.page}] ${r.key} <${r.tag}> ${r.prop}: ${r.before}→${r.after}——${r.rationale}`);
md.push('', '## 8. 未采集属性（冻结属性集外，覆盖方式登记）', '');
for (const n of report.notCaptured) md.push(`- ${n}`);
md.push('');
fs.writeFileSync(`${OUT_PREFIX}.md`, md.join('\n') + '\n');

console.log(`[diff] 配对：${Object.values(pairing).map((s) => `${s.paired ?? '?'}/${s.before ?? '?'}`).join(' ')}`);
console.log(`[diff] 几何归因：${JSON.stringify(causeCount)}`);
console.log(`[diff] line-height changed/unchanged = ${lhChanged}/${lhUnchanged}`);
console.log(`[diff] A4 验证：style翻转变宽0=${bwVal.styleFlipWidthZero}，涌现=${bwVal.emergentSides.length}边/${emergentSites.length}站，表单抵消=${bwVal.formVanished}，other=${bwVal.other.length}`);
console.log(`[diff] 意外：属性 ${propUnexpected.length} + 几何 ${geomUnexpected.length} = ${gate} → ${gate === 0 ? 'PASS' : 'FAIL'}`);
process.exit(gate === 0 ? 0 : 1);
