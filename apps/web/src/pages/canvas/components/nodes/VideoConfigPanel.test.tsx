import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { VideoConfigPanel } from './VideoConfigPanel';

// Track the maxHeight prop passed to PromptInput
let capturedMaxHeight = 80;
// Track the onPasteImage handler passed to PromptInput
let capturedOnPasteImage: ((file: File) => void) | undefined;
// Track the onGenerate handler passed to PromptInput
let capturedOnGenerate: (() => void) | undefined;

// Mock PromptInput
vi.mock('./prompt-input/PromptInput', () => ({
  default: React.forwardRef((props: any, ref: any) => {
    capturedMaxHeight = props.maxHeight;
    capturedOnPasteImage = props.onPasteImage;
    capturedOnGenerate = props.onGenerate;
    React.useImperativeHandle(ref, () => ({
      forceSync: vi.fn(),
      focus: vi.fn(),
      clear: vi.fn(),
      insertImage: vi.fn(),
      removeImage: vi.fn(),
      setText: vi.fn(),
    }));
    return <div data-testid="prompt-input" data-max-height={props.maxHeight}>PromptInput</div>;
  }),
}));

// Mock useImageUpload — uploadSingleImage spyable
const mockUploadSingleImage = vi.fn();
vi.mock('./prompt-input/useImageUpload', () => ({
  useImageUpload: () => ({
    uploadSingleImage: mockUploadSingleImage,
    uploadBatchImages: vi.fn(),
    deleteImage: vi.fn(),
  }),
}));

// Mock ImageThumbnailBar
vi.mock('./prompt-input/ImageThumbnailBar', () => ({
  ImageThumbnailBar: (props: any) => (
    <div data-testid="thumbnail-bar">
      {props.images.map((img: any) => (
        <div key={img.id} data-testid={`thumb-${img.id}`}>{img.name}</div>
      ))}
    </div>
  ),
}));

// Mock @xyflow/react
vi.mock('@xyflow/react', () => ({
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  Handle: () => null,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

// Mock stores
const mockUpdateConfig = vi.fn();
const mockUpdatePromptImages = vi.fn();
let mockNodeData: any = {
  model: 'video-model-1',
  status: 'idle',
  ratio: '16:9',
  resolution: '1080p',
  duration: 5,
  audio: true,
  prompt: { text: '', html: '', allImages: [], referencedImageIds: [] },
};

vi.mock('@/stores/nodeStore', () => {
  const buildState = () => ({
    nodes: {
      v1: { id: 'v1', type: 'videoGen', position: { x: 0, y: 0 }, data: mockNodeData },
      img1: { id: 'img1', type: 'imageGen', position: { x: 100, y: 0 }, data: { model: 'sdxl' } },
    },
    updateConfig: mockUpdateConfig,
    updatePromptImages: mockUpdatePromptImages,
    setStatus: vi.fn(),
    getNodeData: () => mockNodeData,
  });
  return {
    useNodeStore: Object.assign(
      vi.fn((selector?: any) => {
        const state = buildState();
        if (typeof selector === 'function') return selector(state);
        return state;
      }),
      {
        getState: () => buildState(),
        setState: vi.fn(),
      },
    ),
  };
});

let mockCanvasProjectId: string | null = 'real-pid';

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({ nodes: [], edges: [], projectId: mockCanvasProjectId }),
  },
}));

const { mockEnqueueWorkflow, mockSyncNodes, mockSyncEdges } = vi.hoisted(() => ({
  mockEnqueueWorkflow: vi.fn().mockResolvedValue({ jobId: 'job-1', status: 'queued' }),
  mockSyncNodes: vi.fn().mockResolvedValue([]),
  mockSyncEdges: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/api/executionApi', () => ({
  enqueueWorkflow: mockEnqueueWorkflow,
}));
vi.mock('@/api/projectApi', () => ({
  syncNodes: mockSyncNodes,
  syncEdges: mockSyncEdges,
}));

