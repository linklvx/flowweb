import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useNodeStore, isImageNode, isImageExtNode, isImageGenNode, isTextNode, ANNOTATION_DEFAULTS, NODE_TYPES, IMAGE_EXT_DEFAULTS } from './nodeStore';
import { useCanvasStore } from './canvasStore';
import type { AppNode, TextNodeData, ImageNodeData, ImageExtConfig, VideoNodeData, AudioNodeData, PromptValue, ImageItem, DrawOp, PenOp, RectOp, LineOp } from './nodeStore';

describe('nodeStore (AppNode nested structure)', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {}, activeTransformNodeId: null, activeEditNodeId: null, cancelRequestedAt: 0, saveHandlers: {} });
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
      data: { content: 'hello world' } as TextNodeData,
    };

    useNodeStore.getState().addNode(textNode);
    const stored = useNodeStore.getState().nodes['t1'];

    expect(stored).toBeDefined();
    expect(stored.id).toBe('t1');
    expect(stored.type).toBe('text');
    const textData = stored.data as TextNodeData;
    expect(textData.content).toBe('hello world');
  });

  // 3. addNode should add image node with all defaults
  it('addNode should add image node with all defaults', () => {
    const imageNode: AppNode = {
      id: 'img1',
      type: 'imageGen',
      data: {
        style: '写实',
        model: 'sdxl',
        quality: 'standard',
        ratio: '1:1',
        status: 'idle',
        prompt: { text: '', html: '', referencedImageIds: [] },
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
    expect(imgData.prompt).toEqual({ text: '', html: '', referencedImageIds: [] });
  });

  // 4. addNode should store id/type metadata at node level
  it('should store id/type metadata at node level, not inside data', () => {
    const node: AppNode = {
      id: 'meta',
      type: 'video',
      selected: true,
      dragging: false,
      data: { model: 'svd', status: 'idle' } as VideoNodeData,
    };

    useNodeStore.getState().addNode(node);
    const stored = useNodeStore.getState().nodes['meta'];

    // Metadata at node level
    expect(stored.id).toBe('meta');
    expect(stored.type).toBe('video');
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
      data: {
        style: '写实',
        model: 'sdxl',
        quality: 'standard',
        ratio: '1:1',
        status: 'idle',
        prompt: { text: '', html: '', referencedImageIds: [] },
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
      data: {
        style: '动漫',
        model: 'sdxl',
        quality: 'standard',
        ratio: '1:1',
        status: 'idle',
        prompt: { text: 'a cat', html: '', referencedImageIds: [] },
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
    // Seed canvasStore so updateConfig rebuild branch passes guard
    useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'img3', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any] }));
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
    expect(imgData.prompt).toEqual({ text: '', html: '', referencedImageIds: [] });
    expect(imgData.allImages).toEqual([]);
  });

  it('should persist prompt text via updateConfig', () => {
    useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'img9', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any] }));
    useNodeStore.getState().updateConfig('img9', {
      prompt: { text: 'hello world', html: '', referencedImageIds: [] },
    });
    const stored = useNodeStore.getState().nodes['img9'];
    const imgData = stored.data as ImageNodeData;
    expect(imgData.prompt!.text).toBe('hello world');
  });

  // 10. setStatus should update status field
  it('should update status field via setStatus', () => {
    useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'img4', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any] }));
    useNodeStore.getState().updateConfig('img4', { style: '写实' });
    useNodeStore.getState().setStatus('img4', 'loading');

    const stored = useNodeStore.getState().nodes['img4'];
    const imgData = stored.data as ImageNodeData;
    expect(imgData.status).toBe('loading');
  });

  // 11. setFileResult should set fileId and mark status='done'
  it('should set fileId and mark status=done via setFileResult', () => {
    useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'img5', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any] }));
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

  // 16. deleteNode removes the node without any file-cleanup calls (TD-15: Media rows are library assets)
  it('should remove node on deleteNode without any fetch calls (TD-15)', async () => {
    vi.useFakeTimers();

    const imageNode: AppNode = {
      id: 'img-cleanup',
      type: 'imageGen',
      data: {
        style: '写实',
        model: 'sdxl',
        quality: 'standard',
        ratio: '1:1',
        status: 'done',
        fileId: 'file-to-cleanup',
        allImages: [
          { id: 'ref-img-1', url: '/img1.png', name: 'ref1.png', status: 'success' },
        ],
        prompt: {
          text: 'test',
          html: '',
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

    // TD-15: canvas node deletion must not touch Media rows (library/history assets)
    expect(fetchSpy).not.toHaveBeenCalled();

    // Node should be removed
    expect(useNodeStore.getState().nodes['img-cleanup']).toBeUndefined();

    vi.useRealTimers();
  });

  // 16a. deleteNode must not DELETE root-level allImages refs (TD-15)
  it('should NOT issue storage DELETEs for root-level allImages refs on deleteNode (TD-15)', async () => {
    const imageNode: AppNode = {
      id: 'img-root-refs',
      type: 'imageGen',
      data: {
        status: 'done',
        allImages: [{ id: 'f1', url: '/f1.png', name: 'f1.png', status: 'success' }],
        prompt: { text: '', html: '', referencedImageIds: [] },
      } as ImageNodeData,
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 })
    );

    useNodeStore.getState().addNode(imageNode);
    await useNodeStore.getState().deleteNode('img-root-refs');

    const storageDeletes = fetchSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && (call[0] as string).startsWith('/api/storage/files/')
    );
    expect(storageDeletes).toHaveLength(0);
  });

  // 16b. deleteNode must not DELETE nested prompt.allImages refs either (legacy data shape, TD-15)
  it('should NOT issue storage DELETEs for legacy nested prompt.allImages refs on deleteNode (TD-15)', async () => {
    const imageNode: AppNode = {
      id: 'img-nested-refs',
      type: 'imageGen',
      data: {
        status: 'done',
        prompt: {
          text: '',
          html: '',
          allImages: [{ id: 'f2', url: '/f2.png', name: 'f2.png', status: 'success' }],
          referencedImageIds: [],
        },
      } as ImageNodeData,
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 })
    );

    useNodeStore.getState().addNode(imageNode);
    await useNodeStore.getState().deleteNode('img-nested-refs');

    const storageDeletes = fetchSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && (call[0] as string).startsWith('/api/storage/files/')
    );
    expect(storageDeletes).toHaveLength(0);
  });

  // 16c. refs present in both root and nested trigger nothing either (TD-15)
  it('should NOT issue storage DELETEs when refs present in both root and nested allImages (TD-15)', async () => {
    const shared = { id: 'f3', url: '/f3.png', name: 'f3.png', status: 'success' as const };
    const imageNode: AppNode = {
      id: 'img-dup-refs',
      type: 'imageGen',
      data: {
        status: 'done',
        allImages: [shared],
        prompt: { text: '', html: '', allImages: [shared], referencedImageIds: [] },
      } as ImageNodeData,
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 })
    );

    useNodeStore.getState().addNode(imageNode);
    await useNodeStore.getState().deleteNode('img-dup-refs');

    const storageDeletes = fetchSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && (call[0] as string).startsWith('/api/storage/files/')
    );
    expect(storageDeletes).toHaveLength(0);
  });

  // 16d. videoGen deletion issues no storage DELETEs at all — refs and generated fileId alike (TD-15)
  it('should NOT issue any storage DELETEs on videoGen deleteNode (TD-15)', async () => {
    const videoNode: AppNode = {
      id: 'vid-refs',
      type: 'videoGen',
      data: {
        model: 'video-model-1',
        status: 'done',
        fileId: 'gen-result-1',
        referenceVideo: 'ref-video-1',
        trimmedFileId: 'trim-out-1',
        allImages: [{ id: 'vf1', url: '/vf1.png', name: 'vf1.png', status: 'success' }],
        prompt: {
          text: '',
          html: '',
          allImages: [
            { id: 'vf1', url: '/vf1.png', name: 'vf1.png', status: 'success' },
            { id: 'vf2', url: '/vf2.png', name: 'vf2.png', status: 'success' },
          ],
          referencedImageIds: [],
        },
      } as VideoNodeData,
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 })
    );

    useNodeStore.getState().addNode(videoNode);
    await useNodeStore.getState().deleteNode('vid-refs');

    const storageDeletes = fetchSpy.mock.calls
      .map((call) => (typeof call[0] === 'string' ? (call[0] as string) : ''))
      .filter((url) => url.startsWith('/api/storage/files/'));
    expect(storageDeletes).toHaveLength(0);
  });

  // 16e. audioGen deletion issues no storage DELETEs either (TD-15)
  it('should NOT issue any storage DELETEs on audioGen deleteNode (TD-15)', async () => {
    const audioNode: AppNode = {
      id: 'aud-refs',
      type: 'audioGen',
      data: {
        model: 'tts-1',
        content: 'hello',
        status: 'done',
        fileId: 'gen-audio-1',
        referenceAudio: 'ref-audio-1',
      } as AudioNodeData,
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 })
    );

    useNodeStore.getState().addNode(audioNode);
    await useNodeStore.getState().deleteNode('aud-refs');

    const storageDeletes = fetchSpy.mock.calls
      .map((call) => (typeof call[0] === 'string' ? (call[0] as string) : ''))
      .filter((url) => url.startsWith('/api/storage/files/'));
    expect(storageDeletes).toHaveLength(0);
  });

  // 17. isImageNode type guard should correctly narrow type
  it('should correctly narrow via isImageNode type guard', () => {
    const imageNode: AppNode = {
      id: 'img-guard',
      type: 'imageGen',
      data: {
        style: '写实',
        model: 'flux',
        quality: '2k',
        ratio: '16:9',
        status: 'idle',
        prompt: { text: '', html: '', referencedImageIds: [] },
      } as ImageNodeData,
    };

    const textNode: AppNode = {
      id: 'txt-guard',
      type: 'text',
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

  // 17b. isImageNode should return true for imageExtGen type
  it('should return true for imageExtGen via isImageNode type guard', () => {
    const extNode: AppNode = {
      id: 'img-ext-guard',
      type: 'imageExtGen',
      data: {
        style: '写实',
        model: 'flux',
        quality: '2k',
        ratio: '16:9',
        status: 'idle',
        prompt: { text: '', html: '', referencedImageIds: [] },
      } as ImageNodeData,
    };

    useNodeStore.getState().addNode(extNode);
    const stored = useNodeStore.getState().nodes['img-ext-guard'];
    expect(isImageNode(stored)).toBe(true);
    if (isImageNode(stored)) {
      expect(stored.data.model).toBe('flux');
    } else {
      expect.unreachable('isImageNode should return true for imageExtGen type');
    }
  });

  // 18. isTextNode type guard should correctly narrow type
  it('should correctly narrow via isTextNode type guard', () => {
    const textNode: AppNode = {
      id: 'txt-guard-2',
      type: 'text',
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
      data: {
        style: '写实',
        model: 'sdxl',
        quality: 'standard',
        ratio: '1:1',
        status: 'idle',
        prompt: { text: '', html: '', referencedImageIds: [] },
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
      data: {
        style: '写实',
        model: 'sdxl',
        quality: 'standard',
        ratio: '1:1',
        status: 'idle',
        prompt: { text: 'a cat', html: '', referencedImageIds: [] },
        allImages: [],
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
    expect(imgData.allImages).toEqual(newImages);
    // Other prompt fields preserved
    expect(imgData.prompt!.text).toBe('a cat');
  });

  // 20. updatePromptImages should noop for text nodes (text nodes have no prompt)
  it('should noop for text nodes', () => {
    const textNode: AppNode = {
      id: 'txt-prompt',
      type: 'text',
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
      data: { model: '', status: 'idle' as const },
    };
    useNodeStore.getState().addNode(videoNode);

    const newImages: ImageItem[] = [
      { id: 'vid-img-1', url: '/api/storage/files/vid-img-1', name: 'frame1.png', status: 'success' },
    ];
    useNodeStore.getState().updatePromptImages('vid-prompt', newImages);

    const stored = useNodeStore.getState().nodes['vid-prompt'];
    expect((stored.data as VideoNodeData).allImages).toEqual(newImages);
  });

  // 21. updatePromptImages should noop for non-existent node
  it('should noop for non-existent node', () => {
    expect(() => {
      useNodeStore.getState().updatePromptImages('no-exist', []);
    }).not.toThrow();
  });

  // 22b. updateConfig should provide default rotation/flip/transformMode on new image node
  it('should default imageRotation to 0 and flipH/flipV to false on new image node', () => {
    useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'img-rotate-defaults', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any] }));
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
    useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'img-rotate-1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any] }));
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
      data: { model: '', status: 'idle' as const },
    };
    useNodeStore.getState().addNode(videoNode);

    // Simulate VideoConfigPanel saving a prompt
    useNodeStore.getState().updateConfig('vid-config', {
      prompt: { text: 'a sunset', html: '', referencedImageIds: [] },
    });

    const stored = useNodeStore.getState().nodes['vid-config'];
    expect(stored).toBeDefined();
    // Must preserve videoGen type — NOT overwrite to imageGen
    expect(stored.type).toBe('videoGen');
    // Data must include the updated prompt
    expect((stored.data as VideoNodeData).prompt!.text).toBe('a sunset');
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

  // ── editMode infrastructure ──

  it('ImageNodeData should default editMode to null', () => {
    useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'edit-default', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any] }));
    useNodeStore.getState().updateConfig('edit-default', {});
    const stored = useNodeStore.getState().nodes['edit-default'];
    const imgData = stored.data as ImageNodeData;
    expect(imgData.editMode).toBeNull();
  });

  it('should persist editMode via updateConfig', () => {
    useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'edit-persist', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any] }));
    useNodeStore.getState().updateConfig('edit-persist', { style: '写实', editMode: 'crop' });
    const stored = useNodeStore.getState().nodes['edit-persist'];
    expect((stored.data as ImageNodeData).editMode).toBe('crop');
  });

  // ── activeEditNodeId ──

  it('should initialize activeEditNodeId as null', () => {
    expect(useNodeStore.getState().activeEditNodeId).toBeNull();
  });

  it('setActiveEditNodeId should update activeEditNodeId', () => {
    useNodeStore.getState().setActiveEditNodeId('edit-x');
    expect(useNodeStore.getState().activeEditNodeId).toBe('edit-x');
  });

  it('setActiveEditNodeId(null) should clear activeEditNodeId', () => {
    useNodeStore.getState().setActiveEditNodeId('edit-x');
    useNodeStore.getState().setActiveEditNodeId(null);
    expect(useNodeStore.getState().activeEditNodeId).toBeNull();
  });

  // ── mutual exclusion ──

  it('setActiveEditNodeId should not set if activeTransformNodeId is set', () => {
    useNodeStore.getState().setActiveTransformNodeId('tx');
    useNodeStore.getState().setActiveEditNodeId('ex');
    expect(useNodeStore.getState().activeEditNodeId).toBeNull();
    expect(useNodeStore.getState().activeTransformNodeId).toBe('tx');
  });

  it('setActiveTransformNodeId should not set if activeEditNodeId is set', () => {
    useNodeStore.getState().setActiveEditNodeId('ex');
    useNodeStore.getState().setActiveTransformNodeId('tx');
    expect(useNodeStore.getState().activeTransformNodeId).toBeNull();
    expect(useNodeStore.getState().activeEditNodeId).toBe('ex');
  });

  // ── triggerCancelEdit ──

  it('triggerCancelEdit should update cancelRequestedAt', () => {
    const ts = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(ts);
    useNodeStore.getState().triggerCancelEdit();
    expect(useNodeStore.getState().cancelRequestedAt).toBe(ts);
  });

  // ══════════════════════════════════════════════════════
  // ── Annotation State ──
  // ══════════════════════════════════════════════════════

  describe('annotationState', () => {
    const penOp: PenOp = {
      type: 'pen',
      points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
      color: '#FF0000',
      lineWidth: 4,
      effectivePressure: 0.5,
    };

    const rectOp: RectOp = {
      type: 'rect',
      x1: 10, y1: 20, x2: 100, y2: 80,
      color: '#0066FF',
      lineWidth: 3,
    };

    const lineOp: LineOp = {
      type: 'line',
      x1: 0, y1: 0, x2: 200, y2: 150,
      color: '#00AA55',
      lineWidth: 5,
    };

    beforeEach(() => {
      useNodeStore.setState({ annotationState: null, activeEditNodeId: null });
    });

    // -- constants --

    it('ANNOTATION_DEFAULTS should have expected values', () => {
      expect(ANNOTATION_DEFAULTS.color).toBe('#FF0000');
      expect(ANNOTATION_DEFAULTS.lineWidth).toBe(4);
      expect(ANNOTATION_DEFAULTS.maxHistory).toBe(50);
      expect(ANNOTATION_DEFAULTS.minLineWidth).toBe(1);
      expect(ANNOTATION_DEFAULTS.maxLineWidth).toBe(40);
    });

    // -- initAnnotationState --

    it('initAnnotationState should skip when activeEditNodeId is null', () => {
      useNodeStore.getState().initAnnotationState();
      expect(useNodeStore.getState().annotationState).toBeNull();
    });

    it('initAnnotationState should initialize with defaults when activeEditNodeId is set', () => {
      useNodeStore.getState().setActiveEditNodeId('node-1');
      useNodeStore.getState().initAnnotationState();
      const state = useNodeStore.getState().annotationState;
      expect(state).not.toBeNull();
      expect(state!.tool).toBe('pen');
      expect(state!.color).toBe(ANNOTATION_DEFAULTS.color);
      expect(state!.lineWidth).toBe(ANNOTATION_DEFAULTS.lineWidth);
      expect(state!.history).toEqual([]);
      expect(state!.redoStack).toEqual([]);
    });

    // -- updateAnnotationTool --

    it('updateAnnotationTool should update tool without changing history', () => {
      useNodeStore.getState().setActiveEditNodeId('node-1');
      useNodeStore.getState().initAnnotationState();
      useNodeStore.getState().updateAnnotationTool('rect');
      expect(useNodeStore.getState().annotationState!.tool).toBe('rect');
      expect(useNodeStore.getState().annotationState!.history).toEqual([]);
    });

    it('updateAnnotationTool should noop when annotationState is null', () => {
      useNodeStore.getState().updateAnnotationTool('line');
      expect(useNodeStore.getState().annotationState).toBeNull();
    });

    // -- updateAnnotationColor --

    it('updateAnnotationColor should update color without changing history', () => {
      useNodeStore.getState().setActiveEditNodeId('node-1');
      useNodeStore.getState().initAnnotationState();
      useNodeStore.getState().updateAnnotationColor('#00FF00');
      expect(useNodeStore.getState().annotationState!.color).toBe('#00FF00');
    });

    // -- updateAnnotationLineWidth --

    it('updateAnnotationLineWidth should update lineWidth', () => {
      useNodeStore.getState().setActiveEditNodeId('node-1');
      useNodeStore.getState().initAnnotationState();
      useNodeStore.getState().updateAnnotationLineWidth(10);
      expect(useNodeStore.getState().annotationState!.lineWidth).toBe(10);
    });

    // -- pushDrawOp --

    it('pushDrawOp should push op and clear redoStack', () => {
      useNodeStore.getState().setActiveEditNodeId('node-1');
      useNodeStore.getState().initAnnotationState();
      // Simulate redoStack having content
      useNodeStore.setState(s => ({
        annotationState: s.annotationState ? { ...s.annotationState, redoStack: [penOp] } : null,
      }));

      useNodeStore.getState().pushDrawOp(rectOp);
      const state = useNodeStore.getState().annotationState!;
      expect(state.history).toHaveLength(1);
      expect(state.history[0]).toEqual(rectOp);
      expect(state.redoStack).toEqual([]);
    });

    it('pushDrawOp should noop when annotationState is null', () => {
      useNodeStore.getState().pushDrawOp(penOp);
      expect(useNodeStore.getState().annotationState).toBeNull();
    });

    it('pushDrawOp should drop oldest when over 50 steps', () => {
      useNodeStore.getState().setActiveEditNodeId('node-1');
      useNodeStore.getState().initAnnotationState();
      const firstOp: PenOp = { ...penOp, points: [{ x: 1, y: 1 }] };
      // Fill history to exactly 50
      const ops: DrawOp[] = [firstOp];
      for (let i = 0; i < 49; i++) {
        ops.push({ ...penOp, points: [{ x: i + 2, y: i + 2 }] });
      }
      useNodeStore.setState(s => ({
        annotationState: s.annotationState ? { ...s.annotationState, history: ops } : null,
      }));

      const newOp: RectOp = { ...rectOp, x1: 999 };
      useNodeStore.getState().pushDrawOp(newOp);
      const state = useNodeStore.getState().annotationState!;
      expect(state.history).toHaveLength(50);
      // First (oldest) should be dropped
      expect(state.history[0]).not.toEqual(firstOp);
      // New op should be last
      expect(state.history[49]).toEqual(newOp);
    });

    // -- undoDrawOp --

    it('undoDrawOp should move last op from history to redoStack', () => {
      useNodeStore.getState().setActiveEditNodeId('node-1');
      useNodeStore.getState().initAnnotationState();
      useNodeStore.getState().pushDrawOp(penOp);
      useNodeStore.getState().pushDrawOp(rectOp);

      const result = useNodeStore.getState().undoDrawOp();
      expect(result).toEqual(rectOp);
      const state = useNodeStore.getState().annotationState!;
      expect(state.history).toHaveLength(1);
      expect(state.history[0]).toEqual(penOp);
      expect(state.redoStack).toHaveLength(1);
      expect(state.redoStack[0]).toEqual(rectOp);
    });

    it('undoDrawOp should return null when history is empty', () => {
      useNodeStore.getState().setActiveEditNodeId('node-1');
      useNodeStore.getState().initAnnotationState();
      const result = useNodeStore.getState().undoDrawOp();
      expect(result).toBeNull();
    });

    it('undoDrawOp should return null when annotationState is null', () => {
      const result = useNodeStore.getState().undoDrawOp();
      expect(result).toBeNull();
    });

    // -- redoDrawOp --

    it('redoDrawOp should move last op from redoStack to history', () => {
      useNodeStore.getState().setActiveEditNodeId('node-1');
      useNodeStore.getState().initAnnotationState();
      useNodeStore.getState().pushDrawOp(penOp);
      useNodeStore.getState().pushDrawOp(rectOp);
      useNodeStore.getState().undoDrawOp(); // rectOp now in redoStack

      const result = useNodeStore.getState().redoDrawOp();
      expect(result).toEqual(rectOp);
      const state = useNodeStore.getState().annotationState!;
      expect(state.history).toHaveLength(2);
      expect(state.history[1]).toEqual(rectOp);
      expect(state.redoStack).toEqual([]);
    });

    it('redoDrawOp should return null when redoStack is empty', () => {
      useNodeStore.getState().setActiveEditNodeId('node-1');
      useNodeStore.getState().initAnnotationState();
      const result = useNodeStore.getState().redoDrawOp();
      expect(result).toBeNull();
    });

    it('redoDrawOp should return null when annotationState is null', () => {
      const result = useNodeStore.getState().redoDrawOp();
      expect(result).toBeNull();
    });

    // -- clearAnnotationState --

    it('clearAnnotationState should set annotationState to null', () => {
      useNodeStore.getState().setActiveEditNodeId('node-1');
      useNodeStore.getState().initAnnotationState();
      useNodeStore.getState().pushDrawOp(penOp);
      useNodeStore.getState().clearAnnotationState();
      expect(useNodeStore.getState().annotationState).toBeNull();
    });

    // -- mutation isolation --

    it('pushDrawOp/undoDrawOp/redoDrawOp should not mutate previous state references', () => {
      useNodeStore.getState().setActiveEditNodeId('node-1');
      useNodeStore.getState().initAnnotationState();
      useNodeStore.getState().pushDrawOp(penOp);
      const state1 = useNodeStore.getState().annotationState!;
      const historyRef = state1.history;

      useNodeStore.getState().pushDrawOp(rectOp);
      const state2 = useNodeStore.getState().annotationState!;
      // Previous history reference should still have length 1
      expect(historyRef).toHaveLength(1);
      expect(state2.history).toHaveLength(2);
      // state1 and state2 should be different objects
      expect(state1).not.toBe(state2);
    });

    // -- editMode annotate --

    it('should persist editMode annotate via updateConfig', () => {
      useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'edit-annotate', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any] }));
      useNodeStore.getState().updateConfig('edit-annotate', { style: '写实', editMode: 'annotate' });
      const stored = useNodeStore.getState().nodes['edit-annotate'];
      expect((stored.data as ImageNodeData).editMode).toBe('annotate');
    });

    // -- updateAnnotationTool/Color/LineWidth noop --
    it('updateAnnotationTool should not affect history or redoStack', () => {
      useNodeStore.getState().setActiveEditNodeId('node-1');
      useNodeStore.getState().initAnnotationState();
      useNodeStore.getState().pushDrawOp(penOp);
      const before = useNodeStore.getState().annotationState!;
      useNodeStore.getState().updateAnnotationTool('rect');
      useNodeStore.getState().updateAnnotationColor('#000000');
      useNodeStore.getState().updateAnnotationLineWidth(20);
      const after = useNodeStore.getState().annotationState!;
      expect(after.history).toEqual(before.history);
      expect(after.redoStack).toEqual(before.redoStack);
    });
  });

  // ══════════════════════════════════════════════════════
  // ── ImageExtNode: NODE_TYPES, type guards, extConfig ──
  // ══════════════════════════════════════════════════════

  describe('NODE_TYPES constant', () => {
    it('should export NODE_TYPES with IMAGE_GEN and IMAGE_EXT_GEN', () => {
      expect(NODE_TYPES.IMAGE_GEN).toBe('imageGen');
      expect(NODE_TYPES.IMAGE_EXT_GEN).toBe('imageExtGen');
    });
  });

  describe('isImageExtNode — runtime safety', () => {
    it('should return true for imageExtGen node with extConfig', () => {
      const node: AppNode = {
        id: 'ext-valid',
        type: 'imageExtGen',
        data: {
          status: 'idle',
          prompt: { text: '', html: '', referencedImageIds: [] },
          allImages: [],
          extConfig: { model: 'ext-model', ratio: '1:1', resolution: '2K', quality: 'standard', generateCount: 1 },
        } as ImageNodeData,
      };
      useNodeStore.getState().addNode(node);
      const stored = useNodeStore.getState().nodes['ext-valid'];
      expect(isImageExtNode(stored)).toBe(true);
    });

    it('should return false for imageExtGen node without extConfig (runtime safety)', () => {
      const node: AppNode = {
        id: 'ext-no-config',
        type: 'imageExtGen',
        data: {
          status: 'idle',
          prompt: { text: '', html: '', referencedImageIds: [] },
          allImages: [],
        } as ImageNodeData,
      };
      useNodeStore.getState().addNode(node);
      const stored = useNodeStore.getState().nodes['ext-no-config'];
      expect(isImageExtNode(stored)).toBe(false);
    });

    it('should return false for regular imageGen node', () => {
      const node: AppNode = {
        id: 'img-regular',
        type: 'imageGen',
        data: {
          status: 'idle',
          model: 'sdxl',
          prompt: { text: '', html: '', referencedImageIds: [] },
          allImages: [],
        } as ImageNodeData,
      };
      useNodeStore.getState().addNode(node);
      const stored = useNodeStore.getState().nodes['img-regular'];
      expect(isImageExtNode(stored)).toBe(false);
    });
  });

  describe('isImageGenNode — symmetric type guard', () => {
    it('should return true for imageGen node', () => {
      const node: AppNode = {
        id: 'img-gen',
        type: 'imageGen',
        data: {
          status: 'idle',
          model: 'sdxl',
          prompt: { text: '', html: '', referencedImageIds: [] },
          allImages: [],
        } as ImageNodeData,
      };
      useNodeStore.getState().addNode(node);
      const stored = useNodeStore.getState().nodes['img-gen'];
      expect(isImageGenNode(stored)).toBe(true);
    });

    it('should return false for imageExtGen node', () => {
      const node: AppNode = {
        id: 'ext-not-gen',
        type: 'imageExtGen',
        data: {
          status: 'idle',
          prompt: { text: '', html: '', referencedImageIds: [] },
          allImages: [],
          extConfig: { model: 'x' },
        } as ImageNodeData,
      };
      useNodeStore.getState().addNode(node);
      const stored = useNodeStore.getState().nodes['ext-not-gen'];
      expect(isImageGenNode(stored)).toBe(false);
    });

    it('should return false for text node', () => {
      const node: AppNode = {
        id: 'txt',
        type: 'text',
        data: { content: 'hello' } as TextNodeData,
      };
      useNodeStore.getState().addNode(node);
      const stored = useNodeStore.getState().nodes['txt'];
      expect(isImageGenNode(stored)).toBe(false);
    });
  });

  describe('updateExtConfig — shallow merge', () => {
    beforeEach(() => {
      useNodeStore.setState({ nodes: {} });
    });

    it('should update only the specified extConfig field, preserving others', () => {
      const node: AppNode = {
        id: 'ext-update',
        type: 'imageExtGen',
        data: {
          status: 'idle',
          prompt: { text: '', html: '', referencedImageIds: [] },
          allImages: [],
          extConfig: {
            model: 'old-model',
            ratio: '1:1',
            resolution: '2K',
            quality: 'standard',
            generateCount: 1,
          },
        } as ImageNodeData,
      };
      useNodeStore.getState().addNode(node);

      useNodeStore.getState().updateExtConfig('ext-update', { model: 'new-model' });

      const stored = useNodeStore.getState().nodes['ext-update'];
      const extConfig = (stored.data as ImageNodeData).extConfig!;
      expect(extConfig.model).toBe('new-model');
      // Other fields preserved
      expect(extConfig.ratio).toBe('1:1');
      expect(extConfig.resolution).toBe('2K');
      expect(extConfig.quality).toBe('standard');
      expect(extConfig.generateCount).toBe(1);
    });

    it('should noop when called on non-ext node', () => {
      const node: AppNode = {
        id: 'img-noop',
        type: 'imageGen',
        data: {
          status: 'idle',
          model: 'sdxl',
          prompt: { text: '', html: '', referencedImageIds: [] },
          allImages: [],
        } as ImageNodeData,
      };
      useNodeStore.getState().addNode(node);

      // Should not throw, no state change
      expect(() => {
        useNodeStore.getState().updateExtConfig('img-noop', { model: 'x' });
      }).not.toThrow();

      const stored = useNodeStore.getState().nodes['img-noop'];
      expect((stored.data as ImageNodeData).model).toBe('sdxl');
    });

    it('should noop when called on non-existent node', () => {
      expect(() => {
        useNodeStore.getState().updateExtConfig('nonexistent', { model: 'x' });
      }).not.toThrow();
    });

    it('should update generateCount in extConfig', () => {
      const node: AppNode = {
        id: 'ext-count',
        type: 'imageExtGen',
        data: {
          status: 'idle',
          prompt: { text: '', html: '', referencedImageIds: [] },
          allImages: [],
          extConfig: { model: 'm', ratio: '1:1', resolution: '2K', quality: 'standard', generateCount: 1 },
        } as ImageNodeData,
      };
      useNodeStore.getState().addNode(node);

      useNodeStore.getState().updateExtConfig('ext-count', { generateCount: 4 });

      const stored = useNodeStore.getState().nodes['ext-count'];
      expect((stored.data as ImageNodeData).extConfig!.generateCount).toBe(4);
    });
  });

  describe('updateConfig — extConfig filtering', () => {
    it('should strip extConfig from updateConfig payload', () => {
      const node: AppNode = {
        id: 'img-filter',
        type: 'imageGen',
        data: {
          status: 'idle',
          model: 'sdxl',
          prompt: { text: '', html: '', referencedImageIds: [] },
          allImages: [],
        } as ImageNodeData,
      };
      useNodeStore.getState().addNode(node);

      // Attempt to pass extConfig via updateConfig — should be silently ignored
      useNodeStore.getState().updateConfig('img-filter', {
        model: 'flux',
        extConfig: { model: 'evil-model' },
      } as any);

      const stored = useNodeStore.getState().nodes['img-filter'];
      const data = stored.data as ImageNodeData;
      expect(data.model).toBe('flux');
      // extConfig should NOT be set on imageGen node
      expect(data.extConfig).toBeUndefined();
    });
  });
});


