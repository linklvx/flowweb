// useStitchTask.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStitchTask } from './useStitchTask';
import { useCanvasStore } from '@/stores/canvasStore';
import { useGroupHistory } from '@/stores/groupHistory';

vi.mock('@/api/client', () => ({ apiFetch: vi.fn() }));
// P2-1：useSocket 返回 ref 形态；组件外直接调 hook 会抛 Invalid hook call，须 mock + renderHook
vi.mock('@/hooks/useSocket', () => ({ useSocket: () => ({ current: null }) }));

describe('useStitchTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null });
    useGroupHistory.getState().clear();
  });

  it('轮询兜底：Socket 未达时 GET 状态完成后生成产物节点 + 注册撤销项', async () => {
    const { apiFetch } = await import('@/api/client');
    (apiFetch as any)
      .mockResolvedValueOnce({ taskId: 't1' })                       // POST stitch
      .mockResolvedValueOnce({ status: 'PENDING' })                   // poll 1（t=5s）
      .mockResolvedValueOnce({ status: 'COMPLETED', fileId: 'out1', width: 2048, height: 1026 }); // poll 2（t=10s）
    // P2-新6：真实等待第二次轮询 ≥10s > Vitest 默认 5s 超时——必须 fake timers
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useStitchTask('p1'));
      let promise: Promise<string> | undefined;
      act(() => { promise = result.current.start({ fileIds: ['f1', 'f2', 'f3', 'f4'], gridRows: 2, gridCols: 2,
        aspectRatio: '16:9', showIndex: false, resolution: '2K' }); });
      await vi.advanceTimersByTimeAsync(10_500); // 触发两次轮询并 flush 异步回调（65s 超时不会触发）
      const outcome = await promise!;
      expect(outcome).toBe('COMPLETED');
      expect(useCanvasStore.getState().nodes.some((n) => (n.data as any).fileId === 'out1')).toBe(true);
      expect(useGroupHistory.getState().canUndo()).toBe(true); // 撤销项已注册

      // P1-新4 回归：undo 必须删除产物节点（before 为 tombstone，非覆盖恢复）
      act(() => { useGroupHistory.getState().undo(); });
      expect(useCanvasStore.getState().nodes.some((n) => (n.data as any).fileId === 'out1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
