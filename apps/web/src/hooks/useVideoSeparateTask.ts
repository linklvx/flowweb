import { useAsyncMediaTask } from './useAsyncMediaTask';
import { videoSeparateApi } from '@/services/video-separate.api';

export function useVideoSeparateTask(taskId: string | null, socket: any, nodeId?: string) {
  return useAsyncMediaTask({
    taskId,
    socket,
    nodeId,
    socketEvent: 'video-separate:status',
    pollFn: (id) => videoSeparateApi.getTaskStatus(id),
  });
}
