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
  it('fontSize 基准 1080 高：9:16（1920 高）下 style.fontSize 48 渲染为 85.33；maxWidth 按宽比例派生', () => {
    const narrow = () => 1; // 恒窄——强制逐字换行，可观测 maxWidth 语义（不必精确）
    const r = layoutSubtitleLines('测试', { fontSize: 48, color: '#fff', letterSpacing: 0 }, narrow, { width: 1080, height: 1920 });
    expect(r.fontSize).toBeCloseTo(48 * 1920 / 1080); // 85.333…（高比例）
    // lineHeight 同步高比例派生——⚠ R9-5：实现是 Math.round（既有口径）→ 119，
    // toBeCloseTo 默认精度 2 对 119.4667 必红，必须 toBe(Math.round(...))
    expect(r.lineHeight).toBe(Math.round(48 * 1.4 * 1920 / 1080));
    // maxWidth 按宽比例派生直接观测：scaleW = 1080/1920 → 有效 maxWidth 936 → 19 字/行（912 ≤ 936 < 960）
    const wrap = layoutSubtitleLines('字'.repeat(40), { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 }, measure, { width: 1080, height: 1920 });
    expect(wrap.lines[0]).toBe('字'.repeat(19));
  });
  it('缺省第四参 = 既有 1920×1080 基准（既有工程 48 语义不变——spec 5.2）', () => {
    const r = layoutSubtitleLines('a', { fontSize: 48, color: '#fff', letterSpacing: 0 }, () => 1);
    expect(r.fontSize).toBe(48); // 不传 canvasSize——基准行为逐位不变
  });
});
