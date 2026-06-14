import { describe, it, expect } from 'vitest';
import { clampWithAspectRatio, adaptCustomSize } from '../resizeUtils';

describe('clampWithAspectRatio', () => {
  // ratio = width / height
  const ratio = 16 / 9; // ~1.778
  const min = 100;
  const max = 3000;

  it('should return same dimensions when within bounds', () => {
    const { w, h } = clampWithAspectRatio(1600, 900, ratio, min, max);
    expect(w).toBe(1600);
    expect(h).toBe(900);
  });

  it('should clamp width to max and scale height proportionally', () => {
    const { w, h } = clampWithAspectRatio(4000, 2250, ratio, min, max);
    expect(w).toBe(3000);
    expect(h).toBe(Math.round(3000 / ratio)); // ~1688
  });

  it('should clamp height to max and scale width proportionally', () => {
    // 9:16 portrait ratio — height exceeds max, should clamp
    const portraitRatio = 9 / 16; // ~0.5625
    const { w, h } = clampWithAspectRatio(2000, 4000, portraitRatio, min, max);
    expect(h).toBe(3000); // height clamped to max
    expect(w).toBe(Math.round(3000 * portraitRatio)); // ~1688
  });

  it('should enforce min side (hard constraint) even if it breaks max', () => {
    // 10:1 ratio, tiny size
    const r10 = 10;
    const { w, h } = clampWithAspectRatio(50, 5, r10, min, max);
    expect(h).toBe(100); // min hard constraint on height
    expect(w).toBe(1000); // proportional (exceeds max, but min is hard)
  });

  it('should handle square ratio', () => {
    const { w, h } = clampWithAspectRatio(200, 200, 1, min, max);
    expect(w).toBe(200);
    expect(h).toBe(200);
  });
});

describe('adaptCustomSize', () => {
  // adaptCustomSize does CONTAIN-fit: new content must fit ENTIRELY within customSize rect
  it('should fit by height when new ratio is wider than rect', () => {
    // customSize 1600x900 (ratio ~1.78), new ratio 1:1
    // 1600/1 = 1600 > 900 → height-constrained: keep height=900, width=900*1=900
    const result = adaptCustomSize({ width: 1600, height: 900 }, 1);
    expect(result.width).toBe(900);
    expect(result.height).toBe(900);
  });

  it('should fit by width when new ratio is taller than rect', () => {
    // customSize 400x1200 (ratio ~0.33), new ratio 16:9 (~1.78)
    // 400/1.78 = 225 ≤ 1200 → width-constrained: keep width=400, height=225
    const result = adaptCustomSize({ width: 400, height: 1200 }, 16 / 9);
    expect(result.width).toBe(400);
    expect(result.height).toBe(225);
  });
});
