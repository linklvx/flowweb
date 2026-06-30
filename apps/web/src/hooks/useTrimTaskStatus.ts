import { useState, useEffect, useRef, useCallback } from 'react';
import { videoTrimApi } from '@/services/video-trim.api';
import { useNodeStore } from '@/stores/nodeStore';

interface TrimStatus {
  status: 'idle' | 'queued' | 'processing' | 'done' | 'error';
  outputFileId: string | null;
  error: string | null;
}

interface TrimTaskStatusResult extends TrimStatus {
  setError: (error: string) => void;
  setProcessing: () => void;
}

const POLL_INTERVAL_LOW = 10000;
const POLL_INTERVAL_HIGH = 3000;

export function useTrimTaskStatus(
  taskId: string | null,
  socket: any,
  nodeId?: string,
): TrimTaskStatusResult {
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

  const startPolling = useCallback(
    (interval: number) => {
      stopPolling();
      pollingRef.current = setInterval(async () => {
        if (!taskId) return;
        try {
          const result = await videoTrimApi.getTaskStatus(taskId);
          if (result) {
            console.debug('[trim-status] poll result:', { taskId, status: result.status, outputFileId: result.outputFileId });
            setState((prev) => {
              const next: TrimStatus = {
                status: (result.status as TrimStatus['status']) || 'idle',
                outputFileId: result.outputFileId ?? null,
                error: result.error ?? prev.error,
              };
              return next;
            });
          }
        } catch (err) {
          console.debug('[trim-status] poll error:', { taskId, error: (err as Error).message });
        }
      }, interval);
    },
    [taskId, stopPolling],
  );

  const setError = useCallback((error: string) => {
    setState((prev) => ({ ...prev, status: 'error' as const, error }));
    stopPolling();
  }, [stopPolling]);

  const setProcessing = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'processing' as const, error: null }));
  }, []);

  // Automatically sync terminal states to nodeStore
  useEffect(() => {
    if (!nodeId) return;
    const isTerminal = state.status === 'done' || state.status === 'error';

    if (isTerminal) {
      if (state.status === 'done' && state.outputFileId) {
        useNodeStore.getState().setTrimmedResult(nodeId, state.outputFileId);
      } else if (state.status === 'error') {
        useNodeStore.getState().setTrimTaskStatus(nodeId, 'error');
      }
    }
  }, [state.status, state.outputFileId, state.error, nodeId]);

  // Main effect: manage polling + socket subscription
  useEffect(() => {
    if (!taskId) {
      stopPolling();
      return;
    }

    const socket = socketRef.current;

    const getPollInterval = () => {
      return socket && socket.connected ? POLL_INTERVAL_LOW : POLL_INTERVAL_HIGH;
    };

    const resetPolling = () => {
      stopPolling();
      startPolling(getPollInterval());
    };

    const handleStatus = (data: {
      taskId: string;
      status: string;
      outputFileId?: string;
      error?: string;
    }) => {
      if (data.taskId !== taskId) return;
      console.debug('[trim-status] socket event:', { taskId: data.taskId, status: data.status, outputFileId: data.outputFileId });
      setState({
        status: (data.status as TrimStatus['status']) || 'idle',
        outputFileId: data.outputFileId ?? null,
        error: data.error ?? null,
      });
      if (data.status === 'done' || data.status === 'error') {
        stopPolling();
      } else {
        resetPolling();
      }
    };

    if (socket) {
      socket.on('video-trim:status', handleStatus);
    }

    startPolling(getPollInterval());

    return () => {
      if (socket) {
        socket.off('video-trim:status', handleStatus);
      }
      stopPolling();
    };
  }, [taskId, startPolling, stopPolling]);

  // Stop polling when reaching terminal state
  useEffect(() => {
    if (state.status === 'done' || state.status === 'error') {
      stopPolling();
    }
  }, [state.status, stopPolling]);

  return { ...state, setError, setProcessing };
}
