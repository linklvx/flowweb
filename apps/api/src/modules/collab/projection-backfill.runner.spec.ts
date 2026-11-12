// apps/api/src/modules/collab/projection-backfill.runner.spec.ts
// C3a-8 质量收口 I-4：指数退避纯函数（增长/cap/jitter——确定性 rand 注入）。
import { describe, it, expect, vi } from 'vitest';
import {
  BACKFILL_BACKOFF_BASE_MS,
  BACKFILL_BACKOFF_MAX_MS,
  ProjectionBackfillRunner,
  backfillBackoffMs,
} from './projection-backfill.runner';
import { mediaBindingBackfillRemaining } from './media-binding.metrics';

const mid = () => 0.5;   // jitter 中性（×1.0）

describe('C3a-8 I-4：backfillBackoffMs 指数退避', () => {
  it('增长：30s→60s→120s→240s→480s（attempts 0..4）', () => {
    expect(backfillBackoffMs(0, mid)).toBe(30_000);
    expect(backfillBackoffMs(1, mid)).toBe(60_000);
    expect(backfillBackoffMs(2, mid)).toBe(120_000);
    expect(backfillBackoffMs(3, mid)).toBe(240_000);
    expect(backfillBackoffMs(4, mid)).toBe(480_000);
  });

  it('cap：attempts≥5 封顶 10min（含深指数不溢出）', () => {
    expect(backfillBackoffMs(5, mid)).toBe(BACKFILL_BACKOFF_MAX_MS);
    expect(backfillBackoffMs(6, mid)).toBe(BACKFILL_BACKOFF_MAX_MS);
    expect(backfillBackoffMs(64, mid)).toBe(BACKFILL_BACKOFF_MAX_MS);
    expect(backfillBackoffMs(BACKFILL_BACKOFF_BASE_MS, mid)).toBe(BACKFILL_BACKOFF_MAX_MS);   // 大数不 NaN/Infinity
  });

  it('jitter：±20%（rand 0→×0.8 / rand 1→×1.2；非法 attempts 折算 0）', () => {
    expect(backfillBackoffMs(0, () => 0)).toBe(24_000);
    expect(backfillBackoffMs(0, () => 1)).toBe(36_000);
    expect(backfillBackoffMs(1, () => 0)).toBe(48_000);
    expect(backfillBackoffMs(1, () => 1)).toBe(72_000);
    expect(backfillBackoffMs(-3, mid)).toBe(30_000);
    expect(backfillBackoffMs(Number.NaN, mid)).toBe(30_000);
  });
});


describe('C3a-8 I-3/I-3r：backfill_remaining 刷新面（枚举零 COUNT；drain 末尾收口）', () => {
  const gaugeValue = async (): Promise<number> => {
    const m = await mediaBindingBackfillRemaining.get();
    return m.values[0]?.value ?? 0;
  };

  it('枚举页本身零 COUNT（空页/有候选均只一条枚举查询）', async () => {
    const raw = vi.fn();
    const r = new ProjectionBackfillRunner({ $queryRaw: raw } as never, {} as never);
    const enumerate = () => (r as unknown as { enumeratePage(): Promise<number> }).enumeratePage();
    raw.mockResolvedValueOnce([]);
    expect(await enumerate()).toBe(0);
    expect(raw).toHaveBeenCalledTimes(1);
    raw.mockResolvedValueOnce([{ projectId: 'p1' }]);
    expect(await enumerate()).toBe(1);
    expect(raw).toHaveBeenCalledTimes(2);   // 有候选亦不 COUNT（刷新归 drain 末尾）
  });

  it('I-3r：处理拍 drain 末尾刷新——最后一拍完成后 gauge=0（变异删刷新=红）', async () => {
    const raw = vi.fn()
      .mockResolvedValueOnce([{ lifecycleState: 'ACTIVE' }])   // readLifecycleState
      .mockResolvedValueOnce([{ n: 0n }]);                     // drain 末尾 countCandidates
    const prisma = {
      $queryRaw: raw,
      projectionBackfillState: { upsert: vi.fn(async () => ({})) },
    };
    const rebuild = {
      snapshotAnchor: vi.fn(async () => null),
      rebuildProjectBindings: vi.fn(async () => ({ outcome: 'cleared', pgSeq: 0n })),
    };
    const r = new ProjectionBackfillRunner(prisma as never, rebuild as never);
    (r as unknown as { queue: Set<string> }).queue.add('p1');
    mediaBindingBackfillRemaining.set(5);   // 残留非零前置
    expect(await r.drain()).toBe(1);
    expect(raw).toHaveBeenCalledTimes(2);   // lifecycle + drain 末尾 COUNT
    expect(await gaugeValue()).toBe(0);     // 完成后不滞留非零
  });
});
