import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AudioGenNode } from './AudioGenNode';
import { ReactFlowProvider } from '@xyflow/react';
import { io } from 'socket.io-client';

// All shared state must be hoisted for vi.mock factories
const { mockSocket, getMockNodeData, setMockNodeData, getStoreSetStatus, getStoreSetFileResult } = vi.hoisted(() => {
  const mockSocket = {
    on: vi.fn().mockReturnThis(),
    emit: vi.fn().mockReturnThis(),
    disconnect: vi.fn(),
  };
  let mockNodeData: any = { fileId: undefined, status: 'idle', model: '', referenceAudio: undefined };
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

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = {
        nodes: { 'a1': { id: 'a1', type: 'audioGen', position: { x: 0, y: 0 }, data: getMockNodeData() } },
        updateConfig: mockUpdateConfig,
        setStatus: getStoreSetStatus(),
        setFileResult: getStoreSetFileResult(),
      };
      if (typeof selector === 'function') return selector(state);
      return state;
    }),
    {
      getState: () => ({
        nodes: { 'a1': { id: 'a1', type: 'audioGen', position: { x: 0, y: 0 }, data: getMockNodeData() } },
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
    fileId: 'audio-file-1',
    uploadUrl: 'http://minio/flowai/audio-file-1',
    key: 'uploads/audio-file-1/test.mp3',
    fields: { key: 'uploads/audio-file-1/test.mp3', Policy: 'x', 'X-Am-Signature': 'y' },
  }),
  confirmUpload: vi.fn().mockResolvedValue({ fileId: 'audio-file-1' }),
}));

vi.mock('axios', () => ({
  default: { post: vi.fn().mockResolvedValue({}) },
}));

vi.mock('./AudioConfigPanel', () => ({
  AudioConfigPanel: () => <div>audio config panel</div>,
}));

vi.mock('./AudioWaveform', () => ({
  AudioWaveform: vi.fn(({ nodeId, onError }: { nodeId: string; audioUrl: string; onError?: (err: Error) => void }) => (
    <div data-testid="audio-waveform">
      <button data-testid="trigger-error" onClick={() => onError?.(new Error('test'))}>trigger error</button>
      waveform-{nodeId}
    </div>
  )),
}));