describe('nodeStore → canvasStore 桥接（图片身份字段，Bug D/E 响应式）', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {}, activeTransformNodeId: null, activeEditNodeId: null, cancelRequestedAt: 0, saveHandlers: {} });
    useNodeStore.getState().addNode({ id: 'b1', type: 'imageGen', data: {} as any });
    useCanvasStore.setState({ nodes: [{ id: 'b1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });
  });

  it('updateConfig 白名单字段（referenceImage）桥接到 canvasStore', () => {
    useNodeStore.getState().updateConfig('b1', { referenceImage: 'f1' } as any);
    const cn = useCanvasStore.getState().nodes.find((n) => n.id === 'b1')!;
    expect((cn.data as any).referenceImage).toBe('f1');
  });

  it('updateConfig 白名单字段（fileId/status）桥接到 canvasStore', () => {
    useNodeStore.getState().updateConfig('b1', { fileId: 'fx', status: 'done' } as any);
    const cn = useCanvasStore.getState().nodes.find((n) => n.id === 'b1')!;
    expect((cn.data as any).fileId).toBe('fx');
    expect((cn.data as any).status).toBe('done');
  });

  it('updateConfig 非白名单字段不触发 canvasStore setState（防高频重渲染）', () => {
    const spy = vi.spyOn(useCanvasStore, 'setState');
    useNodeStore.getState().updateConfig('b1', { model: 'flux' } as any);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('setFileResult 桥接 fileId + status done', () => {
    useNodeStore.getState().setFileResult('b1', 'file-9');
    const cn = useCanvasStore.getState().nodes.find((n) => n.id === 'b1')!;
    expect((cn.data as any).fileId).toBe('file-9');
    expect((cn.data as any).status).toBe('done');
  });

  it('updateMultiImageImages 桥接 images', () => {
    useNodeStore.getState().updateMultiImageImages('b1', [{ id: 'i1', url: 'http://m/i1', name: 'i1', status: 'success' }] as any);
    const cn = useCanvasStore.getState().nodes.find((n) => n.id === 'b1')!;
    expect((cn.data as any).images).toHaveLength(1);
    expect((cn.data as any).images[0].id).toBe('i1');
  });

  it('canvasStore 中不存在的节点 id 桥接不报错（guard）', () => {
    useNodeStore.getState().addNode({ id: 'ghost', type: 'imageGen', data: {} as any });
    expect(() => useNodeStore.getState().setFileResult('ghost', 'f')).not.toThrow();
    expect(() => useNodeStore.getState().updateConfig('ghost', { referenceImage: 'f' } as any)).not.toThrow();
  });
});

describe('updateConfig 幽灵守卫（I-3）', () => {
  it('双 store 均无的幽灵 id 直接丢弃（undo 撤销创建后完成回调迟到不复活）', () => {
    useNodeStore.setState((s) => { const next = { ...s.nodes }; delete next['ghost-undo']; return { nodes: next }; });
    useCanvasStore.setState((s) => ({ nodes: s.nodes.filter((nd) => nd.id !== 'ghost-undo') }));
    useNodeStore.getState().updateConfig('ghost-undo', { status: 'done' } as any);
    expect(useNodeStore.getState().nodes['ghost-undo']).toBeUndefined();
  });

  it('canvasStore 存在而 nodeStore 缺失 → 仍重建（既有语义保留）', () => {
    useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'cs-only', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any] }));
    try {
      useNodeStore.getState().updateConfig('cs-only', { status: 'done' } as any);
      expect(useNodeStore.getState().nodes['cs-only']).toBeDefined();
    } finally {
      useCanvasStore.setState((s) => ({ nodes: s.nodes.filter((nd) => nd.id !== 'cs-only') }));   // 防跨用例污染
    }
  });
});

