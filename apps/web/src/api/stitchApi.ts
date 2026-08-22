import { apiFetch } from './client';
import type { AspectRatio, StitchResolution } from '@/types/group';

export interface StitchParams {
  fileIds: string[];
  gridRows: number;
  gridCols: number;
  aspectRatio: AspectRatio;
  showIndex: boolean;
  resolution: StitchResolution;
  sourceGroupId?: string; // 产物节点定位用（组右侧），不发给后端
}

export interface StitchResult {
  taskId: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  fileId?: string;
  url?: string;
  width?: number;
  height?: number;
  failedCount?: number;
  error?: string;
}

export const createStitchTask = (projectId: string, params: StitchParams) =>
  apiFetch<StitchResult>(`/projects/${projectId}/storyboard/stitch`, {
    method: 'POST',
    body: JSON.stringify(params),
  });

export const getStitchTask = (projectId: string, taskId: string) =>
  apiFetch<StitchResult>(`/projects/${projectId}/storyboard/stitch/${taskId}`);
