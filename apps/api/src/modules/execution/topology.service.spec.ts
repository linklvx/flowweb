import { Test, TestingModule } from '@nestjs/testing';
import { TopologyService } from './topology.service';
import { describe, it, expect, beforeEach } from 'vitest';

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

  describe('collectUpstreamData', () => {
    it('should collect text content from upstream text nodes', () => {
      const nodes = [
        { id: 'n1', type: 'textInput', data: { content: '一只猫' } },
        { id: 'n2', type: 'textInput', data: { content: '坐在窗台上' } },
        { id: 'n3', type: 'imageGen', data: {} },
      ];
      const edges = [
        { source: 'n1', target: 'n3' }, { source: 'n2', target: 'n3' },
      ];
      const upstream = service.collectUpstreamData('n3', nodes as any, edges as any);
      expect(upstream.textContents).toContain('一只猫');
      expect(upstream.textContents).toContain('坐在窗台上');
      expect(upstream.imageUrl).toBeUndefined();
    });

    it('should collect image resultUrl from upstream image node for img2img', () => {
      const nodes = [
        { id: 'n1', type: 'imageGen', data: { resultUrl: '/img/cat.jpg' } },
        { id: 'n2', type: 'imageGen', data: {} },
      ];
      const edges = [{ source: 'n1', target: 'n2' }];
      const upstream = service.collectUpstreamData('n2', nodes as any, edges as any);
      expect(upstream.imageUrl).toBe('/img/cat.jpg');
      expect(upstream.textContents).toEqual([]);
    });

    it('should return empty when no upstream nodes', () => {
      const nodes = [{ id: 'n1', type: 'imageGen', data: {} }];
      const upstream = service.collectUpstreamData('n1', nodes as any, []);
      expect(upstream.textContents).toEqual([]);
      expect(upstream.imageUrl).toBeUndefined();
    });
  });
});
