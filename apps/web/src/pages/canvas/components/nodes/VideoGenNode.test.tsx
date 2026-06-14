import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoGenNode } from './VideoGenNode';
import { ReactFlowProvider } from '@xyflow/react';
import { io } from 'socket.io-client';

// All shared state must be hoisted for vi.mock factories
const { mockSocket, getMockNodeData, setMockNodeData, getStoreSetStatus, getStoreSetFileResult } = vi.hoisted(() => {
  const mockSocket = {
    on: vi.fn().mockReturnThis(),
    emit: vi.fn().mockReturnThis(),
    removeAllListeners: vi.fn().mockReturnThis(),
    close: vi.fn(),
  };
  let mockNodeData: any = { fileId: undefined, status: 'idle', model: '', referenceVideo: undefined };
  let storeSetStatus = vi.fn();
  let storeSetFileResult = vi.fn();

  return {
    mockSocket,
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

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
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

describe('VideoGenNode', () => {
  afterEach(() => {
    vi.clearAllMocks();
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    // Restore mockSocket.on default behavior after clearAllMocks
    mockSocket.on.mockReturnThis();
    mockSocket.emit.mockReturnThis();
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

  // ─── Socket.io real-time status updates ───

  it('should connect to socket.io on mount and join default room', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    let connectHandler: Function | null = null;
    mockSocket.on.mockImplementation((event: string, handler: Function) => {
      if (event === 'connect') connectHandler = handler;
      return mockSocket;
    });
    renderNode();
    // Simulate socket connect event
    connectHandler!();
    expect(io).toHaveBeenCalledWith('/execution', expect.objectContaining({ transports: expect.any(Array) }));
    expect(mockSocket.emit).toHaveBeenCalledWith('join', 'default');
  });

  it('should disconnect socket.io on unmount', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    const { unmount } = renderNode();
    unmount();
    expect(mockSocket.removeAllListeners).toHaveBeenCalled();
  });

  it('should update node status to loading when socket emits node:status loading', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    // Capture the 'node:status' handler
    let statusHandler: Function | null = null;
    mockSocket.on.mockImplementation((event: string, handler: Function) => {
      if (event === 'node:status') statusHandler = handler;
      return mockSocket;
    });
    renderNode();
    expect(statusHandler).not.toBeNull();
    // Simulate status event for this node
    statusHandler!({ nodeId: 'v1', status: 'loading' });
    expect(getStoreSetStatus()).toHaveBeenCalledWith('v1', 'loading');
  });

  it('should update fileId and set done when socket emits node:status done', () => {
    setMockNodeData({ fileId: undefined, status: 'loading', model: '', referenceVideo: undefined });
    let statusHandler: Function | null = null;
    mockSocket.on.mockImplementation((event: string, handler: Function) => {
      if (event === 'node:status') statusHandler = handler;
      return mockSocket;
    });
    renderNode();
    statusHandler!({ nodeId: 'v1', status: 'done', fileId: 'gen-vid-456' });
    expect(getStoreSetFileResult()).toHaveBeenCalledWith('v1', 'gen-vid-456');
  });

  it('should set status to error when socket emits node:status error', () => {
    setMockNodeData({ fileId: undefined, status: 'loading', model: '', referenceVideo: undefined });
    let statusHandler: Function | null = null;
    mockSocket.on.mockImplementation((event: string, handler: Function) => {
      if (event === 'node:status') statusHandler = handler;
      return mockSocket;
    });
    renderNode();
    statusHandler!({ nodeId: 'v1', status: 'error' });
    expect(getStoreSetStatus()).toHaveBeenCalledWith('v1', 'error');
  });

  it('should ignore socket events for other nodes', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceVideo: undefined });
    let statusHandler: Function | null = null;
    mockSocket.on.mockImplementation((event: string, handler: Function) => {
      if (event === 'node:status') statusHandler = handler;
      return mockSocket;
    });
    getStoreSetStatus().mockClear();
    renderNode();
    statusHandler!({ nodeId: 'other-node', status: 'loading' });
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
});
