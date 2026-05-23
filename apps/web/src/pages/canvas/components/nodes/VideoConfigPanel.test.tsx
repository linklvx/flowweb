import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { VideoConfigPanel } from './VideoConfigPanel';

// Track the maxHeight prop passed to PromptInput
let capturedMaxHeight = 80;

// Mock PromptInput
vi.mock('./prompt-input/PromptInput', () => ({
  default: React.forwardRef((props: any, ref: any) => {
    capturedMaxHeight = props.maxHeight;
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
  prompt: { text: '', html: '', allImages: [], referencedImageIds: [] },
};

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((selector?: any) => {
    const state = {
      nodes: {
        v1: { id: 'v1', type: 'videoGen', position: { x: 0, y: 0 }, data: mockNodeData },
      },
      updateConfig: mockUpdateConfig,
      updatePromptImages: mockUpdatePromptImages,
      setStatus: vi.fn(),
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({ nodes: [], edges: [] }),
  },
}));

vi.mock('@/api/executionApi', () => ({
  enqueueWorkflow: vi.fn(),
}));

vi.mock('@/api/projectApi', () => ({
  syncNodes: vi.fn(),
  syncEdges: vi.fn(),
}));

describe('VideoConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNodeData = {
      model: 'video-model-1',
      status: 'idle',
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

  it('renders correctly with images in prompt', () => {
    mockNodeData.prompt.allImages = [
      { id: 'img1', url: '/u', name: 'x.png', status: 'success' },
      { id: 'img2', url: '/u', name: 'y.png', status: 'success' },
    ];
    const { container } = render(<VideoConfigPanel nodeId="v1" />);
    expect(screen.getByTestId('prompt-input')).toBeTruthy();
    expect(container.querySelectorAll('[data-testid^="thumb-"]').length).toBe(2);
  });
});
