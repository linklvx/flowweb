// useStitchTask.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStitchTask } from './useStitchTask';
import { useCanvasStore } from '@/stores/canvasStore';

vi.mock('@/api/client', () => ({ apiFetch: vi.fn() }));

describe('useStitchTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null });
  });

  it('轮询单通道：先请求一次→5s interval 后续；COMPLETED 生成产物节点', async () => {
    const { apiFetch } = await import('@/api/client');
    (apiFetch as any)
      .mockResolvedValueOnce({ taskId: 't1' })                       // POST stitch
      .mockResolvedValueOnce({ status: 'PENDING' })                  // 首请求（立即——start() 起算）
      .mockResolvedValueOnce({ status: 'COMPLETED', fileId: 'out1', width: 2048, height: 1026 }); // 5s 第 1 拍
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useStitchTask('p1'));
      let promise: Promise<{ outcome: string; failedCount?: number }> | undefined;
      act(() => { promise = result.current.start({ fileIds: ['f1', 'f2', 'f3', 'f4'], gridRows: 2, gridCols: 2,
        aspectRatio: '16:9', showIndex: false, resolution: '2K' }); });

      // 首请求立即发出（不靠 interval 首拍——apiFetch 已消费 PENDING 档）
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect((apiFetch as any).mock.calls.filter((c: any[]) => String(c[0]).includes('/stitch/')).length).toBeGreaterThanOrEqual(1);

      // 5s 一拍命中 COMPLETED（总耗时 5s——首枪消掉旧 10s 等待窗）
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      const { outcome } = await promise!;
      expect(outcome).toBe('COMPLETED');
      expect(useCanvasStore.getState().nodes.some((n) => (n.data as any).fileId === 'out1')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('先请求一次即 COMPLETED → 清掉 5s interval（无第二次状态请求）', async () => {
    const { apiFetch } = await import('@/api/client');
    (apiFetch as any)
      .mockResolvedValueOnce({ taskId: 't1' })                        // POST stitch
      .mockResolvedValueOnce({ status: 'COMPLETED', fileId: 'out1', width: 100, height: 50 }); // 首请求即终态
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useStitchTask('p1'));
      let promise: Promise<{ outcome: string; failedCount?: number }> | undefined;
      act(() => { promise = result.current.start({ fileIds: ['f1', 'f2'], gridRows: 1, gridCols: 2,
        aspectRatio: '16:9', showIndex: false, resolution: '2K' }); });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const { outcome } = await promise!;
      expect(outcome).toBe('COMPLETED');
      expect(useCanvasStore.getState().nodes.filter((n) => (n.data as any).fileId === 'out1')).toHaveLength(1);

      // interval 已被 settle 清掉：再走 15s 零新状态请求
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      const statusCalls = (apiFetch as any).mock.calls.filter((c: any[]) => String(c[0]).includes('/stitch/'));
      expect(statusCalls.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('65s 超时（从 start() 起算）→ outcome TIMEOUT', async () => {
    const { apiFetch } = await import('@/api/client');
    (apiFetch as any)
      .mockResolvedValueOnce({ taskId: 't1' })                       // POST stitch
      .mockResolvedValue({ status: 'PENDING' });                    // 每次状态请求都 PENDING
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useStitchTask('p1'));
      let promise: Promise<{ outcome: string; failedCount?: number }> | undefined;
      act(() => { promise = result.current.start({ fileIds: ['f1', 'f2'], gridRows: 1, gridCols: 2,
        aspectRatio: '16:9', showIndex: false, resolution: '2K' }); });

      // 首请求（t=0）+ 12 拍 5s 轮询后到 65s 超时线
      await act(async () => {
        await vi.advanceTimersByTimeAsync(65_000);
      });
      const { outcome } = await promise!;
      expect(outcome).toBe('TIMEOUT');
      expect(useCanvasStore.getState().nodes).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('超时结算后迟到 COMPLETED → done 锁：不再 spawnResultNode（零产物节点）', async () => {
    const { apiFetch } = await import('@/api/client');
    // 阶段一：全 PENDING（首拍 t=0 + t=5s..60s 共 12 拍）
    (apiFetch as any).mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/stitch') && !u.includes('/stitch/')) return { taskId: 't1' }; // POST stitch
      return { status: 'PENDING' };
    });
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useStitchTask('p1'));
      let promise: Promise<{ outcome: string; failedCount?: number }> | undefined;
      act(() => { promise = result.current.start({ fileIds: ['f1', 'f2'], gridRows: 1, gridCols: 2,
        aspectRatio: '16:9', showIndex: false, resolution: '2K' }); });

      // 走到 64s（t=60s 拍已 PENDING；65s 线未到）
      await act(async () => {
        await vi.advanceTimersByTimeAsync(64_000);
      });
      // 阶段二：此后一切状态请求=迟到 COMPLETED（模拟超时后服务端结果才落库）
      (apiFetch as any).mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('/stitch') && !u.includes('/stitch/')) return { taskId: 't1' };
        return { status: 'COMPLETED', fileId: 'late-out', width: 100, height: 50 };
      });
      // 冲过 65s 超时线 → TIMEOUT 结算
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      const { outcome } = await promise!;
      expect(outcome).toBe('TIMEOUT');
      expect(useCanvasStore.getState().nodes.filter((n) => (n.data as any).fileId === 'late-out')).toHaveLength(0);

      // 迟到 COMPLETED 窗口：结算已冻结——零新请求、零 spawn（done 锁+timers 已清）
      const callsAfterSettle = (apiFetch as any).mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect((apiFetch as any).mock.calls.length).toBe(callsAfterSettle);
      expect(useCanvasStore.getState().nodes.filter((n) => (n.data as any).fileId === 'late-out')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('65s 线内在途挂起请求、超时结算后迟归 COMPLETED → done 锁早退（checkStatus 不再 settle/spawn）', async () => {
    const { apiFetch } = await import('@/api/client');
    // t=0 首拍 + t=5..55s 11 拍全 PENDING；t=60s 第 13 拍发出后挂起在途——恰跨 65s 超时线
    let resolveLate!: (v: any) => void;
    let statusCalls = 0;
    (apiFetch as any).mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/stitch') && !u.includes('/stitch/')) return { taskId: 't1' }; // POST stitch
      statusCalls += 1;
      if (statusCalls === 13) {
        // t=60s 拍：挂起在途（迟归响应载体——与 useTrimTaskStatus 序号锁用例同款 deferred 形态）
        return new Promise((res) => { resolveLate = res; });
      }
      return { status: 'PENDING' };
    });
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useStitchTask('p1'));
      let promise: Promise<{ outcome: string; failedCount?: number }> | undefined;
      act(() => { promise = result.current.start({ fileIds: ['f1', 'f2'], gridRows: 1, gridCols: 2,
        aspectRatio: '16:9', showIndex: false, resolution: '2K' }); });

      // 到 60s：第 13 拍已发出并挂起在途
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(statusCalls).toBe(13);

      // 冲 65s 超时线 → TIMEOUT 结算（在途请求仍挂起——settle 的 clearInterval 杀后续拍、不杀在途）
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      const { outcome } = await promise!;
      expect(outcome).toBe('TIMEOUT');
      expect(useCanvasStore.getState().nodes.filter((n) => (n.data as any).fileId === 'late-out')).toHaveLength(0);

      // 在途请求迟归 COMPLETED——done 锁已关（checkStatus :75 早退），不得再 settle/spawnResultNode
      const callsAfterSettle = (apiFetch as any).mock.calls.length;
      await act(async () => {
        resolveLate({ status: 'COMPLETED', fileId: 'late-out', width: 100, height: 50 });
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(useCanvasStore.getState().nodes.filter((n) => (n.data as any).fileId === 'late-out')).toHaveLength(0);
      expect((apiFetch as any).mock.calls.length).toBe(callsAfterSettle);
    } finally {
      vi.useRealTimers();
    }
  });
});
