/**
 * flowweb/no-theme-utility —— 主题色工具类九前缀族（text/bg/border/ring/divide/fill/stroke/from/via/to × white/black）白名单禁令
 *（B5，spec 2026-09-18-css-base-layer-theme B5；C8 Task 19 扩九前缀族 + 白名单粒度升级）
 *
 * 拦截面：字符串/模板字面量中的完整类 token——九前缀族均命中（text-white、bg-black、border-white…）：
 *   - 斜杠透明度形（text-white/90）、alpha 方括号形（bg-white/[0.06]）、`!` important 变体（!text-white）、
 *     变体前缀（hover:/md:hover: 等）天然命中；
 *   - 完整 token 判定：前导吞 1 个边界字符 + 尾部边界收口——九前缀族均命中；
 *     `bg-whitesmoke` 等非完整 token 仍不命中（尾部边界），`text-[#fff]`（hex 归 no-color-hex）不命中。
 * 白名单双形态（跟随域位点须先修源码迁 token，禁止扩白名单）：
 *   - 目录条目 string = 全属性族放行（恒深域/岛）；
 *   - 精确文件条目 {glob, allow:['bg',...]} = 该属性族放行、其余仍拦（串内全匹配判定——
 *     首个匹配在 allow 不能放行同串真违例）。
 * 无 baseline：跟随域已迁 0（B2 三通道），门禁直判——任何命中 = 违例（lint-gate.mjs 不为此规则建 baseline）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStringClassScanner } from './string-class-scan.js';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 完整类 token 判定：前导吞 1 个边界字符（串首/空白/引号），后随 0+ 变体前缀，尾部边界收口。
 *  第八轮 P2-2：alpha 段扩方括号形态（bg-white/[0.06]、border-white/[0.1]、hover:bg-white/[0.12] 的 / 后是 [）。 */
