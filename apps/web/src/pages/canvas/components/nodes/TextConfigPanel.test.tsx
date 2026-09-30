import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { message } from 'antd';

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
    nodes: { n1: { id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: { content: '', prompt: '', model: 'm1' } } },
    setStatus: vi.fn(),
    applyNodeDataPatch: vi.fn(), // 批2-2：面板内容写收口 wrapper（mock 面）
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
    getState: () => ({ nodes: [], edges: [], projectId: 'real-pid' }),
  },
}));

// Mock api
const { mockEnqueueWorkflow } = vi.hoisted(() => ({
  mockEnqueueWorkflow: vi.fn().mockResolvedValue({ jobId: 'job-1', status: 'queued' })
}));
vi.mock('@/api/executionApi', () => ({
  executeWorkflow: vi.fn(),
  enqueueWorkflow: mockEnqueueWorkflow,
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
    expect(btn.className).toContain('bg-overlay-3');
  });

  it('Task15：直接 enqueue（server doc 实时持久化，无 flush）', async () => {
    const order: string[] = [];
        mockEnqueueWorkflow.mockImplementationOnce(async () => { order.push('enqueue'); return { jobId: 'j1' }; });
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'hello text' } });
    const buttons = container.querySelectorAll('button');
    const generateBtn = buttons[buttons.length - 1];
    fireEvent.click(generateBtn);

    await vi.waitFor(() => {
      expect(mockEnqueueWorkflow).toHaveBeenCalled();
    });

    expect(order).toEqual(['enqueue']);
    expect(mockEnqueueWorkflow).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'real-pid' }));
  });

  it('should restore persisted prompt from nodeStore on mount', () => {
    // Set stored content in mock nodeStore
    mockNodeStoreState.nodes.n1.data.prompt = 'saved text';
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    const textarea = container.querySelector('textarea');
    expect(textarea?.value).toBe('saved text');
    mockNodeStoreState.nodes.n1.data.prompt = '';
  });

  it('should have dark scrollbar class on textarea', () => {
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    const textarea = container.querySelector('textarea');
    expect(textarea?.className).toContain('scrollbar-dark');
  });

  // ── Maximize / Restore button ──

  it('should render maximize button in top-right corner', () => {
    render(<TextConfigPanel nodeId="n1" />);
    expect(screen.getByTestId('canvas-node-text-config-panel-maximize-button')).toBeTruthy();
  });

  it('should have data-state closed initially', () => {
    render(<TextConfigPanel nodeId="n1" />);
    const btn = screen.getByTestId('canvas-node-text-config-panel-maximize-button');
    expect(btn.getAttribute('data-state')).toBe('closed');
  });

  it('should toggle data-state to open on click', () => {
    render(<TextConfigPanel nodeId="n1" />);
    const btn = screen.getByTestId('canvas-node-text-config-panel-maximize-button');
    fireEvent.click(btn);
    expect(btn.getAttribute('data-state')).toBe('open');
  });

  it('should toggle data-state back to closed on second click', () => {
    render(<TextConfigPanel nodeId="n1" />);
    const btn = screen.getByTestId('canvas-node-text-config-panel-maximize-button');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(btn.getAttribute('data-state')).toBe('closed');
  });

  it('should have h-[140px] class before maximizing', () => {
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain('h-[140px]');
    expect(panel.className).not.toContain('h-[350px]');
  });

  it('should change to h-[350px] after maximizing', () => {
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    const btn = screen.getByTestId('canvas-node-text-config-panel-maximize-button');
    fireEvent.click(btn);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain('h-[350px]');
    expect(panel.className).not.toContain('h-[140px]');
  });

  it('should have pr-4 right padding on textarea to avoid overlap with maximize button', () => {
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    const textarea = container.querySelector('textarea');
    expect(textarea?.className).toContain('pr-4');
    expect(textarea?.className).not.toContain('px-2.5');
  });

  it('should restore h-[140px] after collapsing', () => {
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    const btn = screen.getByTestId('canvas-node-text-config-panel-maximize-button');
    fireEvent.click(btn); // maximize
    fireEvent.click(btn); // collapse
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain('h-[140px]');
    expect(panel.className).not.toContain('h-[350px]');
  });

  // ── 批0.5-8b 意图 id 上送（幂等键——失败重试复用、新点击 rotate、额度尽 rotate） ──

  const generate = async (container: HTMLElement) => {
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'hello text' } });
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1]);
  };
  const lastIntentId = (): string | undefined => mockEnqueueWorkflow.mock.calls.at(-1)?.[0]?.intentId;

  it('handleGenerate 上送 intentId（=sessionStorage 留存值，键含 projectId/nodeId）', async () => {
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    await generate(container);
    await vi.waitFor(() => expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1));
    const intentId = lastIntentId();
    expect(intentId).toBeTruthy();
    expect(sessionStorage.getItem('flowweb:intent:real-pid:n1')).toBe(intentId);
  });

  it('失败后重试复用同 intentId（表命中不双扣）', async () => {
    mockEnqueueWorkflow.mockRejectedValueOnce(new Error('network down'));
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    await generate(container);
    await vi.waitFor(() => expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1));
    const intent1 = lastIntentId();

    await generate(container);
    await vi.waitFor(() => expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(2));
    expect(lastIntentId()).toBe(intent1);
  });

  it('成功后新点击 rotate 不同 intentId（新点击=新扣费意图）', async () => {
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    await generate(container);
    await vi.waitFor(() => expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1));
    const intent1 = lastIntentId();

    await generate(container);
    await vi.waitFor(() => expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(2));
    expect(lastIntentId()).toBeTruthy();
    expect(lastIntentId()).not.toBe(intent1);
  });

  it('INTENT_EXHAUSTED → rotate 新 intentId（下次提交照常扣费）', async () => {
    mockEnqueueWorkflow.mockRejectedValueOnce(
      Object.assign(new Error('重试次数已用尽'), { errorCode: 'INTENT_EXHAUSTED' })
    );
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    await generate(container);
    await vi.waitFor(() => expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1));
    const sentIntentId = lastIntentId();
    expect(sentIntentId).toBeTruthy();
    // 已 rotate：sessionStorage 当前值 ≠ 本次上送值
    await vi.waitFor(() => {
      expect(sessionStorage.getItem('flowweb:intent:real-pid:n1')).not.toBe(sentIntentId);
    });
  });

  it('INTENT_CONTEXT_MISMATCH → rotate + 改参提示 + 下次提交用新 id（改参重试死循环根堵）', async () => {
    const warnSpy = vi.spyOn(message, 'warning');
    mockEnqueueWorkflow
      .mockRejectedValueOnce(Object.assign(new Error('意图上下文不匹配'), { errorCode: 'INTENT_CONTEXT_MISMATCH' }))
      .mockResolvedValueOnce({ jobId: 'job-2' });
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    await generate(container);
    await vi.waitFor(() => expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1));
    const intent1 = lastIntentId();
    expect(intent1).toBeTruthy();
    // 已 rotate：sessionStorage 当前值 ≠ 本次上送值
    await vi.waitFor(() => {
      expect(sessionStorage.getItem('flowweb:intent:real-pid:n1')).not.toBe(intent1);
    });
    // 提示出现：明确告知参数变更已重置（不被通用"提交失败"文案吞掉）
    expect(warnSpy).toHaveBeenCalledWith('参数已变更，已重置生成会话，请重新发起');
    // 死循环根堵：下次提交用新 id（不再撞 mismatch）
    await generate(container);
    await vi.waitFor(() => expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(2));
    expect(lastIntentId()).toBeTruthy();
    expect(lastIntentId()).not.toBe(intent1);
    warnSpy.mockRestore();
  });
});
