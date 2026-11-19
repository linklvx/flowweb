import { useAsyncMediaTask } from './useAsyncMediaTask';
import { videoTrimApi } from '@/services/video-trim.api';

interface TrimStatusResult {
  status: 'idle' | 'queued' | 'processing' | 'done' | 'error';
  outputFileId: string | null;
  error: string | null;
  setError: (error: string) => void;
  setProcessing: () => void;
}

export function useTrimTaskStatus(
  taskId: string | null,
  nodeId: string,
): TrimStatusResult {
  // Y3 T1：签名收窄（socket 参数删——REST 轮询单通道）；nodeId 保留在透传面（发起者组件定位）
  void nodeId;
  const { status, data, setError, setProcessing } = useAsyncMediaTask({
    taskId,
    pollFn: (id) => videoTrimApi.getTaskStatus(id),
  });

  const outputFileId: string | null = (data as any).outputFileId ?? null;
  const error: string | null = (data as any).error ?? null;
  void error;
  // Y2 B3：nodeStore 同步 effect 删除——trimmedFileId/trimTaskStatus 均禁键（服务端进度/产物域）；
  // 剪辑产物落画布=VideoGenNode 完成回调用新节点作者放置写 mediaId，进度归本 hook 状态面。

  return {
    status,
    outputFileId,
    error,
    setError,
    setProcessing,
  };
}
