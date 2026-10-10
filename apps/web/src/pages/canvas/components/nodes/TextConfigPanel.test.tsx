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
    nodes: { n1: { id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: { content: '', prompt: '', model: 'm1' } } },
    setStatus: vi.fn(),
    applyNodeDataPatch: vi.fn(), // 批2-2：面板内容写收口 wrapper（mock 面）
    // Y0b-2 T6：exec 投影两源（token 轮换/三态判据——用例内直接注入 Map）
    execStatus: new Map(),
    execAligned: new Map(),
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

  // ── Y0b-2 T6（Z79/Z95/Z118）：手势 token 生命周期（held 一律上送/done 轮换/EXHAUSTED 不自锁） ──
  // 改前形态（intentId 每击 rotate+组件 ref 记忆）随旧手势 id 记忆模块退役——轮换判据单源=doc 投影。

  const generate = async (container: HTMLElement) => {
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'hello text' } });
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1]);
  };
  const lastToken = (): string | undefined => mockEnqueueWorkflow.mock.calls.at(-1)?.[0]?.regenToken;
  const setExec = (entry: any) => {
    mockNodeStoreState.execStatus = new Map([['n1', entry]]);
  };

  it('普通执行（无 held 非终态）→ body 无 regenToken（内容键——服务端②回放最新/③新行）', async () => {
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    await generate(container);
    await vi.waitFor(() => expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1));
    expect(lastToken()).toBeUndefined();
  });

  it('done 投影后点击 → 铸造手势 token 上送+持有（"重新生成"=新意图照常扣费）+done 轮换生效', async () => {
    setExec({ status: 'done', attempts: 1 });
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    await vi.waitFor(() => { // Z95 轮换：done 投影 ⇒ useEffect 丢弃旧持有
      expect(sessionStorage.getItem('flowweb:regen:real-pid:n1')).toBeNull();
    });
    await generate(container);
    await vi.waitFor(() => expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1));
    const token = lastToken();
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(sessionStorage.getItem('flowweb:regen:real-pid:n1')).toBe(token);
  });

  it('error 投影（可 rearm）后 held 上送——失败重试复用同 token（免费 rearm 不双扣）', async () => {
    setExec({ status: 'error', attempts: 1, rearmable: true });
    sessionStorage.setItem('flowweb:regen:real-pid:n1', 'held-token-bbbb');
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    await generate(container);
    await vi.waitFor(() => expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1));
    expect(lastToken()).toBe('held-token-bbbb'); // held 一律上送（Z118）
    expect(sessionStorage.getItem('flowweb:regen:real-pid:n1')).toBe('held-token-bbbb'); // 不轮换
  });

  it('EXHAUSTED（error∧rearmable:false）→ 投影轮换（不自锁）；下一击铸造新 token', async () => {
    setExec({ status: 'error', attempts: 3, rearmable: false });
    sessionStorage.setItem('flowweb:regen:real-pid:n1', 'exhausted-tok');
    const { container } = render(<TextConfigPanel nodeId="n1" />);
    await vi.waitFor(() => {
      expect(sessionStorage.getItem('flowweb:regen:real-pid:n1')).toBeNull(); // 轮换 useEffect
    });
    await generate(container);
    await vi.waitFor(() => expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1));
    expect(lastToken()).toMatch(/^[0-9a-f-]{36}$/);
    expect(lastToken()).not.toBe('exhausted-tok');
  });
});
