// TD-33/C1b T14：擦除双 timer runtime 单测——10s refresh/60s sweep、tick 守卫、stop 幂等。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CollabErasureRuntime, resolveErasureRefreshMs, ERASURE_REFRESH_DEFAULT_MS, ERASURE_REFRESH_MAX_MS, PURGE_SWEEP_INTERVAL_MS } from './collab-erasure-runtime';

afterEach(() => { vi.useRealTimers(); });

const mk = (allowedRef: { v: boolean }) => {
  const source = { refresh: vi.fn(async () => {}) };
  const spool = { sweepPurgeableSpoolLive: vi.fn(async () => {}) };
  const rt = new CollabErasureRuntime(source as never, spool as never, () => allowedRef.v, 1_000);
  return { rt, source, spool };
};

describe('TD-33 T14：CollabErasureRuntime', () => {
  it('refresh 按周期触发、sweep 按 60s 触发；allowed=false 时零调用；stop 后全停', async () => {
    vi.useFakeTimers();
    const allowed = { v: true };
    const { rt, source, spool } = mk(allowed);
    rt.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(source.refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PURGE_SWEEP_INTERVAL_MS);
    expect(spool.sweepPurgeableSpoolLive).toHaveBeenCalledTimes(1);
    allowed.v = false;   // drain/非 serving 期 tick 守卫
    await vi.advanceTimersByTimeAsync(PURGE_SWEEP_INTERVAL_MS * 2);
    const r = source.refresh.mock.calls.length;
    const s = spool.sweepPurgeableSpoolLive.mock.calls.length;
    rt.stop();
    await vi.advanceTimersByTimeAsync(PURGE_SWEEP_INTERVAL_MS * 2);
    expect(source.refresh.mock.calls.length).toBe(r);   // stop 后不增
    expect(spool.sweepPurgeableSpoolLive.mock.calls.length).toBe(s);
    expect(rt.running()).toBe(false);
  });

  it('refresh 周期解析：缺省 10s/非法回缺省/上限 60s', () => {
    expect(resolveErasureRefreshMs(undefined)).toBe(ERASURE_REFRESH_DEFAULT_MS);
    expect(resolveErasureRefreshMs('2500')).toBe(2_500);
    expect(resolveErasureRefreshMs('600000')).toBe(ERASURE_REFRESH_MAX_MS);
    expect(resolveErasureRefreshMs('0')).toBe(ERASURE_REFRESH_DEFAULT_MS);
    expect(resolveErasureRefreshMs('abc')).toBe(ERASURE_REFRESH_DEFAULT_MS);
  });
});
