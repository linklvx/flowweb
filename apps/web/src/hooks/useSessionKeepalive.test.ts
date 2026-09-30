import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSessionKeepalive, SESSION_KEEPALIVE_MS } from './useSessionKeepalive';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();   // document.hidden spy 复位（防跨用例泄漏跳过后续探活）
});

describe('useSessionKeepalive——画布页 15min 静默 me 探活（批3-3 F8）', () => {
  it('每 15min 静默 fetch /api/auth/me（credentials: include）', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = renderHook(() => useSessionKeepalive());

    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ credentials: 'include' }));

    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('document.hidden → 跳过（setInterval unref 的浏览器等价物：页面不可见不产生流量）', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const { unmount } = renderHook(() => useSessionKeepalive());

    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_MS * 3);
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
  });

  it('卸载清（unmount 后定时器不再触发）', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = renderHook(() => useSessionKeepalive());
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_MS * 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetch reject → 吞掉不炸（静默探活，失败不产生 unhandled rejection）', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { unmount } = renderHook(() => useSessionKeepalive());
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_MS);
    // 到达此处且无未捕获异常即通过（reject 被 .catch 吞）
    unmount();
  });

  it('周期常量 = 15min（防误调）', () => {
    expect(SESSION_KEEPALIVE_MS).toBe(15 * 60 * 1000);
  });
});
