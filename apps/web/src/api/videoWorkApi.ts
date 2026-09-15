import { apiFetch } from './client';
import type {
  VideoWorkListResult, VideoWorkDetail, VideoCategoryItem, ProcessSnapshotData, VideoWorkSettings,
} from '@flowweb/shared';

/** /flowai 同源改写（视频 seek 依赖同源拿 Content-Range、img 避 CORS——mediaApi.ts:6 同款） */
export const toFlowaiUrl = (url: string) => url.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');

export async function fetchVideoWorks(params: { categoryId?: string; page?: number; pageSize?: number } = {}): Promise<VideoWorkListResult> {
  const q = new URLSearchParams();
  if (params.categoryId) q.set('categoryId', params.categoryId);
  q.set('page', String(params.page ?? 1));
  q.set('pageSize', String(params.pageSize ?? 20));
  const r = await apiFetch<VideoWorkListResult>(`/video-works?${q.toString()}`); // 第九轮：显式类型参——apiFetch<T> 无推断位，裸调用 T=unknown，下方 r.items 是 TS2571
  // 列表封面也过 /flowai（spec §5.4"沿用同一改写函数"——dev 下 MINIO_ENDPOINT=127.0.0.1:9000 直连碰巧能显示，
  // 生产 presign URL 是内网地址不可达、列表封面全裂；第八轮补，原只改写了详情/快照）
  return { ...r, items: r.items.map(it => ({ ...it, coverUrl: it.coverUrl ? toFlowaiUrl(it.coverUrl) : null })) };
}

export async function fetchVideoCategories(): Promise<VideoCategoryItem[]> {
  return apiFetch('/video-works/categories');
}

export async function fetchVideoWorkDetail(id: string): Promise<VideoWorkDetail> {
  const d = await apiFetch<VideoWorkDetail>(`/video-works/${id}`); // 显式类型参（同上，第九轮）
  return { ...d, videoUrl: toFlowaiUrl(d.videoUrl), coverUrl: d.coverUrl ? toFlowaiUrl(d.coverUrl) : null };
}

export async function recordView(id: string): Promise<void> {
  apiFetch(`/video-works/${id}/view`, { method: 'POST' }).catch(() => {}); // 计数失败静默
}

export async function toggleLike(id: string): Promise<{ liked: boolean; likeCount: number }> {
  return apiFetch(`/video-works/${id}/like`, { method: 'POST' });
}

export async function fetchProcessSnapshot(id: string): Promise<ProcessSnapshotData> {
  const snap = await apiFetch<ProcessSnapshotData>(`/video-works/${id}/process`); // 显式类型参（同上，第九轮）
  for (const n of snap.nodes) {
    if (typeof n.data.thumbnailUrl === 'string') n.data.thumbnailUrl = toFlowaiUrl(n.data.thumbnailUrl);
  }
  return snap;
}

export async function cloneWork(id: string): Promise<{ projectId: string }> {
  return apiFetch(`/video-works/${id}/clone`, { method: 'POST' });
}

/** 公开轮播设置（第八轮自 Task 8.3 前移至此——Task 7.3 测试已 mock 该导出，automock 下缺失导出是同步 TypeError） */
export async function getPublicSettings(): Promise<VideoWorkSettings> {
  return apiFetch('/video-works/settings');
}
