import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWorkflowAssets } from './useWorkflowAssets';
import { useNodeStore } from '@/stores/nodeStore';
import { batchGetMedia } from '@/api/mediaApi';

vi.mock('@/api/mediaApi', () => ({ batchGetMedia: vi.fn() }));

describe('useWorkflowAssets（nodeStore 聚合 fileId → batch 批查）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNodeStore.setState({
      nodes: {
        v1: { id: 'v1', type: 'videoGen', position: { x: 0, y: 0 }, data: { fileId: 'm1', status: 'done', duration: 5 } },
        a1: { id: 'a1', type: 'audioGen', position: { x: 0, y: 0 }, data: { fileId: 'm2', status: 'done' } },
        v2: { id: 'v2', type: 'videoGen', position: { x: 0, y: 0 }, data: { status: 'loading' } },
        e1: { id: 'e1', type: 'videoEdit', position: { x: 0, y: 0 }, data: {} },
      } as any,
    });
  });
  it('收集生成节点 fileId 产物并批查（sourceNodeId 关联保留）', async () => {
    (batchGetMedia as any).mockResolvedValue([
      { id: 'm1', originalName: '视频A.mp4', mimeType: 'video/mp4', url: 'http://u1', thumbnailUrl: 'http://t1', metadata: {} },
      { id: 'm2', originalName: '音频B.mp3', mimeType: 'audio/mpeg', url: 'http://u2', thumbnailUrl: null, metadata: {} },
    ]);
    const { result } = renderHook(() => useWorkflowAssets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(batchGetMedia).toHaveBeenCalledWith(['m1', 'm2']);
    expect(result.current.items.find(i => i.mediaId === 'm1')?.sourceNodeId).toBe('v1');
    expect(result.current.items.find(i => i.mediaId === 'm1')?.nodeDurationSec).toBe(5);
    expect(result.current.items.find(i => i.mediaId === 'm2')?.nodeDurationSec).toBeUndefined();
    expect(result.current.items.find(i => i.mediaId === 'm2')?.kind).toBe('audio');
  });
  it('batch 失败降级空列表不炸', async () => {
    (batchGetMedia as any).mockRejectedValue(new Error('net'));
    const { result } = renderHook(() => useWorkflowAssets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(0);
  });
});
