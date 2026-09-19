/**
 * flowweb/no-theme-utility —— 主题色工具类 text-white/text-black 目录白名单禁令（B5，spec 2026-09-18-css-base-layer-theme B5/plan「目录白名单禁新增 text-white」）
 *
 * 拦截面：字符串/模板字面量中的完整类 token `text-white`/`text-black`——
 *   - 斜杠透明度形（text-white/90）、`!` important 变体（!text-white）、变体前缀（hover:/md:hover: 等）天然命中；
 *   - 完整 token 判定：前后须为串首/空白/引号——`text-whitesmoke`、`bg-white`（非 text 前缀）、
 *     `text-[#fff]`（hex 归 no-color-hex）不命中。
 * 白名单（D4 宿主域三列归因，与 e2e/audit/b2-migration-registry.json whitelistKeeps 家族一一对应；
 * 跟随域位点须先修源码迁 token，禁止扩白名单）：
 *   - 恒深域（家族 #1/#2/#3）：pages/videos/**、canvas/components/{nodes,edges,groups}/**（board）、pages/canvas/video-editor/**
 *   - 岛（家族 #3/#4）：pages/admin/**、pages/login/**、pages/register/**、components/MaterialLibrary/**、
 *     components/AuthModal.tsx、components/auth/{PhoneLoginForm,LoginModal,WeChatQRLogin}.tsx
 *   - 跟随域内「随底保留」位点（家族 #6 档位徽章黑字 / #9 反白 CTA 黑字，文件级精确豁免）：
 *     components/layout/TopActionBar.tsx、pages/canvas/components/CanvasTopBar.tsx、
 *     pages/home/components/CreateCanvasCard.tsx、pages/team/TeamDetail.tsx
 * 无 baseline：跟随域已迁 0（B2 三通道），门禁直判——任何命中 = 违例（lint-gate.mjs 不为此规则建 baseline）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStringClassScanner } from './string-class-scan.js';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 完整类 token 判定：前导吞 1 个边界字符（串首/空白/引号），后随 0+ 变体前缀，尾部边界收口 */
const THEME_UTILITY_RE =
  /(?:^|[\s"'`])((?:[a-zA-Z][\w-]*:)*)!?text-(?:white|black)(?:\/\d{1,3})?(?=$|[\s"'`])/u;

/**
 * 目录/文件白名单（posix glob，相对 apps/web）。`**` 跨段、`*` 单段。
 * 注释即归因：改动须同步 e2e/audit/b2-migration-registry.json whitelistKeeps。
 */
export const THEME_UTILITY_WHITELIST = [
  // —— 恒深域（家族 #1 board / #2 videos / #3 video-editor 岛）——
  'src/pages/videos/**',
  'src/pages/canvas/components/nodes/**',
  'src/pages/canvas/components/edges/**',
  'src/pages/canvas/components/groups/**',
  'src/pages/canvas/video-editor/**',
  // —— 岛（家族 #3 MaterialLibrary / #4 营销·登录；admin 岛 C2 挂 dark）——
  'src/pages/admin/**',
  'src/pages/login/**',
  'src/pages/register/**',
  'src/components/MaterialLibrary/**',
  'src/components/AuthModal.tsx',
  'src/components/auth/PhoneLoginForm.tsx',
  'src/components/auth/LoginModal.tsx',
  'src/components/auth/WeChatQRLogin.tsx',
  // —— 跟随域随底保留位点（家族 #6 其上黑字随底 / #9 反白 CTA 黑字）——
  'src/components/layout/TopActionBar.tsx',
  'src/pages/canvas/components/CanvasTopBar.tsx',
  'src/pages/home/components/CreateCanvasCard.tsx',
  'src/pages/team/TeamDetail.tsx',
];

/** glob → 正则（占位串防 `**` 先展开后被单 `*` 二次改写；占位串不可出现在真实路径） */
function globToRe(glob) {
  const STAR = '@@flowweb-globstar@@';
  let s = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  s = s.split('**/').join(STAR).split('**').join(STAR).split('*').join('[^/]*').split(STAR).join('.*');
  return new RegExp(`^${s}$`, 'u');
}

const WHITELIST_RES = THEME_UTILITY_WHITELIST.map(globToRe);

/** 相对 apps/web 的 posix 路径；相对输入按 APP_ROOT 解释（fixture 直供相对名，与 cwd 无关） */
export function toAppRelPosix(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(APP_ROOT, filePath);
  return path.relative(APP_ROOT, abs).split(path.sep).join('/');
}

export function isWhitelistedPath(filePath) {
  const rel = toAppRelPosix(filePath);
  return WHITELIST_RES.some((re) => re.test(rel));
}

export const noThemeUtility = {
  meta: {
    type: 'problem',
    docs: {
      description:
        '主题色工具类 text-white/text-black 目录白名单禁令——跟随域迁语义 token（spec 2026-09-18-css-base-layer-theme B5）',
    },
    schema: [],
    messages: {
      themeUtilityForbidden:
        '主题色工具类 text-white/text-black 禁令——跟随域迁移语义 token（text-white→text-text/text-text-dim-1..3/text-on-accent，bg-white/NN→bg-overlay-1..3；恒深/豁免域经目录白名单放行，勿扩白名单）；spec 2026-09-18-css-base-layer-theme B5。',
    },
  },
  create(context) {
    const visitor = createStringClassScanner(THEME_UTILITY_RE, 'themeUtilityForbidden')(context);
    const wrap =
      (visit) =>
      (...args) => {
        if (isWhitelistedPath(context.filename)) return;
        visit(...args);
      };
    return { Literal: wrap(visitor.Literal), TemplateLiteral: wrap(visitor.TemplateLiteral) };
  },
};

export default noThemeUtility;
