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
// 三闸门禁（任一不过 exit 1）：
//   1) 意外项闸：属性/几何层未登记意外必须为 0（OVERRIDES 已登记例外不计）。
//   2) 涌现登记闸：涌现边框站点（border-width 0→N）按页归属核验——站点所在页必须在
//      PAGE_REGISTRY_FILES 里有可归属的登记源文件（emergence-adjudication-A4.json bare 非零位点文件
//      ∪ audit-A0.json route1.borderColorExplicit colored-144 文件 ∪ EXTRA_AUTHORIZED_FILES 补登）。
//      快照无源文件信息，DOM 站点只能按页归属；映射表人工梳理，表内文件脱离登记集即失败（漂移防护）。
//   3) 配对闸：未配对键（removed/added）必须全部命中运行时 ID 白名单 RUNTIME_ID_KEY
//      （video-editor 运行时生成 testid：rf__node-node_<ms>_<n> / video-edit-node-node_<ms>_<n> /
//      track-row-track-<uuid>），且逐页 removed 数 = added 数（同位同量）；dom: 键未配对一律失败。
// 人工目检表：e2e/audit/baseline-diff-A5.eyeball.md 为一次性提交文件，本脚本永不写入/覆写；
//   机械报告（可重跑覆盖）尾部 §9 仅留指向该文件的指针。
// 退出码：0=三闸全过；1=任一闸失败（offender 逐条列出）。
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

/* 涌现登记闸配置（脚本头注释 2)）：
 * authorizedFiles = emergence-adjudication-A4.json bare 非零位点文件 ∪ audit-A0.json route① colored-144 文件
 *                 ∪ EXTRA_AUTHORIZED_FILES（扫描器未捕获 token 形的补登，附理由）。
 * PAGE_REGISTRY_FILES：门禁页 → 其上渲染的登记组件源文件（人工梳理，快照无源文件信息只能按页归属）。
 * 新增涌现组件流程：先入 A4-c 裁定登记（或 EXTRA 补登）→ 再入对应页数组——两处缺一闸门即失败。 */
const EXTRA_AUTHORIZED_FILES = [
  // route① 色显式清单只捕 border-[#hex] 形，border-[rgba(…)] 形未入 144 清单：login 邮箱/微信分隔线同串显式作者色，A4-c 同族保留
  { file: 'src/components/auth/PhoneLoginForm.tsx', why: 'border-r border-[rgba(13,13,13,0.2)]（:92）显式作者色；colored-144 扫描未含 rgba 形 token' },
];
const PAGE_REGISTRY_FILES = {
  'admin-models': [], // AdminLayout 自有侧栏，无登记组件——此页出现涌现站点即违例（闸门强制登记）
  canvas: ['src/pages/canvas/components/CanvasTopBar.tsx', 'src/pages/canvas/components/ProjectTitle.tsx'],
  login: ['src/components/AuthModal.tsx', 'src/components/auth/WeChatQRLogin.tsx', 'src/components/auth/PhoneLoginForm.tsx'],
  'material-modal': ['src/pages/canvas/components/CanvasTopBar.tsx', 'src/pages/canvas/components/ProjectTitle.tsx'],
  register: ['src/pages/register/page.tsx'],
  'video-editor': ['src/pages/canvas/components/CanvasTopBar.tsx', 'src/pages/canvas/components/ProjectTitle.tsx'],
  videos: ['src/components/layout/TopActionBar.tsx', 'src/components/layout/Sidebar.tsx', 'src/pages/videos/VideoCard.tsx'],
  works: ['src/components/layout/TopActionBar.tsx', 'src/components/layout/Sidebar.tsx'],
};
/* 配对闸白名单（脚本头注释 3)）：video-editor 运行时生成 testid——键不稳定非结构变化（同位同量）。
 * 键形（剥 tid: 前缀与 @<n> 序号后缀）：rf__node-node_<ms>_<n> / video-edit-node-node_<ms>_<n> / track-row-track-<uuid> */
