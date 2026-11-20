import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import { message } from 'antd';
import { ImageGenNode } from './ImageGenNode';
import { ReactFlowProvider } from '@xyflow/react';
import { presignUpload, confirmUpload } from '@/api/storageApi';
import { cropImage } from '@/utils/imageCrop';
import { MediaRevConflictError } from '@/api/collabApi';
import { reportNodeSize } from '@/stores/canvasIntents';
import { _resetUnloadGuardForTest } from '@/utils/unloadGuard';

const { mockUseInternalNode } = vi.hoisted(() => ({
  mockUseInternalNode: vi.fn(() => ({
    position: { x: 0, y: 0 },
    measured: { width: 500, height: 500 },
    internals: { positionAbsolute: { x: 0, y: 0 } },
  })),
}));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useInternalNode: mockUseInternalNode,
    useStore: (selector: any) => selector({ nodes: mockGetNodes() }),
    useReactFlow: vi.fn(() => ({
      fitView: mockFitView,
      screenToFlowPosition: vi.fn((p: any) => p),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      getNodes: mockGetNodes,
      setNodes: mockSetNodes,
      setCenter: mockSetCenter,
    })),
  };
});

let mockNodeData: any = {
  status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] }
};
// 批1-6：mock nodeStore state 的 exec 合并视图两源（selectExecStatus 读——默认空 Map 走 data.status 回落）
let mockExecStatus: Map<string, any> = new Map();
let mockLastPointerShiftKey = false;
let mockMarqueeSelecting = false;

vi.mock('@/hooks/useMediaUrl', () => ({
  useMediaUrl: (fileId: string | null | undefined) => {
    if (fileId) return { url: `http://media/${fileId}`, loading: false, error: null };
    return { url: null, loading: false, error: null };
  },
}));

// Y1c T32：产物渲染读径唯一源=runtime 投影 overlay（doc data.fileId legacy 兜底退役）——测试面将
// runtimeMediaIdOf 派生自 mockNodeData.fileId（用例产物身份即投影 artifact 身份；F2 命令动态流
// 「成功后落新 fileId」自动随动，无需逐用例注入 runtimeStore）。
vi.mock('@/stores/runtimeStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/runtimeStore')>();
  return { ...actual, runtimeMediaIdOf: () => (mockNodeData?.fileId as string) || undefined };
});

const {
  mockUpdateConfig,
  mockSetActiveTransformNodeId,
  mockSetActiveEditNodeId,
  mockRegisterSaveHandler,
  mockUnregisterSaveHandler,
  mockSaveTransformNode,
  mockTriggerCancelTransform,
  mockDeleteTransformNode,
  mockAddChildNode,
  mockAddNodeWithEdge,
  mockSelectNode,
  mockFitView,
  mockGetNodes,
  mockSetNodes,
  mockSetCenter,
  mockUseNodeStoreFn,
  mockUseCanvasStoreFn,
  mockApplyDataPatchToStores,
  mockSetNodeCallbacks,
  mockGetMediaSlot,
  mockConfirmShow,
  mockConfirmClose,
  mockSetStatus,
  mockSetFileResult,
} = vi.hoisted(() => {
  const updateConfig = vi.fn();
  const applyDataPatchToStores = vi.fn();   // Y1a T11：本地 UI 直写面（AI 回填/命令回退）
  const setActiveTransformNodeId = vi.fn();
  const setActiveEditNodeId = vi.fn();
  const registerSaveHandler = vi.fn();
  const unregisterSaveHandler = vi.fn();
  const saveTransformNode = vi.fn().mockResolvedValue(undefined);
  const triggerCancelTransform = vi.fn();
  const deleteTransformNode = vi.fn();
  const addChildNode = vi.fn(() => 'node-crop-child');
  const addNodeWithEdge = vi.fn(() => 'node-xform-new');
  const selectNode = vi.fn();
  const fitView = vi.fn();
  const getNodes = vi.fn(() => [{ id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, width: 500, height: 500, selected: true, data: mockNodeData }]);
  const setNodes = vi.fn();
  const setCenter = vi.fn();
  const setNodeCallbacks = vi.fn();   // Y1a T11：Angle3D 回调捕获（clear 路径驱动）
  // F2 评审 P1-1：默认槽位=生产形态 {rev:0, mediaId:null}——变换节点由 addNodeWithEdge 复制源
  // fileId 进新 nodeId（PG 无 NodeArtifact 行，服务端 GET 归零）；冲突用例用 Once 覆盖 rev>0 形态
  const getMediaSlot = vi.fn(async (): Promise<{ targetField: 'mediaId'; rev: number; mediaId: string | null }> => ({
    targetField: 'mediaId', rev: 0, mediaId: null,
  }));
  const confirmShow = vi.fn();   // F2（裁定①）：409/入口冲突确认弹窗捕获
  const confirmClose = vi.fn();
  const setStatus = vi.fn();   // F2 P2-1：node:status 提示面出口捕获
  const setFileResult = vi.fn();   // F2 P2-1：socket done 产物写出口捕获（activeMediaOp 门对象）

  const nodeStoreFn = vi.fn((_selector?: any) => {
    // Get fresh state at call time
    const state = {
      nodes: { 'img1': { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, data: mockNodeData } },
      execStatus: mockExecStatus,
      updateConfig,
      applyDataPatchToStores,
      setStatus,
      setFileResult,
      activeTransformNodeId: mockActiveNodeId,
      cancelRequestedAt: mockCancelRequestedAt,
      setActiveTransformNodeId,
      triggerCancelTransform,
      activeEditNodeId: null as string | null,
      setActiveEditNodeId,
      getEditOverlayDragging: vi.fn(() => false),   // Y3 T7 ⑦：handleEditCancel 退出路径可读（默认无拖拽）
      triggerCancelEdit: vi.fn(),
      saveHandlers: {} as Record<string, () => Promise<void>>,
      registerSaveHandler,
      unregisterSaveHandler,
      saveTransformNode,
      getNodeData: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };
    if (typeof _selector === 'function') return _selector(state);
    return state;
  });
  (nodeStoreFn as any).getState = () => nodeStoreFn() as any;
  (nodeStoreFn as any).subscribe = vi.fn(() => vi.fn());

  const canvasStoreFn = vi.fn((_selector?: any) => {
    const state = {
      selectedId: null,
      lastPointerShiftKey: mockLastPointerShiftKey,
      marqueeSelecting: mockMarqueeSelecting,
      // Y0b-2 T7：canExecute 硬态夹具（handleGenerate 门读 getState——缺省字段=断连态早退，fetch 零调用）
      hydration: 'ready' as const,
      collabReadOnly: false,
      wsAuthNotice: null,
      connStatus: 'connected' as const,
      writeFrozen: false,
      // O0b-2 挂载恢复 effect 读 cs.wh——夹具不带 wh（undefined⇒不镜像 imgSize，渲染仍走 ratio 默认）
      nodes: mockCsNodes,
      projectId: 'p1',   // Y1a T11：canvasProjectId 消费面（replaceMedia/clearMedia 命令）
      selectNode,
      addChildNode,
      addNodeWithEdge,
      deleteTransformNode,
      setNodeDraggable: vi.fn(),
      splitImageNode: vi.fn(),
      nodeProcessMap: {},
    };
    if (typeof _selector === 'function') return _selector(state);
    return state;
  });
  (canvasStoreFn as any).getState = () => canvasStoreFn() as any;

  return {
    mockUpdateConfig: updateConfig,
    mockSetActiveTransformNodeId: setActiveTransformNodeId,
    mockSetActiveEditNodeId: setActiveEditNodeId,
    mockRegisterSaveHandler: registerSaveHandler,
    mockUnregisterSaveHandler: unregisterSaveHandler,
    mockSaveTransformNode: saveTransformNode,
    mockTriggerCancelTransform: triggerCancelTransform,
    mockDeleteTransformNode: deleteTransformNode,
    mockAddChildNode: addChildNode,
    mockAddNodeWithEdge: addNodeWithEdge,
    mockSelectNode: selectNode,
    mockFitView: fitView,
    mockGetNodes: getNodes,
    mockSetNodes: setNodes,
    mockSetCenter: setCenter,
    mockUseNodeStoreFn: nodeStoreFn,
    mockUseCanvasStoreFn: canvasStoreFn,
    mockApplyDataPatchToStores: applyDataPatchToStores,
    mockSetNodeCallbacks: setNodeCallbacks,
    mockGetMediaSlot: getMediaSlot,
    mockConfirmShow: confirmShow,
    mockConfirmClose: confirmClose,
    mockSetStatus: setStatus,
    mockSetFileResult: setFileResult,
  };
});

let mockActiveNodeId: string | null = null;
let mockCancelRequestedAt = 0;
// F2 P1-2：canvasStore nodes 夹具（runIntrinsicFit 读 cs 信封 wh——currentWH 供 adaptToFit 分支）
let mockCsNodes: any[] = [];

vi.mock('@/stores/nodeStore', async (importOriginal) => ({
  // Y1c T1：spread 真模块（生产源现引 NODE_TYPES 常量——mock 面保持原覆写）
  ...(await importOriginal<typeof import('@/stores/nodeStore')>()),
  useNodeStore: mockUseNodeStoreFn,
  applyDataPatchToStores: mockApplyDataPatchToStores,
  isImageExtNode: (node: any) => node?.type === 'imageExtGen',
  isImageGenNode: (node: any) => node?.type === 'imageGen',
  isImageNode: (node: any) => node?.type === 'imageGen' || node?.type === 'imageExtGen',
}));

// Y1c T16：PromptInput→resolveDoc 装置链补（partial mock importOriginal——reportNodeSize 仍 mock）
vi.mock('@/stores/canvasIntents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/stores/canvasIntents')>();
  return { ...mod, reportNodeSize: vi.fn() };
});
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: mockUseCanvasStoreFn,
}));

// Y1a T11：Angle3D 回调捕获（真实 store 的 nodeCallbacksMap 是模块私有——mock setNodeCallbacks
// 捕获 onReplaceCurrentNode 供 clear 路径驱动）；openModal 惰性 no-op
vi.mock('@/stores/angle3DStore', () => ({
  useAngle3DStore: { getState: () => ({ setNodeCallbacks: mockSetNodeCallbacks, openModal: vi.fn() }) },
}));

vi.mock('@/api/storageApi', () => ({
  presignUpload: vi.fn(),
  confirmUpload: vi.fn(),
}));

