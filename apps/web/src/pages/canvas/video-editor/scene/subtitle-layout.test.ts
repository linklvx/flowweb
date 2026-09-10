import { describe, it, expect } from 'vitest';
import { layoutSubtitleLines, SUBTITLE_SPEC } from './subtitle-layout';

/** 假 measure：每汉字 48px（fontSize=48 时 1 字 48px），ASCII 半宽 24px——可控换行断言 */
const measure = (s: string, _font: string) =>
  [...s].reduce((w, ch) => w + (/[一-鿿]/.test(ch) ? 48 : 24), 0);

describe('layoutSubtitleLines（1920×1080 基准，measure 注入）', () => {
  it('短文本单行原样', () => {
    const r = layoutSubtitleLines('你好', { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 }, measure);
    expect(r.lines).toEqual(['你好']);
    expect(r.lineHeight).toBe(Math.round(48 * 1.4));
  });
  it('超过 1664px 自动换行（34.6 汉字 → 34 字一行）', () => {
    const text = '字'.repeat(40); // 40×48=1920 > 1664 → 34 字（1632px）后换行
    const r = layoutSubtitleLines(text, { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 }, measure);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toBe('字'.repeat(34));
    expect(r.lines[1]).toBe('字'.repeat(6));
  });
  it('显式换行符保留（\n 分段各自再换行）', () => {
    const r = layoutSubtitleLines('你好\n世界', { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 }, measure);
    expect(r.lines).toEqual(['你好', '世界']);
  });
  it('超长截断：最多 2 行，第 2 行按 maxWidth 切（决策 12）', () => {
    const text = '字'.repeat(100);
    const r = layoutSubtitleLines(text, { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 }, measure);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toBe('字'.repeat(34));
    expect(measure(r.lines[1], '')).toBeLessThanOrEqual(SUBTITLE_SPEC.maxWidth);
    expect(r.lines[1].length + r.lines[0].length).toBeLessThan(100); // 有截断
  });
  it('空文本 → 单空行（绘制端跳过）', () => {
    const r = layoutSubtitleLines('', { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 }, measure);
    expect(r.lines).toEqual(['']);
  });
});
