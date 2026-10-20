import { apiFetch } from './client';

// Y1a+Y1b T5：读侧迁移 content 路由——api 删除 GET /media/:id/url（读侧 presign 旁路），
// 媒体字节统一走 GET /api/media/:fileId/content（同源会话 cookie 鉴权+团队级单门+MIME 嗅探面）。
// content 路径无签名寿命：getMediaUrl 降级为纯本地推导（零网络）；本文件是 /url 调用面的单点收口
// （mediaContentUrl 单点封装+census 归 T6——本卡最小迁移）。
// 两层缓存关系（Minor-6）：本层=URL 映射缓存（content 路径稳定无签名寿命——1d 只是提示刷新周期）；
// 字节层=content 响应 Cache-Control: private, max-age=3600（1h——api serveReady 固定值）。上层长/下层短：
// 路径恒定可长缓存，字节（MIME 嗅探/权限态变化）靠短缓存收敛。
export const MEDIA_URL_CACHE_TTL_SEC = 86_400;

/** content 路由路径（同源相对路径——img/video src 与 fetch 直用；variant=thumbnail 读缩略图对象） */
export function mediaContentUrl(fileId: string, variant?: 'thumbnail'): string {
  return variant ? `/api/media/${fileId}/content?variant=thumbnail` : `/api/media/${fileId}/content`;
}

export interface MediaUrlResult { url: string; ttlSec: number }
export function getMediaUrl(fileId: string): Promise<MediaUrlResult> {
  // Promise 返回维持既有调用面（await/Promise.all/类型签名 DownloadArgs.getMediaUrl）
  return Promise.resolve({ url: mediaContentUrl(fileId), ttlSec: MEDIA_URL_CACHE_TTL_SEC });   // ttlSec=缓存层有效期提示（非签名寿命）
}

export interface BatchMediaItem {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  /** T5：content 路由引用（api 侧不再 presign——读侧旁路删除；同源路径零 /flowai 改写） */
  url: string;
  thumbnailUrl: string | null;
  metadata: Record<string, unknown>;
  /** 契约字段维持（spec §4.5 字段名不变）：content 路径稳定——值=客户端缓存有效期提示（api 侧单源） */
  ttlSec: number;
}

/** 左面板聚合：按 mediaId 集合批查 + content 路由引用（POST /api/media/batch） */
export function batchGetMedia(ids: string[], teamId?: string): Promise<BatchMediaItem[]> {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  return apiFetch<BatchMediaItem[]>(`/media/batch${qs}`, { method: 'POST', body: JSON.stringify({ ids }) });
}

/** 折叠卡批量预取专用：batchGetMedia 原样（既有 2 消费方 useWorkflowAssets/VideoEditNode 行为不变）。
 *  T5：响应 url 已是同源 content 路径——原 presigned URL 的 /flowai 改写退役（零正则）。 */
export async function batchGetMediaRewritten(ids: string[], teamId?: string): Promise<BatchMediaItem[]> {
  return batchGetMedia(ids, teamId);
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
