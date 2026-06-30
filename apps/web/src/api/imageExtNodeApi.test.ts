import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useNodeStore, NODE_TYPES } from '@/stores/nodeStore';
import type { AppNode, ImageNodeData } from '@/stores/nodeStore';
import { buildImageExtGenParams } from './imageExtNodeApi';

vi.mock('@/api/executionApi', () => ({
  enqueueWorkflow: vi.fn().mockResolvedValue({ jobId: 'job-ext-1', status: 'queued' }),
}));

describe('imageExtNodeApi — buildImageExtGenParams', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {} });
    vi.clearAllMocks();
  });

  it('should include nodeType: imageExtGen', () => {
    const node: AppNode = {
      id: 'ext1',
      type: 'imageExtGen',
      position: { x: 0, y: 0 },
      data: {
        status: 'idle',
        allImages: [],
        extConfig: { model: 'ext-model', ratio: '1:1', resolution: '2K', quality: 'standard', generateCount: 1 },
        aiTool: 'film_lighting' as any,
      } as ImageNodeData,
    };
    useNodeStore.getState().addNode(node);

    const params = buildImageExtGenParams('ext1');
    expect(params.nodeType).toBe(NODE_TYPES.IMAGE_EXT_GEN);
  });

  it('should include allImages from root level', () => {
    const node: AppNode = {
      id: 'ext2',
      type: 'imageExtGen',
      position: { x: 0, y: 0 },
      data: {
        status: 'idle',
        allImages: [
          { id: 'ref-ext-1', url: '/ext1.png', name: 'ext1.png', status: 'success' },
        ],
        extConfig: { model: 'ext-model', ratio: '16:9', resolution: '2K', quality: 'standard', generateCount: 1 },
      } as ImageNodeData,
    };
    useNodeStore.getState().addNode(node);

    const params = buildImageExtGenParams('ext2');
    expect(params.allImages).toHaveLength(1);
    expect(params.allImages![0].id).toBe('ref-ext-1');
  });

  it('should include aiTool from root level', () => {
    const node: AppNode = {
      id: 'ext3',
      type: 'imageExtGen',
      position: { x: 0, y: 0 },
      data: {
        status: 'idle',
        allImages: [],
        extConfig: { model: 'm', ratio: '1:1', resolution: '2K', quality: 'standard', generateCount: 1 },
        aiTool: 'nine_camera' as any,
      } as ImageNodeData,
    };
    useNodeStore.getState().addNode(node);

    const params = buildImageExtGenParams('ext3');
    expect(params.aiTool).toBe('nine_camera');
  });

  it('should read model, ratio, resolution, quality, generateCount from extConfig', () => {
    const node: AppNode = {
      id: 'ext4',
      type: 'imageExtGen',
      position: { x: 0, y: 0 },
      data: {
        status: 'idle',
        allImages: [],
        extConfig: {
          model: 'ext-flux',
          ratio: '4:3',
          resolution: '4K',
          quality: 'high',
          generateCount: 8,
        },
      } as ImageNodeData,
    };
    useNodeStore.getState().addNode(node);

    const params = buildImageExtGenParams('ext4');
    expect(params.model).toBe('ext-flux');
    expect(params.ratio).toBe('4:3');
    expect(params.resolution).toBe('4K');
    expect(params.quality).toBe('high');
    expect(params.generateCount).toBe(8);
  });

  it('should use default values when extConfig is missing (fallback)', () => {
    const node: AppNode = {
      id: 'ext5',
      type: 'imageExtGen',
      position: { x: 0, y: 0 },
      data: {
        status: 'idle',
        allImages: [],
        // no extConfig — simulates legacy node
      } as ImageNodeData,
    };
    useNodeStore.getState().addNode(node);

    const params = buildImageExtGenParams('ext5');
    // Should use IMAGE_EXT_DEFAULTS
    expect(params.ratio).toBe('16:9');
    expect(params.resolution).toBe('2K');
    expect(params.quality).toBe('standard');
    expect(params.generateCount).toBe(1);
  });

  it('should include projectId: default', () => {
    const node: AppNode = {
      id: 'ext6',
      type: 'imageExtGen',
      position: { x: 0, y: 0 },
      data: {
        status: 'idle',
        allImages: [],
        extConfig: { model: 'm', ratio: '1:1', resolution: '2K', quality: 'standard', generateCount: 1 },
      } as ImageNodeData,
    };
    useNodeStore.getState().addNode(node);

    const params = buildImageExtGenParams('ext6');
    expect(params.projectId).toBe('default');
  });
});
