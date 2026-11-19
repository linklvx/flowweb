import { useState, useEffect, useRef, useCallback } from 'react';

interface AsyncMediaTaskStatus {
  status: string;
  [key: string]: any;
}

interface AsyncMediaTaskOptions<TData = Record<string, any>> {
  taskId: string | null;
  nodeId?: string;
  pollFn: (taskId: string) => Promise<TData | null>;
}

export interface AsyncMediaTaskResult<TData = Record<string, any>> {
  status: 'idle' | 'queued' | 'processing' | 'done' | 'error';
  data: TData;
  setError: (error: string) => void;
  setProcessing: () => void;
}

// Y3 T1：三族任务=REST 轮询单通道（3s 恒值——删 socket 快路径双档 10s/3s）
const POLL_INTERVAL = 3000;

export function useAsyncMediaTask<TData = Record<string, any>>(
  options: AsyncMediaTaskOptions<TData>,
): AsyncMediaTaskResult<TData> {
  const { taskId, pollFn } = options;

  const [state, setState] = useState<AsyncMediaTaskStatus>({ status: 'idle' });

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // ref 保存最新 pollFn（调用方为内联箭头——入 ref 防 effect 重跑轮询环）
  const pollFnRef = useRef(pollFn);
  pollFnRef.current = pollFn;
  // 单调序号：cleanup 与 taskId 变化各 +1——迟归 resolve 序号失配不 setState（失配那一拍丢弃）
  const seqRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollingRef.current !== null) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const setError = useCallback((error: string) => {
    setState((prev) => ({ ...prev, status: 'error' as const, error }));
    stopPolling();
  }, [stopPolling]);

  const setProcessing = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'processing' as const, error: null }));
  }, []);

  useEffect(() => {
    if (!taskId) { stopPolling(); return; }

    // 每轮 effect 拿独立序号；cleanup（含 taskId 变化触发的重跑）+1 作废在途响应
    seqRef.current += 1;
    const seq = seqRef.current;

    const poll = async (): Promise<boolean> => {
      try {
        const result = await pollFnRef.current(taskId);
        // 序号失配=该响应属于已作废的一拍（cleanup/换 taskId）——不 setState
        if (seqRef.current !== seq) return false;
        if (result) {
          setState((prev) => ({
            ...prev,
            status: (result as any).status || 'idle',
            ...(result as any),
          }));
          const s = (result as any).status;
          if (s === 'done' || s === 'error') return false; // 终态：不再建 interval
        }
      } catch {
        // Poll silent fail
      }
      return true;
    };

    // taskId 到位立即首请求；未终态才 setInterval 3s（终态后不再 setInterval）
    void poll().then((keepGoing) => {
      // 序号失配（cleanup/换 taskId 竞态）→ 不建 interval
      if (keepGoing && seqRef.current === seq) {
        pollingRef.current = setInterval(() => {
          void poll().then((stillGoing) => {
            // 终态判定在 interval 内那一拍命中 → 清掉已建好的 interval（终态不再留 timer）
            if (!stillGoing) stopPolling();
          });
        }, POLL_INTERVAL);
      }
    });

    return () => {
      seqRef.current += 1;
      stopPolling();
    };
  }, [taskId, stopPolling]);

  return {
    status: state.status as AsyncMediaTaskResult['status'],
    data: state as TData,
    setError,
    setProcessing,
  };
}
