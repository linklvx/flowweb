// mediaApi.test.ts（Y1a+Y1b T5：读侧迁移 content 路由——/url 端点删除+batch url 字段=content 路径）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMediaUrl, batchGetMedia, batchGetMediaRewritten, MEDIA_URL_CACHE_TTL_SEC } from './mediaApi';

// Mock apiFetch（batch 仍走网络；getMediaUrl 已无网络——content 路径纯本地推导）
vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '@/api/client';

const row = (id: string, url: string) => ({
  id, originalName: id, mimeType: 'image/png', size: 1, url, thumbnailUrl: null, metadata: {}, ttlSec: 86400,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getMediaUrl（T5：纯本地 content 路径——不再请求 /media/:id/url）', () => {
  it('返回 /api/media/:id/content + 长效 ttlSec（content 路径无签名寿命——ttlSec 降级为缓存提示）', async () => {
    const r = await getMediaUrl('f1');
    expect(r.url).toBe('/api/media/f1/content');
    expect(r.ttlSec).toBe(MEDIA_URL_CACHE_TTL_SEC);
    expect(apiFetch).not.toHaveBeenCalled();   // 红断言：现状 GET /media/:id/url 网络往返+ /flowai 改写
  });
});

describe('batchGetMediaRewritten（T5：响应 url 已是 content 路径——/flowai 改写退役）', () => {
  it('content 路径原样透传（同源路径零改写）；endpoint/method/body 与 batchGetMedia 全同', async () => {
    (apiFetch as any).mockResolvedValueOnce([row('f1', '/api/media/f1/content')]);
    const rows = await batchGetMediaRewritten(['f1'], 't1');
    expect(apiFetch).toHaveBeenCalledWith(
      '/media/batch?teamId=t1',
      { method: 'POST', body: JSON.stringify({ ids: ['f1'] }) },
    );
    expect(rows[0].url).toBe('/api/media/f1/content');
  });

  it('既有 batchGetMedia 行为不变回归（useWorkflowAssets.ts:32 / VideoEditNode.tsx:109 消费面）：url 原样透传', async () => {
    (apiFetch as any).mockResolvedValueOnce([row('f2', '/api/media/f2/content')]);
    const rows = await batchGetMedia(['f2']);
    expect(apiFetch).toHaveBeenCalledWith('/media/batch', { method: 'POST', body: JSON.stringify({ ids: ['f2'] }) });
    expect(rows[0].url).toBe('/api/media/f2/content');
  });

  it('batch 响应带 ttlSec（BatchMediaItem 契约字段维持——api 侧 MEDIA_CONTENT_URL_TTL_SEC 单源各自锁）', async () => {
    (apiFetch as any).mockResolvedValueOnce([row('f3', '/api/media/f3/content')]);
    const rows = await batchGetMediaRewritten(['f3']);
    expect(rows[0].ttlSec).toBe(86400);   // 对齐 api 真值 MEDIA_CONTENT_URL_TTL_SEC=86_400（media-batch.service——双端单源锁留 T6 census）
  });
});
