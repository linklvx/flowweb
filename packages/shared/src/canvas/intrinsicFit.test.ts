// packages/shared/src/canvas/intrinsicFit.test.ts
// T17 红测（spec Z5''/G56）：applyIntrinsicFit 纯函数——EXIF 5-8 display 契约交换/imageRotation
// 用户变换交换（二次旋转红）/分镜跳过/sizeMode fixed/clamp/沿用档。
import { describe, it, expect } from 'vitest';
import { applyIntrinsicFit } from './intrinsicFit';

const BOUNDS = { maxW: 1200, maxH: 900, minW: 120, minH: 80 };

describe('applyIntrinsicFit（Z5 纯函数）', () => {
  it('G56 二次旋转红：imageRotation 90 ⇒ 有效尺寸转置（旋转后盒=转置足迹，不回弹未旋尺寸）', () => {
    const r0 = applyIntrinsicFit({ natural: { width: 800, height: 400 }, imageRotation: 0, bounds: BOUNDS });
    const r90 = applyIntrinsicFit({ natural: { width: 800, height: 400 }, imageRotation: 90, bounds: BOUNDS });
    expect(r0.size.width).toBeGreaterThan(r0.size.height);
    expect(r90.size.height).toBeGreaterThan(r90.size.width);   // 90° ⇒ 转置
    expect(r90.aspectRatio).toBeCloseTo(400 / 800, 2);
    const r180 = applyIntrinsicFit({ natural: { width: 800, height: 400 }, imageRotation: 180, bounds: BOUNDS });
    expect(r180.size).toEqual(r0.size);                          // 180° 不交换
  });

  it('旋转落地窗：现盒=未旋形态 ∧ rotation 90 ⇒ contain-fit 到旋转后比例（changed=true）', () => {
    const r = applyIntrinsicFit({
      currentWH: { width: 800, height: 400 },        // 未旋盒
      natural: { width: 800, height: 400 },
      imageRotation: 90,
      bounds: BOUNDS,
    });
    expect(r.changed).toBe(true);
    expect(r.size.height).toBeGreaterThan(r.size.width);
  });

  it('EXIF 5-8（display 契约）：natural/display 互为转置 ⇒ 取 display 形态（禁二次交换）', () => {
    const r = applyIntrinsicFit({
      natural: { width: 1000, height: 400 },          // 存储横图
      display: { width: 400, height: 1000 },          // 浏览器已应用 EXIF 5-8（显示竖图）
      bounds: BOUNDS,
    });
    expect(r.aspectRatio).toBeCloseTo(400 / 1000, 2); // 有效=display 竖形态
  });

  it('store 数据源优先：仅 natural（无 display）直用；双缺席=沿用档零写', () => {
    const r = applyIntrinsicFit({ natural: { width: 600, height: 300 }, bounds: BOUNDS });
    expect(r.size.width / r.size.height).toBeCloseTo(2, 2);
    const keep = applyIntrinsicFit({ currentWH: { width: 500, height: 250 }, bounds: BOUNDS });
    expect(keep.changed).toBe(false);
    expect(keep.size).toEqual({ width: 500, height: 250 });
  });

  it('分镜跳过：零尺寸写（changed=false——分镜子尺寸=格域权威）', () => {
    const r = applyIntrinsicFit({
      currentWH: { width: 320, height: 180 },
      natural: { width: 4000, height: 10 },
      isStoryboardChild: true,
      bounds: BOUNDS,
    });
    expect(r.changed).toBe(false);
    expect(r.size).toEqual({ width: 320, height: 180 });
  });

  it('sizeMode fixed：作者手改档零覆盖（changed=false）；auto（缺省）照常', () => {
    const fixed = applyIntrinsicFit({
      currentWH: { width: 320, height: 180 }, natural: { width: 4000, height: 3000 },
      sizeMode: 'fixed', bounds: BOUNDS,
    });
    expect(fixed.changed).toBe(false);
    const auto = applyIntrinsicFit({
      currentWH: { width: 320, height: 180 }, natural: { width: 4000, height: 3000 },
      existingAspectRatio: 4000 / 3000,
      bounds: BOUNDS,
    });
    expect(auto.changed).toBe(false);   // 比例未漂（≈1.33 与立档一致）⇒ 沿用（非 fixed 也零写）
  });

  it('clamp：超大 natural 收进滚动约束框（ceil 单源）；冷启动必写', () => {
    const r = applyIntrinsicFit({ natural: { width: 4000, height: 3000 }, bounds: BOUNDS });
    expect(r.changed).toBe(true);
    expect(r.size.width).toBeLessThanOrEqual(BOUNDS.maxW);
    expect(r.size.height).toBeLessThanOrEqual(BOUNDS.maxH);
  });

  it('比例漂移（同 contentEventSize 族）：existingAspectRatio 漂 ⇒ adaptToFit 重算', () => {
    const r = applyIntrinsicFit({
      currentWH: { width: 600, height: 300 }, natural: { width: 300, height: 600 },
      existingAspectRatio: 2, bounds: BOUNDS,
    });
    expect(r.changed).toBe(true);
    expect(r.size.height).toBeGreaterThan(r.size.width);   // contain-fit 到竖比例
  });
});
