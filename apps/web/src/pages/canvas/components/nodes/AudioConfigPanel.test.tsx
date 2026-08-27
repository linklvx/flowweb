import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AudioConfigPanel } from './AudioConfigPanel';

// Mock @xyflow/react for useViewport
vi.mock('@xyflow/react', () => ({
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  Handle: () => null,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

// Mock stores
const mockUpdateConfig = vi.fn();
let mockNodeData: any = {
  model: 'audio-model-1',
  content: '',
  status: 'idle',
};

vi.mock('@/stores/nodeStore', () => {
  const buildState = () => ({
    nodes: {
      a1: { id: 'a1', type: 'audioGen', position: { x: 0, y: 0 }, data: mockNodeData },
      img1: { id: 'img1', type: 'imageGen', position: { x: 100, y: 0 }, data: { model: 'sdxl' } },
    },
    updateConfig: mockUpdateConfig,
    setStatus: vi.fn(),
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

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({ nodes: [], edges: [], projectId: 'real-pid' }),
  },
}));

const { mockEnqueueWorkflow } = vi.hoisted(() => ({
  mockEnqueueWorkflow: vi.fn().mockResolvedValue({ jobId: 'job-1' })
}));

vi.mock('@/api/executionApi', () => ({
  enqueueWorkflow: mockEnqueueWorkflow,
}));

describe('AudioConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNodeData = {
      model: 'audio-model-1',
      content: '',
      status: 'idle',
    };
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no fetch in test'));
  });

  // ─── Basic render ───

  it('renders textarea for prompt input', () => {
    render(<AudioConfigPanel nodeId="a1" />);
    const textarea = document.querySelector('textarea');
    expect(textarea).toBeTruthy();
  });

  it('renders maximize button', () => {
    render(<AudioConfigPanel nodeId="a1" />);
    expect(screen.getByTestId('canvas-node-audio-config-panel-maximize-button')).toBeTruthy();
  });

  it('renders audio model select button', () => {
    render(<AudioConfigPanel nodeId="a1" />);
    expect(screen.getByTestId('canvas-node-audio-model-select')).toBeTruthy();
  });

  it('renders voice input button', () => {
    const { container } = render(<AudioConfigPanel nodeId="a1" />);
    expect(container.querySelector('[aria-label="语音输入"]')).toBeInTheDocument();
  });

  it('renders credits display', () => {
    const { container } = render(<AudioConfigPanel nodeId="a1" />);
    expect(container.querySelector('.min-w-5.text-center')).toBeTruthy();
  });

  it('renders generate button', () => {
    const { container } = render(<AudioConfigPanel nodeId="a1" />);
    expect(container.querySelector('button[class*="bg-\\[\\#3a3a3a\\]"]')).toBeTruthy();
  });

  // ─── Maximize behavior ───

  it('maximize button toggles data-state', () => {
    render(<AudioConfigPanel nodeId="a1" />);
    const btn = screen.getByTestId('canvas-node-audio-config-panel-maximize-button');
    expect(btn.getAttribute('data-state')).toBe('closed');
    fireEvent.click(btn);
    expect(btn.getAttribute('data-state')).toBe('open');
    fireEvent.click(btn);
    expect(btn.getAttribute('data-state')).toBe('closed');
  });

  // ─── Panel height toggle ───

  it('should have default height class h-[140px]', () => {
    const { container } = render(<AudioConfigPanel nodeId="a1" />);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain('h-[140px]');
  });

  it('should change to h-[350px] after maximizing', () => {
    const { container } = render(<AudioConfigPanel nodeId="a1" />);
    fireEvent.click(screen.getByTestId('canvas-node-audio-config-panel-maximize-button'));
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain('h-[350px]');
  });

  // ─── No thumbnail bar ───

  it('should NOT render thumbnail bar (audio has no image upload)', () => {
    render(<AudioConfigPanel nodeId="a1" />);
    expect(screen.queryByTestId('thumbnail-bar')).not.toBeInTheDocument();
  });

  // ─── Type guard ───

  it('returns null when node not in store', () => {
    const { container } = render(<AudioConfigPanel nodeId="nonexistent" />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when node type is imageGen (not audioGen)', () => {
    const { container } = render(<AudioConfigPanel nodeId="img1" />);
    expect(container.innerHTML).toBe('');
  });

  // ─── Divider ───

  it('should render divider between model selector and right-side group', () => {
    const { container } = render(<AudioConfigPanel nodeId="a1" />);
    const dividers = container.querySelectorAll('.w-px.h-4');
    expect(dividers.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Generate: flush before enqueue ───

  it('Task15：直接 enqueue（server doc 实时持久化，无 flush）', async () => {
    const order: string[] = [];
        mockEnqueueWorkflow.mockImplementationOnce(async () => { order.push('enqueue'); return { jobId: 'j1' }; });
    const { container } = render(<AudioConfigPanel nodeId="a1" />);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'hello audio' } });
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1]);

    await act(async () => {});
    expect(mockEnqueueWorkflow).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'real-pid' }));
    expect(order).toEqual(['enqueue']);
  });
});
