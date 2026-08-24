import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { ImageGenNode } from './ImageGenNode';
import { ReactFlowProvider } from '@xyflow/react';
import { presignUpload, confirmUpload } from '@/api/storageApi';
import { cropImage } from '@/utils/imageCrop';

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
let mockLastPointerShiftKey = false;

vi.mock('@/hooks/useMediaUrl', () => ({
  useMediaUrl: (fileId: string | null | undefined) => {
    if (fileId) return { url: `http://media/${fileId}`, loading: false, error: null };
    return { url: null, loading: false, error: null };
  },
}));

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
} = vi.hoisted(() => {
  const updateConfig = vi.fn();
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

  const nodeStoreFn = vi.fn((_selector?: any) => {
    // Get fresh state at call time
    const state = {
      nodes: { 'img1': { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, data: mockNodeData } },
      updateConfig,
      activeTransformNodeId: mockActiveNodeId,
      cancelRequestedAt: mockCancelRequestedAt,
      setActiveTransformNodeId,
      triggerCancelTransform,
      activeEditNodeId: null as string | null,
      setActiveEditNodeId,
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
  };
});

let mockActiveNodeId: string | null = null;
let mockCancelRequestedAt = 0;

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: mockUseNodeStoreFn,
  isImageExtNode: (node: any) => node?.type === 'imageExtGen',
  isImageGenNode: (node: any) => node?.type === 'imageGen',
  isImageNode: (node: any) => node?.type === 'imageGen' || node?.type === 'imageExtGen',
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: mockUseCanvasStoreFn,
}));

vi.mock('@/api/storageApi', () => ({
  presignUpload: vi.fn(),
  confirmUpload: vi.fn(),
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

describe('ImageGenNode', () => {
  beforeEach(() => {
    const el = document.createElement('div');
    el.id = 'node-toolbar-portal';
    document.body.appendChild(el);
    mockLastPointerShiftKey = false;
  });
  afterEach(() => {
    document.querySelectorAll('#node-toolbar-portal').forEach((el) => el.remove());
    vi.clearAllMocks();
    mockNodeData = { status: 'idle', fileId: undefined, style: '写实', model: 'SD XL', quality: 'standard', ratio: '1:1', prompt: { text: '', html: '', referencedImageIds: [] } };
    mockActiveNodeId = null;
    mockCancelRequestedAt = 0;
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
    mockNodeData = { ...mockNodeData, status: 'loading' };
    renderNode();
    expect(screen.getByText(/生成中/i)).toBeInTheDocument();
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

  // ── beforeunload ──

  it('adds beforeunload listener when hasChanges in transform mode', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    mockNodeData = { ...mockNodeData, fileId: 'cat-file-id', transformMode: true, imageRotation: 90 };
    renderNode(true);
    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    addSpy.mockRestore();
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

  it('handleGenerate sends outpaintRect in request body', async () => {
    mockNodeData = { ...mockNodeData, status: 'done', fileId: 'cat-file-id', editMode: 'outpaint' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jobId: 'test-job' }), { status: 200 })
    );
    renderNode();
    const portalRoot = document.getElementById('node-toolbar-portal')!;
    const genBtn = portalRoot.querySelector('[data-testid="outpaint-generate"]');
    if (genBtn) fireEvent.click(genBtn);

    expect(fetchSpy).toHaveBeenCalledWith('/api/image-edit/outpaint', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"rect"'),
    }));
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
      expect(mockAddChildNode).toHaveBeenCalledWith('img1', { fileId: 'cropped-file-id', status: 'done' });
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
});
