import { describe, it, expect, vi } from 'vitest';
import { closeCollabListener } from './collab-listener';

describe('TD-32/C2 T17：closeCollabListener（listener 让位单源）', () => {
  it('closeAllConnections（存在时）+close；close 回调到达即 resolve', async () => {
    const order: string[] = [];
    let closeCb: (() => void) | null = null;
    const server = {
      closeAllConnections: () => order.push('closeAllConnections'),
      close: (cb: () => void) => { order.push('close'); closeCb = cb; },
    };
    const p = closeCollabListener(server);
    expect(order).toEqual(['closeAllConnections', 'close']);
    closeCb!();
    await expect(p).resolves.toBeUndefined();
  });

  it('close 同步抛错→onError 收到+仍 resolve（不让位失败不得悬挂）', async () => {
    const onError = vi.fn();
    const server = {
      close: () => { throw new Error('close boom'); },
    };
    await expect(closeCollabListener(server, onError)).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('undefined listener=立即 resolve（幂等防线）', async () => {
    await expect(closeCollabListener(undefined)).resolves.toBeUndefined();
  });

  it('close 回调不来→2s 兜底 resolve', async () => {
    vi.useFakeTimers();
    try {
      const p = closeCollabListener({ close: () => {} });
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(p).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
