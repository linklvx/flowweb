import { apiFetch } from '@/api/client';

export interface VideoSeparateRequest {
  fileId: string;
  nodeId: string;
  mode: string;
}

export interface VideoSeparateResponse {
  taskId: string;
}

export interface VideoSeparateStatusResponse {
  status: string;
  videoFileId?: string | null;
  audioFileId?: string | null;
  error?: string | null;
}

export const videoSeparateApi = {
  submitSeparate: (params: VideoSeparateRequest): Promise<VideoSeparateResponse> =>
    apiFetch<VideoSeparateResponse>('/execution/video-separate', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  getTaskStatus: (taskId: string): Promise<VideoSeparateStatusResponse> =>
    apiFetch<VideoSeparateStatusResponse>(`/execution/video-separate/${taskId}`),
};
