#!/usr/bin/env node
// C8 迁移 registry（spec §5）：脚本产出迁移文件全集与分区计数——手写数字不作验收依据。
// 分区：画布域 / ve 域 / videos 域 / 域外单件 / 手写 CSS 块 / 测试分区 / 排除集（渲染产物白名单逐文件）。
// differExpectedPairs：D1b/D3 有意变更逐条登记（消费 css-baseline-diff.mjs D 段配对闸）。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

const RENDER_WHITELIST = [
  'src/pages/canvas/video-editor/renderer/canvas-renderer.ts',
  'src/pages/canvas/video-editor/export/worker.ts',            // 第五轮路径订正：worker 在 export/ 非 renderer/
  'src/pages/canvas/engine/Angle3DEngine.ts',                  // engine 在 pages/canvas/engine/（非 video-engine 下）
  'src/pages/canvas/engine/LightingEngine.ts',
  'src/pages/canvas/components/Lighting/ThreePreview.tsx',     // 预览产物在 components/Lighting|Angle3D/ 子目录
  'src/pages/canvas/components/Angle3D/Angle3DPreview.tsx',
];

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\(|\b(?:text|bg|border|ring|divide|fill|stroke|from|via|to)-(?:white|black)(?:\/\d{1,3})?\b|--canvas-|--ve-|--vw-/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
// 测试判据双形态：文件名后缀 + __tests__/ 目录（videos 域一等测试目录——抄 css-audit.mjs:165 既有写法）
const isTest = (f) => /\.(test|spec)\.[jt]sx?$/.test(f) || f.split(path.sep).includes('__tests__');
const stripTests = (files) => files.filter((f) => !isTest(f));

const canvas = stripTests(walk(path.join(SRC, 'pages/canvas')))
  .filter((f) => !f.includes(`${path.sep}video-editor${path.sep}`) && !RENDER_WHITELIST.includes(rel(f)));
const ve = stripTests(walk(path.join(SRC, 'pages/canvas/video-editor'))).filter((f) => !RENDER_WHITELIST.includes(rel(f)));
const videos = stripTests(walk(path.join(SRC, 'pages/videos')));
const extras = ['src/components/layout/WeChatFollowModal.tsx'];
const componentDirs = [path.join(SRC, 'components/MaterialLibrary'), path.join(SRC, 'components/BaseFullscreenModal.tsx')];
const cssBlocks = ['src/index.css', 'src/pages/canvas/components/nodes/prompt-input/PromptInput.css', 'src/pages/canvas/components/nodes/NodeHandle.css'];
const tests = [...walk(path.join(SRC, 'pages/canvas')), ...walk(path.join(SRC, 'pages/videos'))].filter(isTest);

const withHits = (files) => files.filter((f) => COLOR_RE.test(fs.readFileSync(f, 'utf8')));

/* 非 lint 可见盲区四分区（spec §11.1 + 审核补 <style> 块/rgba className 族/内容数据拆离；第六轮 P1-2 放宽）——
 * 两规则只拦 className 串 hex 与 white/black 类名；style 对象色值（#hex 与 rgba()/hsla() 蒙层——CreditsDropdown
 * :268 白辉光/:287-288 白系内阴影即活例，原 #hex-only 正则漏网）、SVG 呈现属性、JSX <style> 块、rgba( 任意值类
 * 全部漏网。styleObjects/svgAttrs/rgbaClasses 是核销清单；contentData（ve store 字幕默认 style:{color:'#FFFFFF'} 等
 * 内容语义色）显式排除——它们不是主题面，核销时勿混勾。 */
/* 第七轮 P1-2 订正：字段表补 backgroundImage|border\w*Color|fill|stroke|filter，量词改 [^;\n]*?——
 * [^,}]*? 过不去 gradient/boxShadow 内的逗号（CreditsDropdown :127 渐变基底/:287 白系内阴影均漏网）；
 * style 对象里逗号是常态、分号/换行才是语句边界。命名色工具类（zinc/amber/rose 族）仍不可见——
 * 第五盲区按"最小方案"专项覆盖（Task 19 Step 1 CreditsDropdown 逐类枚举），不建第五分区。 */
const STYLE_OBJECT_RE = /(?:backgroundImage|background|backgroundColor|boxShadow|color|border\w*Color|outline|fill|stroke|filter)\s*:\s*[^;\n]*?(?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/;
// Task 22 前置改进①：扩 rgba/hsla——原 hex-only 系结构盲区（CropOverlay:168 fill="rgba(0,0,0,0.5)" 实证）
const SVG_ATTR_RE = /(?:fill|stroke|stopColor)\s*=\s*['"`][^'"`]*?(?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/;
const STYLE_BLOCK_RE = /<style[^>]*>[\s\S]*?<\/style>/;
const RGBA_CLASS_RE = /(?:bg|text|border|ring|divide)-(?:\[[^\]]*rgba?\([^\]]*\])/;
const partitionBy = (files, re) => files.flatMap((f) => {
  const text = fs.readFileSync(f, 'utf8');
  return text.split('\n').map((line, i) => (re.test(line) ? { file: rel(f), line: i + 1, text: line.trim().slice(0, 120) } : null)).filter(Boolean);
});
const blindScope = [...canvas, ...ve, ...videos, ...stripTests(walk(path.join(SRC, 'components/MaterialLibrary')))];

const registry = {
  meta: {
    task: 'C8 画布域主题跟随——迁移 registry（spec 2026-09-20-canvas-domain-theme §5；D0-0 产出，D3 逐域核销）',
    generatedAt: new Date().toISOString(),
    renderWhitelist: RENDER_WHITELIST,
    notes: '逐键裁定列随 D1a/D1b/D3 各段填充；differExpectedPairs 为 D 段配对闸唯一来源（未配对=失败，adjudications 只记理由不吸收 diff）；盲区分区（styleObjects/svgAttrs/styleBlocks/rgbaClasses）是"两条 lint 规则都拦不到"位点的唯一清单产出，量级以脚本产出为准；CSS 声明形（如 background: #1a1a1a）实测会命中 styleObjects 正则——handwrittenCss（按文件）与 styleObjects（按位点）重叠收录属预期，核销按分区各自口径勾销勿互相推诿（第七轮 P1-2 订正，原"不匹配"表述作废）；配对残余分两类：全局继承族（body 底/前景→继承链，page 字段无效，永久全局配对——D1a body 两对即首例）与元素级（page 已收窄到同页），三源核销按类别核；命名色工具类（zinc/amber/rose 族）不属四分区可见面，唯一已知重灾区 CreditsDropdown 走 Task 19 专项枚举+B6；style 对象**跨行值**（属性名与值分行，如 CreditsDropdown:135-136 backgroundImage）逐行正则两行都不命中、不在 styleObjects 可见面——已知实例 CreditsDropdown:132-138 光斑层，逐行正则的结构限制，靠 Task 19 专项枚举兜底；svgAttrs 已扩 rgba/hsla（原 hex-only 系结构盲区，CropOverlay:168 实证）；运行时键盲区：ve 采集页 3 个 tid: 根元素不参与属性比对，迁移靠 B6/探针；【D3 收口核销（Task 25）】分区分级核销完成：①逐文件核销——六内容分区+tests 每文件在 adjudications 有裁定或豁免依据，保留字面走 whitelistKeeps 精确条目（各分区 note 键注依据）；②盲区分级——styleBlocks 6 文件与 svgAttrs 38 位点逐行勾（既有条 26/36/40/41/44/46/47/48/52/53/56/57 + Task 25 补录 D3-final-svgattrs-closeout/D3-final-mask-rulings/D3board-styleblock-hover-tokens 三条），styleObjects 与 rgbaClasses **不逐行核销，靠 B6**（诚实边界明文）——浅色档功能性不可见位点已探针化（Task 22 accent 清单 CanvasView:456/GridSizeDropdown:121 等）；③B6 目检清单完整性已核对（plan Task 27 Step 3：节点卡 8 类/KeyboardShortcutsPanel 混合态/VideoHDPanel 标签/操作蓝/菱形/浮层-板分离度/A 组 5 钮/4 浮标等各域条目齐全）；④hex 基线陈旧键说明：D3 删除大量 hex 字面后 eslint-hex-baseline.json 残留已删行陈旧键属预期——默认不动 baseline（陈旧键不影响 no-new-violation 门禁语义），勿手动清、禁 UPDATE_BASELINE=1；D3 全程重键均伴随行文本变更且计数不增（lint-gate 实测 219 baselined/0 new/已消除 26 键）；⑤D3-final 涌现闸：深浅双侧 offender=0/漂移=0（d3EmergentSites 空——D3 迁移皆换色非加边框，final segcheck 实证）',
  },
  partitions: {
    /* D3 收口（Task 25）：note 键=各分区核销状态与依据（重产保留——写在本脚本非手工编辑 JSON，防下次刷新丢失） */
    canvasDomain: { files: withHits(canvas).map(rel), totalFiles: canvas.length, note: 'D3 核销（Task 22/23/24 三批迁移+Task 25 收口）：逐文件裁定在 adjudications（D3board-*/D3-* 条），保留字面在 whitelistKeeps 精确条目 {glob,allow}' },
    veDomain: { files: withHits(ve).map(rel), totalFiles: ve.length, note: 'D3 核销（Task 21 壳岛拆除+字面四通道，D3-ve-* 条）：运行时键盲区 tid: 根元素迁移无 differ 信号，靠 B6/探针' },
    videosDomain: { files: withHits(videos).map(rel), totalFiles: videos.length, note: 'D3 核销（Task 20 播放壳域原子对）：壳根 DOM 拆分+恒深第四通道保留（ProcessSnapshot 整块/媒体容器 bg-black 等 whitelistKeeps 在册）' },
    externalSingles: { files: extras, note: '核销（Task 16 WeChatFollowModal 岛拆除，G8① 反转原子对）' },
    componentDomains: { files: withHits(componentDirs.filter(fs.existsSync).flatMap((p) => (fs.statSync(p).isDirectory() ? stripTests(walk(p)) : [p]))).map(rel), note: 'D3 核销（Task 24 MaterialLibrary 目录摘除净 -6+字面迁移，D3-material-* 两条）：BaseFullscreenModal scrim 白名单保留' },
    handwrittenCss: { files: cssBlocks, note: '核销：index.css（D1a/D1b 双值化+死键清理+等值并域）、PromptInput.css（D1a-promptinput-* 三条）、NodeHandle.css（Task 22 手柄 icon 浅值双值化）' },
    tests: { files: tests.map(rel), note: '核销：断言串随产品字面同 commit 同步（各段登记在案），string 放行仅限测试文件（whitelistKeeps 在册）' },
    styleObjects: { sites: partitionBy(blindScope, STYLE_OBJECT_RE), note: '分级核销：位点量大**不逐行核销，靠 B6**（明文边界）——保留字面裁定在册（D3board-node-floats/slider-white/fullscreen-keeps 等），浅色档功能性不可见位点已探针化（CanvasView:456/GridSizeDropdown:121 等 Task 22 accent 清单）；CSS 声明形与 handwrittenCss 重叠收录按各自口径核销勿互推' },
    svgAttrs: { sites: partitionBy(blindScope, SVG_ATTR_RE), note: '逐行勾完成：位点全数在 adjudications 有裁定——KeyboardShortcutsPanel 25（47 条：#5DDCFF 20+#999 5 补录）、AudioWaveform 2（46）、VideoEditNode GridIcon 4+config-panel sparkle 4+MultiImageNode 占位 1+RemoteCursors 1（Task 25 D3-final-svgattrs-closeout 补录）、CropOverlay 1（D3-final-mask-rulings）' },
    styleBlocks: { sites: [...canvas, ...ve, ...videos].filter((f) => STYLE_BLOCK_RE.test(fs.readFileSync(f, 'utf8'))).map(rel), note: '逐文件勾完成：6 文件全数有裁定——CanvasToolbar（41 hover !important 保序）、Image/VideoFullscreenViewer（26⑤ 恒深面板侧白 thumb）、EditToolbar/ImageNodeToolbar/TransformToolbar（Task 25 D3board-styleblock-hover-tokens：hover 常量已 token 化+tooltip 恒深）' },
    rgbaClasses: { sites: partitionBy(blindScope, RGBA_CLASS_RE), note: '位点 1 处 VideoPlayerModal:86 close-btn：Task 20 壳根 DOM 拆分显式化核销（D3-videos-shell-dom-split+白名单 allow bg,text）' },
    contentDataExcluded: { why: 've store/测试内字幕默认 style:{fontSize,color} 等内容语义色非主题面，显式排除不核销' },
  },
  adjudications: [],
  differExpectedPairs: { pairs: [] },
  /* D3 涌现站点级登记（第五轮 M3/P1-7 采纳+第六轮页无关化）：{page, key, why}——D 对任何采集页 border-width 0→N 站点必须命中，
   * differ 消费（Task 3 Step 2 ⑤）。替代旧"PAGE_REGISTRY_FILES 粘贴 + 授权集并集"双写（D 域全量授权后
   * 文件级闸恒真 + 粘贴视图与 registry 双真源漂移），A5 旧路径不动。 */
  d3EmergentSites: [],
  whitelistKeeps: [],
};
/* 第八轮 P2-3 合并模式：adjudications/differExpectedPairs/d3EmergentSites/whitelistKeeps 四键是 D 段门禁真源、
 * 随各段手工累积——覆盖式重产（如 Task 22 新建 block-colors.ts 后刷新 partitions）会瞬间清零门禁。
 * 脚本只刷新 partitions/meta.renderWhitelist/meta.generatedAt，四手工键读既有文件保留。 */
const out = path.join(ROOT, 'e2e', 'audit', 'canvas-migration-registry.json');
if (fs.existsSync(out)) {
  // Task 22 前置改进③：解析失败即报错点名文件（防手工键静默丢失——坏 JSON 会让四手工键归零重产）
  let prev;
  try {
    prev = JSON.parse(fs.readFileSync(out, 'utf8'));
  } catch (e) {
    console.error(`[registry] 既有 registry 解析失败（${path.relative(ROOT, out)}）：${e.message}——四手工键（adjudications/differExpectedPairs/d3EmergentSites/whitelistKeeps）将丢失，先修 JSON 再重跑`);
    process.exit(1);
  }
  registry.adjudications = prev.adjudications ?? [];
  registry.differExpectedPairs = prev.differExpectedPairs ?? { pairs: [] };
  registry.d3EmergentSites = prev.d3EmergentSites ?? [];
  registry.whitelistKeeps = prev.whitelistKeeps ?? [];
}
fs.writeFileSync(out, JSON.stringify(registry, null, 1));
console.log('[registry] 分区计数：', Object.fromEntries(Object.entries(registry.partitions).map(([k, v]) => [k, v.files ? v.files.length : (v.sites ?? []).length])));
console.log('[registry] 手工键计数：adjudications=%d differExpectedPairs.pairs=%d d3EmergentSites=%d whitelistKeeps=%d',
  registry.adjudications.length,
  registry.differExpectedPairs.pairs.length,
  registry.d3EmergentSites.length,
  registry.whitelistKeeps.length);
