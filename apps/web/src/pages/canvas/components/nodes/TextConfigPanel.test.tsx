import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock Web Speech API
const mockListeners: Record<string, Function> = {};

const mockRecognition = {
  start: vi.fn(),
  stop: vi.fn(),
  abort: vi.fn(),
  continuous: false,
  interimResults: false,
  lang: '',
  addEventListener: vi.fn((event: string, handler: Function) => {
    mockListeners[event] = handler;
  }),
  removeEventListener: vi.fn(),
};

const MockSpeechRecognition = vi.fn(() => mockRecognition);

// Mock viewport
vi.mock('@xyflow/react', () => ({
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}));

// Mock stores
const { mockNodeStoreState } = vi.hoisted(() => {
  const state: any = {
    nodes: { n1: { id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: { content: '', model: 'm1' } } },
    setStatus: vi.fn(),
  };
  return { mockNodeStoreState: state };
});

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: Object.assign(
    vi.fn((selector?: any) => {
      if (typeof selector === 'function') return selector(mockNodeStoreState);
      return mockNodeStoreState;
    }),
    {
      getState: () => mockNodeStoreState,
      setState: (partial: any) => { Object.assign(mockNodeStoreState, partial); },
    }
  ),
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({ nodes: [], edges: [] }),
  },
}));

// Mock api
vi.mock('@/api/executionApi', () => ({
  executeWorkflow: vi.fn(),
  enqueueWorkflow: vi.fn(),
}));
vi.mock('@/api/projectApi', () => ({
  syncNodes: vi.fn(),
  syncEdges: vi.fn(),
}));

import { TextConfigPanel } from './TextConfigPanel';

// Inject mock after imports
(globalThis as any).SpeechRecognition = MockSpeechRecognition;
(globalThis as any).webkitSpeechRecognition = MockSpeechRecognition;

describe('TextConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecognition.start.mockClear();
    mockRecognition.stop.mockClear();
    // Reset fetch mock
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no fetch in test'));
  });

  it('should render voice input button with microphone icon', () => {
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    expect(container.querySelector('[aria-label="语音输入"]')).toBeInTheDocument();
  });

  it('should render divider between voice button and credits', () => {
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    const divider = container.querySelector('.w-px.h-4');
    expect(divider).toBeInTheDocument();
  });

  it('should start listening on voice button click', () => {
    render(<TextConfigPanel nodeId="n1" />);
    const btn = document.querySelector('[aria-label="语音输入"]')!;
    fireEvent.click(btn);
    expect(mockRecognition.start).toHaveBeenCalled();
  });

  it('should stop listening on second click', () => {
    render(<TextConfigPanel nodeId="n1" />);
    const btn = document.querySelector('[aria-label="语音输入"]')!;
    // Start
    fireEvent.click(btn);
    expect(mockRecognition.start).toHaveBeenCalledTimes(1);
    // Stop
    fireEvent.click(btn);
    expect(mockRecognition.stop).toHaveBeenCalled();
  });

  it('should set Chinese language for recognition', () => {
    render(<TextConfigPanel nodeId="n1" />);
    fireEvent.click(document.querySelector('[aria-label="语音输入"]')!);
    expect(mockRecognition.lang).toBe('zh-CN');
  });

  it('should show active state when listening', () => {
    render(<TextConfigPanel nodeId="n1" />);
    const btn = document.querySelector('[aria-label="语音输入"]')!;
    fireEvent.click(btn);
    expect(btn.className).toContain('bg-white/20');
  });

  it('should restore persisted prompt from nodeStore on mount', () => {
    // Set stored content in mock nodeStore
    mockNodeStoreState.nodes.n1.data.content = 'saved text';
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    const textarea = container.querySelector('textarea');
    expect(textarea?.value).toBe('saved text');
    // Cleanup
    mockNodeStoreState.nodes.n1.data.content = '';
  });
});
