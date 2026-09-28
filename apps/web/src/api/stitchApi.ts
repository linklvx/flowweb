import { apiFetch } from './client';
import { STITCH_JOB_KEYS } from '@flowweb/shared';
import type { AspectRatio, StitchResolution } from '@/types/group';

/** 客户端入参 = 线上六键 + 本地定位字段（useStitchTask:63 spawnResultNode 消费） */
export interface StitchParams {
  fileIds: string[];
  gridRows: number;
  gridCols: number;
  aspectRatio: AspectRatio;
  showIndex: boolean;
  resolution: StitchResolution;
  sourceGroupId?: string; // 产物节点定位用（组右侧）——不入线（whitelist pipe 前提，stitchApi 剥离）
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

export const createStitchTask = (projectId: string, params: StitchParams) => {
  // 显式 pick（非解构丢弃）：未来加字段默认不上线，须显式加入 STITCH_JOB_KEYS——与 service 端 pick 同口径。
  // v4：Pick 型别锚定（编译级）——STITCH_JOB_KEYS 加第 7 键时 body 立刻编译不过（比 void 假引用强，
  // 且 pick 与 KEYS 的一致性由 stitchApi.test.ts 第一条行为锚定）。
  const body: Pick<StitchParams, (typeof STITCH_JOB_KEYS)[number]> = {
    fileIds: params.fileIds, gridRows: params.gridRows, gridCols: params.gridCols,
    aspectRatio: params.aspectRatio, showIndex: params.showIndex, resolution: params.resolution,
  };
  return apiFetch<StitchResult>(`/projects/${projectId}/storyboard/stitch`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

export const getStitchTask = (projectId: string, taskId: string) =>
  apiFetch<StitchResult>(`/projects/${projectId}/storyboard/stitch/${taskId}`);
