import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RunButton } from './RunButton';

describe('RunButton', () => {
  it('title=生成 且含 20×20 箭头 svg', () => {
    render(<RunButton loading={false} onClick={vi.fn()} />);
    const btn = screen.getByTitle('生成');
    const svg = btn.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('height')).toBe('20');
  });

  it('背景/箭头指向新 token（字符串断言，不解析 rgb）', () => {
    render(<RunButton loading={false} onClick={vi.fn()} />);
    const btn = screen.getByTitle('生成');
    expect(btn.className).toContain('bg-[var(--canvas-run-btn-bg)]');
    // jsdom SVGElement.className 是 SVGAnimatedString 对象非字符串（探针实证 {}），用 getAttribute('class')
    expect(btn.querySelector('svg')?.getAttribute('class')).toContain('text-[var(--canvas-run-btn-icon)]');
  });

  it('index.css 深/浅块均定义新 token 对（正则锚定块头——顶部注释亦含 .light/:root, 字样，indexOf 切片会得到空串假红）', () => {
    const css = readFileSync(path.resolve(__dirname, '../../../../../index.css'), 'utf-8');
    const darkStart = css.search(/:root,\s*\.dark\s*\{/);
    const lightStart = css.search(/\.light\s*\{/);
    expect(darkStart).toBeGreaterThan(-1);
    expect(lightStart).toBeGreaterThan(darkStart); // 源序约束（D8）
    const darkBlock = css.slice(darkStart, lightStart);
    // 上界锚下一个块头（几何 :root {）——勿用 indexOf('}', lightStart+5000)：+5000 偏移处找 } 会命中更靠后的 } → start>end → 空串假红
    const lightBlock = css.slice(lightStart, css.indexOf(':root {', lightStart));
    expect(darkBlock).toContain('--canvas-run-btn-bg: rgb(145, 145, 145)');
    expect(darkBlock).toContain('--canvas-run-btn-icon: #141414');
    expect(lightBlock).toContain('--canvas-run-btn-bg: rgb(135, 135, 135)');
    expect(lightBlock).toContain('--canvas-run-btn-icon: #141414');
  });
});
