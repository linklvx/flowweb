import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTrimTaskStatus } from './useTrimTaskStatus';

const mockGetTaskStatus = vi.fn();

vi.mock('@/services/video-trim.api', () => ({
  videoTrimApi: {
    getTaskStatus: (taskId: string) => mockGetTaskStatus(taskId),
  },
}));

describe('useTrimTaskStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetTaskStatus.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return idle status with null taskId (零请求)', () => {
    const { result } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, 'node-1'),
      { initialProps: { taskId: null as string | null } },
    );
    expect(result.current.status).toBe('idle');
    expect(result.current.outputFileId).toBeNull();
    expect(result.current.error).toBeNull();
    expect(mockGetTaskStatus).not.toHaveBeenCalled();
  });

  it('taskId 出现 → 立即一次 pollFn（未建 interval 先请求）+ 未终态建 3s interval（单值）', async () => {
    mockGetTaskStatus.mockResolvedValue({ status: 'processing', outputFileId: null, error: null });

    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const { result, unmount } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, 'node-1'),
      { initialProps: { taskId: 'task-1' as string | null } },
    );

    // 首请求立即发生（不靠 interval 首拍）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockGetTaskStatus).toHaveBeenCalledTimes(1);
    expect(mockGetTaskStatus).toHaveBeenCalledWith('task-1');
    expect(result.current.status).toBe('processing');

    // 未终态 → setInterval 3s 恒值（删双档——现码 socket 断 3s/socket 连 10s 双档已随批退役）
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 3000);
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 10000);

    // 3s 一拍后续轮询
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mockGetTaskStatus).toHaveBeenCalledTimes(2);

    setIntervalSpy.mockRestore();
    unmount();
  });

  it('首拍即终态 → 不再建 interval（终态不再 setInterval）', async () => {
    mockGetTaskStatus.mockResolvedValue({ status: 'done', outputFileId: 'file-1', error: null });

    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const { result, unmount } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, 'node-1'),
      { initialProps: { taskId: 'task-1' as string | null } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.status).toBe('done');
    expect(result.current.outputFileId).toBe('file-1');
    expect(setIntervalSpy).not.toHaveBeenCalled();

    // 无 interval → 后续时间流逝零新请求
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mockGetTaskStatus).toHaveBeenCalledTimes(1);

    setIntervalSpy.mockRestore();
    unmount();
  });

  it('后续一拍返回终态 → 清掉已建好的 interval（不再发新请求）', async () => {
    mockGetTaskStatus
      .mockResolvedValueOnce({ status: 'processing', outputFileId: null, error: null }) // 首请求（立即）
      .mockResolvedValueOnce({ status: 'processing', outputFileId: null, error: null }) // interval 第 1 拍
      .mockResolvedValueOnce({ status: 'done', outputFileId: 'file-1', error: null }); // interval 第 2 拍（终态）

    const { result, unmount } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, 'node-1'),
      { initialProps: { taskId: 'task-1' as string | null } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('processing');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.status).toBe('processing');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.status).toBe('done');
    expect(result.current.outputFileId).toBe('file-1');

    // interval 已被清：再走 10s 也无第 4 次请求
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mockGetTaskStatus).toHaveBeenCalledTimes(3);

    unmount();
  });

  it('error 终态同清 interval（失败不再轮询）', async () => {
    mockGetTaskStatus
      .mockResolvedValueOnce({ status: 'processing', outputFileId: null, error: null })
      .mockResolvedValue({ status: 'error', outputFileId: null, error: 'FFmpeg failed' });

    const { result, unmount } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, 'node-1'),
      { initialProps: { taskId: 'task-1' as string | null } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('FFmpeg failed');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mockGetTaskStatus).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('unmount 清 interval（卸载后零新请求）', async () => {
    mockGetTaskStatus.mockResolvedValue({ status: 'processing', outputFileId: null, error: null });

    const { unmount } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, 'node-1'),
      { initialProps: { taskId: 'task-1' as string | null } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mockGetTaskStatus).toHaveBeenCalledTimes(1);
  });

  it('taskId 变化后序号失配的迟归 resolve 不 setState（失配那一拍不覆盖新任务状态）', async () => {
    // 首 taskId 的请求慢：挂起 → 切换 taskId → 旧响应迟归
    let resolveOld!: (v: any) => void;
    const oldTaskPromise = new Promise((r) => { resolveOld = r; });
    mockGetTaskStatus.mockImplementation((id: string) =>
      id === 'task-old' ? oldTaskPromise : Promise.resolve({ status: 'processing', outputFileId: null, error: null }),
    );

    const { result, rerender } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, 'node-1'),
      { initialProps: { taskId: 'task-old' as string | null } },
    );

    // 慢请求在途 → taskId 换新（序号 +1 作废旧在途）
    rerender({ taskId: 'task-new' });

    // 新任务首请求已就位（processing）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('processing');

    // 旧任务迟归（终态 done+产物）——序号失配那一拍不得 setState
    await act(async () => {
      resolveOld({ status: 'done', outputFileId: 'stale-file', error: null });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('processing');
    expect(result.current.outputFileId).toBeNull();
  });

  it('unmount 后序号失配的迟归 resolve 不 setState（cleanup +1 作废在途）', async () => {
    let resolvePending!: (v: any) => void;
    const pending = new Promise((r) => { resolvePending = r; });
    mockGetTaskStatus.mockReturnValueOnce(pending);

    const { result, unmount } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, 'node-1'),
      { initialProps: { taskId: 'task-1' as string | null } },
    );

    unmount();

    // 迟归终态——cleanup 序号已 +1，不得写任何状态
    await act(async () => {
      resolvePending({ status: 'done', outputFileId: 'late-file', error: null });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.outputFileId).toBeNull();
  });

  it('should set error via exposed setter', () => {
    const { result, unmount } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, 'node-1'),
      { initialProps: { taskId: 'task-1' as string | null } },
    );

    act(() => {
      result.current.setError('提交失败，请重试');
    });

    expect(result.current.error).toBe('提交失败，请重试');
    expect(result.current.status).toBe('error');
    unmount();
  });

  it('should stop polling when taskId becomes null', async () => {
    mockGetTaskStatus.mockResolvedValue({ status: 'processing', outputFileId: null, error: null });

    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const { rerender, unmount } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, 'node-1'),
      { initialProps: { taskId: 'task-1' as string | null } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const callsBefore = mockGetTaskStatus.mock.calls.length;
    clearIntervalSpy.mockClear();
    rerender({ taskId: null });

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(clearIntervalSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mockGetTaskStatus.mock.calls.length).toBe(callsBefore);

    clearIntervalSpy.mockRestore();
    unmount();
  });
});
