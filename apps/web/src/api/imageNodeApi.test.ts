import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useNodeStore, NODE_TYPES } from '@/stores/nodeStore';
import type { AppNode, ImageNodeData } from '@/stores/nodeStore';
import { buildImageGenParams } from './imageNodeApi';

// Mock the executionApi
vi.mock('@/api/executionApi', () => ({
  enqueueWorkflow: vi.fn().mockResolvedValue({ jobId: 'job-1', status: 'queued' }),
}));

const { mockProjectIdRef } = vi.hoisted(() => ({ mockProjectIdRef: { value: 'proj-test-123' as string | null } }));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({ projectId: mockProjectIdRef.value }),
  },
}));

describe('imageNodeApi — buildImageGenParams', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {} });
    vi.clearAllMocks();
    mockProjectIdRef.value = 'proj-test-123';
  });

  it('should include nodeType: imageGen', () => {
    const node: AppNode = {
      id: 'img1',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: {
        status: 'idle',
        model: 'sdxl',
        ratio: '16:9',
        resolution: '2K',
        quality: 'standard',
        prompt: { text: 'a beautiful sunset', html: '<p>a beautiful sunset</p>', referencedImageIds: [] },
        allImages: [],
      } as ImageNodeData,
    };
    useNodeStore.getState().addNode(node);

    const params = buildImageGenParams('img1');
    expect(params.nodeType).toBe(NODE_TYPES.IMAGE_GEN);
  });

  it('should include allImages from root level', () => {
    const node: AppNode = {
      id: 'img2',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: {
        status: 'idle',
        model: 'flux',
        prompt: { text: '', html: '', referencedImageIds: [] },
        allImages: [
          { id: 'ref-1', url: '/img1.png', name: 'ref1.png', status: 'success' },
          { id: 'ref-2', url: '/img2.png', name: 'ref2.png', status: 'success' },
        ],
      } as ImageNodeData,
    };
    useNodeStore.getState().addNode(node);

    const params = buildImageGenParams('img2');
    expect(params.allImages).toHaveLength(2);
    expect(params.allImages).toEqual((node.data as ImageNodeData).allImages);
  });

  it('should include model, ratio, resolution, quality from node data', () => {
    const node: AppNode = {
      id: 'img3',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: {
        status: 'idle',
        model: 'flux-pro',
        ratio: '9:16',
        resolution: '4K',
        quality: 'high',
        prompt: { text: 'test', html: '<p>test</p>', referencedImageIds: [] },
        allImages: [],
      } as ImageNodeData,
    };
    useNodeStore.getState().addNode(node);

    const params = buildImageGenParams('img3');
    expect(params.model).toBe('flux-pro');
    expect(params.ratio).toBe('9:16');
    expect(params.resolution).toBe('4K');
    expect(params.quality).toBe('high');
  });

  it('should return allImages as empty array when not set', () => {
    const node: AppNode = {
      id: 'img4',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: {
        status: 'idle',
        model: 'sdxl',
        prompt: { text: '', html: '', referencedImageIds: [] },
      } as ImageNodeData,
    };
    useNodeStore.getState().addNode(node);

    const params = buildImageGenParams('img4');
    expect(params.allImages).toEqual([]);
  });

  it('should read projectId from canvasStore by default', () => {
    const node: AppNode = {
      id: 'img-p1',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: { status: 'idle', allImages: [] } as ImageNodeData,
    };
    useNodeStore.getState().addNode(node);

    const params = buildImageGenParams('img-p1');
    expect(params.projectId).toBe('proj-test-123');
  });

  it('should prefer opts.projectId over canvasStore', () => {
    const node: AppNode = {
      id: 'img-p2',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: { status: 'idle', allImages: [] } as ImageNodeData,
    };
    useNodeStore.getState().addNode(node);

    const params = buildImageGenParams('img-p2', { projectId: 'explicit-1' });
    expect(params.projectId).toBe('explicit-1');
  });

  it('should fall back to "default" when canvasStore projectId is null', () => {
    mockProjectIdRef.value = null;
    const node: AppNode = {
      id: 'img-p3',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: { status: 'idle', allImages: [] } as ImageNodeData,
    };
    useNodeStore.getState().addNode(node);

    const params = buildImageGenParams('img-p3');
    expect(params.projectId).toBe('default');
  });
});