describe('AudioGenNode', () => {
  afterEach(() => {
    vi.clearAllMocks();
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceAudio: undefined });
    mockSocket.on.mockReturnThis();
    mockSocket.emit.mockReturnThis();
  });

  const baseNodeProps = {
    id: 'a1',
    data: {},
    type: 'audioGen',
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
    render(<ReactFlowProvider><AudioGenNode {...baseNodeProps} selected={selected} /></ReactFlowProvider>);

  // ─── Title ───

  it('should render editable node title with default value "Audio"', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceAudio: undefined });
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Audio');
  });

  it('should save title on blur', () => {
    renderNode();
    const input = screen.getByLabelText('节点标题') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '我的音乐' } });
    fireEvent.blur(input);
    expect(screen.getByDisplayValue('我的音乐')).toBeInTheDocument();
  });

  // ─── Fixed size 380×170 ───

  it('should render card with fixed size 400×260', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceAudio: undefined });
    const { container } = renderNode();
    expect(container.innerHTML).toContain('width: 400px');
    expect(container.innerHTML).toContain('height: 260px');
  });

  // ─── Handles ───

  it('should have 2 handles (left target, right source)', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceAudio: undefined });
    const { container } = renderNode();
    expect(container.querySelectorAll('.react-flow__handle').length).toBe(2);
  });

  // ─── Placeholder ───

  it('should render audio placeholder icon when no audio loaded', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceAudio: undefined });
    const { container } = renderNode();
    // Should not show text placeholder
    expect(screen.queryByText(/音频预览区/i)).not.toBeInTheDocument();
    // Should have an SVG placeholder
    const svg = container.querySelector('.flex.items-center.justify-center svg');
    expect(svg).toBeTruthy();
  });

  // ─── Loading state ───

  it('should render loading state', () => {
    setMockNodeData({ fileId: undefined, status: 'loading', model: '', referenceAudio: undefined });
    renderNode();
    expect(screen.getByText(/生成中/i)).toBeInTheDocument();
  });

  // ─── Audio preview ───

  it('should render AudioWaveform when fileId exists', () => {
    setMockNodeData({ fileId: 'test-audio-id', status: 'done', model: '', referenceAudio: undefined });
    renderNode();
    expect(screen.getByTestId('audio-waveform')).toBeTruthy();
  });

  // ─── Config panel ───

  it('should show config panel when selected', () => {
    renderNode(true);
    expect(screen.getByText('audio config panel')).toBeInTheDocument();
  });

  it('should not show config panel when not selected', () => {
    renderNode(false);
    expect(screen.queryByText('audio config panel')).not.toBeInTheDocument();
  });

  // ─── Floating upload button ───

  it('should show floating upload button when selected', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceAudio: undefined });
    renderNode(true);
    expect(screen.getByText('上传')).toBeInTheDocument();
  });

  it('should not show floating upload button when not selected', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceAudio: undefined });
    renderNode(false);
    expect(screen.queryByText('上传')).not.toBeInTheDocument();
  });

  it('should have hidden file input accepting audio/*', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceAudio: undefined });
    renderNode();
    const fileInput = document.querySelector('input[type="file"][accept="audio/*"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
  });

  // ─── Replace button ───

  it('shows replace button when audio is user-uploaded (referenceAudio set, no fileId)', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', referenceAudio: 'ref-456', model: '' });
    renderNode();
    expect(screen.getByText('替换')).toBeInTheDocument();
  });

  it('does not show replace button when audio is AI-generated (fileId set)', () => {
    setMockNodeData({ fileId: 'audio-789', status: 'done', referenceAudio: 'ref-456', model: '' });
    renderNode();
    expect(screen.queryByText('替换')).not.toBeInTheDocument();
  });

  // ─── Socket.io ───

  it('should connect to socket.io on mount', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceAudio: undefined });
    let connectHandler: Function | null = null;
    mockSocket.on.mockImplementation((event: string, handler: Function) => {
      if (event === 'connect') connectHandler = handler;
      return mockSocket;
    });
    renderNode();
    connectHandler!();
    expect(io).toHaveBeenCalledWith('/execution', expect.objectContaining({ transports: expect.any(Array) }));
    expect(mockSocket.emit).toHaveBeenCalledWith('join', 'default');
  });

  it('should disconnect socket.io on unmount', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceAudio: undefined });
    const { unmount } = renderNode();
    unmount();
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('should update status to loading on socket node:status event', () => {
    setMockNodeData({ fileId: undefined, status: 'idle', model: '', referenceAudio: undefined });
    let statusHandler: Function | null = null;
    mockSocket.on.mockImplementation((event: string, handler: Function) => {
      if (event === 'node:status') statusHandler = handler;
      return mockSocket;
    });
    renderNode();
    statusHandler!({ nodeId: 'a1', status: 'loading' });
    expect(getStoreSetStatus()).toHaveBeenCalledWith('a1', 'loading');
  });

  it('should set fileId and done on socket node:status done event', () => {
    setMockNodeData({ fileId: undefined, status: 'loading', model: '', referenceAudio: undefined });
    let statusHandler: Function | null = null;
    mockSocket.on.mockImplementation((event: string, handler: Function) => {
      if (event === 'node:status') statusHandler = handler;
      return mockSocket;
    });
    renderNode();
    statusHandler!({ nodeId: 'a1', status: 'done', fileId: 'gen-audio-001' });
    expect(getStoreSetFileResult()).toHaveBeenCalledWith('a1', 'gen-audio-001');
  });

  // ─── AudioWaveform integration ───

  it('should render AudioWaveform when displayUrl exists', () => {
    setMockNodeData({ fileId: 'test-audio-id', status: 'done', model: '', referenceAudio: undefined });
    renderNode();
    expect(screen.getByTestId('audio-waveform')).toBeTruthy();
  });

  it('should fall back to native audio element when AudioWaveform errors', () => {
    setMockNodeData({ fileId: 'test-audio-id', status: 'done', model: '', referenceAudio: undefined });
    renderNode();
    // Verify AudioWaveform is shown first
    expect(screen.getByTestId('audio-waveform')).toBeTruthy();
    // Trigger error to switch to fallback
    fireEvent.click(screen.getByTestId('trigger-error'));
    // After error, native audio should be shown instead
    const audioEl = document.querySelector('audio');
    expect(audioEl).toBeTruthy();
    expect(audioEl).toHaveAttribute('src', 'http://media/test-audio-id');
  });
});
