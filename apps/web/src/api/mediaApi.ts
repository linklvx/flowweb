import { apiFetch } from './client';

export interface MediaUrlResult { url: string; ttlSec: number }
export async function getMediaUrl(fileId: string): Promise<MediaUrlResult> {
  const res = await apiFetch<MediaUrlResult>(`/media/${fileId}/url`);
  // Rewrite presigned MinIO URL through same-path proxy to avoid CORS/signature issues
  res.url = (res.url as string).replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');
  return res;
}

export interface BatchMediaItem {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  thumbnailUrl: string | null;
  metadata: Record<string, unknown>;
  /** 2d-4 契约（spec §4.5）：服务端 MEDIA_URL_TTL_SEC 常量单源随响应下行，双端各自锁 */
  ttlSec: number;
}

/** 左面板聚合：按 mediaId 集合批查 + presigned URL（POST /api/media/batch，Plan 1 Task 12 已就绪） */
export function batchGetMedia(ids: string[], teamId?: string): Promise<BatchMediaItem[]> {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  return apiFetch<BatchMediaItem[]>(`/media/batch${qs}`, { method: 'POST', body: JSON.stringify({ ids }) });
}

/** 2d-4 折叠卡批量预取专用：batchGetMedia 原样（既有 2 消费方 useWorkflowAssets/VideoEditNode 行为不变）
 *  + /flowai 同源改写（getMediaUrl 同款——presigned URL 绕 Vite 代理防 CORS/签名问题） */
export async function batchGetMediaRewritten(ids: string[], teamId?: string): Promise<BatchMediaItem[]> {
  const rows = await batchGetMedia(ids, teamId);
  for (const r of rows) {
    r.url = r.url.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');
  }
  return rows;
}

/**
 * Get a presigned GET URL for a MinIO object key, rewritten through the Vite proxy.
 * Used for banner background images.
 */
export async function getPresignedUrlByKey(key: string): Promise<string> {
  const res = await fetch(`/api/media/by-key?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error('Failed to get presigned URL');
  const body = await res.json();
  const url = body.data?.url || body.url;
  // Rewrite through /flowai proxy (consistent with all other MinIO access patterns)
  return url.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');
}
