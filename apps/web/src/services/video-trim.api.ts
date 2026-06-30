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
    apiFetch<VideoTrimResponse>('/execution/video-trim', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  getTaskStatus: (taskId: string) =>
    apiFetch<TaskStatusResponse>(`/execution/video-trim/${taskId}`),
};