describe('VideoConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNodeData = {
      model: 'video-model-1',
      status: 'idle',
      ratio: '16:9',
      resolution: '1080p',
      duration: 5,
      audio: true,
      prompt: { text: '', html: '', allImages: [], referencedImageIds: [] },
    };
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no fetch in test'));
  });

  it('renders PromptInput', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    expect(screen.getByTestId('prompt-input')).toBeTruthy();
  });

  it('renders thumbnail bar', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    expect(screen.getByTestId('thumbnail-bar')).toBeTruthy();
  });

  it('renders maximize button', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    expect(screen.getByTestId('canvas-node-generation-input-bar-maximize-button')).toBeTruthy();
  });

  it('renders video model select button', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    expect(screen.getByTestId('canvas-node-video-model-select')).toBeTruthy();
  });

  it('renders voice input button', () => {
    const { container } = render(<VideoConfigPanel nodeId="v1" />);
    expect(container.querySelector('[aria-label="语音输入"]')).toBeInTheDocument();
  });

  it('maximize button toggles data-state', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    const btn = screen.getByTestId('canvas-node-generation-input-bar-maximize-button');
    expect(btn.getAttribute('data-state')).toBe('closed');
    fireEvent.click(btn);
    expect(btn.getAttribute('data-state')).toBe('open');
    fireEvent.click(btn);
    expect(btn.getAttribute('data-state')).toBe('closed');
  });

  it('passes maxHeight=80 to PromptInput initially, 350 after maximize', () => {
    capturedMaxHeight = 0;
    render(<VideoConfigPanel nodeId="v1" />);
    expect(capturedMaxHeight).toBe(80);

    const btn = screen.getByTestId('canvas-node-generation-input-bar-maximize-button');
    fireEvent.click(btn);
    expect(capturedMaxHeight).toBe(350);

    fireEvent.click(btn);
    expect(capturedMaxHeight).toBe(80);
  });

  it('returns null when node not in store', () => {
    const { container } = render(<VideoConfigPanel nodeId="nonexistent" />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when node type is imageGen (not videoGen)', () => {
    const { container } = render(<VideoConfigPanel nodeId="img1" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders thumbnails from root-level allImages', () => {
    mockNodeData.allImages = [
      { id: 'img1', url: '/u', name: 'x.png', status: 'success' },
      { id: 'img2', url: '/u', name: 'y.png', status: 'success' },
    ];
    const { container } = render(<VideoConfigPanel nodeId="v1" />);
    expect(screen.getByTestId('prompt-input')).toBeTruthy();
    expect(container.querySelectorAll('[data-testid^="thumb-"]').length).toBe(2);
  });

  it('blocks paste upload when root-level allImages is full (9)', async () => {
    mockNodeData.allImages = Array.from({ length: 9 }, (_, i) => ({
      id: `full-${i}`,
      url: `/u/${i}`,
      name: `f${i}.png`,
      status: 'success' as const,
    }));
    render(<VideoConfigPanel nodeId="v1" />);

    const file = new File(['x'], 'paste.png', { type: 'image/png' });
    await act(async () => {
      await capturedOnPasteImage?.(file);
    });
    expect(mockUploadSingleImage).not.toHaveBeenCalled();
  });

  it('allows paste upload when root-level allImages has room (8)', async () => {
    mockNodeData.allImages = Array.from({ length: 8 }, (_, i) => ({
      id: `room-${i}`,
      url: `/u/${i}`,
      name: `r${i}.png`,
      status: 'success' as const,
    }));
    render(<VideoConfigPanel nodeId="v1" />);

    const file = new File(['x'], 'paste.png', { type: 'image/png' });
    await act(async () => {
      await capturedOnPasteImage?.(file);
    });
    expect(mockUploadSingleImage).toHaveBeenCalledTimes(1);
  });

  it('generates with real projectId from canvasStore (not "default")', async () => {
    mockNodeData.prompt.text = 'hello video';
    render(<VideoConfigPanel nodeId="v1" />);

    await act(async () => {
      await capturedOnGenerate?.();
    });

    expect(mockSyncNodes).toHaveBeenCalledWith('real-pid', expect.any(Array));
    expect(mockSyncEdges).toHaveBeenCalledWith('real-pid', expect.any(Array));
    expect(mockEnqueueWorkflow).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'real-pid' }));
  });

  it('should render 2 dividers: after model selector and between voice/credits', () => {
    const { container } = render(<VideoConfigPanel nodeId="v1" />);
    const dividers = container.querySelectorAll('.w-px.h-4');
    expect(dividers.length).toBe(2);
  });

  // ─── Video config button (ratio + resolution + duration + audio) ───

  it('should render video config button with ratio icon and texts', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    const btn = screen.getByTestId('canvas-node-video-config-select');
    expect(btn).toBeTruthy();
    // Should display ratio text: 16:9
    expect(btn.textContent).toContain('16:9');
    // Should display resolution: 1080p
    expect(btn.textContent).toContain('1080p');
    // Should contain a rectangle icon (aspect ratio visual)
    const icon = btn.querySelector('[style*="border: 1.5px solid"]');
    expect(icon).toBeTruthy();
    // Should contain volume SVG icon
    const volumeSvg = btn.querySelector('svg[viewBox]');
    expect(volumeSvg).toBeTruthy();
  });

  it('should open config popup on button click', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    const btn = screen.getByTestId('canvas-node-video-config-select');
    fireEvent.click(btn);
    // Popup should render with section labels
    expect(screen.getByText('清晰度')).toBeTruthy();
    expect(screen.getByText('比例')).toBeTruthy();
    expect(screen.getByText('时长')).toBeTruthy();
    expect(screen.getByText('声音')).toBeTruthy();
  });

  it('should show resolution options in popup', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    fireEvent.click(screen.getByTestId('canvas-node-video-config-select'));
    expect(screen.getByText('1080p')).toBeTruthy();
    expect(screen.getByText('4K')).toBeTruthy();
  });

  it('should show ratio grid options in popup', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    fireEvent.click(screen.getByTestId('canvas-node-video-config-select'));
    expect(screen.getByText('16:9')).toBeTruthy();
    expect(screen.getByText('9:16')).toBeTruthy();
    expect(screen.getByText('1:1')).toBeTruthy();
  });

  it('should show duration options in popup', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    fireEvent.click(screen.getByTestId('canvas-node-video-config-select'));
    expect(screen.getByText('5s')).toBeTruthy();
    expect(screen.getByText('10s')).toBeTruthy();
  });

  it('should show audio toggle in popup', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    fireEvent.click(screen.getByTestId('canvas-node-video-config-select'));
    // Audio toggle button should exist
    const toggle = screen.getByTestId('canvas-node-video-audio-toggle');
    expect(toggle).toBeTruthy();
  });

  it('should NOT close popup when selecting options', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    const btn = screen.getByTestId('canvas-node-video-config-select');
    fireEvent.click(btn);
    expect(screen.getByText('清晰度')).toBeTruthy();
    // Click a ratio option
    fireEvent.click(screen.getByText('9:16'));
    // Popup should still be open
    expect(screen.getByText('清晰度')).toBeTruthy();
  });

  it('should close popup when clicking button again (toggle)', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    const btn = screen.getByTestId('canvas-node-video-config-select');
    fireEvent.click(btn); // open
    expect(screen.getByText('清晰度')).toBeTruthy();
    fireEvent.click(btn); // close
    expect(screen.queryByText('清晰度')).not.toBeInTheDocument();
  });

  it('should close config popup on outside click', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    fireEvent.click(screen.getByTestId('canvas-node-video-config-select'));
    expect(screen.getByText('清晰度')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('清晰度')).not.toBeInTheDocument();
  });

  it('should show volume-up icon on button when audio is on', () => {
    mockNodeData.audio = true;
    render(<VideoConfigPanel nodeId="v1" />);
    const btn = screen.getByTestId('canvas-node-video-config-select');
    const svg = btn.querySelector('svg[viewBox="0 0 24 24"]');
    // VolumeUp has the wave arcs: "v8.05"
    expect(svg!.innerHTML).toContain('v8.05');
  });

  it('should show volume-mute icon on button when audio is off', () => {
    mockNodeData.audio = false;
    render(<VideoConfigPanel nodeId="v1" />);
    const btn = screen.getByTestId('canvas-node-video-config-select');
    const svg = btn.querySelector('svg[viewBox="0 0 24 24"]');
    expect(svg).toBeTruthy();
    // VolumeMute has a stroke-based diagonal line (unlike VolumeUp which is all fill)
    expect(svg!.innerHTML).toContain('stroke');
    // Should NOT contain the wave pattern
    expect(svg!.innerHTML).not.toContain('v8.05');
  });

  // ─── Generate count button ───
  it('should render generate count button showing default 1×', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    const btn = screen.getByTestId('canvas-node-video-count-select');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('1×');
  });

  it('should show custom "生成数量" tooltip above button', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    const btn = screen.getByTestId('canvas-node-video-count-select');
    const tooltip = btn.querySelector('.count-tooltip');
    expect(tooltip).toBeTruthy();
    expect(tooltip?.textContent).toBe('生成数量');
  });

  it('should open count dropdown on click', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    fireEvent.click(screen.getByTestId('canvas-node-video-count-select'));
    expect(screen.getAllByText('1×').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('2×')).toBeTruthy();
    expect(screen.getByText('4×')).toBeTruthy();
    expect(screen.getByText('8×')).toBeTruthy();
  });

  it('should update button text when selecting a count', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    fireEvent.click(screen.getByTestId('canvas-node-video-count-select'));
    fireEvent.click(screen.getByText('2×'));
    expect(screen.getByTestId('canvas-node-video-count-select').textContent).toContain('2×');
  });

  it('should close count dropdown on outside click', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    fireEvent.click(screen.getByTestId('canvas-node-video-count-select'));
    expect(screen.getByText('2×')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('2×')).not.toBeInTheDocument();
    expect(screen.getByText('1×')).toBeTruthy();
  });
});
