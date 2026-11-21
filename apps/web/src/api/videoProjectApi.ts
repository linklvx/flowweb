// apps/web/src/api/videoProjectApi.ts
// Y4a T8（spec §0 条 9）：VideoProject 表整删——upsertProject/patchProject/getProjectByNode/
// deleteProjectByNode（REST autosave 链）随链退场；留存 regenerate/exportPrecheck/register/confirm
// 四 fetch（全部零依赖表）。RegisterGeneratedInput 键 `videoProjectId`→`sourceNodeId` 同批 re-key
//（doc 字符串非外键——spec §3.5）。
import type { ExportResolution } from '@flowweb/shared';
import { apiFetch } from './client';

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

export interface RegisterGeneratedInput { workflowId: string; sourceNodeId: string; resolution: ExportResolution; durationSec: number; width?: number; height?: number; actualSize: number; clientRequestId: string; } // width/height 尺寸存档（后端 RegisterGeneratedDto 批5-4 可选字段；Task 19 起前端必传——resolution 无法表达 9:16 的 1080×1920）；clientRequestId 幂等键必填（后端 whitelist 静默剥离未声明字段——漏传则重试无幂等保护）；sourceNodeId=剪辑节点自身 canvas nodeId（Y4a T8 re-key：doc 字符串非外键）
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
