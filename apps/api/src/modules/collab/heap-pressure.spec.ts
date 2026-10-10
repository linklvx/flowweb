// apps/api/src/modules/collab/heap-pressure.spec.ts
// Y0b-3 T4（spec §3.2）：heap 压力谓词单源 util——两量纲各管一种死法（V8 比例管 GC 螺旋、
// RSS 项管原生膨胀）+独立迟滞布尔（trip 需 2 连续采样/release 单次）+fail-open（测量失败放行）。
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_RSS_TRIP_BYTES, DEFAULT_RSS_RELEASE_BYTES, resetHeapPressure, measureHeapPressure, stubHeapMeasure, releaseHook } from './heap-pressure';

const MiB = 1024 * 1024;

describe('Y0b-3 T4 heap 压力谓词（单源 util——禁第二套）', () => {
  beforeEach(() => resetHeapPressure());

  it('默认常量标定：trip 750MiB / release 600MiB（check-ecosystem 提取锚=本文件字面量）', () => {
    expect(DEFAULT_RSS_TRIP_BYTES).toBe(786_432_000);
    expect(DEFAULT_RSS_RELEASE_BYTES).toBe(629_145_600);
  });

  it('V8 比例管 GC 螺旋、RSS 项管原生膨胀——两项各管一种死法，量纲不混（RSS 已含 external，V8 比例禁再并 arrayBuffers）', () => {
    stubHeapMeasure({ heapUsed: 0.9 * 1e9, heapLimit: 1e9, rss: 100 * MiB });
    expect(measureHeapPressure().ratio).toBeCloseTo(0.9); // heap 项主导
    stubHeapMeasure({ heapUsed: 0.1 * 1e9, heapLimit: 1e9, rss: 800 * MiB }); // trip=750MiB
    expect(measureHeapPressure().ratio).toBeGreaterThan(1); // rss 项主导（800/750>1）
  });

  it('迟滞（两量纲各自独立布尔——RELEASE_BYTES 真正进运行时）：tripped = heapRatio>=0.8 || rss>=750MiB；released = heapRatio<0.7 && rss<600MiB', () => {
    stubHeapMeasure({ heapUsed: 0.85e9, heapLimit: 1e9, rss: 100 * MiB }); // heap 项 trip 触发
    expect(measureHeapPressure().tripped).toBe(false); // 第 1 采样未 trip（2 连续才 trip）
    expect(measureHeapPressure().tripped).toBe(true);
    stubHeapMeasure({ heapUsed: 0.6e9, heapLimit: 1e9, rss: 700 * MiB }); // heap 已回落但 rss ∈ (600,750)
    expect(measureHeapPressure().tripped).toBe(true);   // 迟滞带维持（rss 未低于 600MiB 释放线）
    stubHeapMeasure({ heapUsed: 0.6e9, heapLimit: 1e9, rss: 550 * MiB }); // 两项各自低于释放线
    expect(measureHeapPressure().tripped).toBe(false);  // 释放
  });

  it('rss 项同样需 2 连续采样才 trip（量纲对称——单次毛刺不触发）', () => {
    stubHeapMeasure({ heapUsed: 0.1e9, heapLimit: 1e9, rss: 800 * MiB });
    expect(measureHeapPressure().tripped).toBe(false);
    expect(measureHeapPressure().tripped).toBe(true);
  });

  it('fail-open：测量抛错→放行（指标失败不得全站拒连）', () => {
    stubHeapMeasure(null); // 模拟抛错
    expect(measureHeapPressure().tripped).toBe(false);
  });

  it('sample 暴露 debug 口径：heapRatio 独立于 ratio（ratio=max(heapRatio, rss/TRIP_BYTES)）', () => {
    stubHeapMeasure({ heapUsed: 0.9e9, heapLimit: 1e9, rss: 300 * MiB });
    const s = measureHeapPressure();
    expect(s.heapRatio).toBeCloseTo(0.9);
    expect(s.ratio).toBeCloseTo(0.9); // max(0.9, 0.4)=0.9
    expect(s.rssBytes).toBe(300 * MiB);
    expect(s.heapUsedBytes).toBe(0.9e9);
    expect(s.heapLimitBytes).toBe(1e9);
  });

  it('releaseHook：tripped→released 翻转时返回一次性回调（gateway 接清 refusalCache——P-Q 钩子②），非翻转轮 undefined', () => {
    stubHeapMeasure({ heapUsed: 0.9e9, heapLimit: 1e9, rss: 100 * MiB });
    measureHeapPressure();
    measureHeapPressure(); // trip
    expect(releaseHook()).toBeUndefined(); // trip 侧无回调
    stubHeapMeasure({ heapUsed: 0.5e9, heapLimit: 1e9, rss: 100 * MiB }); // 双项低于释放线
    expect(measureHeapPressure().tripped).toBe(false);
    const cb = releaseHook();
    expect(cb).toBeInstanceOf(Function);
    expect(releaseHook()).toBeUndefined(); // 一次性
  });

  it('阈值参数注入（env 三键经 gateway 侧包装传纯数值——util 保持可测）', () => {
    stubHeapMeasure({ heapUsed: 0.6e9, heapLimit: 1e9, rss: 100 * MiB }); // 默认阈(0.8)下不 trip
    expect(measureHeapPressure({ tripRatio: 0.5 }).tripped).toBe(false);  // 第 1 采样 pending
    expect(measureHeapPressure({ tripRatio: 0.5 }).tripped).toBe(true);   // 2 连续才 trip
  });
});
