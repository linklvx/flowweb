import { useState, useEffect, useRef, useCallback } from 'react';
import { videoTrimApi } from '@/services/video-trim.api';

interface TrimStatus {
  status: 'idle' | 'processing' | 'done' | 'error';
  outputFileId: string | null;
  error: string | null;
}

const POLL_INTERVAL = 3000;

export function useTrimTaskStatus(taskId: string | null, socket: any): TrimStatus {
  const [state, setState] = useState<TrimStatus>({
    status: 'idle',
    outputFileId: null,
    error: null,
  });

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketRef = useRef(socket);
  socketRef.current = socket;

  const stopPolling = useCallback(() => {
    if (pollingRef.current !== null) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    if (!taskId) return;
    try {
      const result = await videoTrimApi.getTaskStatus(taskId);
      if (result) {
        setState({
          status: (result.status as TrimStatus['status']) || 'idle',
          outputFileId: result.outputFileId ?? null,
          error: result.error ?? null,
        });
      }
    } catch {
      // Poll failure is silent — will retry next interval
    }
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;

    const socket = socketRef.current;

    const handleStatus = (data: { taskId: string; status: string; outputFileId?: string; error?: string }) => {
      if (data.taskId === taskId) {
        setState({
          status: (data.status as TrimStatus['status']) || 'idle',
          outputFileId: data.outputFileId ?? null,
          error: data.error ?? null,
        });
      }
    };

    // Subscribe to socket event
    if (socket) {
      socket.on('video-trim:status', handleStatus);
    }

    // If socket is not connected, start polling immediately
    const shouldPoll = !socket || !socket.connected;
    if (shouldPoll) {
      pollingRef.current = setInterval(poll, POLL_INTERVAL);
      // Also poll immediately on mount
      poll();
    }

    return () => {
      if (socket) {
        socket.off('video-trim:status', handleStatus);
      }
      stopPolling();
    };
  }, [taskId, poll, stopPolling]);

  // Stop polling when reaching terminal state
  useEffect(() => {
    if (state.status === 'done' || state.status === 'error') {
      stopPolling();
    }
  }, [state.status, stopPolling]);

  return state;
}
