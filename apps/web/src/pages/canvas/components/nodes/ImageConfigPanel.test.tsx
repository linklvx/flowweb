import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ImageConfigPanel } from './ImageConfigPanel';

// Track the maxHeight prop passed to PromptInput
let capturedMaxHeight: number = 80;

// Mock PromptInput — don't render the real Tiptap editor
vi.mock('./prompt-input/PromptInput', () => ({
  default: React.forwardRef((props: any, ref: any) => {
    capturedMaxHeight = props.maxHeight;
    React.useImperativeHandle(ref, () => ({
      forceSync: vi.fn(),
      focus: vi.fn(),
      clear: vi.fn(),
      insertImage: vi.fn(),
      setText: vi.fn(),
    }));
    return <div data-testid="prompt-input" data-max-height={props.maxHeight}>PromptInput</div>;
  }),
}));

// Mock ImageThumbnailBar — don't render the real dnd-kit component
vi.mock('./prompt-input/ImageThumbnailBar', () => ({
  ImageThumbnailBar: (props: any) => (
    <div data-testid="thumbnail-bar">
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
const mockUpdateConfig = vi.fn();
let mockNodeData: any = {
  style: '写实',
  model: 'sdxl',
  quality: 'standard',
  ratio: '1:1',
  status: 'idle',
  prompt: { text: '', html: '', allImages: [], referencedImageIds: [] },
};

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((selector?: any) => {
    const state = {
      nodes: {
        img1: {
          id: 'img1',
          type: 'imageGen',
          position: { x: 0, y: 0 },
          data: mockNodeData,
        },
      },
      updateConfig: mockUpdateConfig,
      updatePromptImages: vi.fn(),
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
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
      prompt: { text: '', html: '', allImages: [], referencedImageIds: [] },
    };
  });

  it('renders PromptInput', () => {
    render(<ImageConfigPanel nodeId="img1" />);
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
});
