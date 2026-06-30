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

const SUBMIT_TIMEOUT_MS = 10000;

export const videoTrimApi = {
  submitTrim: (params: VideoTrimRequest): Promise<VideoTrimResponse> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

    return apiFetch<VideoTrimResponse>('/execution/video-trim', {
      method: 'POST',
      body: JSON.stringify(params),
      signal: controller.signal,
    })
      .then((result) => {
        clearTimeout(timer);
        return result;
      })
      .catch((err) => {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          throw new Error('请求超时，请重试');
        }
        throw err;
      });
  },

  getTaskStatus: (taskId: string): Promise<TaskStatusResponse> =>
    apiFetch<TaskStatusResponse>(`/execution/video-trim/${taskId}`),
};
