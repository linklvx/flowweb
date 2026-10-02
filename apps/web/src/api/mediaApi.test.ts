// mediaApi.test.ts（2d-4：batchGetMediaRewritten 改写口径 + 既有消费方回归 + ttlSec 契约）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { batchGetMedia, batchGetMediaRewritten } from './mediaApi';

// Mock apiFetch（与 mediaUrlCache.test.ts 同约定：media 层 → apiFetch）
vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '@/api/client';

const row = (id: string, url: string) => ({
  id, originalName: id, mimeType: 'image/png', size: 1, url, thumbnailUrl: null, metadata: {}, ttlSec: 3600,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('batchGetMediaRewritten（2d-4 折叠卡批量预取）', () => {
  it('rewrite opt-in：响应 url 经 /flowai 同源改写（getMediaUrl:7 同款正则）；endpoint/method/body 与 batchGetMedia 全同', async () => {
    (apiFetch as any).mockResolvedValueOnce([row('f1', 'http://minio:9000/flowai/f1')]);
    const rows = await batchGetMediaRewritten(['f1'], 't1');
    expect(apiFetch).toHaveBeenCalledWith(
      '/media/batch?teamId=t1',
      { method: 'POST', body: JSON.stringify({ ids: ['f1'] }) },
    );
    expect(rows[0].url).toBe('/flowai/f1');
  });

  it('既有 batchGetMedia 行为不变回归（useWorkflowAssets.ts:32 / VideoEditNode.tsx:109 消费面）：url 原样透传不改写', async () => {
    (apiFetch as any).mockResolvedValueOnce([row('f2', 'http://minio:9000/flowai/f2')]);
    const rows = await batchGetMedia(['f2']);
    expect(apiFetch).toHaveBeenCalledWith('/media/batch', { method: 'POST', body: JSON.stringify({ ids: ['f2'] }) });
    expect(rows[0].url).toBe('http://minio:9000/flowai/f2');
  });

  it('batch 响应带 ttlSec（BatchMediaItem 契约字段——spec §4.5：web 侧类型锁 + 运行时透传，api 侧常量单源各自锁）', async () => {
    (apiFetch as any).mockResolvedValueOnce([row('f3', 'http://minio:9000/flowai/f3')]);
    const rows = await batchGetMediaRewritten(['f3']);
    expect(rows[0].ttlSec).toBe(3600);
  });
});
