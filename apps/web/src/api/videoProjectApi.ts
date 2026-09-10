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

/** 首次全屏编辑 upsert by sourceNodeId（幂等防双击；update 分支亦返回全量） */
export function upsertProject(input: { workflowId: string; sourceNodeId: string; title: string }): Promise<VideoProjectDto> {
  return apiFetch<VideoProjectDto>('/video-projects', { method: 'POST', body: JSON.stringify(input) });
}

export function patchProject(id: string, body: { data: unknown; baseUpdatedAt: string }): Promise<VideoProjectDto> {
  return apiFetch<VideoProjectDto>(`/video-projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

/** 删除剪辑节点时 fire-and-forget 调用（仅删工程记录，引用 Media 不动） */
export function deleteProjectByNode(sourceNodeId: string): Promise<void> {
  return apiFetch<void>(`/video-projects/by-node/${sourceNodeId}`, { method: 'DELETE' });
}

export async function getProjectByNode(sourceNodeId: string): Promise<VideoProjectDto | null> {
  try {
    return await apiFetch<VideoProjectDto>(`/video-projects/by-node/${sourceNodeId}`);
  } catch (e) {
    if ((e as { status?: number })?.status === 404) return null; // 工程不存在=空态（添加节点不建工程）
    throw e;
  }
}
