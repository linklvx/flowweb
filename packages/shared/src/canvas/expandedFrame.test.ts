// packages/shared/src/canvas/expandedFrame.test.ts
// R2d-1（§4.9 改道）：展开帧单源纯函数——savedSize 密封快照档/分镜配置档/守恒档/空组堵洞档。
import { describe, it, expect } from 'vitest';
import { resolveExpandedFrame } from './expandedFrame';
import { COLLAPSED_SIZE, calcGroupBounds, calcStoryboardSize } from './geometry';
import { DEFAULT_STORYBOARD_CONFIG } from './storyboardConfig';

describe('resolveExpandedFrame（展开帧单源——签名 {data, childrenAbs, config}）', () => {
  it('有效 savedSize 优先（等价性仅 normal 组）：返回 savedSize 尺寸且无 origin（caller 保持现位——子 rect 不参与）', () => {
    const ef = resolveExpandedFrame({
      data: { groupType: 'normal', savedSize: { width: 500, height: 350 } },
      childrenAbs: [{ x: 100, y: 100, width: 100, height: 60 }],
    });
    expect(ef.width).toBe(500);
    expect(ef.height).toBe(350);
    expect('origin' in ef).toBe(false);   // 无绝对原点——展开不挪组
  });

  it('无效 savedSize 堵洞序①：storyboard（groupType 判定）→ calcStoryboardSize(resolved config)——配置是分镜框真理', () => {
    const ef = resolveExpandedFrame({
      data: { groupType: 'storyboard', savedSize: { width: 0, height: 0 } },   // 脏 savedSize 不可读（分镜不可折叠）
      config: { ...DEFAULT_STORYBOARD_CONFIG, gridRows: 1, gridCols: 2 },
    });
    expect(ef.width).toBe(calcStoryboardSize(1, 2, '16:9').width);
    expect(ef.height).toBe(calcStoryboardSize(1, 2, '16:9').height);
    expect('origin' in ef).toBe(false);
  });

  it('无效 savedSize 堵洞序②：normal → 守恒重算（childrenAbs bbox+padding——origin=绝对原点供 moveNode）', () => {
    const childrenAbs = [{ x: 105, y: 105, width: 100, height: 60 }];
    const ef = resolveExpandedFrame({ data: { groupType: 'normal' }, childrenAbs });
    expect({ width: ef.width, height: ef.height, ...ef.origin }).toEqual(calcGroupBounds(childrenAbs));
  });

  it('空组 → COLLAPSED_SIZE（不造 0×0——calcGroupBounds 空集=Infinity 垃圾）', () => {
    const ef = resolveExpandedFrame({ data: { groupType: 'normal' }, childrenAbs: [] });
    expect(ef.width).toBe(COLLAPSED_SIZE.width);
    expect(ef.height).toBe(COLLAPSED_SIZE.height);
    // 无 childrenAbs 形参（undefined）同档
    const ef2 = resolveExpandedFrame({ data: {} });
    expect(ef2.width).toBe(COLLAPSED_SIZE.width);
    expect(ef2.height).toBe(COLLAPSED_SIZE.height);
  });

  it('不可达形态（单测钉死）：savedSize 缺键/非有限/≤0/数组形态 全部落堵洞，不抛不半读', () => {
    const childrenAbs = [{ x: 0, y: 0, width: 100, height: 60 }];
    const fallthrough = (savedSize: unknown) => resolveExpandedFrame({
      data: { groupType: 'normal', savedSize } as Record<string, unknown>,
      childrenAbs,
    });
    // 缺键 → 守恒
    expect(resolveExpandedFrame({ data: { groupType: 'normal' }, childrenAbs }).width)
      .toBe(calcGroupBounds(childrenAbs).width);
    // 非有限（NaN/Infinity）/≤0 → 守恒（堵洞档不读快照）
    for (const bad of [
      { width: Number.NaN, height: 100 }, { width: Number.POSITIVE_INFINITY, height: 100 },
      { width: 0, height: 100 }, { width: -5, height: 100 }, { width: 100, height: 0 },
      { width: 100 }, { width: '100', height: 100 }, [100, 100],
    ]) {
      expect(fallthrough(bad).width).toBe(calcGroupBounds(childrenAbs).width);
    }
  });
});