const THEME_UTILITY_RE =
  /(?:^|[\s"'`])((?:[a-zA-Z][\w-]*:)*)!?(text|bg|border|ring|divide|fill|stroke|from|via|to)-(?:white|black)(?:\/(?:\d{1,3}|\[[\d.]+\]))?(?=$|[\s"'`])/u;

// 全局扫描形态：g 标志 + lookaround 边界（(?:^|[\s"']) 在 matchAll 下会吃掉一个字符致相邻 token 漏匹配）
// ⚠ 与 THEME_UTILITY_RE 两式必须同步修改（家族集/边界/变体前缀/alpha 段任一差异 = familiesOf 与 scanner 判定分叉）；fixture ④ 变体形态用例守此
const GLOBAL_THEME_UTILITY_RE = /(?<![\w-])((?:[a-zA-Z][\w-]*:)*)!?(text|bg|border|ring|divide|fill|stroke|from|via|to)-(?:white|black)(?:\/(?:\d{1,3}|\[[\d.]+\]))?(?![\w-])/gu;

/**
 * 白名单（posix glob，相对 apps/web）。双形态：string=目录/文件全属性族放行；{glob,allow}=精确文件+属性族。
 * `**` 跨段、`*` 单段。注释即归因：改动须同步 e2e/audit/canvas-migration-registry.json whitelistKeeps（C8 镜像）。
 */
export const THEME_UTILITY_WHITELIST = [
  // —— 恒深域（C8 D3 逐域摘除：videos 已摘（Task 20）、video-editor 已摘（Task 21，net -2）、nodes/edges/groups 已摘（Task 22，net -5 累计）——
  // 摘除后本域残余 = 下列精确条目（媒体压层浮层/恒深自持面，registry D3-board 逐条 adjudication 镜像）：
  { glob: 'src/pages/canvas/components/nodes/VideoGenNode.tsx', allow: ['bg', 'text', 'border'] },   // :623 选中浮标+:756 替换视频钮（压媒体浮层，registry D3-board-node-float-keeps）
  { glob: 'src/pages/canvas/components/nodes/ImageGenNode.tsx', allow: ['bg', 'text', 'border'] },   // :1227 替换图片钮（压媒体浮层）
  { glob: 'src/pages/canvas/components/nodes/MultiImageNode.tsx', allow: ['bg', 'text', 'border'] }, // :207 浮标+:322/329/394 琥珀徽章+:327 悬停黑罩+:359 内沿边（压媒体/图形档）
  { glob: 'src/pages/canvas/components/nodes/AudioGenNode.tsx', allow: ['bg', 'text', 'border'] },   // :128 浮标+:242 替换音频钮（压媒体浮层）
  { glob: 'src/pages/canvas/components/nodes/VideoEditNode.tsx', allow: ['bg'] },                    // :193 bg-black 迷你画布垫底（JS 通道 #000 同源，registry D3-ve-content-data）
  { glob: 'src/pages/canvas/components/nodes/ImageNodeToolbar.tsx', allow: ['border'] },             // :402 选中浮标 border-white/10（压媒体浮层）
  { glob: 'src/pages/canvas/components/nodes/EditToolbar.tsx', allow: ['bg'] },                      // :210 白滑钮+:477 反白生成钮（压恒深浮条图形面）
  { glob: 'src/pages/canvas/components/nodes/AnnotationToolbar.tsx', allow: ['bg', 'border'] },      // :254 滑钮 border-white/20+:276 白滑钮（压恒深浮条）
  { glob: 'src/pages/canvas/components/nodes/OutpaintSelectionOverlay.tsx', allow: ['bg'] },         // :232-235 bg-white/30 三分网格线（压媒体，spec §11.1 点名保留）
  { glob: 'src/pages/canvas/components/nodes/TextNodeToolbar.tsx', allow: ['bg', 'text', 'border'] },// :214 深玻璃浮条（压文本内容，浅档保深属功能性正确）
  { glob: 'src/pages/canvas/components/nodes/TextNodeFullscreen.tsx', allow: ['bg'] },               // :88 bg-black/60 全屏遮罩中性 scrim（BaseFullscreenModal 先例）
  { glob: 'src/pages/canvas/components/nodes/ImageFullscreenViewer.tsx', allow: ['bg', 'text', 'border'] }, // 压画面整块恒深（ProcessSnapshot 同款第四通道）
  { glob: 'src/pages/canvas/components/nodes/VideoFullscreenViewer.tsx', allow: ['bg', 'text', 'border'] }, // 同上
  { glob: 'src/pages/canvas/components/nodes/prompt-input/CommandMentionList.tsx', allow: ['text'] },        // 恒深提及菜单（#1f2937 壳）内 text-white
  { glob: 'src/pages/canvas/components/nodes/prompt-input/ImageThumbnailBar.tsx', allow: ['bg', 'text'] },   // 压 prompt 条恒深面的加图钮
  { glob: 'src/pages/canvas/components/nodes/prompt-input/SortableImageItem.tsx', allow: ['bg', 'text'] },   // 压缩略图黑罩/删除钮（压媒体）
  { glob: 'src/pages/canvas/components/nodes/AiToolActionPopup.tsx', allow: ['bg'] },                        // oklab 恒深弹层内 bg-white/5 图标垫底/hover（压画布浮层）
  { glob: 'src/pages/canvas/components/edges/ConnectionLine.tsx', allow: ['text'] },                          // :111 边删除徽章 hover:text-white（恒深 badge 压画布）
  // —— nodes 域测试文件单文件条目（断言串九族命中非产品 UI）——
  'src/pages/canvas/components/nodes/MultiImageNode.test.tsx',   // :351 断言 .border-white/[0.06] keep 面
  'src/pages/canvas/components/nodes/TextNodeToolbar.test.tsx',  // :171/:180 断言深浮条 active bg-white/20
  // —— 岛（MaterialLibrary 随 Task 24 摘除并迁 TSX）——
  'src/pages/admin/**',
  'src/pages/login/**',
  'src/pages/register/**',
  'src/components/MaterialLibrary/**',
  'src/components/AuthModal.tsx',
  'src/components/auth/PhoneLoginForm.tsx',
  'src/components/auth/LoginModal.tsx',
  'src/components/auth/WeChatQRLogin.tsx',
  // —— 精确文件+属性族（现状 4 条随升级改对象形态；allow 语义=该属性族放行、其余仍拦）——
  { glob: 'src/components/layout/TopActionBar.tsx', allow: ['bg', 'text'] },       // 登录钮 bg-white/text-black（#9 反白 CTA）
  { glob: 'src/pages/canvas/components/CanvasTopBar.tsx', allow: ['text'] },        // 档位徽章 text-black（#6 黑字随底）
  { glob: 'src/pages/home/components/CreateCanvasCard.tsx', allow: ['bg', 'text'] }, // :30 bg-white 白盒 + :32 text-black 加号（#9 反白 CTA 族——allow 必须 grep 属性族定，禁按语义描述直写）
  { glob: 'src/pages/team/TeamDetail.tsx', allow: ['text'] },                      // 同上
  // —— C8 新增精确条目 ——
  { glob: 'src/pages/canvas/components/CreditsDropdown.tsx', allow: ['bg'] },       // :267 充值钮 bg-white+hover:bg-zinc-100（第五轮订正：此钮非"邀请卡"——邀请钮 :282-285 已 token 化；P5 通道 3 明文保留的即这族白系）
  { glob: 'src/pages/canvas/components/ConfirmModal.tsx', allow: ['bg'] },          // 白卡（通道 3）
  { glob: 'src/pages/canvas/components/SaveAsTemplateDialog.tsx', allow: ['bg'] },  // 白卡（通道 3）
  { glob: 'src/pages/videos/ProcessSnapshot.tsx', allow: ['bg', 'text', 'border'] }, // 内容承载恒深整块（spec §10-⑦）——Task 19 预置，Task 20 摘目录后本条已激活
  // —— C8 Task 20 D3-videos 摘目录同 commit 补精确条目（媒体压层/恒深自持，禁 string 整文件放行）——
  { glob: 'src/pages/videos/PlayView.tsx', allow: ['bg', 'text', 'from'] },          // 压画面 UI 整块恒深保留字面（第四通道，registry D3-playview-channel4：from-black scrim+白字/bg-white 形+深药丸 text-white）
  { glob: 'src/pages/videos/CarouselBar.tsx', allow: ['bg', 'ring'] },               // :29 hover:ring-white/60 + :31 无封面占位 bg-white/10 压媒体（第四通道，registry D3-carouselbar-overmedia-keep）
  { glob: 'src/pages/videos/VideoCard.tsx', allow: ['bg', 'text'] },                 // :21 时长胶囊 bg-black/70+text-white 压封面（第四通道，registry D3-videocard-migration）
  { glob: 'src/pages/videos/ProcessView.tsx', allow: ['bg'] },                       // :53 复制项目 bg-white 反白 CTA（通道 3 明文禁 token 化，registry D3-processview-migration）
  { glob: 'src/pages/videos/VideoPlayerModal.tsx', allow: ['bg', 'text'] },          // :75 媒体容器 bg-black 恒深自持 + :86 close-btn text-white 压画面显式化（第四通道，registry D3-videos-shell-dom-split）
  // —— C8 Task 21 D3-ve 摘目录同 commit 补精确条目（恒定面/恒深保留，禁 string 整文件放行）——
  { glob: 'src/pages/canvas/video-editor/components/ExportModal.tsx', allow: ['text'] },        // :245 紫底填充钮白字=图形档恒定面（第七轮 M3：on-accent 语义绑绿底非紫底，registry D3-ve-keeps-constant-faces）
  { glob: 'src/pages/canvas/video-editor/components/PreviewPlayer.tsx', allow: ['bg'] },        // :71 bg-black 媒体垫底恒深自持（registry D3-ve-keeps-constant-faces）
  { glob: 'src/pages/canvas/video-editor/components/timeline/ClipBlock.tsx', allow: ['text'] }, // :75 text-white/85 clip 色条前景=内容语义恒深压 BLOCK_BG 色表（registry D3-ve-keeps-constant-faces）
  // —— C8 Task 20 videos __tests__ 单文件 string 条目（测试断言串九族命中非产品 UI，整文件放行；第五轮写 3、第八轮 P3-1 实测 4——多出 CarouselBar.test:80 ring 家族）——
  'src/pages/videos/__tests__/CarouselBar.test.tsx',
  'src/pages/videos/__tests__/PlayView.test.tsx',
  'src/pages/videos/__tests__/ProcessView.test.tsx',
  'src/pages/videos/__tests__/ProcessSnapshot.test.tsx',
  // —— C8 Task 19 Step 3 working list 精确豁免（lint-gate 实测 12 处/7 文件全 bg 族；每文件先九族 grep -i 定 allow）——
  { glob: 'src/components/BaseFullscreenModal.tsx', allow: ['bg'] },                 // :70 bg-black/60 全屏模态遮罩中性 scrim（恒定黑罩两档成立）
  { glob: 'src/pages/canvas/page.tsx', allow: ['bg'] },                              // :313 bg-black/50 hydrate 加载遮罩中性 scrim
  { glob: 'src/pages/home/components/BannerCarousel.tsx', allow: ['bg'] },           // :80/:87 bg-black/40 轮播图上 hover 前后导航钮垫底（压媒体浮层）
  { glob: 'src/pages/workspace/components/CanvasCard.tsx', allow: ['bg'] },          // :87 bg-black/50 卡面 hover 浮出操作条垫底（压预览媒体）
  { glob: 'src/pages/workspace/components/FolderCard.tsx', allow: ['bg'] },          // :71 bg-black/50 同 CanvasCard
  { glob: 'src/pages/canvas/components/Lighting/LightingModal.tsx', allow: ['bg'] }, // :97 bg-black/60 scrim + :160/:189 bg-black/80 结果/错误遮罩（压暗垫底）
  { glob: 'src/pages/canvas/components/Angle3D/Angle3DModal.tsx', allow: ['bg'] },   // :129 bg-black/60 scrim + :183/:208 bg-black/80 结果/错误遮罩（同 LightingModal）
];

/** glob → 正则（占位串防 `**` 先展开后被单 `*` 二次改写；占位串不可出现在真实路径） */
function globToRe(glob) {
  const STAR = '@@flowweb-globstar@@';
  let s = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  s = s.split('**/').join(STAR).split('**').join(STAR).split('*').join('[^/]*').split(STAR).join('.*');
  return new RegExp(`^${s}$`, 'u');
}

/** 相对 apps/web 的 posix 路径；相对输入按 APP_ROOT 解释（fixture 直供相对名，与 cwd 无关） */
export function toAppRelPosix(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(APP_ROOT, filePath);
  return path.relative(APP_ROOT, abs).split(path.sep).join('/');
}

/** 条目归一：string → {glob, allow:null(全放行)}；{glob,allow} → 原样 */
const normalizeEntry = (e) => (typeof e === 'string' ? { glob: e, allow: null } : e);
const WHITELIST_ENTRIES = THEME_UTILITY_WHITELIST.map(normalizeEntry);

const RE_CACHE = new Map(); // 第七轮 P3：旧实现是模块级预编译；新入口若每次访问现编译 28 条 glob 会拖慢全仓 lint——缓存补回
function globToReCached(glob) {
  let re = RE_CACHE.get(glob);
  if (!re) { re = globToRe(glob); RE_CACHE.set(glob, re); }
  return re;
}

/** 匹配 + 属性族判定：返回 undefined=不在白名单；null=目录条目全放行；数组=精确条目放行集 */
function whitelistAllowFor(filePath) {
  const rel = toAppRelPosix(filePath);
  // 首匹配生效——目录条目须排在被其覆盖文件的精确条目之前（重叠对现状唯一：videos/** 遮蔽 ProcessSnapshot 精确条目，摘目录后自动激活；重排数组会静默改变遮蔽关系）
  for (const e of WHITELIST_ENTRIES) {
    if (globToReCached(e.glob).test(rel)) return e.allow; // null=目录条目全放行
  }
  return undefined; // 不在白名单
}

/** 收集节点串内全部匹配的属性族（Literal 单串；TemplateLiteral 逐 quasi cooked——String(node.value) 对其恒 ''） */
const familiesOf = (node) => {
  const texts = node?.type === 'Literal'
    ? [String(node.value ?? '')]
    : (node?.quasis ?? []).map((q) => String(q?.value?.cooked ?? ''));
  return texts.flatMap((t) => [...t.matchAll(GLOBAL_THEME_UTILITY_RE)].map((m) => m[2]));
};

export const noThemeUtility = {
  meta: {
    type: 'problem',
    docs: {
      description:
        '主题色工具类九前缀族（×white/black）白名单禁令——跟随域迁语义 token（spec 2026-09-18-css-base-layer-theme B5；C8 Task 19 扩九前缀族+白名单粒度升级）',
    },
    schema: [],
    messages: {
      themeUtilityForbidden:
        '主题色工具类九前缀族（text/bg/border/ring/divide/fill/stroke/from/via/to × white/black）禁令——跟随域迁移语义 token（text-white→text-text/text-text-dim-1..3/text-on-accent，bg-white/NN→bg-overlay-1..3；恒深/岛域经目录白名单、合法保留面经 {glob,allow} 精确条目放行，勿扩白名单）；spec 2026-09-18-css-base-layer-theme B5。',
    },
  },
  create(context) {
    const visitor = createStringClassScanner(THEME_UTILITY_RE, 'themeUtilityForbidden')(context);
    const wrap =
      (visit) =>
      (...args) => {
        const allow = whitelistAllowFor(context.filename);
        if (allow === null) return; // 目录条目全放行
        if (allow) {
          const fams = familiesOf(args[0]);
          if (fams.length && fams.every((f) => allow.includes(f))) return; // 全部命中家族都在 allow 内才放行
        }
        visit(...args); // 不在白名单 / 精确条目但存在超出 allow 的家族（含首匹配在 allow 的同串真违例）
      };
    return { Literal: wrap(visitor.Literal), TemplateLiteral: wrap(visitor.TemplateLiteral) };
  },
};

export default noThemeUtility;
