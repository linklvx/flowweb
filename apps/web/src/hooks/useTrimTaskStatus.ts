import { useEffect } from 'react';
import { useAsyncMediaTask } from './useAsyncMediaTask';
import { videoTrimApi } from '@/services/video-trim.api';
import { useNodeStore } from '@/stores/nodeStore';

interface TrimStatusResult {
  status: 'idle' | 'queued' | 'processing' | 'done' | 'error';
  outputFileId: string | null;
  error: string | null;
  setError: (error: string) => void;
  setProcessing: () => void;
}

export function useTrimTaskStatus(
  taskId: string | null,
  socket: any,
  nodeId?: string,
): TrimStatusResult {
  const { status, data, setError, setProcessing } = useAsyncMediaTask({
    taskId,
    socket,
    nodeId,
    socketEvent: 'video-trim:status',
    pollFn: (id) => videoTrimApi.getTaskStatus(id),
  });

  const outputFileId: string | null = (data as any).outputFileId ?? null;
  const error: string | null = (data as any).error ?? null;

  // Automatically sync terminal states to nodeStore
  useEffect(() => {
    if (!nodeId) return;
    const isTerminal = status === 'done' || status === 'error';

    if (isTerminal) {
      if (status === 'done' && outputFileId) {
        useNodeStore.getState().setTrimmedResult(nodeId, outputFileId);
      } else if (status === 'error') {
        useNodeStore.getState().setTrimTaskStatus(nodeId, 'error');
      }
    }
  }, [status, outputFileId, error, nodeId]);

  return {
    status,
    outputFileId,
    error,
    setError,
    setProcessing,
  };
}
