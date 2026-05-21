import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ImageConfigPanel } from './ImageConfigPanel';

// Mock PromptInput — don't render the real Tiptap editor
vi.mock('./prompt-input/PromptInput', () => ({
  default: React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      forceSync: vi.fn(),
      focus: vi.fn(),
      clear: vi.fn(),
      insertImage: vi.fn(),
    }));
    return <div data-testid="prompt-input">PromptInput</div>;
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
  prompt: { text: '', allImages: [], referencedImageIds: [] },
};

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: vi.fn((selector?: any) => {
    const state = {
      nodes: {
        img1: {
          id: 'img1',
          type: 'image',
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
      prompt: { text: '', allImages: [], referencedImageIds: [] },
    };
  });

  it('renders PromptInput', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    expect(screen.getByTestId('prompt-input')).toBeTruthy();
  });

  it('displays model/ratio/quality from store', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    expect(screen.getByText('sdxl')).toBeTruthy();
    expect(screen.getByText('1:1')).toBeTruthy();
    expect(screen.getByText('standard')).toBeTruthy();
  });

  it('generate button is disabled when status is loading', () => {
    mockNodeData = {
      ...mockNodeData,
      status: 'loading',
      prompt: { text: 'test', allImages: [], referencedImageIds: [] },
    };
    render(<ImageConfigPanel nodeId="img1" />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
  });

  it('generate button is disabled when prompt text is empty', () => {
    mockNodeData = {
      ...mockNodeData,
      status: 'idle',
      prompt: { text: '', allImages: [], referencedImageIds: [] },
    };
    render(<ImageConfigPanel nodeId="img1" />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
  });

  it('generate button is enabled when prompt has text and status is idle', () => {
    mockNodeData = {
      ...mockNodeData,
      status: 'idle',
      prompt: { text: 'test prompt', allImages: [], referencedImageIds: [] },
    };
    render(<ImageConfigPanel nodeId="img1" />);
    const btn = screen.getByRole('button');
    expect(btn).not.toBeDisabled();
  });

  it('shows loading indicator (⏳) when status is loading', () => {
    mockNodeData = {
      ...mockNodeData,
      status: 'loading',
      prompt: { text: 'test', allImages: [], referencedImageIds: [] },
    };
    render(<ImageConfigPanel nodeId="img1" />);
    expect(screen.getByText('⏳')).toBeTruthy();
  });
});
