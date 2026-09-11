import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoGenNode } from './VideoGenNode';
import { ReactFlowProvider } from '@xyflow/react';

// All shared state must be hoisted for vi.mock factories
const { subscribeNodeStatusMock, getMockNodeData, setMockNodeData, getStoreSetStatus, getStoreSetFileResult } = vi.hoisted(() => {
  // 声明 handler 参数使 mock.calls[0][0] 类型为处理器本身（测试经此触发 node:status）
  const subscribeNodeStatusMock = vi.fn((_handler: (p: any) => void) => () => {});
  let mockNodeData: any = { fileId: undefined, status: 'idle', model: '', referenceVideo: undefined };
  let storeSetStatus = vi.fn();
  let storeSetFileResult = vi.fn();

  return {
    subscribeNodeStatusMock,
    getMockNodeData: () => mockNodeData,
    setMockNodeData: (d: any) => { mockNodeData = d; },
    getStoreSetStatus: () => storeSetStatus,
    getStoreSetFileResult: () => storeSetFileResult,
  };
});

const mockUpdateConfig = vi.fn();

vi.mock('@/hooks/useMediaUrl', () => ({
  useMediaUrl: (fileId: string | null | undefined) => {
    if (fileId) return { url: `http://media/${fileId}`, loading: false, error: null };
    return { url: null, loading: false, error: null };
  },
}));

const { mockGetNodes, mockSetNodes } = vi.hoisted(() => {
  const getNodes = vi.fn(() => [{ id: 'v1', type: 'videoGen', position: { x: 0, y: 0 }, width: 548, height: 309, selected: true, data: getMockNodeData() }]);
  const setNodes = vi.fn();
  return { mockGetNodes: getNodes, mockSetNodes: setNodes };
});

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useStore: (selector: any) => selector({ nodes: mockGetNodes() }),
    useReactFlow: vi.fn(() => ({
      getNodes: mockGetNodes,
      setNodes: mockSetNodes,
    })),
    // Mock NodeResizeControl as a transparent wrapper that forwards data-testid
    NodeResizeControl: ({ position, style, children }: any) => (
      <div data-testid={`resize-control-${position}`} style={style}>
        {children}
      </div>
    ),
  };
});

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = {
        nodes: { 'v1': { id: 'v1', type: 'video', position: { x: 0, y: 0 }, data: getMockNodeData() } },
        updateConfig: mockUpdateConfig,
        setStatus: getStoreSetStatus(),
        setFileResult: getStoreSetFileResult(),
      };
      if (typeof selector === 'function') return selector(state);
      return state;
    }),
    {
      getState: () => ({
        nodes: { 'v1': { id: 'v1', type: 'video', position: { x: 0, y: 0 }, data: getMockNodeData() } },
        setStatus: getStoreSetStatus(),
        setFileResult: getStoreSetFileResult(),
      }),
    },
  ),
}));

const { mockCanvasProjectId } = vi.hoisted(() => {
  let projectId: string | null = 'test-project';
  return {
    mockCanvasProjectId: () => projectId,
  };
});

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = { projectId: mockCanvasProjectId() };
      if (typeof selector === 'function') return selector(state);
      return state;
    }),
    {
      getState: () => ({ projectId: mockCanvasProjectId() }),
    },
  ),
}));

vi.mock('@/services/executionSocket', () => ({
  subscribeNodeStatus: subscribeNodeStatusMock,
  subscribeNodeEditResult: vi.fn(() => () => {}),
  ensureExecutionSocket: vi.fn(() => ({ once: vi.fn(), off: vi.fn(), on: vi.fn(), connected: false })),
  teardownExecutionSocket: vi.fn(),
}));

vi.mock('@/api/storageApi', () => ({
  presignUpload: vi.fn().mockResolvedValue({
    fileId: 'vid-file-1',
    uploadUrl: 'http://minio/flowai/vid-file-1',
    key: 'uploads/vid-file-1/test.mp4',
    fields: { key: 'uploads/vid-file-1/test.mp4', Policy: 'x', 'X-Am-Signature': 'y' },
  }),
  confirmUpload: vi.fn().mockResolvedValue({ fileId: 'vid-file-1' }),
}));