// Y1a T11+F2：replaceMedia/clearMedia/getMediaSlot 命令面（默认成功/默认槽位无冲突——失败与
// 冲突用例内改 mockRejectedValueOnce/mockResolvedValueOnce）；MediaRevConflictError 等保持真实
const { mockReplaceNodeMedia, mockClearNodeMedia } = vi.hoisted(() => ({
  mockReplaceNodeMedia: vi.fn().mockResolvedValue({ action: 'replace' as const, rev: 2, mediaId: 'm-2' }),
  mockClearNodeMedia: vi.fn().mockResolvedValue({ action: 'clear' as const, rev: 2, mediaId: null }),
}));
vi.mock('@/api/collabApi', async (importOriginal) => {
  const actual = await importOriginal<any>();   // 既有 shrink 等导出保持真实（本文件未消费亦防漂移）
  return {
    ...actual,
    replaceNodeMedia: mockReplaceNodeMedia,
    clearNodeMedia: mockClearNodeMedia,
    getMediaSlot: mockGetMediaSlot,
  };
});

// F2（用户裁定①）：409/入口冲突确认弹窗——捕获 show 配置供用例手动驱动 onPrimary/onClose
vi.mock('@/stores/confirmModalStore', () => ({
  useConfirmModalStore: { getState: () => ({ show: mockConfirmShow, close: mockConfirmClose }) },
}));

// Y1a T11：transformImage 在 jsdom 无法真加载 Image——mock Blob 出口（handleSave 链路驱动）
vi.mock('@/utils/imageTransform', () => ({
  transformImage: vi.fn().mockResolvedValue(new Blob(['x'], { type: 'image/webp' })),
}));

vi.mock('@/utils/imageCrop', () => ({
  cropImage: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({}),
  },
}));

// Mock ImageThumbnailBar to avoid dnd-kit dependency in tests
vi.mock('./prompt-input/ImageThumbnailBar', () => ({
  ImageThumbnailBar: () => null,
}));

// F4c P0：上传 confirm 后延时定向补拉钩子捕获（partial mock——真实 mediaFactsRuntime 图不进断言面，
// 仅钉组件挂点；时序/ingest/toast 行为归 mediaFactsRuntime.test.ts）
vi.mock('@/stores/mediaFactsRuntime', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual };
});

const { mockDownloadMediaFile } = vi.hoisted(() => ({ mockDownloadMediaFile: vi.fn() }));
vi.mock('@/utils/mediaDownload', () => ({ downloadMediaFile: mockDownloadMediaFile }));

// Y3 T7：投影收场测试面——真实 useRuntimeFeedStore（组件订阅 selector/响应后立刻读共用该 store 实例）。
// Y3 清理批（Ruling 5 A2）：regen-token import 随 tripwire 用例整例删除（本文件 token 面断言已归零）。
import { useRuntimeFeedStore, resetRuntimeFeed } from '@/stores/runtimeStore';

