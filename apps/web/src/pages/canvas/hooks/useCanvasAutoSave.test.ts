import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/stores/canvasSyncRuntime', () => ({
  bindCanvasSync: vi.fn(() => vi.fn()),
  flushOnUnload: vi.fn(),
  flushCanvasSync: vi.fn().mockResolvedValue(undefined),
}));

import { bindCanvasSync, flushOnUnload, flushCanvasSync } from '@/stores/canvasSyncRuntime';
import { useCanvasAutoSave } from './useCanvasAutoSave';

describe('useCanvasAutoSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(bindCanvasSync).mockReturnValue(vi.fn());
  });

  it('projectId 非空时绑定订阅 + pagehide 监听', () => {
    const { unmount } = renderHook(() => useCanvasAutoSave('p1'));
    expect(bindCanvasSync).toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
    expect(flushOnUnload).toHaveBeenCalled();
    unmount();
  });

  it('projectId 为 null 不绑定', () => {
    const { unmount } = renderHook(() => useCanvasAutoSave(null));
    expect(bindCanvasSync).not.toHaveBeenCalled();
    unmount();
  });

  it('卸载：解绑订阅与监听，不触发 flush（项目切换 cleanup 时 store 已被新项目数据污染，flush 会跨项目脏写）', () => {
    const unbind = vi.fn();
    vi.mocked(bindCanvasSync).mockReturnValue(unbind);
    const { unmount } = renderHook(() => useCanvasAutoSave('p1'));
    unmount();
    expect(unbind).toHaveBeenCalled();
    expect(flushCanvasSync).not.toHaveBeenCalled();
  });
});
