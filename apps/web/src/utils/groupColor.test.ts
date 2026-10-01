import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import { GROUP_PALETTE, resolveGroupColor } from './groupColor';

// walk-up 找仓库根（先例：group-frame-writer-guard.test.ts——勿对 .css 用 require.resolve，jsdom+Vite 下不稳）
function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(cur, 'pnpm-workspace.yaml'))) return cur;
    cur = path.dirname(cur);
  }
  throw new Error('repo root not found');
}
const INDEX_CSS = path.join(findRepoRoot(process.cwd()), 'apps/web/src/index.css');

describe('groupColor 单源（R2c-2——palette/类型/resolve 唯一收敛）', () => {
  it('GROUP_PALETTE 恰 7 色，无 gray', () => {
    expect(GROUP_PALETTE).toHaveLength(7);
    expect(new Set(GROUP_PALETTE)).toEqual(
      new Set(['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple']),
    );
    expect(GROUP_PALETTE).not.toContain('gray');
  });

  it('resolveGroupColor：合法 key → CSS 变量值；bogus/undefined → undefined（未知 key 不抛错，写入端另有拒写守卫）', () => {
    expect(resolveGroupColor('red')).toBe('var(--canvas-group-color-red)');
    expect(resolveGroupColor('purple')).toBe('var(--canvas-group-color-purple)');
    expect(resolveGroupColor('bogus')).toBeUndefined();
    expect(resolveGroupColor(undefined)).toBeUndefined();
  });

  it('palette↔index.css 对账（双主题块全部 --canvas-group-color-* key 双向互指，钉死单源）', () => {
    const src = readFileSync(INDEX_CSS, 'utf8');
    const cssKeys = new Set(
      [...src.matchAll(/--canvas-group-color-([a-z]+):/g)].map((m) => m[1]),
    );
    const paletteSet = new Set<string>(GROUP_PALETTE);
    // palette → css：palette 里有而 css 里没有 → 红
    for (const key of GROUP_PALETTE) expect(cssKeys.has(key)).toBe(true);
    // css → palette：css 里有而 palette 里没有 → 红
    expect(cssKeys).toEqual(paletteSet);
  });
});