const RUNTIME_ID_KEY = /^(?:(?:rf__node-node|video-edit-node-node)_\d+_\d+|track-row-track-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

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

/* B2 预期类别（b2-migration-registry.json 消费）：B2a 机械颜色迁移的值变化配对闸——
 * color（仅表单控件采集）/borderColor（全元素采集）的 (before,after) 命中注册表 → 吸收（预期）；
 * 未登记的新 color 配对 → 意外（闸）；borderColor 未登记配对维持原三路（桥值/OVERRIDES/意外）。
 * backgroundColor 不在 A0 冻结属性集（不可复采）——B2 值变化经 b1 探针 computed 零回退 + B6 目检覆盖。
 * A1_COLOR_PAIRS = B2 前既存配对（A 段表单重置 color:inherit / antd 暗色 token），非 B2 产物不闸。 */
const B2_REGISTRY_PATH = path.join(ROOT, 'e2e', 'audit', 'b2-migration-registry.json');
const B2_REGISTRY = JSON.parse(fs.readFileSync(B2_REGISTRY_PATH, 'utf8'));
const normColorVal = (s) => String(s).replace(/\s+/g, '').toLowerCase();
const b2Pairs = new Set(B2_REGISTRY.differExpectedPairs.pairs.map((p) => `${p.prop}|${normColorVal(p.before)}|${normColorVal(p.after)}`));
const A1_COLOR_PAIRS = new Set([
  'color|rgb(0,0,0)|rgba(0,0,0,0.88)', // antd 暗色 colorText 按钮（A 段既有，29 处族）
  'color|rgb(16,16,16)|rgba(255,255,255,0.35)', // UA buttontext → white/35（A 段表单重置族）
]);
const b2Absorbed = {}; // `${prop} ${before}→${after}` → 计数

const bucketCount = {}; // 属性层：桶名 → 计数（桶名 "family.pair"）
const causeCount = {}; // 几何层：cause → 计数
const causeItems = {}; // 几何层：cause → 明细（审查可追溯——意外=0 的证明力靠预期项可查）
const cascadeHist = {}; // `${prop}${+/-}${delta}` → 计数
const lhPairs = {}; // line-height before→after → 计数
let lhChanged = 0, lhUnchanged = 0;
let lhFormInherit = 0, lhHtml15 = 0, lhAntdFactor = 0; // line-height 拆桶：form-inherit / html-1.5（含承接 antd 祖先因子子计）
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
        const b2Key = `borderColor|${normColorVal(bc)}|${normColorVal(ac)}`;
        if (b2Pairs.has(b2Key)) {
          bump(b2Absorbed, `borderColor ${bc}→${ac}`);
        } else {
          bump(bucketCount, `borderColor.→${ac}`);
          if (ac !== BRIDGE_DARK && ac !== BRIDGE_LIGHT) {
            const item = { page, key, tag: a.tag, prop: `border-${s}-color`, before: bc, after: ac };
            if (reg) propRegistered.push({ ...item, rationale: reg });
            else propUnexpected.push(item);
          }
        }
      }
    }
    if (b.lineHeight !== a.lineHeight) {
      bump(bucketCount, `lineHeight.${b.lineHeight}→${a.lineHeight}`);
      bump(lhPairs, `${b.lineHeight}→${a.lineHeight}`);
      lhChanged++;
      // 拆桶（A5 审查订正，两机制不混述）：
      //   lh-form-inherit：normal→22px = 表单重置 line-height:inherit 承接 antd body 既有 22px
      //     （before 快照 body 已是 22px；22 ≠ 1.5×任何表单字号，不可能源自 html 1.5）。
      //   lh-html-1.5：其余 = html{line-height:1.5} 根传播 normal→1.5×自身字号；其中承接
      //     antd 祖先既有 unitless 因子（1.5714×字号，如 20.4286px=1.5714×13）者另计 lhAntdFactor。
      if (b.lineHeight === 'normal' && a.lineHeight === '22px') lhFormInherit++;
      else {
        lhHtml15++;
        if (Math.abs(px(a.lineHeight) - 1.5 * px(a.fontSize)) > 0.01) lhAntdFactor++;
      }
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
      // 仅表单控件有采集；三类：B2 注册配对（吸收）/ A 段表单重置-antd 既有配对（聚合不逐条）/ 其余=意外（B2 起闸）
      const b2Key = `color|${normColorVal(b.color)}|${normColorVal(a.color)}`;
      if (b2Pairs.has(b2Key)) {
        bump(b2Absorbed, `color ${b.color}→${a.color}`);
      } else {
        bump(bucketCount, `color.${b.color}→${a.color}`);
        if (!A1_COLOR_PAIRS.has(b2Key)) {
          propUnexpected.push({ page, key, tag: a.tag, prop: 'color', before: b.color, after: a.color });
        }
      }
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

/* ---- 涌现登记闸：emergent 站点必须可归属到裁定登记组件（fail-loud，offender 逐条列出） ---- */
const adjudication = JSON.parse(fs.readFileSync(path.join(ROOT, 'e2e', 'audit', 'emergence-adjudication-A4.json'), 'utf8'));
const auditA0 = JSON.parse(fs.readFileSync(path.join(ROOT, 'e2e', 'audit', 'audit-A0.json'), 'utf8'));
const authorizedFiles = new Set([
  ...adjudication.bareBorder.nonzeroCodeSites.map((s) => s.file),
  ...auditA0.route1.borderColorExplicit.items.map((i) => i.file),
  ...EXTRA_AUTHORIZED_FILES.map((f) => f.file),
]);
const registryDrift = [];
for (const [page, files] of Object.entries(PAGE_REGISTRY_FILES)) {
  for (const f of files) if (!authorizedFiles.has(f)) registryDrift.push(`${page} → ${f} 不在裁定登记集（bare 非零/colored-144/补登）`);
}
const emergenceOffenders = [];
for (const site of emergentSites) {
  const files = PAGE_REGISTRY_FILES[site.page];
  if (!files?.length || !files.some((f) => authorizedFiles.has(f))) {
    emergenceOffenders.push(`${site.page}|${site.key} <${site.tag}> ${site.side} ${site.after}（页无登记组件可归属——先登记再入 PAGE_REGISTRY_FILES）`);
  }
}

/* ---- 配对闸：未配对键必须全部命中运行时 ID 白名单且逐页同位同量 ---- */
const pairingOffenders = [];
for (const [page, s] of Object.entries(pairing)) {
  if (s.error) { pairingOffenders.push(`${page}: ${s.error}`); continue; }
  if (s.removed !== s.added) pairingOffenders.push(`${page}: removed ${s.removed} ≠ added ${s.added}（同位同量破坏）`);
  for (const k of [...s.removedKeys, ...s.addedKeys]) {
    const bare = k.replace(/^tid:/, '').replace(/@\d+$/, '');
    if (!k.startsWith('tid:') || !RUNTIME_ID_KEY.test(bare)) pairingOffenders.push(`${page}: ${k}（未命中运行时 ID 白名单）`);
  }
}
const hardGate = emergenceOffenders.length + registryDrift.length + pairingOffenders.length;

const report = {
  meta: {
    before: { dir: BEFORE_DIR, commit: before.meta.commit, collectedAt: before.meta.collectedAt },
    after: { dir: AFTER_DIR, commit: after.meta.commit, collectedAt: after.meta.collectedAt },
    generatedAt: new Date().toISOString(),
    classifier: { cascadeMax: CASCADE_MAX, bridgeExpected: [BRIDGE_DARK, BRIDGE_LIGHT], overrides: Object.keys(OVERRIDES).length, b2Registry: 'e2e/audit/b2-migration-registry.json（differExpectedPairs 配对闸：color/borderColor 命中即吸收，未登记 color 配对即意外）' },
  },
  gate: {
    unexpectedTotal: gate, propertyUnexpected: propUnexpected.length, geometryUnexpected: geomUnexpected.length,
    emergenceOffenders: emergenceOffenders.length, registryDrift: registryDrift.length, pairingOffenders: pairingOffenders.length,
    passed: gate === 0 && hardGate === 0,
  },
  emergenceGate: {
    authorizedFiles: authorizedFiles.size,
    registrySources: { bareNonzeroSites: adjudication.bareBorder.nonzeroCodeSites.length, colored144: auditA0.route1.borderColorExplicit.items.length, extra: EXTRA_AUTHORIZED_FILES },
    registryDrift, offenders: emergenceOffenders,
  },
  pairingGate: { runtimeIdPattern: RUNTIME_ID_KEY.source, offenders: pairingOffenders },
  b2ExpectedGate: {
    registry: 'e2e/audit/b2-migration-registry.json',
    pairsRegistered: b2Pairs.size,
    absorbedTotal: Object.values(b2Absorbed).reduce((x, y) => x + y, 0),
    absorbedByPair: Object.fromEntries(Object.entries(b2Absorbed).sort((a, b) => b[1] - a[1])),
  },
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
      ? `A4 删除零副作用实证：style 翻转而宽度恒 0 共 ${bwVal.styleFlipWidthZero} 边（border-none/box-border 等补偿删除 no-op）；涌现宽度 0→N ${bwVal.emergentSides.length} 边/${emergentSites.length} 站点（涌现站点属 A4-c colored-144 批量保留族——同串显式作者色，非 33 bare 位点子集；门禁页渲染子集，登记闸按页核验）；表单 UA 边框抵消 N→0 ${bwVal.formVanished} 边（裸 button 归零族）；无非预期宽度变化`
      : '存在非预期 border-width 变化——见 other 列表',
  }, null, 2),
);

