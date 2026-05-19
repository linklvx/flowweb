import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { VideoConfigPanel } from './VideoConfigPanel';

const mockUpdateConfig = vi.fn();
const mockSetStatus = vi.fn();

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((selector?: any) => {
    const state = {
      nodes: {
        'v1': { type: 'video', mode: 'text-to-video', prompt: 'test video prompt', model: '', ratio: '16:9', quality: '720P', duration: '', audio: false, status: 'idle' },
      },
      updateConfig: mockUpdateConfig,
      setStatus: mockSetStatus,
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: vi.fn(() => ({ nodes: [], edges: [], getState: () => ({ nodes: [], edges: [] }) })),
}));

const renderPanel = () =>
  render(
    <ReactFlowProvider>
      <VideoConfigPanel nodeId="v1" />
    </ReactFlowProvider>
  );

describe('VideoConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