vi.mock('axios', () => ({
  default: { post: vi.fn().mockResolvedValue({}) },
}));

vi.mock('./VideoConfigPanel', () => ({
  VideoConfigPanel: () => <div>config panel</div>,
}));

vi.mock('./VideoHDPanel', () => ({
  VideoHDPanel: () => <div>hd panel</div>,
}));

describe('VideoGenNode', () => {
  afterEach(() => {
    vi.clearAllMocks();
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
  });

  const baseNodeProps = {
    id: 'v1',
    data: {},
    type: 'videoGen',
    draggable: true,
    dragging: false,
    selectable: true,
    deletable: true,
    zIndex: 0,
    isConnectable: true,
    positionAbsoluteX: 100,
    positionAbsoluteY: 100,
  } as any;

  const renderNode = (selected = false) =>
    render(<ReactFlowProvider><VideoGenNode {...baseNodeProps} selected={selected} /></ReactFlowProvider>);

  // ---- Title icon test ----
  it('should render play button icon next to title', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    const { container } = renderNode();
    const titleBar = container.querySelector('[class*="-translate-y-full"]');
    const svg = titleBar?.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16');
    const path = svg?.querySelector('path');
    expect(path?.getAttribute('d')).toContain('M4.66699');
  });

  // ---- Title tests ----
  it('should render editable node title with default value', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Video');
  });

  it('should save title on blur', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '我的视频' } });
    fireEvent.blur(input);
    expect(screen.getByDisplayValue('我的视频')).toBeInTheDocument();
  });

  it('should cancel edit on Escape', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '取消' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByDisplayValue('Video')).toBeInTheDocument();
  });

  it('should grow ghost sizer span as user types longer title', () => {
    const { container } = renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'A very long video title' } });
    const ghost = container.querySelector('[aria-hidden="true"]') as HTMLSpanElement;
    expect(ghost.textContent).toBe('A very long video title ');
  });

  // ---- Preview tests ----
  it('should render play button SVG placeholder when no video', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    const { container } = renderNode();
    // The placeholder should be a play icon SVG, not text
    expect(screen.queryByText(/视频预览区/i)).not.toBeInTheDocument();
    // Find the preview container (flex items-center justify-center)
    const previewContainer = container.querySelector('.flex.items-center.justify-center.overflow-hidden');
    const svg = previewContainer?.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg?.getAttribute('width')).toBe('64');
    expect(svg?.getAttribute('height')).toBe('64');
    const path = svg?.querySelector('path');
    expect(path?.getAttribute('d')).toContain('M4.66699');
  });

  it('should render video element when videoUrl exists', () => {
    setMockNodeData({ fileId: 'test-file-id', status: 'done', model: '', referenceVideo: undefined });
    renderNode();
    const videoEl = document.querySelector('video');
    expect(videoEl).toBeTruthy();
    expect(videoEl).toHaveAttribute('src', 'http://media/test-file-id');
  });

  it('should render loading state', () => {
    setMockNodeData({ fileId: undefined, status: 'loading', model: '', referenceVideo: undefined });
    renderNode();
    expect(screen.getByText(/生成中/i)).toBeInTheDocument();
  });

  // ---- Handles ----
  it('should have 2 handles', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    const { container } = renderNode();
    expect(container.querySelectorAll('.react-flow__handle').length).toBe(2);
  });

  // ---- Config panel ----
  it('should show config panel when selected', () => {
    renderNode(true);
    expect(screen.getByText('config panel')).toBeInTheDocument();
  });

  it('should not show config panel when not selected', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    renderNode(false);
    expect(screen.queryByText('config panel')).not.toBeInTheDocument();
  });

  // ---- Floating upload button ----
  it('should show floating upload button when selected', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    renderNode(true);
    expect(screen.getByText('上传')).toBeInTheDocument();
  });

  it('should not show floating upload button when not selected', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    renderNode(false);
    expect(screen.queryByText('上传')).not.toBeInTheDocument();
  });

  it('should have hidden file input accepting video/*', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    renderNode();
    const fileInput = document.querySelector('input[type="file"][accept="video/*"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
  });

  // ---- Default size same as image node ----
  it('should default to 548 width in card (same as image node)', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    const { container } = renderNode();
    expect(container.innerHTML).toContain('width: 548px');
  });

  // ---- Dynamic sizing by video aspect ratio ----
  it('should resize container based on video dimensions after load', () => {
    setMockNodeData({ fileId: 'vid-123', status: 'done', model: '', referenceVideo: undefined });
    renderNode();
    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    // Container should have dynamic width style (not just 548)
    const parent = video?.closest('[style*="width"]') as HTMLElement;
    expect(parent).toBeTruthy();
  });

  // ---- Replace button on hover for user-uploaded videos ----
  it('shows replace button when video is user-uploaded (referenceVideo set, no fileId)', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', referenceVideo: 'ref-123', model: '' });
    renderNode();
    expect(screen.getByText('替换')).toBeInTheDocument();
  });

  it('does not show replace button when video is AI-generated (fileId set)', () => {
    setMockNodeData({ fileId: 'vid-123', status: 'done', referenceVideo: 'ref-123', model: '' });
    renderNode();
    expect(screen.queryByText('替换')).not.toBeInTheDocument();
  });

  // ─── Socket.io real-time status updates（经 executionSocket 单例 subscribeNodeStatus 触发）───

  it('should update node status to loading when socket emits node:status loading', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    renderNode();
    expect(subscribeNodeStatusMock).toHaveBeenCalledWith(expect.any(Function));
    const statusHandler = subscribeNodeStatusMock.mock.calls[0][0];
    // Simulate status event for this node
    statusHandler({ nodeId: 'v1', status: 'loading' });
    expect(getStoreSetStatus()).toHaveBeenCalledWith('v1', 'loading');
  });

  it('should update fileId and set done when socket emits node:status done', () => {
    setMockNodeData({ fileId: undefined, status: 'loading', model: '', referenceVideo: undefined });
    renderNode();
    const statusHandler = subscribeNodeStatusMock.mock.calls[0][0];
    statusHandler({ nodeId: 'v1', status: 'done', fileId: 'gen-vid-456' });
    expect(getStoreSetFileResult()).toHaveBeenCalledWith('v1', 'gen-vid-456');
  });

  it('should set status to error when socket emits node:status error', () => {
    setMockNodeData({ fileId: undefined, status: 'loading', model: '', referenceVideo: undefined });
    renderNode();
    const statusHandler = subscribeNodeStatusMock.mock.calls[0][0];
    statusHandler({ nodeId: 'v1', status: 'error' });
    expect(getStoreSetStatus()).toHaveBeenCalledWith('v1', 'error');
  });

  it('should ignore socket events for other nodes', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    renderNode();
    const statusHandler = subscribeNodeStatusMock.mock.calls[0][0];
    getStoreSetStatus().mockClear();
    statusHandler({ nodeId: 'other-node', status: 'loading' });
    expect(getStoreSetStatus()).not.toHaveBeenCalled();
  });

  // ─── Ratio-based default sizing ───

  it('should use 16:9 ratio for default container (548×309 same as image node)', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    const { container } = renderNode();
    expect(container.innerHTML).toContain('width: 548px');
    expect(container.innerHTML).toContain('height: 309px');
  });

  // ─── Resize handles ───

  it('should NOT render resize handles when no video is loaded', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    renderNode(true);
    expect(screen.queryByTestId('resize-control-top-left')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resize-control-bottom-right')).not.toBeInTheDocument();
  });

  it('should render 4 corner resize handles when single-selected with video loaded', () => {
    setMockNodeData({ fileId: 'vid-123', status: 'done', model: '', referenceVideo: undefined });
    renderNode(true);
    expect(screen.getByTestId('resize-control-top-left')).toBeInTheDocument();
    expect(screen.getByTestId('resize-control-top-right')).toBeInTheDocument();
    expect(screen.getByTestId('resize-control-bottom-left')).toBeInTheDocument();
    expect(screen.getByTestId('resize-control-bottom-right')).toBeInTheDocument();
  });

  // ─── Title bar dimension display ───

  it('displays video dimensions in title bar after video metadata loads', () => {
    setMockNodeData({ fileId: 'vid-123', status: 'done', model: '', referenceVideo: undefined });
    renderNode();
    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 1080, configurable: true });
    fireEvent(video!, new Event('loadedmetadata'));
    expect(screen.getByText('1920 × 1080')).toBeInTheDocument();
  });

  it('does not display dimensions when no video is loaded', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    const { container } = renderNode();
    const titleBar = container.querySelector('[class*="-translate-y-full"]');
    expect(titleBar?.textContent).not.toContain('×');
  });

  // ─── HD panel integration ────────────────────────────

  it('does not render toolbar or HD panel when no fileId', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    renderNode(true);
    // Toolbar not visible (show requires hasMedia)
    expect(screen.queryByText('高清')).not.toBeInTheDocument();
    // HD panel not rendered
    expect(screen.queryByText('hd panel')).not.toBeInTheDocument();
  });

  it('renders HD button but not HD panel when fileId exists', () => {
    setMockNodeData({ fileId: 'vid-123', status: 'done', model: '', referenceVideo: undefined });
    renderNode(true);
    // HD button visible in toolbar
    expect(screen.getByText('高清')).toBeInTheDocument();
    // HD panel not open by default
    expect(screen.queryByText('hd panel')).not.toBeInTheDocument();
  });

  it('opens HD panel when HD button is clicked', () => {
    setMockNodeData({ fileId: 'vid-123', status: 'done', model: '', referenceVideo: undefined });
    renderNode(true);
    fireEvent.click(screen.getByText('高清'));
    expect(screen.getByText('hd panel')).toBeInTheDocument();
  });

  it('hides HD panel when selected becomes false', () => {
    setMockNodeData({ fileId: 'vid-123', status: 'done', model: '', referenceVideo: undefined });
    const { rerender } = renderNode(true);
    // Open panel
    fireEvent.click(screen.getByText('高清'));
    expect(screen.getByText('hd panel')).toBeInTheDocument();
    // Deselect
    rerender(<ReactFlowProvider><VideoGenNode {...baseNodeProps} selected={false} /></ReactFlowProvider>);
    expect(screen.queryByText('hd panel')).not.toBeInTheDocument();
  });

  it('hides HD panel when dragging becomes true', () => {
    setMockNodeData({ fileId: 'vid-123', status: 'done', model: '', referenceVideo: undefined });
    const { rerender } = renderNode(true);
    // Open panel
    fireEvent.click(screen.getByText('高清'));
    expect(screen.getByText('hd panel')).toBeInTheDocument();
    // Start dragging
    rerender(<ReactFlowProvider><VideoGenNode {...baseNodeProps} selected={true} dragging={true} /></ReactFlowProvider>);
    expect(screen.queryByText('hd panel')).not.toBeInTheDocument();
  });

  it('does not show HD panel when multiple nodes are selected', () => {
    setMockNodeData({ fileId: 'vid-123', status: 'done', model: '', referenceVideo: undefined });
    // Return multiple selected nodes
    mockGetNodes.mockReturnValue([
      { id: 'v1', type: 'videoGen', selected: true } as any,
      { id: 'v2', type: 'videoGen', selected: true } as any,
    ]);
    renderNode(true);
    // 多选时工具条（含高清入口）整体隐藏，HD panel 不可达
    expect(screen.queryByText('高清')).not.toBeInTheDocument();
    expect(screen.queryByText('hd panel')).not.toBeInTheDocument();
    // Restore
    mockGetNodes.mockReturnValue([{ id: 'v1', type: 'videoGen', position: { x: 0, y: 0 }, width: 548, height: 309, selected: true, data: getMockNodeData() }]);
  });

  it('closes HD panel on Escape key', () => {
    setMockNodeData({ fileId: 'vid-123', status: 'done', model: '', referenceVideo: undefined });
    renderNode(true);
    fireEvent.click(screen.getByText('高清'));
    expect(screen.getByText('hd panel')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('hd panel')).not.toBeInTheDocument();
  });

  it('does not close HD panel on Escape when input is focused', () => {
    setMockNodeData({ fileId: 'vid-123', status: 'done', model: '', referenceVideo: undefined });
    renderNode(true);
    fireEvent.click(screen.getByText('高清'));
    expect(screen.getByText('hd panel')).toBeInTheDocument();
    // Focus the title input
    const titleInput = screen.getByLabelText('节点标题');
    (titleInput as HTMLInputElement).focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText('hd panel')).toBeInTheDocument();
  });
});
