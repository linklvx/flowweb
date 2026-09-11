// apps/web/src/pages/canvas/video-editor/export/eta.test.ts
import { describe, it, expect } from 'vitest';
import { createEtaTracker } from './eta';

describe('createEtaTracker（前 30 帧外推 + 每 500 帧滚动修正）', () => {
  it('不足 30 帧无 ETA（null）', () => {
    let now = 0;
    const t = createEtaTracker(1000, () => now);
    t.observe(0); now = 50; t.observe(10);
    expect(t.etaSec()).toBeNull();
  });
  it('第 30 帧（index 29）首次外推：10fps → 剩 970 帧 = 97.0s', () => {
    let now = 0;
    const t = createEtaTracker(1000, () => now);
    t.observe(0);
    now = 2900; // 29 帧 2.9s → 10 帧/s
    t.observe(29);
    expect(t.etaSec()).toBeCloseTo(970 / 10, 1); // (1000-1-29)/10 = 97.0
  });
  it('每 500 帧滚动修正：速率骤升 → ETA 随最新窗口下降', () => {
    let now = 0;
    const t = createEtaTracker(10000, () => now);
    t.observe(0);
    now = 2900; t.observe(29);        // 首 30 帧 2.9s → 10fps → eta1 = 9970 帧 / 10fps = 997s
    const eta1 = t.etaSec()!;
    now += 500_000; t.observe(5499);  // 滚动窗 5470 帧 / 500s ≈ 10.94fps → eta2 = 4500/10.94 ≈ 411.5s
    const eta2 = t.etaSec()!;
    now += 100; t.observe(9999);      // 滚动窗 4500 帧 / 0.1s → 速率极快 → eta3 = 0
    const eta3 = t.etaSec()!;
    expect(eta1).toBeCloseTo(997, 0);
    expect(eta2).toBeGreaterThan(300);
    expect(eta3).toBeLessThan(eta2);
    expect(eta3).toBe(0);
  });
});
