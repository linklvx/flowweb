import { describe, it, expect } from 'vitest';
import { formatDateTime } from '../utils/time';

describe('formatDateTime', () => {
  it('输出 YYYY-MM-DD HH:mm（无时区转换，秒截断）', () => {
    expect(formatDateTime('2026-09-01T20:54:30')).toBe('2026-09-01 20:54');
  });

  it('ISO 带 Z 后缀同样按本地时刻格式化', () => {
    expect(formatDateTime('2026-08-18T09:00:00')).toBe('2026-08-18 09:00');
  });
});
