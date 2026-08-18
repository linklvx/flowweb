import { describe, it, expect } from 'vitest';
import { getCanvasGradient } from '../utils/gradient';
import { formatRelativeTime } from '../utils/time';

describe('getCanvasGradient', () => {
  it('同 id 返回相同渐变（确定性）', () => {
    expect(getCanvasGradient('abc')).toBe(getCanvasGradient('abc'));
  });
  it('不同 id 高概率返回不同渐变', () => {
    expect(getCanvasGradient('a')).not.toBe(getCanvasGradient('b'));
  });
  it('返回 HSL 双色 linear-gradient 字符串', () => {
    expect(getCanvasGradient('x')).toMatch(/^linear-gradient\(135deg, hsl\(\d+, 70%, 75%\), hsl\(\d+, 70%, 55%\)\)$/);
  });
  it('空字符串与特殊字符 id 不报错', () => {
    expect(() => getCanvasGradient('')).not.toThrow();
    expect(() => getCanvasGradient('🦠../@')).not.toThrow();
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-18T12:00:00');
  it('3 小时前', () => {
    expect(formatRelativeTime('2026-08-18T09:00:00', now)).toBe('3 小时前');
  });
  it('2 个月前', () => {
    expect(formatRelativeTime('2026-06-10T12:00:00', now)).toBe('2 个月前');
  });
});
