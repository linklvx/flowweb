import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTrimTaskStatus } from './useTrimTaskStatus';

const mockGetTaskStatus = vi.fn();

vi.mock('@/services/video-trim.api', () => ({
  videoTrimApi: {
    getTaskStatus: (taskId: string) => mockGetTaskStatus(taskId),
  },
}));

function createMockSocket(connected = true) {
  const listeners: Record<string, Function[]> = {};
  return {
    on: vi.fn((event: string, handler: Function) => {
      (listeners[event] ??= []).push(handler);
    }),
    off: vi.fn(),
    emit: vi.fn(),
    connected,
    _trigger: (event: string, ...args: any[]) => {
      listeners[event]?.forEach((h) => h(...args));
    },
  };
}

describe('useTrimTaskStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetTaskStatus.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return idle status with null taskId', () => {
    const socket = createMockSocket();
    const { result } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, socket as any),
      { initialProps: { taskId: null as string | null } },
    );
    expect(result.current.status).toBe('idle');
    expect(result.current.outputFileId).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should start polling with low interval (10s) when socket is connected', () => {
    const socket = createMockSocket(true);
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const { unmount } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, socket as any),
      { initialProps: { taskId: 'task-1' as string | null } },
    );
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 10000);
    setIntervalSpy.mockRestore();
    unmount();
  });

  it('should poll with high interval (3s) when socket is disconnected', () => {
    const socket = createMockSocket(false);
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const { unmount } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, socket as any),
      { initialProps: { taskId: 'task-1' as string | null } },
    );
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 3000);
    setIntervalSpy.mockRestore();
    unmount();
  });

  it('should stop polling when status becomes done', async () => {
    const socket = createMockSocket(false);
    mockGetTaskStatus.mockResolvedValue({ status: 'done', outputFileId: 'file-1', error: null });

    const { result, unmount } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, socket as any),
      { initialProps: { taskId: 'task-1' as string | null } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });

    expect(result.current.status).toBe('done');
    expect(result.current.outputFileId).toBe('file-1');
    unmount();
  });

  it('should stop polling when status becomes error', async () => {
    const socket = createMockSocket(false);
    mockGetTaskStatus.mockResolvedValue({ status: 'error', outputFileId: null, error: 'FFmpeg failed' });

    const { result, unmount } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, socket as any),
      { initialProps: { taskId: 'task-1' as string | null } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('FFmpeg failed');
    unmount();
  });

  it('should update status from socket event', () => {
    const socket = createMockSocket();
    const { result, unmount } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, socket as any),
      { initialProps: { taskId: 'task-1' as string | null } },
    );

    act(() => {
      socket._trigger('video-trim:status', {
        taskId: 'task-1',
        status: 'processing',
      });
    });

    expect(result.current.status).toBe('processing');
    unmount();
  });

  it('should ignore socket events for other taskIds', () => {
    const socket = createMockSocket();
    const { result, unmount } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, socket as any),
      { initialProps: { taskId: 'task-1' as string | null } },
    );

    act(() => {
      socket._trigger('video-trim:status', {
        taskId: 'other-task',
        status: 'done',
        outputFileId: 'file-x',
      });
    });

    expect(result.current.status).toBe('idle');
    unmount();
  });

  it('should reset polling timer on socket event', () => {
    const socket = createMockSocket(false);
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const setIntervalSpy = vi.spyOn(global, 'setInterval');

    const { unmount } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, socket as any),
      { initialProps: { taskId: 'task-1' as string | null } },
    );

    clearIntervalSpy.mockClear();
    setIntervalSpy.mockClear();

    act(() => {
      socket._trigger('video-trim:status', {
        taskId: 'task-1',
        status: 'processing',
      });
    });

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(setIntervalSpy).toHaveBeenCalled();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    unmount();
  });

  it('should set error via exposed setter', () => {
    const socket = createMockSocket();
    const { result, unmount } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, socket as any),
      { initialProps: { taskId: 'task-1' as string | null } },
    );

    act(() => {
      result.current.setError('提交失败，请重试');
    });

    expect(result.current.error).toBe('提交失败，请重试');
    expect(result.current.status).toBe('error');
    unmount();
  });

  it('should stop polling when taskId becomes null', () => {
    const socket = createMockSocket(false);
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    const { rerender, unmount } = renderHook(
      ({ taskId }) => useTrimTaskStatus(taskId, socket as any),
      { initialProps: { taskId: 'task-1' as string | null } },
    );

    clearIntervalSpy.mockClear();

    rerender({ taskId: null });

    expect(clearIntervalSpy).toHaveBeenCalled();

    clearIntervalSpy.mockRestore();
    unmount();
  });
});
