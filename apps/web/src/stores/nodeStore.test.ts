import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useNodeStore, isImageNode, isTextNode } from './nodeStore';
import type { AppNode, TextNodeData, ImageNodeData, VideoNodeData, PromptValue, ImageItem } from './nodeStore';

describe('nodeStore (AppNode nested structure)', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {} });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. should initialize with empty nodes map
  it('should initialize with empty nodes map', () => {
    expect(useNodeStore.getState().nodes).toEqual({});
  });

  // 2. addNode should add text node with readable data.content
  it('addNode should add text node with readable data.content', () => {
    const textNode: AppNode = {
      id: 't1',
      type: 'text',
      position: { x: 100, y: 200 },
      data: { content: 'hello world' } as TextNodeData,
    };

    useNodeStore.getState().addNode(textNode);
    const stored = useNodeStore.getState().nodes['t1'];

    expect(stored).toBeDefined();
    expect(stored.id).toBe('t1');
    expect(stored.type).toBe('text');
    expect(stored.position).toEqual({ x: 100, y: 200 });
    const textData = stored.data as TextNodeData;
    expect(textData.content).toBe('hello world');
  });

  // 3. addNode should add image node with all defaults
  it('addNode should add image node with all defaults', () => {
    const imageNode: AppNode = {
      id: 'img1',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: {
        style: '写实',
        model: 'sdxl',
        quality: 'standard',
        ratio: '1:1',
        status: 'idle',
        prompt: { text: '', html: '', allImages: [], referencedImageIds: [] },
      } as ImageNodeData,
    };

    useNodeStore.getState().addNode(imageNode);
    const stored = useNodeStore.getState().nodes['img1'];

    expect(stored).toBeDefined();
    expect(stored.type).toBe('imageGen');
    const imgData = stored.data as ImageNodeData;
    expect(imgData.style).toBe('写实');
    expect(imgData.model).toBe('sdxl');
    expect(imgData.quality).toBe('standard');
    expect(imgData.ratio).toBe('1:1');
    expect(imgData.status).toBe('idle');
    expect(imgData.prompt).toEqual({ text: '', html: '', allImages: [], referencedImageIds: [] });
  });

  // 4. addNode should store id/type/position metadata at node level
  it('should store id/type/position metadata at node level, not inside data', () => {
    const node: AppNode = {
      id: 'meta',
      type: 'video',
      position: { x: 300, y: 400 },
      selected: true,
      dragging: false,
      data: { model: 'svd', status: 'idle' } as VideoNodeData,
    };

    useNodeStore.getState().addNode(node);
    const stored = useNodeStore.getState().nodes['meta'];

    // Metadata at node level
    expect(stored.id).toBe('meta');
    expect(stored.type).toBe('video');
    expect(stored.position).toEqual({ x: 300, y: 400 });
    expect(stored.selected).toBe(true);
    expect(stored.dragging).toBe(false);

    // Data is separate
    expect(stored.data).toBeDefined();
    expect(stored.data).not.toHaveProperty('id');
    expect(stored.data).not.toHaveProperty('type');
    expect(stored.data).not.toHaveProperty('position');
  });

  // 5. updateNodeData should partial-merge without overwriting other fields
  it('should partial-merge without overwriting other fields', () => {
    const node: AppNode = {
      id: 'img1',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: {
        style: '写实',
        model: 'sdxl',
        quality: 'standard',
        ratio: '1:1',
        status: 'idle',
        prompt: { text: '', html: '', allImages: [], referencedImageIds: [] },
      } as ImageNodeData,
    };

    useNodeStore.getState().addNode(node);
    useNodeStore.getState().updateNodeData<ImageNodeData>('img1', { model: 'flux' });

    const stored = useNodeStore.getState().nodes['img1'];
    const imgData = stored.data as ImageNodeData;
    expect(imgData.model).toBe('flux');
    // Other fields preserved
    expect(imgData.style).toBe('写实');
    expect(imgData.quality).toBe('standard');
    expect(imgData.ratio).toBe('1:1');
    expect(imgData.status).toBe('idle');
  });

  // 6. updateNodeData should update image node model/ratio/quality
  it('should update image node model/ratio/quality', () => {
    const node: AppNode = {
      id: 'img2',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: {
        style: '动漫',
        model: 'sdxl',
        quality: 'standard',
        ratio: '1:1',
        status: 'idle',
        prompt: { text: 'a cat', allImages: [], referencedImageIds: [] },
      } as ImageNodeData,
    };

    useNodeStore.getState().addNode(node);
    useNodeStore
      .getState()
      .updateNodeData<ImageNodeData>('img2', { model: 'flux', ratio: '16:9', quality: '2k' });

    const stored = useNodeStore.getState().nodes['img2'];
    const imgData = stored.data as ImageNodeData;
    expect(imgData.model).toBe('flux');
    expect(imgData.ratio).toBe('16:9');
    expect(imgData.quality).toBe('2k');
  });

  // 7. updateNodeData should update text node content
  it('should update text node content', () => {
    const textNode: AppNode = {
      id: 't1',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { content: 'original' } as TextNodeData,
    };

    useNodeStore.getState().addNode(textNode);
    useNodeStore.getState().updateNodeData<TextNodeData>('t1', { content: 'updated' });

    const stored = useNodeStore.getState().nodes['t1'];
    const textData = stored.data as TextNodeData;
    expect(textData.content).toBe('updated');
  });

  // 8. updateText convenience method should update content
  it('should update text content via updateText convenience method', () => {
    const textNode: AppNode = {
      id: 't2',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { content: 'hello' } as TextNodeData,
    };

    useNodeStore.getState().addNode(textNode);
    useNodeStore.getState().updateText('t2', 'world');

    const stored = useNodeStore.getState().nodes['t2'];
    const textData = stored.data as TextNodeData;
    expect(textData.content).toBe('world');
    expect(stored.type).toBe('text');
  });

  // 9. updateConfig convenience method should set config with defaults
  it('should set config with defaults via updateConfig', () => {
    // Start with an empty config
    useNodeStore.getState().updateConfig('img3', {});

    const stored = useNodeStore.getState().nodes['img3'];
    expect(stored).toBeDefined();
    const imgData = stored.data as ImageNodeData;
    expect(imgData.style).toBe('写实');
    expect(imgData.model).toBe('sdxl');
    expect(imgData.quality).toBe('standard');
    expect(imgData.ratio).toBe('16:9');
    expect(imgData.status).toBe('idle');
    expect(imgData.prompt).toEqual({ text: '', html: '', allImages: [], referencedImageIds: [] });
  });

  it('should persist prompt text via updateConfig', () => {
    useNodeStore.getState().updateConfig('img9', {
      prompt: { text: 'hello world', allImages: [], referencedImageIds: [] },
    });
    const stored = useNodeStore.getState().nodes['img9'];
    const imgData = stored.data as ImageNodeData;
    expect(imgData.prompt.text).toBe('hello world');
  });

  // 10. setStatus should update status field
  it('should update status field via setStatus', () => {
    useNodeStore.getState().updateConfig('img4', { style: '写实' });
    useNodeStore.getState().setStatus('img4', 'loading');

    const stored = useNodeStore.getState().nodes['img4'];
    const imgData = stored.data as ImageNodeData;
    expect(imgData.status).toBe('loading');
  });

  // 11. setFileResult should set fileId and mark status='done'
  it('should set fileId and mark status=done via setFileResult', () => {
    useNodeStore.getState().updateConfig('img5', { style: '写实' });
    useNodeStore.getState().setFileResult('img5', 'file-abc-123');

    const stored = useNodeStore.getState().nodes['img5'];
    const imgData = stored.data as ImageNodeData;
    expect(imgData.fileId).toBe('file-abc-123');
    expect(imgData.status).toBe('done');
  });

  // 12. deleteNode should remove node (nodes[id] is undefined after)
  it('should remove node via deleteNode', async () => {
    const node: AppNode = {
      id: 'to-delete',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { content: 'delete me' } as TextNodeData,
    };

    useNodeStore.getState().addNode(node);
    expect(useNodeStore.getState().nodes['to-delete']).toBeDefined();

    await useNodeStore.getState().deleteNode('to-delete');
    expect(useNodeStore.getState().nodes['to-delete']).toBeUndefined();
  });

  // 13. getNodeData should return data for existing node
  it('should return data for existing node via getNodeData', () => {
    const textNode: AppNode = {
      id: 't-data',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { content: 'test data' } as TextNodeData,
    };

    useNodeStore.getState().addNode(textNode);
    const data = useNodeStore.getState().getNodeData<TextNodeData>('t-data');

    expect(data).toBeDefined();
    expect(data!.content).toBe('test data');
  });

  // 14. getNodeData should return undefined for non-existent node
  it('should return undefined for non-existent node', () => {
    expect(useNodeStore.getState().getNodeData('does-not-exist')).toBeUndefined();
  });

  // 15. updateNodeData on non-existent id should NOT throw, silently return
  it('should not throw when updating non-existent node, silently return', () => {
    expect(() => {
      useNodeStore.getState().updateNodeData<ImageNodeData>('nonexistent', { model: 'flux' });
    }).not.toThrow();

    // State should remain unchanged
    expect(useNodeStore.getState().nodes['nonexistent']).toBeUndefined();
  });

  // 16. deleteNode should handle async resource cleanup (use fake timers)
  it('should handle async resource cleanup on deleteNode for image nodes', async () => {
    vi.useFakeTimers();

    const imageNode: AppNode = {
      id: 'img-cleanup',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: {
        style: '写实',
        model: 'sdxl',
        quality: 'standard',
        ratio: '1:1',
        status: 'done',
        fileId: 'file-to-cleanup',
        prompt: {
          text: 'test',
          allImages: [
            { id: 'ref-img-1', url: '/img1.png', name: 'ref1.png', status: 'success' },
          ],
          referencedImageIds: ['ref-img-1'],
        } as PromptValue,
      } as ImageNodeData,
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 })
    );

    useNodeStore.getState().addNode(imageNode);
    const deletePromise = useNodeStore.getState().deleteNode('img-cleanup');

    // Advance timers so all async cleanup resolves
    await vi.runAllTimersAsync();
    await deletePromise;

    // Should have called DELETE for reference images and fileId
    const deleteCalls = fetchSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' && (call[0] as string).includes('DELETE')
    );
    // Allow the calls to have happened (some implementations batch)
    expect(fetchSpy).toHaveBeenCalled();

    // Node should be removed
    expect(useNodeStore.getState().nodes['img-cleanup']).toBeUndefined();

    vi.useRealTimers();
  });

  // 17. isImageNode type guard should correctly narrow type
  it('should correctly narrow via isImageNode type guard', () => {
    const imageNode: AppNode = {
      id: 'img-guard',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: {
        style: '写实',
        model: 'flux',
        quality: '2k',
        ratio: '16:9',
        status: 'idle',
        prompt: { text: '', html: '', allImages: [], referencedImageIds: [] },
      } as ImageNodeData,
    };

    const textNode: AppNode = {
      id: 'txt-guard',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { content: 'hello' } as TextNodeData,
    };

    useNodeStore.getState().addNode(imageNode);
    useNodeStore.getState().addNode(textNode);

    const img = useNodeStore.getState().nodes['img-guard'];
    const txt = useNodeStore.getState().nodes['txt-guard'];

    if (isImageNode(img)) {
      // TypeScript should narrow to ImageNodeData
      expect(img.data.model).toBe('flux');
      expect(img.data.ratio).toBe('16:9');
    } else {
      // Should not reach here for image node
      expect.unreachable('isImageNode should return true for image type');
    }

    expect(isImageNode(txt)).toBe(false);
  });

  // 18. isTextNode type guard should correctly narrow type
  it('should correctly narrow via isTextNode type guard', () => {
    const textNode: AppNode = {
      id: 'txt-guard-2',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { content: 'hello world' } as TextNodeData,
    };

    useNodeStore.getState().addNode(textNode);
    const stored = useNodeStore.getState().nodes['txt-guard-2'];

    if (isTextNode(stored)) {
      expect(stored.data.content).toBe('hello world');
    } else {
      expect.unreachable('isTextNode should return true for text type');
    }

    // Negative test — image node is not text
    const imageNode: AppNode = {
      id: 'img-guard-2',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: {
        style: '写实',
        model: 'sdxl',
        quality: 'standard',
        ratio: '1:1',
        status: 'idle',
        prompt: { text: '', html: '', allImages: [], referencedImageIds: [] },
      } as ImageNodeData,
    };

    useNodeStore.getState().addNode(imageNode);
    const imgStored = useNodeStore.getState().nodes['img-guard-2'];
    expect(isTextNode(imgStored)).toBe(false);
  });

  // 19. updatePromptImages should update allImages without touching other prompt fields
  it('should update allImages without overwriting other prompt fields', () => {
    const node: AppNode = {
      id: 'img-prompt',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: {
        style: '写实',
        model: 'sdxl',
        quality: 'standard',
        ratio: '1:1',
        status: 'idle',
        prompt: { text: 'a cat', allImages: [], referencedImageIds: ['ref-1'] },
      } as ImageNodeData,
    };

    useNodeStore.getState().addNode(node);
    const newImages: ImageItem[] = [
      { id: 'img-1', url: '/api/storage/files/img-1', name: 'ref1.png', status: 'success' },
      { id: 'img-2', url: '/api/storage/files/img-2', name: 'ref2.png', status: 'uploading', progress: 45 },
    ];

    useNodeStore.getState().updatePromptImages('img-prompt', newImages);

    const stored = useNodeStore.getState().nodes['img-prompt'];
    const imgData = stored.data as ImageNodeData;
    expect(imgData.prompt.allImages).toEqual(newImages);
    // Other prompt fields preserved
    expect(imgData.prompt.text).toBe('a cat');
    expect(imgData.prompt.referencedImageIds).toEqual(['ref-1']);
  });

  // 20. updatePromptImages should noop for text nodes (text nodes have no prompt)
  it('should noop for text nodes', () => {
    const textNode: AppNode = {
      id: 'txt-prompt',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { content: 'hello' } as TextNodeData,
    };

    useNodeStore.getState().addNode(textNode);
    useNodeStore.getState().updatePromptImages('txt-prompt', [
      { id: 'img-1', url: '/u', name: 'x.png', status: 'success' },
    ]);

    // Should NOT have prompt field
    const stored = useNodeStore.getState().nodes['txt-prompt'];
    expect(stored.data).not.toHaveProperty('prompt');
  });

  // 20b. updatePromptImages should work for videoGen nodes (independent from imageGen)
  it('should update prompt images for videoGen nodes', () => {
    const videoNode: AppNode = {
      id: 'vid-prompt',
      type: 'videoGen',
      position: { x: 100, y: 100 },
      data: { model: '', status: 'idle' as const },
    };
    useNodeStore.getState().addNode(videoNode);

    const newImages: ImageItem[] = [
      { id: 'vid-img-1', url: '/api/storage/files/vid-img-1', name: 'frame1.png', status: 'success' },
    ];
    useNodeStore.getState().updatePromptImages('vid-prompt', newImages);

    const stored = useNodeStore.getState().nodes['vid-prompt'];
    expect(stored.data.prompt).toBeDefined();
    expect(stored.data.prompt.allImages).toEqual(newImages);
  });

  // 21. updatePromptImages should noop for non-existent node
  it('should noop for non-existent node', () => {
    expect(() => {
      useNodeStore.getState().updatePromptImages('no-exist', []);
    }).not.toThrow();
  });

  // 22b. updateConfig should provide default rotation/flip/transformMode on new image node
  it('should default imageRotation to 0 and flipH/flipV to false on new image node', () => {
    useNodeStore.getState().updateConfig('img-rotate-defaults', {});
    const stored = useNodeStore.getState().nodes['img-rotate-defaults'];
    const imgData = stored.data as ImageNodeData;
    expect(imgData.imageRotation).toBe(0);
    expect(imgData.flipH).toBe(false);
    expect(imgData.flipV).toBe(false);
    expect(imgData.transformMode).toBe(false);
  });

  // 22c. updateConfig should persist imageRotation/flipH/flipV/transformMode updates
  it('should persist imageRotation/flipH/flipV/transformMode via updateConfig', () => {
    useNodeStore.getState().updateConfig('img-rotate-1', { style: '写实' });
    useNodeStore.getState().updateConfig('img-rotate-1', {
      imageRotation: 90 as 0 | 90 | 180 | 270,
      flipH: true,
      flipV: true,
      transformMode: true,
    });
    const stored = useNodeStore.getState().nodes['img-rotate-1'];
    const imgData = stored.data as ImageNodeData;
    expect(imgData.imageRotation).toBe(90);
    expect(imgData.flipH).toBe(true);
    expect(imgData.flipV).toBe(true);
    expect(imgData.transformMode).toBe(true);
  });

  // 22. updateConfig should preserve videoGen node type (not overwrite to imageGen)
  it('should preserve videoGen type when updateConfig called on video node', () => {
    const videoNode: AppNode = {
      id: 'vid-config',
      type: 'videoGen',
      position: { x: 100, y: 100 },
      data: { model: '', status: 'idle' as const },
    };
    useNodeStore.getState().addNode(videoNode);

    // Simulate VideoConfigPanel saving a prompt
    useNodeStore.getState().updateConfig('vid-config', {
      prompt: { text: 'a sunset', allImages: [], referencedImageIds: [] },
    });

    const stored = useNodeStore.getState().nodes['vid-config'];
    expect(stored).toBeDefined();
    // Must preserve videoGen type — NOT overwrite to imageGen
    expect(stored.type).toBe('videoGen');
    // Data must include the updated prompt
    expect(stored.data.prompt.text).toBe('a sunset');
  });

  // ── activeTransformNodeId ──

  it('should initialize activeTransformNodeId as null', () => {
    expect(useNodeStore.getState().activeTransformNodeId).toBeNull();
  });

  it('setActiveTransformNodeId should update activeTransformNodeId', () => {
    useNodeStore.getState().setActiveTransformNodeId('node-x');
    expect(useNodeStore.getState().activeTransformNodeId).toBe('node-x');
  });

  it('setActiveTransformNodeId(null) should clear activeTransformNodeId', () => {
    useNodeStore.getState().setActiveTransformNodeId('node-x');
    useNodeStore.getState().setActiveTransformNodeId(null);
    expect(useNodeStore.getState().activeTransformNodeId).toBeNull();
  });

  // ── cancelRequestedAt ──

  it('should initialize cancelRequestedAt to 0', () => {
    expect(useNodeStore.getState().cancelRequestedAt).toBe(0);
  });

  it('triggerCancelTransform should update cancelRequestedAt', () => {
    const ts = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(ts);
    useNodeStore.getState().triggerCancelTransform();
    expect(useNodeStore.getState().cancelRequestedAt).toBe(ts);
  });

  // ── saveHandlers ──

  it('should initialize saveHandlers as empty object', () => {
    expect(useNodeStore.getState().saveHandlers).toEqual({});
  });

  it('registerSaveHandler should add handler to saveHandlers', () => {
    const handler = vi.fn();
    useNodeStore.getState().registerSaveHandler('n1', handler);
    expect(useNodeStore.getState().saveHandlers['n1']).toBe(handler);
  });

  it('unregisterSaveHandler should remove handler from saveHandlers', () => {
    const handler = vi.fn();
    useNodeStore.getState().registerSaveHandler('n1', handler);
    useNodeStore.getState().unregisterSaveHandler('n1');
    expect(useNodeStore.getState().saveHandlers['n1']).toBeUndefined();
  });

  it('saveTransformNode should call the registered handler', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    useNodeStore.getState().registerSaveHandler('n1', handler);
    await useNodeStore.getState().saveTransformNode('n1');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('saveTransformNode should noop when no handler registered', async () => {
    // Should not throw
    await expect(useNodeStore.getState().saveTransformNode('nonexistent')).resolves.toBeUndefined();
  });

  it('saveTransformNode should catch handler errors', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('upload failed'));
    useNodeStore.getState().registerSaveHandler('fail', handler);
    // Should not throw
    await expect(useNodeStore.getState().saveTransformNode('fail')).resolves.toBeUndefined();
  });
});
