import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { VideoConfigPanel } from './VideoConfigPanel';

vi.mock('@/components/FileUpload', () => ({
  FileUpload: ({ onUploadComplete, accept, hint }: any) => (
    <div data-testid="file-upload">
      <span>点击或拖拽上传</span>
      {hint && <span>{hint}</span>}
    </div>
  ),
}));

const { mockStoreState } = vi.hoisted(() => {
  const state: any = {
    nodes: {
      'v1': { type: 'video', mode: 'text-to-video', prompt: 'test video prompt', model: '', ratio: '16:9', quality: '720P', duration: '', audio: false, status: 'idle' },
    },
    updateConfig: vi.fn(),
    setStatus: vi.fn(),
  };
  return { mockStoreState: state };
});

const mockUpdateConfig = mockStoreState.updateConfig;
const mockSetStatus = mockStoreState.setStatus;

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: Object.assign(
    vi.fn((selector?: any) => {
      if (typeof selector === 'function') return selector(mockStoreState);
      return mockStoreState;
    }),
    {
      getState: () => mockStoreState,
      setState: (partial: any) => { Object.assign(mockStoreState, partial); },
    }
  ),
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: vi.fn(() => ({ nodes: [], edges: [], getState: () => ({ nodes: [], edges: [] }) })),
}));

const renderPanel = (nodeId?: string) =>
  render(
    <ReactFlowProvider>
      <VideoConfigPanel nodeId={nodeId ?? 'v1'} />
    </ReactFlowProvider>
  );

describe('VideoConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState.nodes = {
      'v1': { type: 'video', mode: 'text-to-video', prompt: 'test video prompt', model: '', ratio: '16:9', quality: '720P', duration: '', audio: false, status: 'idle' },
    };
  });

  it('should render 4 mode tabs', () => {
    renderPanel();
    expect(screen.getByText('文生视频')).toBeInTheDocument();
    expect(screen.getByText('单图生视频')).toBeInTheDocument();
    expect(screen.getByText('首尾帧生视频')).toBeInTheDocument();
    expect(screen.getByText('多帧参考生视频')).toBeInTheDocument();
  });

  it('should render prompt input', () => {
    renderPanel();
    expect(screen.getByPlaceholderText(/描述想要生成的视频/i)).toBeInTheDocument();
  });

  it('should render execute button', () => {
    renderPanel();
    expect(screen.getByText('▶')).toBeInTheDocument();
  });

  it('should show ratio/quality/duration/audio controls', () => {
    renderPanel();
    expect(screen.getByText('比例')).toBeInTheDocument();
    expect(screen.getByText('清晰度')).toBeInTheDocument();
    expect(screen.getByText('时长')).toBeInTheDocument();
    expect(screen.getByText('音频')).toBeInTheDocument();
  });

  it('should call setStatus when execute button clicked', () => {
    renderPanel();
    fireEvent.click(screen.getByText('▶'));
    expect(mockSetStatus).toHaveBeenCalledWith('v1', 'loading');
  });

  it('should show upload for image-to-video mode', () => {
    mockStoreState.nodes['vid-1'] = { type: 'video', mode: 'image-to-video' };
    const { container } = renderPanel('vid-1');
    expect(container.innerHTML).toContain('点击或拖拽上传');
  });

  it('should show dual upload for first-last-frame mode', () => {
    mockStoreState.nodes['vid-1'] = { type: 'video', mode: 'first-last-frame' };
    const { container } = renderPanel('vid-1');
    expect(container.textContent).toContain('开始帧');
    expect(container.textContent).toContain('结束帧');
  });
});
