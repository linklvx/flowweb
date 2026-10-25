import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { message } from 'antd';
import { useNodeStore, isImageNode, isImageExtNode, isImageGenNode, isTextNode, ANNOTATION_DEFAULTS, NODE_TYPES, IMAGE_EXT_DEFAULTS, _resetViewerToastForTest } from './nodeStore';
import * as Y from 'yjs';
// Y1c T16：域键拒测试装置（doc 种子缝）
import { _setIntentDocForTest } from './canvasIntents';
// Y1c T16 收口 C-1：write_reject 零噪声断言面（诊断 ring 观测）
import { getRecentCollabDiag, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';
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
      data: { content: 'hello world' } as unknown as TextNodeData,
    };

    useNodeStore.getState().addNode(textNode);
    const stored = useNodeStore.getState().nodes['t1'];

    expect(stored).toBeDefined();
    expect(stored.id).toBe('t1');
    expect(stored.type).toBe('text');
    const textData = stored.data as unknown as TextNodeData;
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
        prompt: { text: '', html: '', json: [] },   // Y1c T16：RichTextValue 形
      } as unknown as ImageNodeData,
    };

    useNodeStore.getState().addNode(imageNode);
    const stored = useNodeStore.getState().nodes['img1'];

    expect(stored).toBeDefined();
    expect(stored.type).toBe('imageGen');
    const imgData = stored.data as unknown as ImageNodeData;
    expect(imgData.style).toBe('写实');
    expect(imgData.model).toBe('sdxl');
    expect(imgData.quality).toBe('standard');
    expect(imgData.ratio).toBe('1:1');
    expect(imgData.status).toBe('idle');
    // Y1c T16：prompt=xml 域——种子 RichTextValue 原样保留（ns 本地面；defaults 注入已删）
    expect(imgData.prompt).toEqual({ text: '', html: '', json: [] });
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
        prompt: { text: '', html: '', json: [] },   // Y1c T16：RichTextValue 形
      } as unknown as ImageNodeData,
    };

    useNodeStore.getState().addNode(node);
    useNodeStore.getState().updateNodeData<ImageNodeData>('img1', { model: 'flux' });

    const stored = useNodeStore.getState().nodes['img1'];
    const imgData = stored.data as unknown as ImageNodeData;
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
      } as unknown as ImageNodeData,
    };

    useNodeStore.getState().addNode(node);
    useNodeStore
      .getState()
      .updateNodeData<ImageNodeData>('img2', { model: 'flux', ratio: '16:9', quality: '2k' });

    const stored = useNodeStore.getState().nodes['img2'];
    const imgData = stored.data as unknown as ImageNodeData;
    expect(imgData.model).toBe('flux');
    expect(imgData.ratio).toBe('16:9');
    expect(imgData.quality).toBe('2k');
  });

  // 7. updateNodeData should update text node data（Y1c T16：content=XmlFragment 域——ns 本地
  //    写面保留（updateNodeData 非 dispatch 面），doc 侧域键写由 canvasIntents seam 拒——t16 spec 锚）
  it('should update text node data', () => {
    const textNode: AppNode = {
      id: 't1',
      type: 'text',
      data: { content: { text: 'original', html: '<p>original</p>', json: [] } } as unknown as TextNodeData,
    };

    useNodeStore.getState().addNode(textNode);
    useNodeStore.getState().updateNodeData<TextNodeData>('t1', { prompt: { text: 'p1' } });

    const stored = useNodeStore.getState().nodes['t1'];
    const textData = stored.data as unknown as TextNodeData;
    expect(textData.prompt?.text).toBe('p1');
  });

  // 8.（Y1c T16 删）updateText 整串便捷方法删除——content=XmlFragment 域（编辑器直绑，
  //    getHTML 整串写=容器替换对抗面；t16-xml-domains.spec 红①锚）

  // 9. updateConfig convenience method should set config with defaults
  it('should set config with defaults via updateConfig', () => {
    // Seed canvasStore so updateConfig rebuild branch passes guard
    useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'img3', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any] }));
    // Start with an empty config
    useNodeStore.getState().updateConfig('img3', {});

    const stored = useNodeStore.getState().nodes['img3'];
    expect(stored).toBeDefined();
    const imgData = stored.data as unknown as ImageNodeData;
    expect(imgData.style).toBe('写实');
    // Y0b-1（三轮 Z30/P0-6）：model/resolution 缺省不注入字面量默认——空值留给面板自选首模型/首分辨率（存行 id）
    expect(imgData.model).toBeUndefined();
    expect(imgData.resolution).toBeUndefined();
    expect(imgData.quality).toBe('standard');
    expect(imgData.ratio).toBe('16:9');
    expect(imgData.status).toBe('idle');
    // Y1c T16：prompt=xml 域——defaults 注入删除（缺省归创建 seam；域键写 seam 拒）
    expect(imgData.prompt).toBeUndefined();
    expect(imgData.allImages).toEqual([]);
  });

  it('Y1c T16：prompt=xml 域——updateConfig prompt 写被拒（域键=编辑器直绑容器，ns 同剥零半落）', () => {
    // 装置：真 doc 种子（dispatch 拒需 doc 在——域键 seam 判定面）
    const doc = new Y.Doc();
    doc.transact(() => {
      const data = new Y.Map();
      data.set('prompt', new Y.XmlFragment());
      const n = new Y.Map();
      n.set('type', 'imageGen');
      n.set('data', data);
      doc.getMap('nodes').set('img9', n);
    });
    _setIntentDocForTest(doc);
    try {
      // 编辑窗（dispatch 门：hydration ready——域键拒判定可达）
      useCanvasStore.setState({ hydration: 'ready', collabReadOnly: false, wsAuthNotice: null });
      useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'img9', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any] }));
      useNodeStore.getState().updateConfig('img9', {
        prompt: { text: 'hello world', html: '', json: [] },
      });
      const stored = useNodeStore.getState().nodes['img9'];
      const imgData = stored.data as unknown as ImageNodeData;
      expect(imgData.prompt).toBeUndefined();   // doc 拒 ⇒ ns 同剥（收口——半落根修）
      // 非域键写照常（对照组）
      useNodeStore.getState().updateConfig('img9', { style: '动漫' });
      expect((useNodeStore.getState().nodes['img9'].data as unknown as ImageNodeData).style).toBe('动漫');
    } finally {
      _setIntentDocForTest(null);
    }
  });

  // ── Y1c T16 双评审收口 C-1（quality 探针实证——评审员真 store 复现）：updateConfig 全量终态
  //    摊开 ns 投影域键 → seam 无条件拒 → outcome 剥除后整体替换 ns → prompt 键消失（生成判据
  //    !nodeData?.prompt?.text 永久失效）。红测=探针复现：非域键写后域键保留+零 write_reject。
  it('T16 收口 C-1：updateConfig({model}) ⇒ ns prompt 保留+doc 容器原样+零 write_reject（现状红）', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const data = new Y.Map();
      data.set('prompt', new Y.XmlFragment());
      const n = new Y.Map();
      n.set('type', 'imageGen');
      n.set('data', data);
      doc.getMap('nodes').set('i1', n);
    });
    _setIntentDocForTest(doc);
    _resetCollabDiagForTest();
    try {
      useCanvasStore.setState((s) => ({
        hydration: 'ready', collabReadOnly: false, wsAuthNotice: null,
        nodes: [...s.nodes, { id: 'i1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any],
      }));
      // ns 投影含 prompt 域键（RichTextValue 形）——评审探针 'a cat' 同构
      useNodeStore.setState((s) => ({
        nodes: { ...s.nodes, i1: { id: 'i1', type: 'imageGen', data: { model: 'm1', prompt: { text: 'a cat', html: '<p>a cat</p>', json: [] } } as any } },
      }));
      useNodeStore.getState().updateConfig('i1', { model: 'm2' });
      const dataAfter = useNodeStore.getState().nodes['i1'].data as any;
      expect(dataAfter.model).toBe('m2');
      // 域键保留（现状红：undefined——生成按钮静默失效根）
      expect(dataAfter.prompt).toEqual({ text: 'a cat', html: '<p>a cat</p>', json: [] });
      // 零 write_reject 诊断噪声（现状红：全量摊开 existing 域键每次必发）
      expect(getRecentCollabDiag().filter((e) => e.type === 'write_reject')).toHaveLength(0);
      // doc 面：非域键落+容器原样
      const docData = (doc.getMap('nodes').get('i1') as Y.Map<any>).get('data') as Y.Map<any>;
      expect(docData.get('model')).toBe('m2');
      expect(docData.get('prompt') instanceof Y.XmlFragment).toBe(true);
    } finally {
      _setIntentDocForTest(null);
    }
  });

  // 10. setStatus should update status field
  it('should update status field via setStatus', () => {
    useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'img4', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any] }));
    useNodeStore.getState().updateConfig('img4', { style: '写实' });
    useNodeStore.getState().setStatus('img4', 'loading');

    const stored = useNodeStore.getState().nodes['img4'];
    const imgData = stored.data as unknown as ImageNodeData;
    expect(imgData.status).toBe('loading');
  });

  // 11. setFileResult should set fileId and mark status='done'
  it('should set fileId and mark status=done via setFileResult', () => {
    useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'img5', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any] }));
    useNodeStore.getState().updateConfig('img5', { style: '写实' });
    // 批2-2：AI 落地走 canEdit 门——rw 会话电平（默认 idle/readonly 会被 wrapper 早退）
    useCanvasStore.setState({ hydration: 'ready', collabReadOnly: false, wsAuthNotice: null });
    useNodeStore.getState().setFileResult('img5', 'file-abc-123');

    const stored = useNodeStore.getState().nodes['img5'];
    const imgData = stored.data as unknown as ImageNodeData;
    expect(imgData.fileId).toBe('file-abc-123');
    expect(imgData.status).toBe('done');
  });

  // 12. deleteNode should remove node (nodes[id] is undefined after)
  it('should remove node via deleteNode', async () => {
    const node: AppNode = {
      id: 'to-delete',
      type: 'text',
      data: { content: 'delete me' } as unknown as TextNodeData,
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
      data: { content: 'test data' } as unknown as TextNodeData,
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
          json: [],
        } as unknown as PromptValue,
      } as unknown as ImageNodeData,
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
      } as unknown as ImageNodeData,
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
      } as unknown as ImageNodeData,
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
      } as unknown as ImageNodeData,
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
        // Y1c T16：prompt=RichTextValue（allImages/referencedImageIds 出 prompt——引用走 json/池）
        prompt: { text: '', html: '', json: [] },
      } as unknown as VideoNodeData,
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
        prompt: 'hello',   // Y1c T15：audioGen content:string 同卡迁 prompt（Y.Text 域）
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
        prompt: { text: '', html: '', json: [] },   // Y1c T16：RichTextValue 形
      } as unknown as ImageNodeData,
    };

    const textNode: AppNode = {
      id: 'txt-guard',
      type: 'text',
      data: { content: 'hello' } as unknown as TextNodeData,
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
        prompt: { text: '', html: '', json: [] },   // Y1c T16：RichTextValue 形
      } as unknown as ImageNodeData,
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
  // Y1c T1 红：夹具改生产名 'textInput'（真实节点类型全集无 'text'）——生产 isTextNode 判
  // NODE_TYPES.TEXT（='textInput'），旧实现判裸 'text' 必 miss → unreachable 分支红
  it('should correctly narrow via isTextNode type guard (production type textInput)', () => {
    const textNode: AppNode = {
      id: 'txt-guard-2',
      type: 'textInput',
      data: { content: 'hello world' } as unknown as TextNodeData,
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
        prompt: { text: '', html: '', json: [] },   // Y1c T16：RichTextValue 形
      } as unknown as ImageNodeData,
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
        prompt: { text: 'a cat', html: '<p>a cat</p>', json: [] },   // Y1c T16：RichTextValue 形
        allImages: [],
      } as unknown as ImageNodeData,
    };

    useNodeStore.getState().addNode(node);
    const newImages: ImageItem[] = [
      { id: 'img-1', url: '/api/storage/files/img-1', name: 'ref1.png', status: 'success' },
      { id: 'img-2', url: '/api/storage/files/img-2', name: 'ref2.png', status: 'uploading', progress: 45 },
    ];

    useNodeStore.getState().updatePromptImages('img-prompt', newImages);

    const stored = useNodeStore.getState().nodes['img-prompt'];
    const imgData = stored.data as unknown as ImageNodeData;
    expect(imgData.allImages).toEqual(newImages);
    // Other prompt fields preserved
    expect(imgData.prompt!.text).toBe('a cat');
  });

  // 20. updatePromptImages should noop for text nodes (text nodes have no prompt)
  it('should noop for text nodes', () => {
    const textNode: AppNode = {
      id: 'txt-prompt',
      type: 'text',
      data: { content: 'hello' } as unknown as TextNodeData,
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
    const imgData = stored.data as unknown as ImageNodeData;
    expect(imgData.imageRotation).toBe(0);
    expect(imgData.flipH).toBe(false);
    expect(imgData.flipV).toBe(false);
    // transformMode 不入 defaults（Spec B editMode 分片：本地瞬态键随写点显式写，读面 ?? 兜底）
    expect('transformMode' in imgData).toBe(false);
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
    const imgData = stored.data as unknown as ImageNodeData;
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

    // Y1c T16/C-1：prompt=xml 域——updateConfig 载荷禁域键（编辑器直绑容器；config 携带
    // =剔除不落——上方「updateConfig prompt 写被拒」用例锚）。本用例焦点=类型保留，改非域键。
    useNodeStore.getState().updateConfig('vid-config', {
      model: 'vm-9',
    });

    const stored = useNodeStore.getState().nodes['vid-config'];
    expect(stored).toBeDefined();
    // Must preserve videoGen type — NOT overwrite to imageGen
    expect(stored.type).toBe('videoGen');
    // Data must include the updated config
    expect((stored.data as VideoNodeData).model).toBe('vm-9');
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

  // ── editMode 本地瞬态（Spec B editMode 分片——doc 面剥键由 canvasIntents.spec 守卫承接）──

  it('mergeNodeData defaults 不含 ephemeral 键（editMode/transformMode 本地瞬态不注入 defaults）', () => {
    useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'edit-default', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any] }));
    useNodeStore.getState().updateConfig('edit-default', {});
    const stored = useNodeStore.getState().nodes['edit-default'];
    const imgData = stored.data as unknown as ImageNodeData;
    expect('editMode' in imgData).toBe(false);
    expect('transformMode' in imgData).toBe(false);
  });

  it('updateConfig editMode 落 ns 本地瞬态面（组件读取面；不注入 defaults）', () => {
    useCanvasStore.setState((s) => ({ nodes: [...s.nodes, { id: 'edit-persist', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any] }));
    useNodeStore.getState().updateConfig('edit-persist', { style: '写实', editMode: 'crop' });
    const stored = useNodeStore.getState().nodes['edit-persist'];
    expect((stored.data as unknown as ImageNodeData).editMode).toBe('crop');
  });

  // ── selectIsLocked 单源（Spec B editMode 分片——CanvasView 订阅式/isLockedNow 命令式同源；
  //    selector 本体在 stores/canvasLock.ts，此处经 nodeStore 行为装置验证三态）──

  it('selectIsLocked：双 null=false', async () => {
    const { selectIsLocked } = await import('@/stores/canvasLock');
    expect(selectIsLocked(useNodeStore.getState())).toBe(false);
  });

  it('selectIsLocked：activeEditNodeId 置位=true（编辑锁五模式仅本地视图态）', async () => {
    const { selectIsLocked } = await import('@/stores/canvasLock');
    useNodeStore.getState().setActiveEditNodeId('n1');
    expect(selectIsLocked(useNodeStore.getState())).toBe(true);
  });

  it('selectIsLocked：activeTransformNodeId 置位=true', async () => {
    const { selectIsLocked } = await import('@/stores/canvasLock');
    useNodeStore.getState().setActiveTransformNodeId('n1');
    expect(selectIsLocked(useNodeStore.getState())).toBe(true);
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
      expect((stored.data as unknown as ImageNodeData).editMode).toBe('annotate');
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
        } as unknown as ImageNodeData,
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
        } as unknown as ImageNodeData,
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
        } as unknown as ImageNodeData,
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
        } as unknown as ImageNodeData,
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
        } as unknown as ImageNodeData,
      };
      useNodeStore.getState().addNode(node);
      const stored = useNodeStore.getState().nodes['ext-not-gen'];
      expect(isImageGenNode(stored)).toBe(false);
    });

    it('should return false for text node', () => {
      const node: AppNode = {
        id: 'txt',
        type: 'text',
        data: { content: 'hello' } as unknown as TextNodeData,
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
        } as unknown as ImageNodeData,
      };
      useNodeStore.getState().addNode(node);

      useNodeStore.getState().updateExtConfig('ext-update', { model: 'new-model' });

      const stored = useNodeStore.getState().nodes['ext-update'];
      const extConfig = (stored.data as unknown as ImageNodeData).extConfig!;
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
        } as unknown as ImageNodeData,
      };
      useNodeStore.getState().addNode(node);

      // Should not throw, no state change
      expect(() => {
        useNodeStore.getState().updateExtConfig('img-noop', { model: 'x' });
      }).not.toThrow();

      const stored = useNodeStore.getState().nodes['img-noop'];
      expect((stored.data as unknown as ImageNodeData).model).toBe('sdxl');
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
        } as unknown as ImageNodeData,
      };
      useNodeStore.getState().addNode(node);

      useNodeStore.getState().updateExtConfig('ext-count', { generateCount: 4 });

      const stored = useNodeStore.getState().nodes['ext-count'];
      expect((stored.data as unknown as ImageNodeData).extConfig!.generateCount).toBe(4);
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
        } as unknown as ImageNodeData,
      };
      useNodeStore.getState().addNode(node);

      // Attempt to pass extConfig via updateConfig — should be silently ignored
      useNodeStore.getState().updateConfig('img-filter', {
        model: 'flux',
        extConfig: { model: 'evil-model' },
      } as any);

      const stored = useNodeStore.getState().nodes['img-filter'];
      const data = stored.data as unknown as ImageNodeData;
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
    // 批2-2：setFileResult 走 canEdit 门——rw 会话电平（默认 idle/readonly 会被 wrapper 早退）
    useCanvasStore.setState({ hydration: 'ready', collabReadOnly: false, wsAuthNotice: null });
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