describe('ImageGenNode', () => {
  beforeEach(() => {
    const el = document.createElement('div');
    el.id = 'node-toolbar-portal';
    document.body.appendChild(el);
    mockLastPointerShiftKey = false;
  });
  afterEach(() => {
    document.querySelectorAll('#node-toolbar-portal').forEach((el) => el.remove());
    sessionStorage.clear();
    vi.clearAllMocks();
    resetRuntimeFeed();   // Y3 T7：投影收场测试面跨用例清零（cursor/projection 归 null）
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    mockExecStatus = new Map();
    mockActiveNodeId = null;
    mockCancelRequestedAt = 0;
    mockCsNodes = [];
    // mockReturnValue 不被 clearAllMocks 清除 → 显式恢复单选默认
    mockGetNodes.mockReturnValue([{ id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, width: 500, height: 500, selected: true, data: mockNodeData }]);
    mockUseInternalNode.mockReturnValue({
      position: { x: 0, y: 0 },
      measured: { width: 500, height: 500 },
      internals: { positionAbsolute: { x: 0, y: 0 } },
    });
  });

  const renderNode = (selected = false) => {
    const portalRoot = document.createElement('div');
    portalRoot.id = 'node-toolbar-portal';
    document.body.appendChild(portalRoot);

    return render(
      <ReactFlowProvider>
        <ImageGenNode id="img1" data={{}} selected={selected} type="imageGen" draggable={true} dragging={false} selectable={true} deletable={true} zIndex={0} {...{} as any} />
      </ReactFlowProvider>
    );
  };

  it('should render editable node title with default value', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Image');
  });

  it('should save title on blur', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '我的图片' } });
    fireEvent.blur(input);
    expect(screen.getByDisplayValue('我的图片')).toBeInTheDocument();
  });

  it('should cancel edit on Escape', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '取消' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByDisplayValue('Image')).toBeInTheDocument();
  });

  it('should render title at 14px with enlarged 14×14 leading icon', () => {
    const { container } = renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    expect(input.style.fontSize).toBe('14px');
    expect(input.style.lineHeight).toBe('21px');
    const ghost = input.parentElement?.querySelector('span[aria-hidden="true"]') as HTMLSpanElement;
    expect(ghost.style.fontSize).toBe('14px');
    expect(ghost.style.lineHeight).toBe('21px');
    const icon = container.querySelector('svg[viewBox="0 0 48 48"]');
    expect(icon?.getAttribute('width')).toBe('14');
    expect(icon?.getAttribute('height')).toBe('14');
  });

  it('should grow ghost sizer span as user types longer title', () => {
    const { container } = renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'A very long title for testing' } });
    const ghost = container.querySelector('[aria-hidden="true"]') as HTMLSpanElement;
    expect(ghost.textContent).toBe('A very long title for testing ');
  });

  it('should render camera SVG placeholder when no result image', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    const { container } = renderNode();
    // The placeholder should be an SVG icon, not text
    expect(screen.queryByText(/图片预览区/i)).not.toBeInTheDocument();
    const previewContainer = container.querySelector('.flex.items-center.justify-center.overflow-hidden');
    const svg = previewContainer?.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 48 48');
    expect(svg?.getAttribute('width')).toBe('72');
    expect(svg?.getAttribute('height')).toBe('72');
    const g = svg?.querySelector('g');
    expect(g?.getAttribute('opacity')).toBe('0.35');
    const path = svg?.querySelector('path');
    expect(path?.getAttribute('d')).toContain('M31.7998');
  });

  it('should render loading state', () => {
    // Y2 B3：execStatus 只来自投影（data.status 回落删）——loading 态经 execStatusView 投影注入
    mockExecStatus = new Map([['img1', { status: 'loading' }]]);
    renderNode();
    expect(screen.getByText(/生成中/i)).toBeInTheDocument();
  });

  it('批1-6 合并视图：data.status=loading 但 exec 投影 done → 非"生成中"（读点换源）', () => {
    mockNodeData = { ...mockNodeData, status: 'loading', fileId: undefined };
    mockExecStatus = new Map([['img1', { status: 'done' }]]);
    renderNode();
    expect(screen.queryByText(/生成中/i)).not.toBeInTheDocument();
  });

  it('should render result image when available', () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id' };
    renderNode();
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'http://media/cat-file-id');
  });

  it('should have 2 handles (input + output)', () => {
    // Reset to default
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    const { container } = renderNode();
    expect(container.querySelectorAll('.react-flow__handle').length).toBe(2);
  });

  it('should render card with dynamic width based on ratio', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '16:9', prompt: { text: '', html: '', referencedImageIds: [] } };
    const { container } = renderNode();
    const html = container.innerHTML;
    // Width is dynamic (inline style), 16:9 ratio gives 548px wide
    expect(html).toContain('width: 548px');
  });

  // ---- New tests for floating upload button ----

  it('should show floating upload button when selected', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    renderNode(true);
    expect(screen.getByText('上传')).toBeInTheDocument();
  });

  it('should not show floating upload button when not selected', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    renderNode(false);
    expect(screen.queryByText('上传')).not.toBeInTheDocument();
  });

  it('floating upload container should have nodrag and nopan classes', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    renderNode(true);
    const uploadBtn = screen.getByText('上传');
    const container = uploadBtn.closest('.nodrag');
    expect(container).toBeTruthy();
    expect(container?.classList.contains('nopan')).toBe(true);
  });

  // ---- Multi-selection: hide single-node toolbar (Bug A) ----

  it('多选（选中数≥2）时不渲染悬浮上传按钮', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    mockGetNodes.mockReturnValue([
      { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, width: 500, height: 500, selected: true, data: mockNodeData },
      { id: 'img2', type: 'imageGen', position: { x: 600, y: 0 }, width: 500, height: 500, selected: true, data: {} },
    ]);
    renderNode(true);
    expect(screen.queryByText('上传')).not.toBeInTheDocument();
  });

  it('多选时不渲染底部配置面板', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    mockGetNodes.mockReturnValue([
      { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, width: 500, height: 500, selected: true, data: mockNodeData },
      { id: 'img2', type: 'imageGen', position: { x: 600, y: 0 }, width: 500, height: 500, selected: true, data: {} },
    ]);
    renderNode(true);
    // ImageConfigPanel would have model/ratio selectors — should not be present
    expect(screen.queryByText('模型')).not.toBeInTheDocument();
  });

  it('多选时选中边框保留（inline boxShadow）', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    mockGetNodes.mockReturnValue([
      { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, width: 500, height: 500, selected: true, data: mockNodeData },
      { id: 'img2', type: 'imageGen', position: { x: 600, y: 0 }, width: 500, height: 500, selected: true, data: {} },
    ]);
    const { container } = renderNode(true);
    expect(container.innerHTML).toContain('box-shadow: 0 0 0 3px #9CA3AF');
  });

  it('shows replace button when image is user-uploaded (referenceImage set, no fileId)', () => {
    mockNodeData = { status: 'idle', fileId: undefined, referenceImage: 'ref-123', style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    renderNode();
    expect(screen.getByText('替换')).toBeInTheDocument();
  });

  it('does not show replace button when image is AI-generated (fileId set)', () => {
    mockNodeData = { status: 'done', fileId: 'cat-file-id', referenceImage: 'ref-123', style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    renderNode();
    expect(screen.queryByText('替换')).not.toBeInTheDocument();
  });

  // ---- Ratio-based container dimensions (when no image loaded) ----
  it('should use square dimensions for 1:1 ratio when no image', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    const { container } = renderNode();
    // Container should be square (width ≈ height) within max constraints
    expect(container.innerHTML).toContain('width: 500px');
    expect(container.innerHTML).toContain('height: 500px');
  });

  it('should use wide dimensions for 16:9 ratio when no image', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '16:9', prompt: { text: '', html: '', referencedImageIds: [] } };
    const { container } = renderNode();
    // 16:9 → wider than tall, max width 548, height ~309
    expect(container.innerHTML).toContain('width: 548px');
    expect(container.innerHTML).toContain('height: 309px');
  });

  it('should use tall dimensions for 9:16 ratio when no image', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '9:16', prompt: { text: '', html: '', referencedImageIds: [] } };
    const { container } = renderNode();
    // 9:16 → taller than wide, max height 500, width ~281
    expect(container.innerHTML).toContain('height: 500px');
  });

  // ---- Transform mode (rotation + mirror) ----

  it('should apply CSS transform to img in transform mode', () => {
    mockNodeData = { status: 'done', fileId: 'cat-file-id', style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', transformMode: true, imageRotation: 90, flipH: true, flipV: false, prompt: { text: '', html: '', referencedImageIds: [] } };
    renderNode();
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'http://media/cat-file-id');
    expect(img.style.transform).toBe('rotate(90deg) scaleX(-1) scaleY(1)');
  });

  it('should set explicit img dimensions in transform mode to bypass max-w/h', () => {
    mockNodeData = { status: 'done', fileId: 'cat-file-id', style: '写实', model: 'SD XL', quality: 'standard', ratio: '16:9', transformMode: true, imageRotation: 90, flipH: false, flipV: false, prompt: { text: '', html: '', referencedImageIds: [] } };
    renderNode();
    const img = screen.getByRole('img');
    expect(img.style.width).toBe('100%');
    expect(img.style.height).toBe('100%');
    expect(img.style.objectFit).toBe('cover');
  });

  // ── Phase 4/5: Save handler registration ──

  it('registers save handler with nodeStore on mount when in transform mode', () => {
    mockNodeData = { ...mockNodeData, fileId: 'cat-file-id', transformMode: true, imageRotation: 90 };
    renderNode(true);
    expect(mockRegisterSaveHandler).toHaveBeenCalledWith('img1', expect.any(Function));
  });

  it('unregisters save handler on unmount', () => {
    mockNodeData = { ...mockNodeData, fileId: 'cat-file-id', transformMode: true, imageRotation: 90 };
    const { unmount } = renderNode(true);
    unmount();
    expect(mockUnregisterSaveHandler).toHaveBeenCalledWith('img1');
  });

  it('does not register save handler when not in transform mode', () => {
    mockNodeData = { ...mockNodeData, fileId: 'cat-file-id', transformMode: false };
    renderNode(true);
    expect(mockRegisterSaveHandler).not.toHaveBeenCalled();
  });

  // ── activeTransformNodeId ──

  it('sets activeTransformNodeId on mount when in transform mode', () => {
    mockNodeData = { ...mockNodeData, fileId: 'cat-file-id', transformMode: true };
    renderNode(true);
    expect(mockSetActiveTransformNodeId).toHaveBeenCalledWith('img1');
  });

  it('clears activeTransformNodeId on unmount when it was the active node', () => {
    mockActiveNodeId = 'img1';
    mockNodeData = { ...mockNodeData, fileId: 'cat-file-id', transformMode: true };
    const { unmount } = renderNode(true);
    unmount();
    expect(mockSetActiveTransformNodeId).toHaveBeenCalledWith(null);
  });

  // ── beforeunload（Y0b-5 T6 迁移：handler 面归 unloadGuard reason 集合——组件注册 'editor-dirty'，
  // 行为面断言=defaultPrevented；挂载/卸载随 unmount 解除）──

  it('warns unload when hasChanges in transform mode（unloadGuard reason 武装→beforeunload preventDefault）', () => {
    _resetUnloadGuardForTest();
    mockNodeData = { ...mockNodeData, fileId: 'cat-file-id', transformMode: true, imageRotation: 90 };
    renderNode(true);
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    _resetUnloadGuardForTest();
  });

  it('does not add beforeunload listener when no changes', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    mockNodeData = { ...mockNodeData, fileId: 'cat-file-id', transformMode: true, imageRotation: 0, flipH: false, flipV: false };
    renderNode(true);
    // The handler only checks the beforeunload key — spy on that
    const wasCalled = addSpy.mock.calls.some((call: any[]) => call[0] === 'beforeunload');
    expect(wasCalled).toBe(false);
    addSpy.mockRestore();
  });

  // ── handleRotateMirror (Phase 4: mutual exclusion) ──

  it('calls addNodeWithEdge when onRotateMirror is triggered and no active transform', () => {
    mockNodeData = { ...mockNodeData, fileId: 'cat-file-id' };
    const { container } = renderNode(true);
    const btn = screen.queryByText('旋转与镜像');
    if (btn) {
      fireEvent.click(btn);
      expect(mockAddNodeWithEdge).toHaveBeenCalledWith('img1');
    }
  });

  // ── Outpaint mode: new overlay replaces OutpaintPanel ──

  it('renders OutpaintSelectionOverlay when editMode is outpaint', () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id', editMode: 'outpaint' };
    renderNode();
    expect(screen.queryByText('上')).not.toBeInTheDocument();
    expect(screen.queryByText('全部')).not.toBeInTheDocument();
    const frame = document.querySelector('[data-testid="outpaint-frame"]');
    expect(frame).toBeTruthy();
  });

  it('扩图选区悬浮层按 positionAbsolute 定位（打组后不错位）', () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id', editMode: 'outpaint' };
    const first = renderNode();
    const frame0 = document.querySelector('[data-testid="outpaint-frame"]') as HTMLElement;
    expect(frame0).toBeTruthy();
    const left0 = parseFloat(frame0.style.left);
    const top0 = parseFloat(frame0.style.top);
    first.unmount();

    mockUseInternalNode.mockReturnValue({
      position: { x: 0, y: 0 },
      measured: { width: 500, height: 500 },
      internals: { positionAbsolute: { x: 600, y: 400 } },
    });
    renderNode();
    const frame1 = document.querySelector('[data-testid="outpaint-frame"]') as HTMLElement;
    expect(parseFloat(frame1.style.left) - left0).toBe(600);
    expect(parseFloat(frame1.style.top) - top0).toBe(400);
  });

  it('renders EditToolbar with outpaint-specific props', () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id', editMode: 'outpaint' };
    renderNode();
    const portalRoot = document.getElementById('node-toolbar-portal')!;
    expect(portalRoot.textContent).toContain('退出');
    expect(portalRoot.querySelector('[data-testid="outpaint-generate"]')).toBeTruthy();
  });

  it('handleGenerate sends outpaintRect in request body（T6：apiFetch 形态——路径 /api 前缀已内聚+envelope 单层消费）', async () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id', editMode: 'outpaint' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ code: 0, data: { jobId: 'test-job' }, message: 'ok' }), { status: 200 }));
    renderNode();
    const portalRoot = document.getElementById('node-toolbar-portal')!;
    const genBtn = portalRoot.querySelector('[data-testid="outpaint-generate"]');
    if (genBtn) fireEvent.click(genBtn);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith('/api/image-edit/outpaint', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"rect"'),
    }));
    fetchSpy.mockRestore();
  });

  // ── 批0.5-8 意图 id 上送（幂等键——失败重试复用、新点击 rotate、额度尽 rotate） ──

  const clickOutpaintGenerate = () => {
    const portalRoot = document.getElementById('node-toolbar-portal')!;
    const genBtn = portalRoot.querySelector('[data-testid="outpaint-generate"]')!;
    expect(genBtn).toBeTruthy();
    fireEvent.click(genBtn as HTMLElement);
  };

  // ── Y0b-2 T6（Z79 编辑三入口恒手势）：regenToken 生命周期（裸 fetch 已改 apiFetch——envelope 单层消费） ──

  const lastBodyToken = (fetchSpy: any): string | undefined => {
    const call = fetchSpy.mock.calls.at(-1);
    return JSON.parse(call[1].body).regenToken;
  };
  const okEnvelope = () => new Response(JSON.stringify({ code: 0, data: { jobId: 'job-1' }, message: 'ok' }), { status: 200 });

  it('编辑三入口恒手势：首次应用 → regenToken 铸造上送+sessionStorage 持有', async () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id', editMode: 'outpaint' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okEnvelope());
    renderNode();
    clickOutpaintGenerate();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const token = lastBodyToken(fetchSpy);
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(sessionStorage.getItem('flowweb:regen:p1:img1')).toBe(token);
    fetchSpy.mockRestore();
  });

  it('成功后同参数再应用 → 同 token（改参才换键——idemKey 含 paramsHash，token 恒定不撞）', async () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id', editMode: 'outpaint' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okEnvelope());
    const first = renderNode();
    clickOutpaintGenerate();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const token1 = lastBodyToken(fetchSpy);
    first.unmount();

    renderNode();
    clickOutpaintGenerate();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const token2 = lastBodyToken(fetchSpy);
    expect(token1).toBeTruthy();
    expect(token2).toBe(token1); // held 复用（sessionStorage 跨组件实例存活——Z118）
    fetchSpy.mockRestore();
  });

  it('失败后重试复用同 token（免费 rearm 不双扣）', async () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id', editMode: 'outpaint' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(okEnvelope());
    renderNode();
    clickOutpaintGenerate();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const token1 = lastBodyToken(fetchSpy);

    clickOutpaintGenerate();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(lastBodyToken(fetchSpy)).toBe(token1);
    fetchSpy.mockRestore();
  });

  it('INTENT_EXHAUSTED 409 → rotate 新 token+明确提示（下次提交照常扣费；旧上下文不匹配 409 语义已随 T1 退役）', async () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id', editMode: 'outpaint' };
    const warnSpy = vi.spyOn(message, 'warning');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 409, message: '重试次数已用尽', errorCode: 'INTENT_EXHAUSTED' }), { status: 409 })
    );
    renderNode();
    clickOutpaintGenerate();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const sentToken = lastBodyToken(fetchSpy);
    expect(sentToken).toBeTruthy();
    // 已 rotate：sessionStorage 当前值 ≠ 本次上送值（同 token rearm 自锁根堵）
    await waitFor(() => {
      expect(sessionStorage.getItem('flowweb:regen:p1:img1')).not.toBe(sentToken);
    });
    expect(warnSpy).toHaveBeenCalledWith('重试次数已用尽，请重新发起编辑');
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  // ── Y3 Task4（v3.1 合同二）：ImageGenNode handleGenerate 真发受理请求处调 markGestureConsumed ──

  it('Y3 Task4：真发受理请求那次 ⇒ markGestureConsumed 消费标记在案（token 铸造上送后即标记——渲染读不计）', async () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id', editMode: 'outpaint' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okEnvelope());
    renderNode();
    clickOutpaintGenerate();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const token = lastBodyToken(fetchSpy);
    expect(token).toBeTruthy();
    // 消费标记=受理请求真发面的证据（回滚三条件之条件三——token 未消费判据的单源）
    await waitFor(() => {
      expect(sessionStorage.getItem('flowweb:regen-consumed:p1:img1')).toBe('1');
    });
    fetchSpy.mockRestore();
  });

  it('Y3 Task4：INTENT_EXHAUSTED 同步 409 轮换走无 execSeq 旧形态（无行终态维持今天行为——零代际记录）', async () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id', editMode: 'outpaint' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 409, message: '重试次数已用尽', errorCode: 'INTENT_EXHAUSTED' }), { status: 409 })
    );
    renderNode();
    clickOutpaintGenerate();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const sentToken = lastBodyToken(fetchSpy);
    expect(sentToken).toBeTruthy();
    await waitFor(() => {
      expect(sessionStorage.getItem('flowweb:regen:p1:img1')).not.toBe(sentToken);   // 照常轮换（无 execSeq 两参形态）
    });
    // 两参旧形态不写代际记录（无行终态不参与 execSeq 代际窗口）
    expect(sessionStorage.getItem('flowweb:regen-seq:p1:img1')).toBeNull();
    fetchSpy.mockRestore();
  });

  // ── Redraw mode: bottom toolbar + integrated prompt/strength ──

  it('renders EraseBottomToolbar below node when editMode is redraw', () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id', editMode: 'redraw' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 })
    );
    renderNode();
    // EraseBottomToolbar renders with credit/generate section
    const nodeEl = document.querySelector('.canvas-node');
    expect(nodeEl).toBeTruthy();
    // The bottom toolbar is positioned at top-full (below node)
    const bottomBar = nodeEl?.querySelector('.absolute.top-full');
    expect(bottomBar).toBeTruthy();
    fetchSpy.mockRestore();
  });

  it('renders EraseCanvas in redraw mode regardless of tool', () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id', editMode: 'redraw' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 })
    );
    const { container } = renderNode();
    // EraseCanvas renders a canvas element
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
    fetchSpy.mockRestore();
  });

  it('renders prompt input and strength slider in node body for redraw mode', () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id', editMode: 'redraw' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 })
    );
    renderNode();
    expect(screen.getByPlaceholderText('描述你希望生成的内容')).toBeInTheDocument();
    // Strength slider with default value 50
    const strengthSlider = screen.getByDisplayValue('50');
    expect(strengthSlider).toBeInTheDocument();
    expect(strengthSlider.tagName).toBe('INPUT');
    expect((strengthSlider as HTMLInputElement).type).toBe('range');
    fetchSpy.mockRestore();
  });

  it('does not render ImageConfigPanel when editMode is redraw', () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id', editMode: 'redraw' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 })
    );
    renderNode();
    const nodeEl = document.querySelector('.canvas-node');
    // ImageConfigPanel would have model/ratio selectors — should not be present
    expect(screen.queryByText('模型')).not.toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  it('RedrawPanel mode toggle buttons are not rendered', () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id', editMode: 'redraw' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 })
    );
    renderNode();
    // The old RedrawPanel had "矩形" and "画笔" inside the image area.
    // These should NOT appear inside the node body (only in EditToolbar portal).
    const imageContainer = document.querySelector('.canvas-node .relative > .relative');
    if (imageContainer) {
      const rectInImage = (imageContainer as HTMLElement).textContent?.includes('矩形');
      if (rectInImage) {
        // The text "矩形" should only be in portal, not in image container
        expect(imageContainer.querySelector('button')?.textContent).not.toBe('矩形');
      }
    }
    fetchSpy.mockRestore();
  });

  // ── Crop save creates new node ──

  it('crop save creates new child node instead of replacing original image', async () => {
    vi.mocked(presignUpload).mockResolvedValue({
      fileId: 'cropped-file-id',
      uploadUrl: 'http://upload.url',
      key: 'some-key',
      fields: {},
    } as any);
    vi.mocked(cropImage).mockResolvedValue(new Blob(['fake'], { type: 'image/webp' }));

    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'original-file-id', editMode: 'crop' };
    renderNode();

    const portalRoot = document.getElementById('node-toolbar-portal')!;
    const saveBtn = Array.from(portalRoot.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('保存')
    );
    expect(saveBtn).toBeTruthy();
    fireEvent.click(saveBtn!);

    await waitFor(() => {
      // Y2 B3（裁决 15）：裁剪产物=作者放置只写 mediaId（status/fileId 禁键）
      expect(mockAddChildNode).toHaveBeenCalledWith('img1', { mediaId: 'cropped-file-id' });
    });

    // Should NOT replace original node's fileId
    const updateCalls = mockUpdateConfig.mock.calls.filter((c: any[]) => c[0] === 'img1');
    const fileIdUpdate = updateCalls.find((c: any[]) => c[1]?.fileId !== undefined);
    expect(fileIdUpdate).toBeUndefined();

    // Should exit edit mode
    expect(mockUpdateConfig).toHaveBeenCalledWith('img1', { editMode: null });
    expect(mockSetActiveEditNodeId).toHaveBeenCalledWith(null);
  });

  // ─── Resize handles ───

  it('should NOT render resize handles when no image is loaded', () => {
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    const { container } = renderNode(true);
    expect(container.querySelector('.resize-control-top-left')).toBeNull();
    expect(container.querySelector('.resize-control-top-right')).toBeNull();
    expect(container.querySelector('.resize-control-bottom-left')).toBeNull();
    expect(container.querySelector('.resize-control-bottom-right')).toBeNull();
  });

  it('should render 4 corner resize handles when single-selected with image loaded', () => {
    mockNodeData = { status: 'done', fileId: 'cat-file-id', style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    const { container } = renderNode(true);
    expect(container.querySelector('.resize-control-top-left')).toBeTruthy();
    expect(container.querySelector('.resize-control-top-right')).toBeTruthy();
    expect(container.querySelector('.resize-control-bottom-left')).toBeTruthy();
    expect(container.querySelector('.resize-control-bottom-right')).toBeTruthy();
  });

  it('should NOT render resize handles in edit mode', () => {
    mockNodeData = { status: 'done', fileId: 'cat-file-id', editMode: 'crop', style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    const { container } = renderNode(true);
    expect(container.querySelector('.resize-control-top-left')).toBeNull();
  });

  it('should NOT render resize handles in transform mode', () => {
    mockNodeData = { status: 'done', fileId: 'cat-file-id', transformMode: true, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    const { container } = renderNode(true);
    expect(container.querySelector('.resize-control-top-left')).toBeNull();
  });

  // Spec B B6-1 锚：handle 门已收敛 getAvailableHandles（isEditMode=!!editMode||!!transformMode）——
  // transformMode 下双 handle 隐藏（editMode 分片期"handle 门只吃裸 editMode"的现状锚随谓词收敛改写）。
  it('双 handle 在 transformMode 下隐藏（handle 门消费 getAvailableHandles 单源谓词）', () => {
    mockNodeData = { status: 'done', fileId: 'cat-file-id', transformMode: true, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    const { container } = renderNode(true);
    expect(container.querySelectorAll('.react-flow__handle').length).toBe(0);
  });

  it('TD-7: renders loading placeholder (not blank) when nodeData is undefined (refresh restore race)', () => {
    mockNodeData = undefined;
    renderNode();
    const placeholder = screen.getByTestId('node-loading-placeholder');
    expect(placeholder).toHaveAttribute('role', 'status');
    expect(placeholder).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('内容加载中')).toBeInTheDocument();
  });

  // ── Shift 多选抑制悬浮工具条（接线回归锁定）──

  it('flag=true：单选图片节点不渲染悬浮工具条（Shift 多选抑制接线）', () => {
    mockNodeData.fileId = 'f1';
    mockLastPointerShiftKey = true;
    render(
      <ReactFlowProvider>
        <ImageGenNode id="img1" data={{}} selected type="imageGen" draggable={true} dragging={false} selectable={true} deletable={true} zIndex={0} {...{} as any} />
      </ReactFlowProvider>
    );
    expect(document.querySelector('#node-toolbar-portal [role="toolbar"]')).toBeNull();
  });

  it('flag=false：单选图片节点正常渲染悬浮工具条（接线回归）', () => {
    mockNodeData.fileId = 'f1';
    render(
      <ReactFlowProvider>
        <ImageGenNode id="img1" data={{}} selected type="imageGen" draggable={true} dragging={false} selectable={true} deletable={true} zIndex={0} {...{} as any} />
      </ReactFlowProvider>
    );
    expect(document.querySelector('#node-toolbar-portal [role="toolbar"]')).not.toBeNull();
  });

  it('flag true→false rerender 后工具条恢复（接线回归）', () => {
    mockNodeData.fileId = 'f1';
    mockLastPointerShiftKey = true;
    const { rerender } = render(
      <ReactFlowProvider>
        <ImageGenNode id="img1" data={{}} selected type="imageGen" draggable={true} dragging={false} selectable={true} deletable={true} zIndex={0} {...{} as any} />
      </ReactFlowProvider>
    );
    expect(document.querySelector('#node-toolbar-portal [role="toolbar"]')).toBeNull();
    mockLastPointerShiftKey = false;
    // ImageGenNode 是 memo 组件：rerender 传新 data={{}} 字面量（identity 变化）越过浅比较触发重渲染；
    // 真实场景的订阅触发路径由 useIsSingleSelected.test.tsx「恢复路径」用例覆盖
    rerender(
      <ReactFlowProvider>
        <ImageGenNode id="img1" data={{}} selected type="imageGen" draggable={true} dragging={false} selectable={true} deletable={true} zIndex={0} {...{} as any} />
      </ReactFlowProvider>
    );
    expect(document.querySelector('#node-toolbar-portal [role="toolbar"]')).not.toBeNull();
  });

  // ── Y3 T7：受理显式结局+投影收场（G2/G3 族随批翻新——node:status/edit-result 双 socket 通道退役， ──
  // 订阅与响应后立刻读共用收场函数：v3.1 三闸三分支命中即返回）。夹具=editMode 'outpaint'（EditToolbar
  // 生成按钮 data-testid="outpaint-generate"——与恒手势族同款）；投影槽经真实 useRuntimeFeedStore 注入。

  describe('Y3 T7 受理结局+投影收场', () => {
    const portal = () => document.getElementById('node-toolbar-portal')!;
    const genBtn = () => portal().querySelector('[data-testid="outpaint-generate"]') as HTMLButtonElement | null;
    const renderInEditMode = () => {
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', editMode: 'outpaint' };
      renderNode();
    };
    const clickGenerate = () => {
      const btn = genBtn();
      expect(btn).toBeTruthy();
      fireEvent.click(btn!);
    };
    // 投影槽注入（真 store——订阅 selector/响应后立刻读直读该面；cursorSeq 兼作基线 nodeVersion 回落档）
    const setSlot = (entry: Record<string, unknown> | null, cursorSeq = '1') => {
      act(() => {
        useRuntimeFeedStore.setState({
          projectId: 'p1',
          cursor: { historyId: 'h', generation: 0, feedSeq: cursorSeq },
          projection: entry === null ? null : {
            projectId: 'p1', generation: 0, feedSeq: cursorSeq, pgSeq: '0',
            nodes: { img1: entry as any },
          },
          fetchedAtMs: Date.now(),
        });
      });
    };
    const admitEnvelope = (intentId: string, execSeq: string) => new Response(
      JSON.stringify({ code: 0, data: { jobId: 'job-1', replayed: false, intentId, execSeq }, message: 'ok' }), { status: 200 });
    const deliveredEnvelope = () => new Response(
      JSON.stringify({ code: 0, data: { replayed: true, outcome: 'delivered', resultRef: 'ref-1' } }), { status: 200 });
    const voidedEnvelope = () => new Response(
      JSON.stringify({ code: 0, data: { replayed: true, outcome: 'voided' } }), { status: 200 });
    const deferredResponse = () => {
      let resolve!: (v: Response) => void;
      const promise = new Promise<Response>((res) => { resolve = res; });
      return { promise, resolve };
    };

    it('无 socket 订阅锚：node:status/edit-result 双通道均不挂（投影订阅+响应后立刻读单通道——T8 随 executionSocket 模块删除，「零订阅」由「无 import」结构性承担）', () => {
      renderInEditMode();
    });

    it('① delivered → 直接退出编辑+processing false（产物点击前已在槽上——不走「变了才退出」）', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => deliveredEnvelope());
      renderInEditMode();
      // 槽上已是别的 intentId 的 done 且 mediaId 未变——delivered 仍直接退出（不走收场函数比较）
      setSlot({ execStatus: { status: 'done', nodeVersion: '50', intentId: 'i1', execSeq: '6' } });
      mockUpdateConfig.mockClear();
      mockSetActiveEditNodeId.mockClear();
      clickGenerate();
      await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledWith('img1', { editMode: null }));
      expect(mockSetActiveEditNodeId).toHaveBeenCalledWith(null);
      expect((genBtn() as HTMLButtonElement).disabled).toBe(false);   // processing false
      fetchSpy.mockRestore();
    });

    it('② voided → processing false+保持编辑态不弹错（重放不写新事件——不能拿版本大于基线等已存在的 done）', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => voidedEnvelope());
      renderInEditMode();
      mockUpdateConfig.mockClear();
      mockSetActiveEditNodeId.mockClear();
      clickGenerate();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      await act(async () => {});   // 响应分支 flush
      expect((genBtn() as HTMLButtonElement).disabled).toBe(false);
      expect(mockUpdateConfig).not.toHaveBeenCalledWith('img1', { editMode: null });
      expect(portal().textContent).not.toContain('AI 处理失败');
      fetchSpy.mockRestore();
    });

    it('③ 新建成功（replayed:false）→ intentId/execSeq 入 ref+立刻调收场函数（Feed 先到——响应前投影已含该 intentId 的 error 也要弹）', async () => {
      const d = deferredResponse();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => d.promise);
      renderInEditMode();
      clickGenerate();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      // Feed 先到（响应未回——ref.intentId 尚 null）：订阅收场闸ⓐ 拦下不弹
      setSlot({ execStatus: { status: 'error', nodeVersion: '50', intentId: 'i2', execSeq: '7', error: '积分不足' } });
      expect(portal().textContent).not.toContain('积分不足');
      // 响应到达：intentId+execSeq 入 ref+立刻读投影——同一条 error 收场弹句
      await act(async () => { d.resolve(admitEnvelope('i2', '7')); });
      expect(portal().textContent).toContain('积分不足');
      expect((genBtn() as HTMLButtonElement).disabled).toBe(false);
      fetchSpy.mockRestore();
    });

    it('④-1 闸ⓐ：ref 空或 intentId null → 不动（未点击时投影 error 不弹；点击后响应未回也拦）', async () => {
      renderInEditMode();
      // 未点击（ref 空）
      setSlot({ execStatus: { status: 'error', nodeVersion: '50', intentId: 'i9', execSeq: '9', error: '积分不足' } });
      expect(portal().textContent).not.toContain('积分不足');
      // 点击但响应未回（ref.intentId 仍 null——闸ⓐ 拦下订阅收场）
      const d = deferredResponse();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => d.promise);
      clickGenerate();
      setSlot({ execStatus: { status: 'error', nodeVersion: '51', intentId: 'i2', execSeq: '7', error: '本月额度已用尽' } });
      expect(portal().textContent).not.toContain('本月额度已用尽');
      fetchSpy.mockRestore();
    });

    it('④-2 闸ⓓ：error∧intentId 同∧execSeq 同∧nodeVersion 严格大于基线 → 投影句+processing false（空缺句→「AI 处理失败」）', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => admitEnvelope('i2', '7'));
      renderInEditMode();
      // 点击时投影已含本节点旧状态——基线 nodeVersion='40'（槽上合法十进制优先）
      setSlot({ execStatus: { status: 'loading', nodeVersion: '40', intentId: 'old', execSeq: '1' } });
      clickGenerate();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      await act(async () => {});   // replayed:false——ref 落键+立刻读（槽 loading 非终态——不动）
      setSlot({ execStatus: { status: 'error', nodeVersion: '50', intentId: 'i2', execSeq: '7', error: '积分不足' } });
      await act(async () => {});
      expect(portal().textContent).toContain('积分不足');
      expect((genBtn() as HTMLButtonElement).disabled).toBe(false);
      // 空缺句 → 「AI 处理失败」（缺键与空串同档）
      setSlot({ execStatus: { status: 'error', nodeVersion: '51', intentId: 'i2', execSeq: '7' } });
      await act(async () => {});
      expect(portal().textContent).toContain('AI 处理失败');
      fetchSpy.mockRestore();
    });

    it('④-3 闸ⓑ：entry.intentId≠ref.intentId → 不动（error 档——别的 intentId 的 error 不收场；done 档见⑧）', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => admitEnvelope('i2', '7'));
      renderInEditMode();
      clickGenerate();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      await act(async () => {});
      setSlot({ execStatus: { status: 'error', nodeVersion: '55', intentId: 'other', execSeq: '7', error: '积分不足' } });
      await act(async () => {});
      expect(portal().textContent).not.toContain('积分不足');
      expect((genBtn() as HTMLButtonElement).disabled).toBe(true);   // processing 保持（等这一次）
      fetchSpy.mockRestore();
    });

    it('④-4 版本闸：nodeVersion≤基线/非十进制 → 不动（槽上合法十进制基线优先于 cursor 回落）', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => admitEnvelope('i2', '7'));
      renderInEditMode();
      // 基线=槽上 '40'（优先于 cursor '1'）
      setSlot({ execStatus: { status: 'loading', nodeVersion: '40', intentId: 'old', execSeq: '1' } });
      clickGenerate();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      await act(async () => {});
      // 版本相等（≤）→ 不动
      setSlot({ execStatus: { status: 'error', nodeVersion: '40', intentId: 'i2', execSeq: '7', error: '积分不足' } });
      await act(async () => {});
      expect(portal().textContent).not.toContain('积分不足');
      // 非十进制 → 不大于 → 不动
      setSlot({ execStatus: { status: 'error', nodeVersion: 'x51', intentId: 'i2', execSeq: '7', error: '积分不足' } });
      await act(async () => {});
      expect(portal().textContent).not.toContain('积分不足');
      expect((genBtn() as HTMLButtonElement).disabled).toBe(true);
      fetchSpy.mockRestore();
    });

    it('④-4b 基线 null（无槽无 cursor）→ 合法十进制视为大于；cursor=\'0\' 禁采 → 基线仍 null（槽版本 \'0\' 可弹=判别基线非 \'0\'）', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => admitEnvelope('i2', '7'));
      renderInEditMode();
      // 投影空+cursor '0'（禁采档）——基线 nodeVersion 须为 null 而非 '0'（历史 error 严格大于 '0' 会把上一次失败当这一次弹）
      setSlot(null, '0');
      clickGenerate();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      await act(async () => {});
      setSlot({ execStatus: { status: 'error', nodeVersion: '0', intentId: 'i2', execSeq: '7', error: '积分不足' } }, '0');
      await act(async () => {});
      // 槽版本 '0' 合法十进制——基线 null ⇒ 弹；若基线误采 '0' 则 0≤0 不弹（判别基线非 '0'）
      expect(portal().textContent).toContain('积分不足');
      fetchSpy.mockRestore();
    });

    it('⑤ done∧mediaId 相对基线变且非空 → 退出编辑+清基线（读源=投影 artifact 槽非 Yjs 节点 mediaId）', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => admitEnvelope('i2', '7'));
      renderInEditMode();
      mockUpdateConfig.mockClear();
      mockSetActiveEditNodeId.mockClear();
      clickGenerate();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      setSlot({
        execStatus: { status: 'done', nodeVersion: '50', intentId: 'i2', execSeq: '7' },
        artifact: { mediaId: 'new-file-id', artifactRev: 1, nodeVersion: '51' },
      });
      await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledWith('img1', { editMode: null }));
      expect(mockSetActiveEditNodeId).toHaveBeenCalledWith(null);
      expect((genBtn() as HTMLButtonElement).disabled).toBe(false);
      // 清基线：随后同 intentId 的 error 落槽不弹错（闸ⓐ ref null——不清则三闸全过会弹）
      setSlot({ execStatus: { status: 'error', nodeVersion: '52', intentId: 'i2', execSeq: '7', error: '积分不足' } });
      expect(portal().textContent).not.toContain('积分不足');
      fetchSpy.mockRestore();
    });

    it('⑥ done∧mediaId 未变/空 → processing false+留编辑态不弹错（作废终态=poller 单写那条 done 的收场）', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => admitEnvelope('i2', '7'));
      renderInEditMode();
      mockUpdateConfig.mockClear();
      mockSetActiveEditNodeId.mockClear();
      clickGenerate();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      // mediaId 未变（=基线 orig-file-id）→ ⓕ 不退出；空档（artifact 槽无）同判
      setSlot({
        execStatus: { status: 'done', nodeVersion: '50', intentId: 'i2', execSeq: '7' },
        artifact: { mediaId: 'orig-file-id', artifactRev: 1, nodeVersion: '51' },
      });
      await act(async () => {});
      expect((genBtn() as HTMLButtonElement).disabled).toBe(false);
      expect(mockUpdateConfig).not.toHaveBeenCalledWith('img1', { editMode: null });
      expect(portal().textContent).not.toContain('AI 处理失败');
      // artifact 槽空档同判（作废 done 零 exec.artifact）
      setSlot({ execStatus: { status: 'done', nodeVersion: '53', intentId: 'i2', execSeq: '7' } });
      await act(async () => {});
      expect((genBtn() as HTMLButtonElement).disabled).toBe(false);
      expect(mockUpdateConfig).not.toHaveBeenCalledWith('img1', { editMode: null });
      fetchSpy.mockRestore();
    });

    it('⑦ 退出编辑 → ref 清（ⓕ 终态后退出——随后同 intentId 同代 error 不再收场）', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => admitEnvelope('i2', '7'));
      renderInEditMode();
      // 基线=槽上 '40'
      setSlot({ execStatus: { status: 'loading', nodeVersion: '40', intentId: 'old', execSeq: '1' } });
      clickGenerate();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      await act(async () => {});
      // ⓕ 作废终态：processing false 留编辑态（ref.intentId='i2' 在案）
      setSlot({ execStatus: { status: 'done', nodeVersion: '50', intentId: 'i2', execSeq: '7' } });
      await act(async () => {});
      expect((genBtn() as HTMLButtonElement).disabled).toBe(false);
      // 退出编辑（处理已清——退出按钮可达）
      const exitBtn = Array.from(portal().querySelectorAll('button')).find(
        (b) => b.textContent?.includes('退出'),
      ) as HTMLButtonElement;
      expect(exitBtn).toBeTruthy();
      fireEvent.click(exitBtn);
      expect(mockUpdateConfig).toHaveBeenCalledWith('img1', { editMode: null });
      // 退出清基线：同 intentId 同代 error 落槽 → 闸ⓐ 拦下不弹（不清则 ⓓ 版本 51>40 会弹——判别）
      setSlot({ execStatus: { status: 'error', nodeVersion: '51', intentId: 'i2', execSeq: '7', error: '积分不足' } });
      await act(async () => {});
      expect(portal().textContent).not.toContain('积分不足');
      fetchSpy.mockRestore();
    });

    it('⑧ 槽上已是别的 intentId 的 done：响应 replayed:false 后立刻读投影——编辑态与 processing 都不变（闸ⓑ）', async () => {
      const d = deferredResponse();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => d.promise);
      renderInEditMode();
      clickGenerate();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      // Feed 先到：上一代 done+产物换新图（nodeVersion 大于基线）——闸ⓑ（intentId≠ref）拦下
      setSlot({
        execStatus: { status: 'done', nodeVersion: '50', intentId: 'i1', execSeq: '6' },
        artifact: { mediaId: 'prev-gen-file', artifactRev: 1, nodeVersion: '51' },
      });
      // 响应回来：ref=i2——立刻读投影：i1≠i2 闸ⓑ → 不动
      await act(async () => { d.resolve(admitEnvelope('i2', '7')); });
      expect(mockUpdateConfig).not.toHaveBeenCalledWith('img1', { editMode: null });
      expect((genBtn() as HTMLButtonElement).disabled).toBe(true);   // processing 不清（继续等这一次）
      fetchSpy.mockRestore();
    });

    it('⑨ 上一代 artifact 使 mediaId 相对基线变化、但当前 execStatus.intentId 不是这一次 → 不退出编辑（上一代的图照常换上、工具条继续等这一次）', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => admitEnvelope('i2', '7'));
      renderInEditMode();
      clickGenerate();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      await act(async () => {});   // ref：intentId='i2'/execSeq='7' 在案
      // Feed 到达（订阅路径）：上一代 artifact 事件换上新图，execStatus 槽仍持别的 intentId 的 done
      setSlot({
        execStatus: { status: 'done', nodeVersion: '50', intentId: 'i1', execSeq: '6' },
        artifact: { mediaId: 'prev-gen-file', artifactRev: 1, nodeVersion: '51' },
      });
      await act(async () => {});
      expect(mockUpdateConfig).not.toHaveBeenCalledWith('img1', { editMode: null });
      expect((genBtn() as HTMLButtonElement).disabled).toBe(true);   // 继续等这一次
      fetchSpy.mockRestore();
    });

    it('⑩ 同 intentId 换代档：execStatus.execSeq≠ref.execSeq → processing 不清、编辑态不动（ⓒ闸在 ⓔⓕ 分支前命中即返回——缺 execSeq 也算对不上）', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => admitEnvelope('i2', '7'));
      renderInEditMode();
      clickGenerate();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      await act(async () => {});   // ref：intentId='i2'/execSeq='7'
      // 旧代 done 先落槽：同 intentId、execSeq=5（≠7）+ mediaId 变非空——顺序断言：done∧mediaId 变∧execSeq 不匹配也不退出
      setSlot({
        execStatus: { status: 'done', nodeVersion: '50', intentId: 'i2', execSeq: '5' },
        artifact: { mediaId: 'gen-5-file', artifactRev: 1, nodeVersion: '51' },
      });
      await act(async () => {});
      expect(mockUpdateConfig).not.toHaveBeenCalledWith('img1', { editMode: null });
      expect((genBtn() as HTMLButtonElement).disabled).toBe(true);   // processing 不被旧代 done 清掉
      // 槽缺 execSeq 也算对不上（同 intentId 无代际键——无行终态不冒充本次代）
      setSlot({
        execStatus: { status: 'done', nodeVersion: '52', intentId: 'i2' },
        artifact: { mediaId: 'gen-5-file', artifactRev: 1, nodeVersion: '53' },
      });
      await act(async () => {});
      expect((genBtn() as HTMLButtonElement).disabled).toBe(true);
      fetchSpy.mockRestore();
    });

    // Y3 清理批（Ruling 5 A2）：「手清消费标记构造资格」的 restore 接线 tripwire 用例整例删除——
    // settle 已零 token 面（settle 只收场编辑态），restore 生产接线迁六面板投影 effect
    //（面板级回归面=ImageConfigPanel.test.tsx Ruling5 用例；三条件单测面=regen-token.generation.spec.ts）。
  });

  describe('下载（R2b-2 切 downloadMediaFile）', () => {
    it('点击下载 → downloadMediaFile 携 fileId+url+mediaName 文件名（delta①）', async () => {
      mockNodeData = { status: 'done', fileId: 'f-img-000123', mediaName: '日落图', style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
      mockDownloadMediaFile.mockResolvedValue({ ok: true });
      renderNode(true);
      fireEvent.click(screen.getByLabelText('下载'));
      await vi.waitFor(() => {
        expect(mockDownloadMediaFile).toHaveBeenCalledWith({
          fileId: 'f-img-000123',
          url: 'http://media/f-img-000123',
          filename: '日落图',
        });
      });
    });
  });
  // ════════ F2（用户裁定②③④）：媒体命令操作级交互——pending 预览层/入口捕获/409 用户裁定/
  // op token 竞态/edit-result 门/清空延后。确定性交错=可控 promise 手动 resolve（禁真实定时器）════════

  describe('F2 媒体命令交互', () => {
    const getSaveHandler = () => mockRegisterSaveHandler.mock.calls.at(-1)![1] as () => Promise<void>;
    const getClearCallback = () =>
      mockSetNodeCallbacks.mock.calls.at(-1)![1] as { onReplaceCurrentNode: (u: string) => void };
    const mockPresign = (fid: string) => vi.mocked(presignUpload).mockResolvedValue({
      fileId: fid, uploadUrl: 'http://upload.url', key: 'k', fields: {},
    } as any);
    const deferred = <T,>() => {
      let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
      const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };
    const conflictErr = () =>
      new MediaRevConflictError('槽位已换代', { status: 409, errorCode: 'ARTIFACT_REV_CONFLICT', body: {} });
    const getConfirm = () => mockConfirmShow.mock.calls.at(-1)![0];
    const configCallsWith = (key: string) =>
      mockUpdateConfig.mock.calls.filter((c: any[]) => c[0] === 'img1' && c[1] != null && key in c[1]);

    // —— 裁定③：变换保存 pending 预览层——乐观产物不写共享权威状态 ——

    it('变换保存 pending 期间共享 store 的 fileId/referenceImage/rotation 零写；成功后才落新 fileId+清变换参数+清 referenceImage', async () => {
      mockPresign('transformed-file-id');
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', transformMode: true, imageRotation: 90, flipH: true };
      const cmd = deferred<{ action: 'replace'; rev: number; mediaId: string }>();
      mockReplaceNodeMedia.mockReturnValueOnce(cmd.promise as any);
      renderNode(true);
      await act(async () => { getSaveHandler()(); });   // 挂起于命令 await（pending 期间）
      expect(configCallsWith('fileId')).toHaveLength(0);
      expect(configCallsWith('referenceImage')).toHaveLength(0);
      expect(configCallsWith('imageRotation')).toHaveLength(0);
      expect(configCallsWith('transformMode')).toHaveLength(0);
      expect(mockApplyDataPatchToStores).not.toHaveBeenCalled();
      // 裁定②：命令携处理开始时捕获的槽位 rev（非上传后 fresh GET）——默认槽位=生产形态
      // {rev:0,mediaId:null}（新变换节点无基线行）→ expectedRev 0 且零弹窗
      expect(mockConfirmShow).not.toHaveBeenCalled();
      expect(mockReplaceNodeMedia).toHaveBeenCalledWith('p1', 'img1', 'transformed-file-id', { expectedRev: 0 });
      // pending 预览层渲染优先：displayUrl 取待保存产物（name=preview——免疫前序用例遗留的
      // antd message 图标 span[role=img]）
      const img = screen.getByRole('img', { name: 'preview' });
      expect(img).toHaveAttribute('src', 'http://media/transformed-file-id');
      // P3-2：pending 期 CSS transform 抑制（烘焙产物不得双重旋转——取消路径恢复断言见 409 取消用例）
      expect(img.style.transform).toBe('');

      await act(async () => { cmd.resolve({ action: 'replace', rev: 4, mediaId: 'transformed-file-id' }); });
      // 成功后一次性落库：mediaId+清 referenceImage+清旋转变换（Y2 B3：变换产物=作者放置写 mediaId）
      expect(mockUpdateConfig).toHaveBeenCalledWith('img1', {
        mediaId: 'transformed-file-id', referenceImage: undefined,
        imageRotation: 0, flipH: false, flipV: false, transformMode: false,
      });
    });

    // —— 评审 P1-1：入口身份核对判据=rev>0 基线（新变换节点假冲突根修）——

    it('P1-1 新变换节点（复制源 fileId+槽位 {rev:0,mediaId:null}）→ 零弹窗直 POST（expectedRev 0——全新 INSERT 路径）', async () => {
      mockPresign('transformed-file-id');
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'copied-from-source', transformMode: true, imageRotation: 90 };
      renderNode(true);
      await act(async () => { getSaveHandler()(); });
      expect(mockConfirmShow).not.toHaveBeenCalled();   // 无基线行≠冲突
      expect(mockReplaceNodeMedia).toHaveBeenCalledWith('p1', 'img1', 'transformed-file-id', { expectedRev: 0 });
      expect(mockUpdateConfig).toHaveBeenCalledWith('img1', expect.objectContaining({ mediaId: 'transformed-file-id' }));
    });

    it('P1-1 槽位被他人清空（rev>0+mediaId:null）→ 真冲突弹窗（取消零处理零写）', async () => {
      mockGetMediaSlot.mockResolvedValueOnce({ targetField: 'mediaId', rev: 4, mediaId: null });
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', transformMode: true, imageRotation: 90 };
      renderNode(true);
      await act(async () => { getSaveHandler()(); });
      expect(mockConfirmShow).toHaveBeenCalledTimes(1);   // rev>0 基线在——真冲突（非新节点假冲突）
      expect(presignUpload).not.toHaveBeenCalled();
      const cfg = getConfirm();
      await act(async () => { cfg.onClose(); });
      expect(mockReplaceNodeMedia).not.toHaveBeenCalled();
      expect(configCallsWith('fileId')).toHaveLength(0);
    });

    // —— 裁定①：409 取消静默重试——确认弹窗+用户显式裁定 ——

    it('409 竞态：reject MediaRevConflictError → 确认弹窗出现+无第二次提交；点「仍要替换」→ fresh 单次命令（无 opts）成功后应用', async () => {
      mockPresign('transformed-file-id');
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', transformMode: true, imageRotation: 90 };
      mockReplaceNodeMedia
        .mockRejectedValueOnce(conflictErr())
        .mockResolvedValueOnce({ action: 'replace', rev: 8, mediaId: 'transformed-file-id' });
      renderNode(true);
      await act(async () => { getSaveHandler()(); });
      const cfg = getConfirm();
      expect(cfg.title).toBe('图片已被更新');
      expect(cfg.content).toContain('本次替换未生效');
      expect(cfg.primaryText).toBe('仍要替换');
      // 未裁定：零重提交+共享态零写（待保存产物不丢——pending 预览保留）
      expect(mockReplaceNodeMedia).toHaveBeenCalledTimes(1);
      expect(configCallsWith('fileId')).toHaveLength(0);
      expect(screen.getByRole('img', { name: 'preview' })).toHaveAttribute('src', 'http://media/transformed-file-id');

      await act(async () => { cfg.onPrimary(); });
      // 用户授权的覆盖=全新一轮单次命令（无 expectedRev——api 层 fresh GET 槽位）
      const last = mockReplaceNodeMedia.mock.calls.at(-1)!;
      expect(last[0]).toBe('p1'); expect(last[1]).toBe('img1'); expect(last[2]).toBe('transformed-file-id');
      expect(last[3]).toBeUndefined();
      expect(mockUpdateConfig).toHaveBeenCalledWith('img1', expect.objectContaining({ mediaId: 'transformed-file-id' }));
    });

    it('409 取消：共享 store 零写+pending 预览撤掉（回落权威值渲染）+toast', async () => {
      const infoSpy = vi.spyOn(message, 'info').mockImplementation(() => ({} as any));
      mockPresign('transformed-file-id');
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', transformMode: true, imageRotation: 90 };
      mockReplaceNodeMedia.mockRejectedValueOnce(conflictErr());
      renderNode(true);
      await act(async () => { getSaveHandler()(); });
      const cfg = getConfirm();
      await act(async () => { cfg.onClose(); });   // 取消（X/取消键/遮罩同路）
      expect(configCallsWith('fileId')).toHaveLength(0);
      expect(mockApplyDataPatchToStores).not.toHaveBeenCalled();
      expect(mockReplaceNodeMedia).toHaveBeenCalledTimes(1);   // 无第二次提交
      // pending 清：回落权威值（共享态从未被本操作写过——无需恢复闭包旧值）
      expect(screen.getByRole('img', { name: 'preview' })).toHaveAttribute('src', 'http://media/orig-file-id');
      // 变换参数保留（用户可再试）：CSS transform 恢复生效
      expect(screen.getByRole('img', { name: 'preview' }).style.transform).toBe('rotate(90deg) scaleX(1) scaleY(1)');
      expect(infoSpy).toHaveBeenCalledWith('已取消，图片保持协作者版本');
      infoSpy.mockRestore();
    });

    it('命令非 409 失败（网络/403）：清 pending 预览+toast 错误+显示权威值；变换参数保留、共享态零写', async () => {
      const errSpy = vi.spyOn(message, 'error').mockImplementation(() => ({} as any));
      mockPresign('transformed-file-id');
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', transformMode: true, imageRotation: 90 };
      mockReplaceNodeMedia.mockRejectedValueOnce(new Error('network down'));
      renderNode(true);
      await act(async () => { getSaveHandler()(); });
      expect(mockConfirmShow).not.toHaveBeenCalled();   // 非 409 无裁定面
      expect(configCallsWith('fileId')).toHaveLength(0);
      expect(mockApplyDataPatchToStores).not.toHaveBeenCalled();
      expect(screen.getByRole('img', { name: 'preview' })).toHaveAttribute('src', 'http://media/orig-file-id');
      expect(screen.getByRole('img', { name: 'preview' }).style.transform).toBe('rotate(90deg) scaleX(1) scaleY(1)');
      expect(errSpy).toHaveBeenCalledWith('图片替换未生效（网络异常），已显示最新图片');
      errSpy.mockRestore();
    });

    // —— 裁定②：入口捕获——处理开始时发现输入已被换，同 409 面交用户裁定 ——

    it('入口捕获：槽位 mediaId≠本轮输入 fileId → 上传前弹确认；取消 → 零处理零写', async () => {
      const infoSpy = vi.spyOn(message, 'info').mockImplementation(() => ({} as any));
      mockGetMediaSlot.mockResolvedValueOnce({ targetField: 'mediaId', rev: 3, mediaId: 'collaborator-new' });
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', transformMode: true, imageRotation: 90 };
      renderNode(true);
      await act(async () => { getSaveHandler()(); });
      const cfg = getConfirm();
      expect(cfg.title).toBe('图片已被更新');
      // 未裁定：未处理输入（无上传）/未发命令
      expect(presignUpload).not.toHaveBeenCalled();
      expect(mockReplaceNodeMedia).not.toHaveBeenCalled();
      await act(async () => { cfg.onClose(); });
      expect(configCallsWith('fileId')).toHaveLength(0);
      expect(infoSpy).toHaveBeenCalledWith('已取消，图片保持协作者版本');
      infoSpy.mockRestore();
    });

    it('入口冲突确认「仍要替换」→ 继续处理+命令携入口捕获 rev 成功应用', async () => {
      mockGetMediaSlot.mockResolvedValueOnce({ targetField: 'mediaId', rev: 6, mediaId: 'collaborator-new' });
      mockPresign('transformed-file-id');
      mockReplaceNodeMedia.mockResolvedValueOnce({ action: 'replace', rev: 7, mediaId: 'transformed-file-id' });
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', transformMode: true, imageRotation: 90 };
      renderNode(true);
      await act(async () => { getSaveHandler()(); });
      const cfg = getConfirm();
      await act(async () => { cfg.onPrimary(); });
      expect(mockReplaceNodeMedia).toHaveBeenCalledWith('p1', 'img1', 'transformed-file-id', { expectedRev: 6 });
      expect(mockUpdateConfig).toHaveBeenCalledWith('img1', expect.objectContaining({ mediaId: 'transformed-file-id' }));
    });

    // —— 裁定③：op token——旧操作回调不能修改新操作 ——

    it('旧操作回调竞态：两次 handleSave，第一次的命令 promise 后 resolve → 第一次续段零写（token 失配弃置）', async () => {
      vi.mocked(presignUpload)
        .mockResolvedValueOnce({ fileId: 't-1', uploadUrl: 'http://upload.url', key: 'k', fields: {} } as any)
        .mockResolvedValueOnce({ fileId: 't-2', uploadUrl: 'http://upload.url', key: 'k', fields: {} } as any);
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', transformMode: true, imageRotation: 90 };
      const cmd1 = deferred<{ action: 'replace'; rev: number; mediaId: string }>();
      mockReplaceNodeMedia
        .mockReturnValueOnce(cmd1.promise as any)
        .mockResolvedValueOnce({ action: 'replace', rev: 5, mediaId: 't-2' });
      renderNode(true);
      await act(async () => { getSaveHandler()(); });   // 保存①挂起于命令
      await act(async () => { getSaveHandler()(); });   // 保存②完整成功（t-2 落库）
      expect(mockUpdateConfig).toHaveBeenCalledWith('img1', expect.objectContaining({ mediaId: 't-2' }));
      const writesBefore = mockUpdateConfig.mock.calls.length;
      await act(async () => { cmd1.resolve({ action: 'replace', rev: 9, mediaId: 't-1' }); });
      // 保存①续段弃置：无新增共享写（旧回调禁写新态）
      expect(mockUpdateConfig.mock.calls.length).toBe(writesBefore);
      expect(mockApplyDataPatchToStores).not.toHaveBeenCalled();
    });

    // —— 裁定③（Y3 T7 随批翻新）：edit-result socket 通道退役——投影更新到达不写共享产物面 ——

    it('投影更新在 pending 媒体操作期间到达 → 零共享写不变量维持；pending 清后到达 → 编辑收场同样零固化写', async () => {
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', editMode: 'crop' };
      const cmd = deferred<{ action: 'clear'; rev: number; mediaId: null }>();
      mockClearNodeMedia.mockReturnValueOnce(cmd.promise as any);
      renderNode(true);
      const bumpSlot = (mediaId?: string) => act(() => {
        useRuntimeFeedStore.setState({
          projectId: 'p1',
          cursor: { historyId: 'h', generation: 0, feedSeq: '1' },
          projection: {
            projectId: 'p1', generation: 0, feedSeq: '1', pgSeq: '0',
            nodes: { img1: { ...(mediaId ? { artifact: { mediaId, artifactRev: 1, nodeVersion: '2' } } : {}), execStatus: { status: 'done', nodeVersion: '2' } } as any },
          },
          fetchedAtMs: Date.now(),
        });
      });
      await act(async () => { getClearCallback().onReplaceCurrentNode('http://result.url'); });   // clear 挂起=pending 期间
      bumpSlot('f-edit');   // 投影终态到达（pending 期间）——共享产物面零写
      expect(mockApplyDataPatchToStores).not.toHaveBeenCalledWith('img1', { fileId: 'f-edit' });
      expect(mockSetFileResult).not.toHaveBeenCalled();
      // 裁定④：清空延后——命令 resolve 前 referenceImage/fileId 不动
      expect(configCallsWith('referenceImage')).toHaveLength(0);

      await act(async () => { cmd.resolve({ action: 'clear', rev: 4, mediaId: null }); });
      expect(mockUpdateConfig).toHaveBeenCalledWith('img1', { referenceImage: undefined, fileId: undefined });
      bumpSlot('f-edit2');   // pending 清后投影再到达——fileId 固化写仍全链退役
      expect(mockApplyDataPatchToStores).not.toHaveBeenCalled();
      expect(mockSetFileResult).not.toHaveBeenCalled();
    });

    // —— 裁定④：清空失败——referenceImage 清理延后到命令成功，失败保留原参考图 ——

    it('清空失败（非 409）：referenceImage+fileId 原样保留（零写）+toast', async () => {
      const errSpy = vi.spyOn(message, 'error').mockImplementation(() => ({} as any));
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', referenceImage: 'ref-1' };
      mockClearNodeMedia.mockRejectedValueOnce(new Error('network down'));
      renderNode(true);
      await act(async () => { getClearCallback().onReplaceCurrentNode('http://result.url'); });
      expect(mockUpdateConfig).not.toHaveBeenCalled();   // 不预清也不回滚（快照回滚会盖掉期间他人编辑）
      expect(mockApplyDataPatchToStores).not.toHaveBeenCalled();
      expect(mockConfirmShow).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledWith('清空未生效（网络异常），原图片已保留');
      errSpy.mockRestore();
    });

    it('清空 409：确认弹窗+无第二次提交；确认「仍要清空」→ fresh 单次命令成功才清；取消原样保留', async () => {
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', referenceImage: 'ref-1' };
      mockClearNodeMedia
        .mockRejectedValueOnce(conflictErr())
        .mockResolvedValueOnce({ action: 'clear', rev: 5, mediaId: null });
      renderNode(true);
      await act(async () => { getClearCallback().onReplaceCurrentNode('http://result.url'); });
      const cfg = getConfirm();
      expect(cfg.title).toBe('图片已被更新');
      expect(cfg.primaryText).toBe('仍要清空');
      expect(mockClearNodeMedia).toHaveBeenCalledTimes(1);   // 未裁定零重提交
      expect(mockUpdateConfig).not.toHaveBeenCalled();
      await act(async () => { cfg.onPrimary(); });
      expect(mockClearNodeMedia).toHaveBeenCalledTimes(2);
      expect(mockClearNodeMedia).toHaveBeenLastCalledWith('p1', 'img1');   // 无 opts——fresh 槽位 rev
      expect(mockUpdateConfig).toHaveBeenCalledWith('img1', { referenceImage: undefined, fileId: undefined });
    });

    it('清空 409 取消：原样保留（referenceImage+fileId 零写）', async () => {
      const infoSpy = vi.spyOn(message, 'info').mockImplementation(() => ({} as any));
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', referenceImage: 'ref-1' };
      mockClearNodeMedia.mockRejectedValueOnce(conflictErr());
      renderNode(true);
      await act(async () => { getClearCallback().onReplaceCurrentNode('http://result.url'); });
      const cfg = getConfirm();
      await act(async () => { cfg.onClose(); });
      expect(mockClearNodeMedia).toHaveBeenCalledTimes(1);
      expect(mockUpdateConfig).not.toHaveBeenCalled();
      expect(mockApplyDataPatchToStores).not.toHaveBeenCalled();
      infoSpy.mockRestore();
    });

    it('P2-2 清空 409 确认后重提再遇 409 → 冲突专属文案（非一律「网络异常」——镜像 handleSave 分支）', async () => {
      const errSpy = vi.spyOn(message, 'error').mockImplementation(() => ({} as any));
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', referenceImage: 'ref-1' };
      mockClearNodeMedia.mockRejectedValueOnce(conflictErr()).mockRejectedValueOnce(conflictErr());
      renderNode(true);
      await act(async () => { getClearCallback().onReplaceCurrentNode('http://result.url'); });
      const cfg = getConfirm();
      await act(async () => { cfg.onPrimary(); });
      expect(mockClearNodeMedia).toHaveBeenCalledTimes(2);
      expect(mockUpdateConfig).not.toHaveBeenCalled();   // 仍未清（referenceImage/fileId 保留）
      expect(errSpy).toHaveBeenCalledWith('清空未生效（版本再次冲突），原图片已保留');
      errSpy.mockRestore();
    });

    // —— 评审 P1-2：pending 期烘焙图 load 禁 fit（转置 wh 不得写 envelope）；成功自愈收敛 ——

    it('P1-2 90/270 pending 期间零 reportNodeSize；成功后按烘焙语义自愈到正确足迹', async () => {
      mockPresign('transformed-file-id');
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', transformMode: true, imageRotation: 90, aspectRatio: 2 };
      // 变换盒=旋转足迹（竖 274×548——transform 模式渲染拟合后的现盒；cs 信封=fit 的 currentWH 源）
      mockCsNodes = [{ id: 'img1', width: 274, height: 548 }];
      const cmd = deferred<{ action: 'replace'; rev: number; mediaId: string }>();
      mockReplaceNodeMedia.mockReturnValueOnce(cmd.promise as any);
      renderNode(true);
      const fireLoad = (w: number, h: number) => {
        const img = screen.getByRole('img', { name: 'preview' });
        Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
        Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
        fireEvent.load(img);
      };
      fireLoad(400, 200);   // 原图 load（4:2 横）——normal 路径记 naturalSizeRef
      vi.mocked(reportNodeSize).mockClear();
      await act(async () => { getSaveHandler()(); });   // pending：img src=烘焙产物
      fireLoad(200, 400);   // 烘焙图 load（竖）——门内：store 仍持 90° 时转置 fit 会写错误横盒 {274,137}
      expect(vi.mocked(reportNodeSize)).not.toHaveBeenCalled();   // pending 期零 envelope 写
      await act(async () => { cmd.resolve({ action: 'replace', rev: 1, mediaId: 'transformed-file-id' }); });
      // 成功自愈：烘焙语义（90°→转置最近 natural {200,400}）+清理后 rotation 0 显式重算：
      // adaptToFit({274,548}, 0.5)={274,548}——竖足迹保持（非转置错误横盒）
      expect(vi.mocked(reportNodeSize)).toHaveBeenCalledWith('img1', 274, 548);
    });

    // —— 评审 P2-1（Y3 T7 随批翻新）：node:status socket 通道退役——投影收场零共享产物写 ——

    it('P2-1 投影收场（done∧mediaId 变）零共享产物写——setFileResult/setStatus/applyDataPatchToStores 全零调（收场仅编辑态面）', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
        JSON.stringify({ code: 0, data: { jobId: 'job-1', replayed: false, intentId: 'i2', execSeq: '7' } }), { status: 200 }));
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', editMode: 'outpaint' };
      renderNode();
      const portalRoot = document.getElementById('node-toolbar-portal')!;
      const btn = portalRoot.querySelector('[data-testid="outpaint-generate"]') as HTMLElement;
      fireEvent.click(btn);
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      act(() => {
        useRuntimeFeedStore.setState({
          projectId: 'p1',
          cursor: { historyId: 'h', generation: 0, feedSeq: '1' },
          projection: {
            projectId: 'p1', generation: 0, feedSeq: '1', pgSeq: '0',
            nodes: { img1: {
              execStatus: { status: 'done', nodeVersion: '50', intentId: 'i2', execSeq: '7' },
              artifact: { mediaId: 'new-file-id', artifactRev: 1, nodeVersion: '51' },
            } as any },
          },
          fetchedAtMs: Date.now(),
        });
      });
      await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledWith('img1', { editMode: null }));   // ⓔ 编辑态收场
      expect(mockSetFileResult).not.toHaveBeenCalled();
      expect(mockSetStatus).not.toHaveBeenCalledWith('img1', 'done');
      expect(mockApplyDataPatchToStores).not.toHaveBeenCalled();
      expect(mockReplaceNodeMedia).not.toHaveBeenCalled();   // 交付唯一 owner=服务端投影（Y2 B3 维持）
      fetchSpy.mockRestore();
    });

    // —— 评审 P2-4：入口取消清残留 pending（死操作产物不滞留预览层）——

    it('P2-4 旧操作 409 确认窗期间新保存入口取消 → 残留 pending 预览清除', async () => {
      const infoSpy = vi.spyOn(message, 'info').mockImplementation(() => ({} as any));
      mockPresign('t-1');
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', transformMode: true, imageRotation: 90 };
      mockReplaceNodeMedia.mockRejectedValueOnce(conflictErr());
      renderNode(true);
      await act(async () => { getSaveHandler()(); });   // 保存①：409 → 确认窗开（pending=t-1 产物）
      expect(getConfirm().primaryText).toBe('仍要替换');
      expect(screen.getByRole('img', { name: 'preview' })).toHaveAttribute('src', 'http://media/t-1');
      // 保存②启动（新入口——真实面=Angle3D 回调等非键盘通道；①成 stale，其确认窗位移作废）
      mockGetMediaSlot.mockResolvedValueOnce({ targetField: 'mediaId', rev: 5, mediaId: 'collaborator-new' });
      await act(async () => { getSaveHandler()(); });   // 保存②：入口冲突确认
      const cfg2 = getConfirm();
      await act(async () => { cfg2.onClose(); });   // ②取消 → ①残留 pending 必须同批清除
      expect(screen.getByRole('img', { name: 'preview' })).toHaveAttribute('src', 'http://media/orig-file-id');
      expect(configCallsWith('fileId')).toHaveLength(0);
      expect(infoSpy).toHaveBeenCalledWith('已取消，图片保持协作者版本');
      infoSpy.mockRestore();
    });

    // —— 评审 P2-5：Ctrl+S 在飞守卫 ——

    it('P2-5 保存中 Ctrl+S 不再启动新保存（在飞窗口唯一操作）', async () => {
      mockPresign('transformed-file-id');
      mockNodeData = { ...mockNodeData, status: 'done', fileId: 'orig-file-id', transformMode: true, imageRotation: 90 };
      mockActiveNodeId = 'img1';   // keydown 门：activeTransformNodeId===id
      const cmd = deferred<{ action: 'replace'; rev: number; mediaId: string }>();
      mockReplaceNodeMedia.mockReturnValueOnce(cmd.promise as any);
      renderNode(true);
      await act(async () => { getSaveHandler()(); });   // ①在飞（isSaving=true——命令挂起）
      expect(mockReplaceNodeMedia).toHaveBeenCalledTimes(1);
      act(() => {
        fireEvent(document, new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
      });
      expect(mockReplaceNodeMedia).toHaveBeenCalledTimes(1);   // 守卫：未启保存②
      await act(async () => { cmd.resolve({ action: 'replace', rev: 1, mediaId: 'transformed-file-id' }); });
    });
  });

});
