import { useAsyncMediaTask } from './useAsyncMediaTask';
import { videoSeparateApi } from '@/services/video-separate.api';

// Y3 T1：签名收窄（socket 参数删——REST 轮询单通道）；nodeId 保留在透传面（发起者组件定位）
export function useVideoSeparateTask(taskId: string | null, nodeId: string) {
  void nodeId;
  return useAsyncMediaTask({
    taskId,
    pollFn: (id) => videoSeparateApi.getTaskStatus(id),
  });
}