describe('referenceSelect（画布参考选择模式，spec §3.1）', () => {
  beforeEach(() => {
    useNodeStore.setState({ referenceSelect: null, activeEditNodeId: null, activeTransformNodeId: null });
  });

  it('startReferenceSelect 置状态；exitReferenceSelect 清空', () => {
    useNodeStore.getState().startReferenceSelect('img1');
    expect(useNodeStore.getState().referenceSelect).toEqual({ sourceNodeId: 'img1', notice: null });
    useNodeStore.getState().exitReferenceSelect();
    expect(useNodeStore.getState().referenceSelect).toBeNull();
  });

  it('setActiveEditNodeId(非null) 自动退出选择模式（编辑模式互斥）', () => {
    useNodeStore.getState().startReferenceSelect('img1');
    useNodeStore.getState().setActiveEditNodeId('img1');
    expect(useNodeStore.getState().referenceSelect).toBeNull();
  });

  it('setActiveTransformNodeId(非null) 同样退出', () => {
    useNodeStore.getState().startReferenceSelect('img1');
    useNodeStore.getState().setActiveTransformNodeId('img1');
    expect(useNodeStore.getState().referenceSelect).toBeNull();
  });

  it('setActiveEditNodeId(null) 不触发退出（仅进入时互斥）', () => {
    useNodeStore.getState().startReferenceSelect('img1');
    useNodeStore.getState().setActiveEditNodeId(null);
    expect(useNodeStore.getState().referenceSelect).not.toBeNull();
  });

  it('flashReferenceNotice 设 notice 并 2.2s 后自动清（vi.useFakeTimers）', () => {
    vi.useFakeTimers();
    useNodeStore.getState().startReferenceSelect('img1');
    useNodeStore.getState().flashReferenceNotice('最多 9 张参考图');
    expect(useNodeStore.getState().referenceSelect?.notice).toBe('最多 9 张参考图');
    vi.advanceTimersByTime(2300);
    expect(useNodeStore.getState().referenceSelect?.notice).toBeNull();
    vi.useRealTimers();
  });
});
