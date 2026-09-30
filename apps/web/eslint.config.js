/**
 * Flat config（A3，spec 2026-09-18-css-base-layer-theme §2.5/D9）
 * —— 语义迁移自仓库根 .eslintrc.base.json（eslint:recommended + plugin:@typescript-eslint/strict
 * type-aware + no-unused-vars argsIgnorePattern；该文件保留不动，deploy.sh 仍引用）。
 *
 * 门禁语义（O3，scripts/lint-gate.mjs 实现）：
 *   - 卡门禁新规则 = flowweb/no-color-hex（颜色前缀任意值 hex 禁令，baseline 增量）
 *     + flowweb/no-theme-utility（B5 收口：目录白名单外 text-white/text-black 禁令，无 baseline 直判）；
 *   - 存量规则（eslint:recommended / @typescript-eslint/strict）保持默认 error 严重度
 *     （IDE 与直接 npx eslint 仍是标准行为），但 lint-gate 只按新规则算退出码——存量永不卡门禁。
 *     不选降级 warn 的原因：降级会让 --max-warnings 类用法与 IDE 展示失真，且门禁脚本过滤更可审计。
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { noColorHex } from './scripts/eslint-rules/no-color-hex.js';
import { noThemeUtility } from './scripts/eslint-rules/no-theme-utility.js';
import { noConnStatusWrite, noYdocGetmap, noStoreSetstate } from './scripts/eslint-rules/collab-static-asserts.js';

const TS_FILES = ['src/**/*.ts', 'src/**/*.tsx'];

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'e2e/**', // Playwright 域，独立 tsconfig
      'scripts/**', // 工具脚本（css-audit/lint-gate/eslint-rules 本身）
      'test-results/**',
    ],
  },
  // JS 文件：eslint:recommended（对应 .eslintrc.base.json extends 第一项）
  js.configs.recommended,
  // TS 文件：@typescript-eslint/strict（type-aware，projectService 走 apps/web/tsconfig.json）
  // —— 整组映射到 src TS 范围：JS 文件不经 TS parser，type-aware 不越界
  ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: TS_FILES })),
  {
    files: TS_FILES,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      flowweb: {
        rules: {
          'no-color-hex': noColorHex,
          'no-theme-utility': noThemeUtility,
          'no-conn-status-write': noConnStatusWrite,
          'no-ydoc-getmap': noYdocGetmap,
          'no-store-setstate': noStoreSetstate,
        },
      },
    },
    rules: {
      // 新规则（B5 收口：hex 全量启用 baseline 增量；theme-utility 白名单外直判 0 违例）
      'flowweb/no-color-hex': 'error',
      'flowweb/no-theme-utility': 'error',
      // collab 静态断言三条（批0e-4）：connStatus 单写点 / getMap 门 / setState 白名单——白名单外直判（lint-gate 分流）
      'flowweb/no-conn-status-write': 'error',
      'flowweb/no-ydoc-getmap': 'error',
      'flowweb/no-store-setstate': 'error',
      // 迁移自 .eslintrc.base.json 的既有覆写
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
