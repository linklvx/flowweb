import { useState, useEffect, useRef, useCallback } from 'react';

interface AsyncMediaTaskStatus {
  status: string;
  [key: string]: any;
}

interface AsyncMediaTaskOptions<TData = Record<string, any>> {
  taskId: string | null;
  socket: any;
  nodeId?: string;
  socketEvent: string;
  pollFn: (taskId: string) => Promise<TData | null>;
}

export interface AsyncMediaTaskResult<TData = Record<string, any>> {
  status: 'idle' | 'queued' | 'processing' | 'done' | 'error';
  data: TData;
  setError: (error: string) => void;
  setProcessing: () => void;
}

const POLL_INTERVAL_LOW = 10000;
const POLL_INTERVAL_HIGH = 3000;

export function useAsyncMediaTask<TData = Record<string, any>>(
  options: AsyncMediaTaskOptions<TData>,
): AsyncMediaTaskResult<TData> {
  const { taskId, socket, socketEvent, pollFn } = options;

  const [state, setState] = useState<AsyncMediaTaskStatus>({ status: 'idle' });

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketRef = useRef(socket);
  socketRef.current = socket;
  // 用 ref 保存最新 taskId，避免卸载清理时闭包捕获初始值
  const taskIdRef = useRef(taskId);
  taskIdRef.current = taskId;

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
        if (!taskIdRef.current) return;
        try {
          const result = await pollFn(taskIdRef.current);
          if (result) {
            setState((prev) => ({
              ...prev,
              status: (result as any).status || 'idle',
              ...(result as any),
            }));
          }
        } catch {
          // Poll silent fail
        }
      }, interval);
    },
    [pollFn, stopPolling],
  );

  const setError = useCallback((error: string) => {
    setState((prev) => ({ ...prev, status: 'error' as const, error }));
    stopPolling();
  }, [stopPolling]);

  const setProcessing = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'processing' as const, error: null }));
  }, []);

  useEffect(() => {
    if (!taskId) { stopPolling(); return; }

    const sock = socketRef.current;
    const getPollInterval = () =>
      sock && sock.connected ? POLL_INTERVAL_LOW : POLL_INTERVAL_HIGH;

    const handleStatus = (data: any) => {
      if (data.taskId !== taskId) return;
      setState({ status: data.status || 'idle', ...data });
      if (data.status === 'done' || data.status === 'error') {
        stopPolling();
      }
    };

    if (sock) {
      sock.on(socketEvent, handleStatus);
    }

    startPolling(getPollInterval());

    return () => {
      if (sock) sock.off(socketEvent, handleStatus);
      stopPolling();
    };
  }, [taskId, socketEvent, startPolling, stopPolling]);

  // Stop polling on terminal states
  useEffect(() => {
    if (state.status === 'done' || state.status === 'error') {
      stopPolling();
    }
  }, [state.status, stopPolling]);

  return {
    status: state.status as AsyncMediaTaskResult['status'],
    data: state as TData,
    setError,
    setProcessing,
  };
}
