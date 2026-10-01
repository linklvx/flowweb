// 域 token 深浅键集守卫（R2c-1，spec 2026-09-28-canvas-group-ui-upgrade §4.2 门禁第三条）：
// b1-4 块唯一性/源序守卫只在 Playwright 批（fail-closed、CI 不跑）⇒ vitest 侧必须自证：
//   ① b0 DOMAIN_DARK/DOMAIN_LIGHT 深浅键集相等（单侧加键=另一侧静默缺失）；
//   ② 组域 9 新键与 index.css 双块对账（css 漏声明=计算值空串；b0 值表多写不读=假绿面）。
// e2e/** 被 vitest exclude（vite.config.ts test.exclude）且 b0 引 @playwright/test，无法 import——
// 源码正则解析对账（先例：group-frame-writer-guard.test.ts findRepoRoot 定根 / RunButton.test.tsx
// readFileSync index.css 块头正则锚定切片）。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';

function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(cur, 'pnpm-workspace.yaml'))) return cur;
    cur = path.dirname(cur);
  }
  throw new Error('repo root not found');
}
const WEB = path.join(findRepoRoot(process.cwd()), 'apps/web');
const CSS = readFileSync(path.join(WEB, 'src/index.css'), 'utf8');
const B0 = readFileSync(path.join(WEB, 'e2e/b0-token-blocks.spec.ts'), 'utf8');

/** 组域 9 新键（spec §4.2 R2c-1 落地集，显式锚定——后续新键须同步扩本表） */
const NEW_KEYS = [
  '--canvas-storyboard-shell-bg',
  '--canvas-group-border',
  '--canvas-group-color-red',
  '--canvas-group-color-orange',
  '--canvas-group-color-yellow',
  '--canvas-group-color-green',
  '--canvas-group-color-cyan',
  '--canvas-group-color-blue',
  '--canvas-group-color-purple',
];

/** 块切片内声明的 --xxx: 键（声明位形态，var() 引用不命中——b1-4 :317-320 同款订正） */
function blockKeys(block: string): string[] {
  return [...block.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]);
}
/** b0 spec 源码解析：`const NAME = [...] as const` 字符串项 */
function b0ArrayKeys(name: string): string[] {
  const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(B0);
  expect(m, `b0 spec 缺 ${name} 数组`).toBeTruthy();
  return [...m![1].matchAll(/'(--[\w-]+)'/g)].map((x) => x[1]);
}
/** b0 spec 源码解析：`const NAME: Record<string, string> = {...}` 键 */
function b0MapKeys(name: string): string[] {
  const m = new RegExp(`const ${name}: Record<string, string> = \\{([\\s\\S]*?)\\n\\};`).exec(B0);
  expect(m, `b0 spec 缺 ${name} 值表`).toBeTruthy();
  return [...m![1].matchAll(/'(--[\w-]+)':/g)].map((x) => x[1]);
}
const sorted = (keys: string[]) => [...new Set(keys)].sort();

describe('域 token 深浅键集守卫（R2c-1——vitest 侧自证，b1-4 仅 Playwright 批）', () => {
  // 块头正则锚定切片（RunButton.test.tsx:27-33 先例——顶部注释含 .light/:root, 字样，indexOf 会假红；
  // 上界锚下一块头 `:root {` 几何常量块——禁入第三块的纪律由切片上界体现）
  const darkStart = CSS.search(/:root,\s*\.dark\s*\{/);
  const lightStart = CSS.search(/\.light\s*\{/);
  const darkBlock = CSS.slice(darkStart, lightStart);
  const lightBlock = CSS.slice(lightStart, CSS.indexOf(':root {', lightStart));
  const darkMapKeys = b0MapKeys('DOMAIN_DARK');
  const lightMapKeys = b0MapKeys('DOMAIN_LIGHT');

  it('b0 DOMAIN_DARK/DOMAIN_LIGHT 深浅键集相等（单侧加键即红）', () => {
    expect(sorted(darkMapKeys)).toEqual(sorted(lightMapKeys));
  });

  it('index.css 深/浅双块各自声明键集相等（域 token 双块成对，源序 .light 在后）', () => {
    expect(darkStart).toBeGreaterThan(-1);
    expect(lightStart).toBeGreaterThan(darkStart); // D8 源序约束
    expect(sorted(blockKeys(darkBlock))).toEqual(sorted(blockKeys(lightBlock)));
  });

  it('组域 9 新键与 index.css 双块对账：双块声明的组域键恰为 NEW_KEYS（多键少键都红）', () => {
    const isNewFamily = (k: string) => /^--canvas-(?:group|storyboard)/.test(k);
    const cssDarkNew = sorted(blockKeys(darkBlock).filter(isNewFamily));
    const cssLightNew = sorted(blockKeys(lightBlock).filter(isNewFamily));
    expect(cssDarkNew, 'index.css 深块组域键').toEqual(sorted(NEW_KEYS));
    expect(cssLightNew, 'index.css 浅块组域键').toEqual(sorted(NEW_KEYS));
  });

  it('组域 9 新键在 b0 迭代清单与双值表五处齐全（值表多写不读=假绿面封死）', () => {
    const tokens = b0ArrayKeys('DOMAIN_TOKENS');
    for (const k of NEW_KEYS) {
      expect(tokens, `DOMAIN_TOKENS 缺 ${k}——b0 不迭代即假绿`).toContain(k);
      expect(darkMapKeys, `DOMAIN_DARK 缺 ${k}`).toContain(k);
      expect(lightMapKeys, `DOMAIN_LIGHT 缺 ${k}`).toContain(k);
    }
  });
});
