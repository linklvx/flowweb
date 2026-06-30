import { apiFetch } from '@/api/client';

export interface VideoTrimRequest {
  fileId: string;
  startTime: number;
  endTime: number;
  nodeId: string;
}

export interface VideoTrimResponse {
  taskId: string;
}

export interface TaskStatusResponse {
  status: string;
  outputFileId?: string | null;
  error?: string | null;
}

export const videoTrimApi = {
  submitTrim: (params: VideoTrimRequest) =>
    apiFetch<VideoTrimResponse>('/api/execution/video-trim', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  getTaskStatus: (taskId: string) =>
    apiFetch<TaskStatusResponse>(`/api/execution/video-trim/${taskId}`),
};
