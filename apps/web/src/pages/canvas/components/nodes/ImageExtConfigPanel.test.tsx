import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { ImageExtConfigPanel } from './ImageExtConfigPanel';

// Track the onGenerate handler passed to PromptEditor
let capturedOnGenerate: (() => void) | undefined;

// Mock PromptEditor — don't render the real Tiptap editor
vi.mock('./config-panel/PromptEditor', () => ({
  PromptEditor: (props: any) => {
    capturedOnGenerate = props.onGenerate;
    return <div data-testid="prompt-editor">PromptEditor</div>;
  },
}));

// Mock @xyflow/react for useViewport
vi.mock('@xyflow/react', () => ({
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  Handle: () => null,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

// Mock nodeStore
const mockUpdateConfig = vi.fn();
const mockUpdateExtConfig = vi.fn();
let mockNodeData: any = {
  status: 'idle',
  prompt: { text: '', html: '' },
  allImages: [],
  extConfig: { model: '', ratio: '16:9', resolution: '2K' },
};

vi.mock('@/stores/nodeStore', () => {
  const buildState = () => ({
    nodes: {
      imgext1: {
        id: 'imgext1',
        type: 'imageExtGen',
        position: { x: 0, y: 0 },
        data: mockNodeData,
      },
    },
    updateConfig: mockUpdateConfig,
    updateExtConfig: mockUpdateExtConfig,
    setStatus: vi.fn(),
    IMAGE_EXT_DEFAULTS: { model: '', ratio: '16:9', resolution: '2K', generateCount: 1 },
  });
  return {
    isImageExtNode: (node: unknown) => {
      if (!node || typeof node !== 'object') return false;
      return (node as { type?: string }).type === 'imageExtGen';
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

const { mockSubmitGeneration } = vi.hoisted(() => ({
  mockSubmitGeneration: vi.fn().mockResolvedValue({ jobId: 'job-1' })
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({ nodes: [], edges: [], projectId: 'real-pid' }),
  },
}));
vi.mock('@/api/imageExtNodeApi', () => ({
  getCreditCost: vi.fn().mockResolvedValue(0),
  fetchModels: vi.fn().mockResolvedValue([]),
  submitGeneration: mockSubmitGeneration,
}));

describe('ImageExtConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNodeData = {
      status: 'idle',
      prompt: { text: '', html: '' },
      allImages: [],
      extConfig: { model: '', ratio: '16:9', resolution: '2K' },
    };
  });

  it('renders panel for imageExtGen node', () => {
    render(<ImageExtConfigPanel nodeId="imgext1" />);
    expect(screen.getByTestId('prompt-editor')).toBeTruthy();
  });

  it('Task15：直接 submitGeneration（server doc 实时持久化，无 flush）', async () => {
    mockNodeData.prompt.text = 'hello image ext';
    const order: string[] = [];
        mockSubmitGeneration.mockImplementationOnce(async () => { order.push('submit'); return { jobId: 'j1' }; });
    render(<ImageExtConfigPanel nodeId="imgext1" />);

    await act(async () => {
      await capturedOnGenerate?.();
    });
    expect(mockSubmitGeneration).toHaveBeenCalledWith('imgext1', { projectId: 'real-pid' });
    expect(order).toEqual(['submit']);
  });
});
