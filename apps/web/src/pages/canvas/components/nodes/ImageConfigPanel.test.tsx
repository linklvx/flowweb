import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { ImageConfigPanel } from './ImageConfigPanel';

// Track the maxHeight prop passed to PromptInput
let capturedMaxHeight: number = 80;
let capturedOnGenerate: (() => void) | undefined;

// Mock PromptInput — don't render the real Tiptap editor
vi.mock('./prompt-input/PromptInput', () => ({
  default: React.forwardRef((props: any, ref: any) => {
    capturedMaxHeight = props.maxHeight;
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

// Mock ImageThumbnailBar — don't render the real dnd-kit component
vi.mock('./prompt-input/ImageThumbnailBar', () => ({
  ImageThumbnailBar: (props: any) => (
    <div data-testid="thumbnail-bar" data-before-delete={!!props.onBeforeImageDelete}>
      {props.images.map((img: any) => (
        <div key={img.id} data-testid={`thumb-${img.id}`}>{img.name}</div>
      ))}
    </div>
  ),
}));

// Mock @xyflow/react for useViewport
vi.mock('@xyflow/react', () => ({
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  Handle: () => null,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

// Mock nodeStore with AppNode nested structure
const mockUpdateConfig = vi.fn((_nodeId: string, partial: Record<string, unknown>) => {
  Object.assign(mockNodeData, partial);
});
let mockNodeData: any = {
  style: '写实',
  model: 'sdxl',
  quality: 'standard',
  ratio: '1:1',
  resolution: '2K',
  status: 'idle',
  prompt: { text: '', html: '', referencedImageIds: [] },
};

vi.mock('@/stores/nodeStore', () => {
  const buildState = () => ({
    nodes: {
      img1: {
        id: 'img1',
        type: 'imageGen',
        position: { x: 0, y: 0 },
        data: mockNodeData,
      },
      ext1: {
        id: 'ext1',
        type: 'imageExtGen',
        position: { x: 0, y: 0 },
        data: mockNodeData,
      },
    },
    updateConfig: mockUpdateConfig,
    updatePromptImages: vi.fn(),
    setStatus: vi.fn(),
  });
  return {
    isImageNode: (node: unknown) => {
      if (!node || typeof node !== 'object') return false;
      const type = (node as { type?: string }).type;
      return type === 'imageGen' || type === 'imageExtGen';
    },
    isImageExtNode: (node: unknown) => {
      if (!node || typeof node !== 'object') return false;
      const type = (node as { type?: string }).type;
      return type === 'imageExtGen';
    },
    useNodeStore: Object.assign(
      vi.fn((selector?: any) => {
        const state = buildState();
        if (typeof selector === 'function') return selector(state);
        return state;
      }),
      { getState: () => buildState() },
    ),
  };
});

const { getMockCanvasNodes, mockSubmitGeneration, mockFlushCanvasSync } = vi.hoisted(() => {
  let mockCanvasNodes: any[] = [];
  return {
    mockFlushCanvasSync: vi.fn().mockResolvedValue(true),
    mockSubmitGeneration: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
    getMockCanvasNodes: () => mockCanvasNodes,
  };
});

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({ nodes: getMockCanvasNodes(), edges: [], projectId: 'real-pid' }),
  },
}));
vi.mock('@/stores/canvasSyncRuntime', () => ({
  flushCanvasSync: mockFlushCanvasSync,
}));
vi.mock('@/api/imageNodeApi', () => ({
  getCreditCost: vi.fn().mockResolvedValue(0),
  fetchModels: vi.fn().mockResolvedValue([]),
  submitGeneration: mockSubmitGeneration,
}));

describe('ImageConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNodeData = {
      style: '写实',
      model: 'sdxl',
      quality: 'standard',
      ratio: '1:1',
      status: 'idle',
      prompt: { text: '', html: '', referencedImageIds: [] },
    };
  });

  it('renders PromptInput', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    expect(screen.getByTestId('prompt-input')).toBeTruthy();
  });

  it('should render for imageGen node', () => {
    const { container } = render(<ImageConfigPanel nodeId="img1" />);
    expect(container.innerHTML).toBeTruthy();
    expect(screen.getByTestId('prompt-input')).toBeTruthy();
  });

  it('renders maximize button in top-right corner', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    expect(screen.getByTestId('canvas-node-generation-input-bar-maximize-button')).toBeTruthy();
  });

  it('renders thumbnail bar', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    expect(screen.getByTestId('thumbnail-bar')).toBeTruthy();
  });

  it('maximize button toggles data-state between closed and open on click', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    const btn = screen.getByTestId('canvas-node-generation-input-bar-maximize-button');
    // Initial state: closed (not maximized)
    expect(btn.getAttribute('data-state')).toBe('closed');
    // Click to maximize
    fireEvent.click(btn);
    expect(btn.getAttribute('data-state')).toBe('open');
    // Click to collapse
    fireEvent.click(btn);
    expect(btn.getAttribute('data-state')).toBe('closed');
  });

  it('passes maxHeight=80 to PromptInput before maximizing', () => {
    capturedMaxHeight = 0;
    render(<ImageConfigPanel nodeId="img1" />);
    expect(capturedMaxHeight).toBe(80);
  });

  it('passes maxHeight=350 to PromptInput after maximizing', () => {
    capturedMaxHeight = 0;
    render(<ImageConfigPanel nodeId="img1" />);
    const btn = screen.getByTestId('canvas-node-generation-input-bar-maximize-button');
    fireEvent.click(btn);
    expect(capturedMaxHeight).toBe(350);
  });

  it('restores maxHeight=80 to PromptInput after collapsing', () => {
    capturedMaxHeight = 0;
    render(<ImageConfigPanel nodeId="img1" />);
    const btn = screen.getByTestId('canvas-node-generation-input-bar-maximize-button');
    fireEvent.click(btn); // maximize
    fireEvent.click(btn); // collapse
    expect(capturedMaxHeight).toBe(80);
  });

  it('should render divider next to model selector', () => {
    const { container } = render(<ImageConfigPanel nodeId="img1" />);
    // There should be 2 dividers: one after model selector, one between voice and credits
    const dividers = container.querySelectorAll('.w-px.h-4');
    expect(dividers.length).toBe(2);
  });

  it('should render ratio+resolution button with ratio and resolution text', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    const btn = screen.getByTestId('canvas-node-image-ratio-select');
    expect(btn).toBeTruthy();
    // Should display ratio and resolution: e.g. "1:1 · 2K"
    expect(btn.textContent).toContain('1:1');
    expect(btn.textContent).toContain('2K');
    // Should contain a rectangle icon (aspect ratio visual)
    const icon = btn.querySelector('[style*="border: 1.5px solid"]');
    expect(icon).toBeTruthy();
  });

  it('should open ratio popup on button click', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    const btn = screen.getByTestId('canvas-node-image-ratio-select');
    fireEvent.click(btn);
    // Popup should render with resolution and ratio labels
    expect(screen.getByText('分辨率')).toBeTruthy();
    expect(screen.getByText('比例')).toBeTruthy();
  });

  it('should show resolution options 2K and 4K in popup', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    fireEvent.click(screen.getByTestId('canvas-node-image-ratio-select'));
    expect(screen.getByText('2K')).toBeTruthy();
    expect(screen.getByText('4K')).toBeTruthy();
  });

  it('should show ratio grid options in popup', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    fireEvent.click(screen.getByTestId('canvas-node-image-ratio-select'));
    // Should show ratio options in popup (use exact:false since button shows "1:1 · 2K")
    const ratioOptions = screen.getAllByText('1:1', { exact: false });
    expect(ratioOptions.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('16:9')).toBeTruthy();
    expect(screen.getByText('9:16')).toBeTruthy();
  });

  it('should NOT close popup when selecting a ratio option', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    const btn = screen.getByTestId('canvas-node-image-ratio-select');
    fireEvent.click(btn);
    expect(screen.getByText('分辨率')).toBeTruthy();
    // Click a ratio option
    fireEvent.click(screen.getByText('16:9'));
    // Popup should still be open
    expect(screen.getByText('分辨率')).toBeTruthy();
  });

  it('should close popup when clicking the button again (toggle)', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    const btn = screen.getByTestId('canvas-node-image-ratio-select');
    fireEvent.click(btn); // open
    expect(screen.getByText('分辨率')).toBeTruthy();
    fireEvent.click(btn); // close
    expect(screen.queryByText('分辨率')).not.toBeInTheDocument();
  });

  it('should close ratio popup on outside click', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    fireEvent.click(screen.getByTestId('canvas-node-image-ratio-select'));
    expect(screen.getByText('分辨率')).toBeTruthy();
    // Click outside
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('分辨率')).not.toBeInTheDocument();
  });

  // ─── Generate count button ───
  it('should render generate count button showing default 1×', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    const btn = screen.getByTestId('canvas-node-image-count-select');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('1×');
  });

  it('should show custom "生成数量" tooltip above button', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    const btn = screen.getByTestId('canvas-node-image-count-select');
    // Custom tooltip element (not native title attribute)
    const tooltip = btn.querySelector('.count-tooltip');
    expect(tooltip).toBeTruthy();
    expect(tooltip?.textContent).toBe('生成数量');
  });

  it('should open count dropdown on click', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    fireEvent.click(screen.getByTestId('canvas-node-image-count-select'));
    // Use getAllByText for '1×' since button also shows it, causing duplicates
    expect(screen.getAllByText('1×').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('2×')).toBeTruthy();
    expect(screen.getByText('4×')).toBeTruthy();
    expect(screen.getByText('8×')).toBeTruthy();
  });

  it('should update button text when selecting a count', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    fireEvent.click(screen.getByTestId('canvas-node-image-count-select'));
    fireEvent.click(screen.getByText('2×'));
    expect(screen.getByTestId('canvas-node-image-count-select').textContent).toContain('2×');
  });

  it('should close count dropdown on outside click', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    fireEvent.click(screen.getByTestId('canvas-node-image-count-select'));
    // Dropdown is open: text '2×' only exists in dropdown (not on button with default 1×)
    expect(screen.getByText('2×')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    // After closing, dropdown items disappear (button still shows 1×)
    expect(screen.queryByText('2×')).not.toBeInTheDocument();
    expect(screen.getByText('1×')).toBeTruthy();
  });

  it('should NOT render AI tool button for imageGen node', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    expect(screen.queryByTestId('canvas-node-image-ai-tool-select')).not.toBeInTheDocument();
  });

  it('生成前先 flush 再 submitGeneration（改参即生效），不再散点同步', async () => {
    mockNodeData.prompt.text = 'hello image';
    const order: string[] = [];
    mockFlushCanvasSync.mockImplementationOnce(async () => { order.push('flush'); return true; });
    mockSubmitGeneration.mockImplementationOnce(async () => { order.push('submit'); return { jobId: 'j1' }; });
    render(<ImageConfigPanel nodeId="img1" />);

    await act(async () => {
      await capturedOnGenerate?.();
    });

    expect(mockFlushCanvasSync).toHaveBeenCalledWith('execute');
    expect(mockSubmitGeneration).toHaveBeenCalledWith('img1', { projectId: 'real-pid' });
    expect(order).toEqual(['flush', 'submit']);
  });
});