/* ---- MD ---- */
const causeDesc = {
  'P:box-sizing-flip': 'box-sizing content-box→border-box：width+padding/border 组合总宽收窄（register form −64 / 手写 CSS 26px·2px 实例族）',
  'P:form-reset': '表单控件 UA padding/border/font 抵消（裸 button 四属性归零族；ul/ol/fieldset reset 同列；含按钮后代 span/svg 传播——13.3333px UA 字号标记）',
  'P:emergent-border': '涌现边框占位（border 宽度类 0→N 真实渲染；auto 尺寸总 w/h += 边框和；A4-c colored-144 批量保留族门禁页子集）',
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
  'borderWidth.0px→1px': 'P:涌现宽度真实渲染（A4-c colored-144 批量保留族同串显式作者色——非 33 bare 位点子集；门禁页渲染子集 24 站点，登记闸按页核验）',
  'borderWidth.2px→0px': 'P:裸 button UA outset 边框归零（四属性归零族）',
  'lineHeight.normal→22px': 'P:lh-form-inherit（表单重置 line-height:inherit 承接 antd body 既有 22px——before 快照 body 已是 22px；22 ≠ 1.5×表单字号，不可能源自 html 1.5；全落 form/button 子树）',
  'lineHeight.*': 'P:lh-html-1.5（html{line-height:1.5} 根传播——normal→1.5×自身字号；html 1.5 在 16px 根=24px；部分表单/按钮后代承接 antd 祖先既有因子而非 1.5，§4 拆桶行细计）',
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
const gatePass = gate === 0 && hardGate === 0;
md.push(`- 门禁：**${gatePass ? 'PASS（三闸全过）' : 'FAIL'}**（意外项闸：属性 ${propUnexpected.length} + 几何 ${geomUnexpected.length}；涌现登记闸：offender ${emergenceOffenders.length} / 映射漂移 ${registryDrift.length}；配对闸：offender ${pairingOffenders.length}；R:registered 已登记例外另计）`, '');
md.push('## 1. 配对统计（稳定键 tid:@n / dom: 路径）', '', '| page | before | after | paired | removed | added |', '|---|---|---|---|---|---|');

for (const [p, s] of Object.entries(pairing)) md.push(`| ${p} | ${s.before ?? '-'} | ${s.after ?? '-'} | ${s.paired ?? '-'} | ${s.removed ?? '-'} | ${s.added ?? '-'} |`);
for (const n of PAIRING_NOTES) md.push(`- ${n}`);
md.push('', '## 2. 属性层（聚合分桶）', '', '| 桶 | 计数 | 预期类别 |', '|---|---|---|');
for (const [k, v] of Object.entries(bucketCount).sort((a, b) => b[1] - a[1])) {
  const fam = `${k.split('.')[0]}.*`;
  md.push(`| ${k} | ${v} | ${bucketMeta[k] ?? bucketMeta[fam] ?? '—'} |`);
}
md.push('', '### 2b. B2 预期类别（注册配对吸收，b2-migration-registry.json）', '');
{
  const total = Object.values(b2Absorbed).reduce((x, y) => x + y, 0);
  md.push(`- 注册配对 ${b2Pairs.size} 组；本 diff 吸收 **${total}** 条（命中即预期；未登记 color 配对即意外——见 §6）`);
  for (const [p, n] of Object.entries(b2Absorbed).sort((a, b) => b[1] - a[1])) md.push(`  - \`${p}\` ×${n}`);
  if (!total) md.push('  - （无——B2a 等值换不产生 diff 条目，值变化配对在采集页无表单控件命中时为 0）');
}
md.push('', '## 3. 几何层归因汇总（w/h/x/y/padding/border-width/font-size 逐条）', '', '| 归因 | 条数 | 说明 |', '|---|---|---|');
for (const [c, n] of Object.entries(causeCount).sort((a, b) => b[1] - a[1])) md.push(`| ${c} | ${n} | ${causeDesc[c] ?? ''} |`);
md.push('', `级联位移量级直方图（|Δ|≤${CASCADE_MAX}px 自动归级联）：\`${JSON.stringify(cascadeHist)}\``, '');
md.push('## 4. line-height 二分统计（对照 A0 冻结值）', '', `- changed ${lhChanged} / unchanged ${lhUnchanged}`,
  `- 拆桶：**lh-form-inherit**（normal→22px，表单重置 line-height:inherit 承接 antd body 既有 22px；全落 form/button 子树）×${lhFormInherit}`,
  ` - **lh-html-1.5**（其余：html{line-height:1.5} 根传播 normal→1.5×自身字号）×${lhHtml15}——其中 ${lhAntdFactor} 条承接 antd 祖先既有 unitless 因子（1.5714×字号，如 20.4286px=1.5714×13、18.8571px=1.5714×12），非 html 1.5 直算`,
  '- 值对分布（全量）：');
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
if (emergenceOffenders.length || registryDrift.length) {
  md.push('', '### 涌现登记闸 offender（先入 A4-c 裁定登记/EXTRA 补登，再入 PAGE_REGISTRY_FILES）');
  for (const o of [...registryDrift, ...emergenceOffenders]) md.push(`- ${o}`);
}
if (pairingOffenders.length) {
  md.push('', '### 配对闸 offender（未配对键须命中 RUNTIME_ID_KEY 运行时 ID 白名单且逐页同位同量）');
  for (const o of pairingOffenders) md.push(`- ${o}`);
}
md.push('', '## 7. 已登记例外（R:registered）', '');
if (Object.keys(OVERRIDES).length === 0 && propRegistered.length === 0 && geomRegistered.length === 0) md.push('（无）');
for (const r of propRegistered) md.push(`- [${r.page}] ${r.key} <${r.tag}> ${r.prop}: ${r.before}→${r.after}——${r.rationale}`);
for (const r of geomRegistered) md.push(`- [${r.page}] ${r.key} <${r.tag}> ${r.prop}: ${r.before}→${r.after}——${r.rationale}`);
md.push('', '## 8. 未采集属性（冻结属性集外，覆盖方式登记）', '');
for (const n of report.notCaptured) md.push(`- ${n}`);
md.push('', '## 9. §2.4 目检清单（人工）', '', '本文件为机械产物，重跑即覆盖；人工目检表独立维护于 `e2e/audit/baseline-diff-A5.eyeball.md`（一次性提交，本脚本永不写入/覆写）。', '');
fs.writeFileSync(`${OUT_PREFIX}.md`, md.join('\n') + '\n');

console.log(`[diff] 配对：${Object.values(pairing).map((s) => `${s.paired ?? '?'}/${s.before ?? '?'}`).join(' ')}`);
console.log(`[diff] 几何归因：${JSON.stringify(causeCount)}`);
console.log(`[diff] line-height changed/unchanged = ${lhChanged}/${lhUnchanged}（拆桶 form-inherit=${lhFormInherit} / html-1.5=${lhHtml15}，其中承接 antd 因子 ${lhAntdFactor}）`);
console.log(`[diff] A4 验证：style翻转变宽0=${bwVal.styleFlipWidthZero}，涌现=${bwVal.emergentSides.length}边/${emergentSites.length}站，表单抵消=${bwVal.formVanished}，other=${bwVal.other.length}`);
console.log(`[diff] B2 预期类别：注册配对 ${b2Pairs.size} 组，吸收 ${Object.values(b2Absorbed).reduce((x, y) => x + y, 0)} 条 ${JSON.stringify(b2Absorbed)}`);
console.log(`[gate] 意外项：属性 ${propUnexpected.length} + 几何 ${geomUnexpected.length} = ${gate}；涌现登记闸 offender=${emergenceOffenders.length}/漂移=${registryDrift.length}（authorized=${authorizedFiles.size}）；配对闸 offender=${pairingOffenders.length}`);
process.exit(gatePass ? 0 : 1);
