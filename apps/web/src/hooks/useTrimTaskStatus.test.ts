import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTrimTaskStatus } from './useTrimTaskStatus';
import * as apiModule from '@/services/video-trim.api';

vi.mock('@/services/video-trim.api', () => ({
  videoTrimApi: {
    getTaskStatus: vi.fn(),
  },
}));

function makeMockSocket() {
  const listeners: Record<string, (...args: any[]) => void> = {};
  return {
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      listeners[event] = cb;
    }),
    off: vi.fn((event: string) => {
      delete listeners[event];
    }),
    connected: true,
    _listeners: listeners,
  } as any;
}

describe('useTrimTaskStatus', () => {
  let mockSocket: ReturnType<typeof makeMockSocket>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockSocket = makeMockSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not start polling or socket subscription when taskId is null', () => {
    renderHook(() => useTrimTaskStatus(null, mockSocket));

    expect(mockSocket.on).not.toHaveBeenCalled();
  });

  it('should update status from socket event', () => {
    const { result } = renderHook(() => useTrimTaskStatus('task-1', mockSocket));

    expect(result.current.status).toBe('idle');

    // Simulate socket event
    act(() => {
      mockSocket._listeners['video-trim:status']?.({
        nodeId: 'node-1',
        taskId: 'task-1',
        status: 'done',
        outputFileId: 'out-1',
      });
    });

    expect(result.current.status).toBe('done');
    expect(result.current.outputFileId).toBe('out-1');
  });

  it('should start polling when socket disconnected', async () => {
    mockSocket.connected = false;
    const getTaskStatus = vi.mocked(apiModule.videoTrimApi.getTaskStatus);
    getTaskStatus.mockResolvedValue({ status: 'processing' });

    const { result } = renderHook(() => useTrimTaskStatus('task-1', mockSocket));

    // Advance timer by 3s — polling should kick in
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(getTaskStatus).toHaveBeenCalledWith('task-1');
    expect(result.current.status).toBe('processing');
  });

  it('should stop polling and subscriptions when status is done', async () => {
    mockSocket.connected = false;
    const getTaskStatus = vi.mocked(apiModule.videoTrimApi.getTaskStatus);
    getTaskStatus.mockResolvedValue({ status: 'done', outputFileId: 'out-1' });

    const { result } = renderHook(() => useTrimTaskStatus('task-1', mockSocket));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(result.current.status).toBe('done');

    getTaskStatus.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(getTaskStatus).not.toHaveBeenCalled();
  });

  it('should stop polling when status is error', async () => {
    mockSocket.connected = false;
    const getTaskStatus = vi.mocked(apiModule.videoTrimApi.getTaskStatus);
    getTaskStatus.mockResolvedValue({ status: 'error', error: 'FFmpeg crashed' });

    const { result } = renderHook(() => useTrimTaskStatus('task-1', mockSocket));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(result.current.status).toBe('error');

    getTaskStatus.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(getTaskStatus).not.toHaveBeenCalled();
  });

  it('should clean up timers and listeners on unmount', () => {
    const { unmount } = renderHook(() => useTrimTaskStatus('task-1', mockSocket));

    unmount();

    expect(mockSocket.off).toHaveBeenCalled();
  });
});
