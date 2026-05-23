import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoGenNode } from './VideoGenNode';
import { ReactFlowProvider } from '@xyflow/react';

let mockNodeData: any = { fileId: undefined, status: 'idle', model: '', referenceVideo: undefined };

const mockUpdateConfig = vi.fn();

vi.mock('@/hooks/useMediaUrl', () => ({
  useMediaUrl: (fileId: string | null | undefined) => {
    if (fileId) return { url: `http://media/${fileId}`, loading: false, error: null };
    return { url: null, loading: false, error: null };
  },
}));

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((selector?: any) => {
    const state = {
      nodes: { 'v1': { id: 'v1', type: 'video', position: { x: 0, y: 0 }, data: mockNodeData } },
      updateConfig: mockUpdateConfig,
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
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
  it('should render preview placeholder when no video', () => {
    renderNode();
    expect(screen.getByText(/视频预览区/i)).toBeInTheDocument();
  });

  it('should render video element when videoUrl exists', () => {
    mockNodeData = { fileId: 'test-file-id', status: 'done', model: '', referenceVideo: undefined };
    renderNode();
    const videoEl = document.querySelector('video');
    expect(videoEl).toBeTruthy();
    expect(videoEl).toHaveAttribute('src', 'http://media/test-file-id');
  });

  it('should render loading state', () => {
    mockNodeData = { fileId: undefined, status: 'loading', model: '', referenceVideo: undefined };
    renderNode();
    expect(screen.getByText(/生成中/i)).toBeInTheDocument();
  });

  // ---- Handles ----
  it('should have 2 handles', () => {
    mockNodeData = { fileId: undefined, status: 'idle', model: '', referenceVideo: undefined };
    const { container } = renderNode();
    expect(container.querySelectorAll('.react-flow__handle').length).toBe(2);
  });

  // ---- Config panel ----
  it('should show config panel when selected', () => {
    renderNode(true);
    expect(screen.getByText('config panel')).toBeInTheDocument();
  });

  it('should not show config panel when not selected', () => {
    mockNodeData = { fileId: undefined, status: 'idle', model: '', referenceVideo: undefined };
    renderNode(false);
    expect(screen.queryByText('config panel')).not.toBeInTheDocument();
  });

  // ---- Floating upload button ----
  it('should show floating upload button when selected', () => {
    mockNodeData = { fileId: undefined, status: 'idle', model: '', referenceVideo: undefined };
    renderNode(true);
    expect(screen.getByText('上传')).toBeInTheDocument();
  });

  it('should not show floating upload button when not selected', () => {
    mockNodeData = { fileId: undefined, status: 'idle', model: '', referenceVideo: undefined };
    renderNode(false);
    expect(screen.queryByText('上传')).not.toBeInTheDocument();
  });

  it('should have hidden file input accepting video/*', () => {
    mockNodeData = { fileId: undefined, status: 'idle', model: '', referenceVideo: undefined };
    renderNode();
    const fileInput = document.querySelector('input[type="file"][accept="video/*"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
  });

  // ---- 1. Default size same as image node (548×306) ----
  it('should default to 548 width in card (same as image node)', () => {
    mockNodeData = { fileId: undefined, status: 'idle', model: '', referenceVideo: undefined };
    const { container } = renderNode();
    expect(container.innerHTML).toContain('width: 548px');
  });

  // ---- 2. Dynamic sizing by video aspect ratio ----
  it('should resize container based on video dimensions after load', () => {
    mockNodeData = { fileId: 'vid-123', status: 'done', model: '', referenceVideo: undefined };
    renderNode();
    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    // Container should have dynamic width style (not just 548)
    const parent = video?.closest('[style*="width"]') as HTMLElement;
    expect(parent).toBeTruthy();
  });

  // ---- 3. Replace button on hover for user-uploaded videos ----
  it('shows replace button when video is user-uploaded (referenceVideo set, no fileId)', () => {
    mockNodeData = { fileId: undefined, status: 'idle', referenceVideo: 'ref-123', model: '' };
    renderNode();
    expect(screen.getByText('替换')).toBeInTheDocument();
  });

  it('does not show replace button when video is AI-generated (fileId set)', () => {
    mockNodeData = { fileId: 'vid-123', status: 'done', referenceVideo: 'ref-123', model: '' };
    renderNode();
    expect(screen.queryByText('替换')).not.toBeInTheDocument();
  });
});
