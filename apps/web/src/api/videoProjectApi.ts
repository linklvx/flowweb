// apps/web/src/api/videoProjectApi.ts
import type { ExportResolution } from '@flowweb/shared';
import { apiFetch } from './client';

export interface VideoProjectDto {
  id: string;
  sourceNodeId: string;
  workflowId: string;
  teamId: string; // 运行时 getByNode/upsert 回 Prisma 整行恒含（Shell 传 p.teamId → loadProject）
  title: string;
  data: import('@flowweb/shared').ProjectData;
  updatedAt: string;
}

/** 首次全屏编辑 upsert by sourceNodeId（幂等防双击；update 分支亦返回全量）。
 *  data 由前端显式传（shared barrel 仅 Vite 侧可值导入——API 纯 TS 源码包运行时约束，服务端只留防御缺省——执行期修正） */
export function upsertProject(input: { workflowId: string; sourceNodeId: string; title: string; data?: unknown }): Promise<VideoProjectDto> {
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

export interface RegenerateInput { workflowId: string; sourceNodeId: string; kind: 'video' | 'audio'; retakeId: string; }
/** Y0b-2 T5（Z95）：errors 结构化 {nodeId,status,error,errorCode?}——与 executionApi.ExecutionErrorEntry 同形 */
export interface RegenerateResult { retakeId: string; result?: { success: boolean; errors?: Array<{ nodeId: string; status: 'error' | 'skipped'; error: string; errorCode?: string }> } }

/** 批5-1 retake 直连真实节点：retakeId 客户端生成（E0 幂等键——Y0b-2 T6 起为 regen-token 手势 token，
 *  语义重定位见 video-project.service.ts：held 优先免费 rearm/成功后投影单源轮换）上送，
 *  返回 { retakeId, result }——result 含 execute 的 success/errors（早失败在 HTTP 往返内已 emit+写
 *  exec map，订阅必错过——直读 result 反馈；完成态由真实节点 exec 投影对齐） */
export function regenerateNode(input: RegenerateInput): Promise<RegenerateResult> {
  return apiFetch<RegenerateResult>('/video-projects/regenerate', { method: 'POST', body: JSON.stringify(input) });
}

export interface RegisterGeneratedInput { workflowId: string; videoProjectId: string; resolution: ExportResolution; durationSec: number; width?: number; height?: number; actualSize: number; clientRequestId: string; } // width/height 尺寸存档（后端 RegisterGeneratedDto 批5-4 可选字段；Task 19 起前端必传——resolution 无法表达 9:16 的 1080×1920）；clientRequestId 幂等键必填（后端 whitelist 静默剥离未声明字段——漏传则重试无幂等保护）
export interface RegisterGeneratedResult { mediaId: string; upload: { url: string; fields: Record<string, string> } }

export function registerGeneratedMedia(input: RegisterGeneratedInput): Promise<RegisterGeneratedResult> {
  return apiFetch<RegisterGeneratedResult>('/video-projects/generated-media/register', { method: 'POST', body: JSON.stringify(input) });
}

export function confirmGeneratedMedia(mediaId: string): Promise<unknown> {
  return apiFetch<unknown>('/video-projects/generated-media/confirm', { method: 'POST', body: JSON.stringify({ mediaId }) });
}

/** 导出前置配额预检——编码前调用，配额不足时 4xx 立即失败（避免编码数分钟后上传才报错） */
export function exportPrecheck(workflowId: string, estimatedSize: number): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/video-projects/export-precheck', { method: 'POST', body: JSON.stringify({ workflowId, estimatedSize }) });
}
