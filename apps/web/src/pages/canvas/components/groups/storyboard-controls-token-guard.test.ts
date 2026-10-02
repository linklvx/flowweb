// storyboard-controls-token-guard.test.ts — F28 源码扫描（2d-7）
// 三子组件 style 对象对 hex lint 豁免，故由扫描钉死：分镜工具条子组件源码零硬编码 hex
// （#fff/#666/#aaa/#ccc 一律 --canvas-controls-* token；先例：group-frame-writer-guard 读源码断言）
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'src/pages/canvas/components/groups');
const FILES = ['AspectRatioDropdown.tsx', 'GridSizeDropdown.tsx', 'StitchButton.tsx'];

describe('F28 三子组件 token 化源码扫描（零 hex 字面量）', () => {
  it.each(FILES)('%s 源码零 hex（含 #fff/#666/#aaa/#ccc——应换 --canvas-controls-text/--canvas-controls-icon）', (file) => {
    const src = readFileSync(join(DIR, file), 'utf8');
    expect(src, `${file} 含硬编码 hex 颜色（应换 --canvas-controls-* token）`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
