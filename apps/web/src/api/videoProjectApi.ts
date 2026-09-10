// apps/web/src/api/videoProjectApi.ts
import { apiFetch } from './client';

export interface VideoProjectDto {
  id: string;
  sourceNodeId: string;
  workflowId: string;
  title: string;
  data: import('@flowweb/shared').ProjectData;
  updatedAt: string;
}

/** upsertProject/patchProject/deleteProjectByNode 在 Task 12 补全 */
export async function getProjectByNode(sourceNodeId: string): Promise<VideoProjectDto | null> {
  try {
    return await apiFetch<VideoProjectDto>(`/video-projects/by-node/${sourceNodeId}`);
  } catch (e) {
    if ((e as { status?: number })?.status === 404) return null; // 工程不存在=空态（添加节点不建工程）
    throw e;
  }
}