// ══════════ Y0b-5 T7（C6 收口）：applyNodeDataPatch VIEWER 门（Y1c T16：updateText 删除——
// canEdit 门探针改 applyNodeDataPatch 同门面〔批2-2 三行早退同款〕；prompt={text} 走 T15 域键形态） ══════════
describe('Y0b-5 T7：applyNodeDataPatch VIEWER 门', () => {
  beforeEach(() => {
    _resetViewerToastForTest();
    useNodeStore.setState({ nodes: {} });
  });

  it('canEdit false→零写入：已有节点内容不变+缺席节点不建幽灵条目（else 分支建节点路径同样被拦）+toast 提示（异节点各自计时）', () => {
    // viewer 形态：hydration 非 ready（canEdit 假——离线/水合中/连接级只读三态同拦）
    useCanvasStore.setState({ hydration: 'idle', collabReadOnly: false, wsAuthNotice: null });
    const warnSpy = vi.spyOn(message, 'warning');
    useNodeStore.setState({
      nodes: { t9: { id: 't9', type: 'text', data: { content: { text: '', html: '', json: [] }, prompt: { text: '原' } } as unknown as TextNodeData } },
    });
    useNodeStore.getState().applyNodeDataPatch('t9', { prompt: { text: '被拒写入' } });
    useNodeStore.getState().applyNodeDataPatch('t-ghost', { prompt: { text: '被拒写入' } });
    expect((useNodeStore.getState().nodes['t9']!.data as unknown as TextNodeData).prompt?.text).toBe('原');
    expect(useNodeStore.getState().nodes['t-ghost']).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(2);   // 异节点各自计时（节流=同节点 2s 窗——下一用例）
    expect(warnSpy).toHaveBeenCalledWith('当前为只读会话，编辑未生效');
  });

  it('toast 节流：同节点 2s 窗内连续键入不风暴（一次提示）；窗后再写再提示', () => {
    useCanvasStore.setState({ hydration: 'idle', collabReadOnly: false, wsAuthNotice: null });
    const warnSpy = vi.spyOn(message, 'warning');
    useNodeStore.getState().applyNodeDataPatch('t9', { prompt: { text: 'a' } });
    useNodeStore.getState().applyNodeDataPatch('t9', { prompt: { text: 'ab' } });
    useNodeStore.getState().applyNodeDataPatch('t9', { prompt: { text: 'abc' } });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const ts = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(ts + 2_001);   // 出 2s 节流窗（viewerToastAt 同 Date.now 基准）
    useNodeStore.getState().applyNodeDataPatch('t9', { prompt: { text: 'abcd' } });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
