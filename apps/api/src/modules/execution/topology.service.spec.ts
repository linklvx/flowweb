import { Test, TestingModule } from '@nestjs/testing';
import { TopologyService } from './topology.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('TopologyService', () => {
  let service: TopologyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TopologyService],
    }).compile();
    service = module.get<TopologyService>(TopologyService);
  });

  describe('sort', () => {
    it('should return topological order for chain: n1→n2→n3', () => {
      const nodes = [
        { id: 'n1', type: 'textInput', position: {}, data: { content: 'hello' } },
        { id: 'n2', type: 'imageGen', position: {}, data: { model: 'm1' } },
        { id: 'n3', type: 'imageGen', position: {}, data: { model: 'm1' } },
      ];
      const edges = [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
      ];
      const order = service.sort(nodes as any, edges as any);
      expect(order.map((n: any) => n.id)).toEqual(['n1', 'n2', 'n3']);
    });

    it('should handle nodes with no edges', () => {
      const nodes = [{ id: 'n1', type: 'textInput', position: {}, data: {} }];
      const order = service.sort(nodes as any, []);
      expect(order).toHaveLength(1);
    });
  });

  describe('getScope', () => {
    it('should return node + all upstream nodes', () => {
      const nodes = [
        { id: 'n1', type: 'textInput' }, { id: 'n2', type: 'textInput' }, { id: 'n3', type: 'imageGen' },
      ];
      const edges = [
        { id: 'e1', source: 'n1', target: 'n3' },
        { id: 'e2', source: 'n2', target: 'n3' },
      ];
      const scope = service.getScope(nodes as any, edges as any, 'n3');
      const ids = scope.map((n: any) => n.id).sort();
      expect(ids).toEqual(['n1', 'n2', 'n3']);
    });
  });

  describe('collectUpstreamData（Y1a T8：上游产物读 NodeArtifact PG 权威——doc resultUrl 读源退役）', () => {
    const noMedia = async () => null;

    it('should collect text content from upstream text nodes', async () => {
      const nodes = [
        { id: 'n1', type: 'textInput', data: { content: '一只猫' } },
        { id: 'n2', type: 'textInput', data: { content: '坐在窗台上' } },
        { id: 'n3', type: 'imageGen', data: {} },
      ];
      const edges = [
        { source: 'n1', target: 'n3' }, { source: 'n2', target: 'n3' },
      ];
      const upstream = await service.collectUpstreamData('p1', 'n3', nodes as any, edges as any, noMedia);
      expect(upstream.textContents).toContain('一只猫');
      expect(upstream.textContents).toContain('坐在窗台上');
      expect(upstream.imageMediaId).toBeUndefined();
    });

    it('Y1a T8 红测 1（拓扑投影滞后）：doc 尚无 fileId/resultUrl 时 NodeArtifact reader 取到 mediaId（PG 行 finalize 即建——doc 滞后不再漂移）', async () => {
      const nodes = [
        { id: 'n1', type: 'imageGen', data: {} },   // doc 无 resultUrl/fileId（投影滞后）
        { id: 'n2', type: 'imageGen', data: {} },
      ];
      const edges = [{ source: 'n1', target: 'n2' }];
      const readMediaId = vi.fn().mockResolvedValue('media-upstream-1');
      const upstream = await service.collectUpstreamData('p1', 'n2', nodes as any, edges as any, readMediaId);
      expect(upstream.imageMediaId).toBe('media-upstream-1');
      expect(readMediaId).toHaveBeenCalledWith('p1', 'n1');
      expect(upstream.textContents).toEqual([]);
    });

    it('imageExtGen 上游同经 reader 取身份（三类生成节点同一读源）', async () => {
      const nodes = [
        { id: 'n1', type: 'imageExtGen', data: { resultUrl: '/img/ext.jpg' } },  // doc 残留值不再被读
        { id: 'n2', type: 'imageGen', data: {} },
      ];
      const edges = [{ source: 'n1', target: 'n2' }];
      const upstream = await service.collectUpstreamData('p1', 'n2', nodes as any, edges as any, async () => 'media-ext-1');
      expect(upstream.imageMediaId).toBe('media-ext-1');
    });

    it('videoGen 上游同经 reader 取身份（imageGen→videoGen 链）', async () => {
      const nodes = [
        { id: 'n1', type: 'videoGen', data: {} },
        { id: 'n2', type: 'imageGen', data: {} },
      ];
      const edges = [{ source: 'n1', target: 'n2' }];
      const upstream = await service.collectUpstreamData('p1', 'n2', nodes as any, edges as any, async () => 'media-video-1');
      expect(upstream.imageMediaId).toBe('media-video-1');
    });

    it('reader 无终态产物（null）→ imageMediaId 缺省（无上游图外呼省略 imageUrl）', async () => {
      const nodes = [
        { id: 'n1', type: 'imageGen', data: { resultUrl: '/img/stale.jpg' } },  // doc 有值但 PG 无行=投影未建/未终态
        { id: 'n2', type: 'imageGen', data: {} },
      ];
      const edges = [{ source: 'n1', target: 'n2' }];
      const upstream = await service.collectUpstreamData('p1', 'n2', nodes as any, edges as any, noMedia);
      expect(upstream.imageMediaId).toBeUndefined();   // 不回退 doc resultUrl——读源已退役
    });

    it('首条上游优先（多上游边同 imageUrl 语义——先到先得）', async () => {
      const nodes = [
        { id: 'n1', type: 'imageGen', data: {} },
        { id: 'n2', type: 'imageGen', data: {} },
        { id: 'n3', type: 'imageGen', data: {} },
      ];
      const edges = [
        { source: 'n1', target: 'n3' }, { source: 'n2', target: 'n3' },
      ];
      const readMediaId = vi.fn().mockImplementation(async (_p: string, nodeId: string) => (nodeId === 'n1' ? 'media-first' : 'media-second'));
      const upstream = await service.collectUpstreamData('p1', 'n3', nodes as any, edges as any, readMediaId);
      expect(upstream.imageMediaId).toBe('media-first');
    });

    it('should return empty when no upstream nodes', async () => {
      const nodes = [{ id: 'n1', type: 'imageGen', data: {} }];
      const upstream = await service.collectUpstreamData('p1', 'n1', nodes as any, [], noMedia);
      expect(upstream.textContents).toEqual([]);
      expect(upstream.imageMediaId).toBeUndefined();
    });
  });
});
