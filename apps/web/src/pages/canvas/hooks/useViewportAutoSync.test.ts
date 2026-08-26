// apps/web/src/pages/canvas/hooks/useViewportAutoSync.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/api/projectApi', () => ({
  updateViewport: vi.fn().mockResolvedValue(undefined),
}));

import { updateViewport } from '@/api/projectApi';
import { useCanvasStore } from '@/stores/canvasStore';
import { useViewportAutoSync } from './useViewportAutoSync';

describe('useViewportAutoSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useCanvasStore.setState({ projectId: 'p1', viewport: { x: 10, y: 20, zoom: 1.5 } });
    vi.mocked(updateViewport).mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('onMoveEnd 1s debounce 后 PUT viewport', async () => {
    const { result } = renderHook(() => useViewportAutoSync());
    act(() => { result.current.onMoveEnd(); });
    act(() => { result.current.onMoveEnd(); });
    expect(updateViewport).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(updateViewport).toHaveBeenCalledTimes(1);
    expect(updateViewport).toHaveBeenCalledWith('p1', { x: 10, y: 20, zoom: 1.5 });
  });

  it('无 projectId 不发', async () => {
    useCanvasStore.setState({ projectId: null });
    const { result } = renderHook(() => useViewportAutoSync());
    act(() => { result.current.onMoveEnd(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(updateViewport).not.toHaveBeenCalled();
  });

  it('窗口内切换项目：不把旧项目 viewport 写到新项目（H-1 同款守卫）', async () => {
    const { result } = renderHook(() => useViewportAutoSync());
    act(() => { result.current.onMoveEnd(); });
    useCanvasStore.setState({ projectId: 'p2' });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(updateViewport).not.toHaveBeenCalled();
  });

  it('isHydrating 窗口内定时器触发不发送', async () => {
    const { result } = renderHook(() => useViewportAutoSync());
    act(() => { result.current.onMoveEnd(); });
    useCanvasStore.setState({ isHydrating: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(updateViewport).not.toHaveBeenCalled();
  });
});
