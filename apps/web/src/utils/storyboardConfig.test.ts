// apps/web/src/utils/storyboardConfig.test.ts
import { describe, it, expect } from 'vitest';
import { resolveStoryboardConfig, hasStoryboardConfig, DEFAULT_STORYBOARD_CONFIG } from './storyboardConfig';
import { ASPECT_RATIOS } from '@/types/group';

describe('resolveStoryboardConfig（F2——缺省/非法字段全兜底，渲染与 store 共用）', () => {
  it('data 无 storyboard → DEFAULT（16:9/1×1/false/2K）', () => {
    expect(resolveStoryboardConfig({})).toEqual(DEFAULT_STORYBOARD_CONFIG);
    expect(resolveStoryboardConfig(undefined)).toEqual(DEFAULT_STORYBOARD_CONFIG);
    expect(resolveStoryboardConfig({ storyboard: null })).toEqual(DEFAULT_STORYBOARD_CONFIG);
  });

  it('合法配置透传', () => {
    const cfg = { aspectRatio: '9:16', gridRows: 2, gridCols: 3, showIndex: true, stitchResolution: '4K' };
    expect(resolveStoryboardConfig({ storyboard: cfg })).toEqual(cfg);
  });

  it('非法 aspectRatio → 16:9；非法 resolution → 2K', () => {
    const out = resolveStoryboardConfig({ storyboard: { aspectRatio: 'bogus', stitchResolution: '8K' } });
    expect(out.aspectRatio).toBe('16:9');
    expect(out.stitchResolution).toBe('2K');
  });

  it('gridRows/gridCols 越界/非数值钳制 1~10（与服务端校验同口径）', () => {
    expect(resolveStoryboardConfig({ storyboard: { gridRows: 0 } }).gridRows).toBe(1);
    expect(resolveStoryboardConfig({ storyboard: { gridRows: 99 } }).gridRows).toBe(10);
    expect(resolveStoryboardConfig({ storyboard: { gridRows: 'x' as any } }).gridRows).toBe(1);
  });

  it('部分字段缺省逐字段兜底（merge 语义非全有全无）', () => {
    const out = resolveStoryboardConfig({ storyboard: { gridRows: 3, showIndex: 'yes' as any } });
    expect(out.gridRows).toBe(3);
    expect(out.gridCols).toBe(1);
    expect(out.showIndex).toBe(false);
  });
});

describe('hasStoryboardConfig（守卫型消费点⑧用——显式提示而非静默默认）', () => {
  it('有真实配置 true；缺失/null/非对象 false', () => {
    expect(hasStoryboardConfig({ storyboard: { gridRows: 1 } })).toBe(true);
    expect(hasStoryboardConfig({})).toBe(false);
    expect(hasStoryboardConfig({ storyboard: null })).toBe(false);
    expect(hasStoryboardConfig(undefined)).toBe(false);
  });
});

describe('ASPECT_RATIOS 单源（types/group.ts）', () => {
  it('与 resolver 枚举一致（6 比例）', () => {
    expect(ASPECT_RATIOS).toHaveLength(6);
  });
});
