import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { message } from 'antd';
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
    // Y0b-1：面板自动选首模型/首分辨率走 applyNodeDataPatch（收口 wrapper）
    applyNodeDataPatch: vi.fn(),
    // Y0b-2 T6：投影两源（token 轮换/三态判据——测试经 hoisted mockExec 注入 done/EXHAUSTED 形态）
    execStatus: getMockExec().execStatus,
    execAligned: getMockExec().execAligned,
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

const { getMockCanvasNodes, mockSubmitGeneration, mockFetchModels, getMockExec } = vi.hoisted(() => {
  let mockCanvasNodes: any[] = [];
  // Y0b-2 T6：exec 投影可变注入（buildState 每次读新值——用例内改 entries 即生效）
  const exec = { execStatus: new Map(), execAligned: new Map() };
  return {
    mockSubmitGeneration: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
    getMockCanvasNodes: () => mockCanvasNodes,
    getMockExec: () => exec,
    // Y0b-1：模型带声明维度行（resolutions）——分辨率选项/label 自模型声明渲染
    mockFetchModels: vi.fn().mockResolvedValue([
      {
        id: 'sdxl',
        name: 'SDXL',
        resolutions: [
          { id: 'res-1k', label: '1K' },
          { id: 'res-2k', label: '2K' },
          { id: 'res-4k', label: '4K' },
        ],
        durations: [],
      },
    ]),
  };
});

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({ nodes: getMockCanvasNodes(), edges: [], projectId: 'real-pid' }),
  },
}));
vi.mock('@/api/imageNodeApi', () => ({
  getCreditCost: vi.fn().mockResolvedValue(0),
  fetchModels: mockFetchModels,
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
      resolution: 'res-2k', // Y0b-1：分辨率存行 id（label 显示由模型声明行解析）
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

  it('should render ratio+resolution button with ratio and resolution text', async () => {
    render(<ImageConfigPanel nodeId="img1" />);
    // Y0b-1：分辨率显示=模型声明行 label（异步 fetchModels 后渲染；res-2k → '2K'）
    await vi.waitFor(() => {
      const btn = screen.getByTestId('canvas-node-image-ratio-select');
      expect(btn.textContent).toContain('1:1');
      expect(btn.textContent).toContain('2K');
    });
    // Should contain a rectangle icon (aspect ratio visual)
    const icon = screen.getByTestId('canvas-node-image-ratio-select').querySelector('[style*="border: 1.5px solid"]');
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

  it('should show resolution options 2K and 4K in popup', async () => {
    render(<ImageConfigPanel nodeId="img1" />);
    // Y0b-1：等模型声明行加载完（弹层选项自模型 resolutions 渲染）
    await vi.waitFor(() => expect(screen.getByTestId('canvas-node-image-ratio-select').textContent).toContain('2K'));
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

  it('should render 1K/2K/4K resolution options (需求9——选项自模型 resolutions 渲染)', async () => {
    render(<ImageConfigPanel nodeId="img1" />);
    // Y0b-1：等模型声明行加载完（弹层选项=resolutions label，非硬编码字面量）
    await vi.waitFor(() => expect(screen.getByTestId('canvas-node-image-ratio-select').textContent).toContain('2K'));
    fireEvent.click(screen.getByTestId('canvas-node-image-ratio-select'));
    expect(screen.getByText('1K')).toBeTruthy();
    expect(screen.getByText('2K')).toBeTruthy();
    expect(screen.getByText('4K')).toBeTruthy();
  });

  // ─── Generate count button ───
  it('should render generate count button showing default 1张', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    const btn = screen.getByTestId('canvas-node-image-count-select');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('1张');
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
    // Use getAllByText for '1张' since button also shows it, causing duplicates
    expect(screen.getAllByText('1张').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('2张')).toBeTruthy();
    expect(screen.getByText('4张')).toBeTruthy();
  });

  it('should update button text when selecting a count', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    fireEvent.click(screen.getByTestId('canvas-node-image-count-select'));
    fireEvent.click(screen.getByText('2张'));
    expect(screen.getByTestId('canvas-node-image-count-select').textContent).toContain('2张');
  });

  it('should close count dropdown on outside click', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    fireEvent.click(screen.getByTestId('canvas-node-image-count-select'));
    // Dropdown is open: text '2张' only exists in dropdown (not on button with default 1张)
    expect(screen.getByText('2张')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    // After closing, dropdown items disappear (button still shows 1张)
    expect(screen.queryByText('2张')).not.toBeInTheDocument();
    expect(screen.getByText('1张')).toBeTruthy();
  });

  it('should NOT render AI tool button for imageGen node', () => {
    render(<ImageConfigPanel nodeId="img1" />);
    expect(screen.queryByTestId('canvas-node-image-ai-tool-select')).not.toBeInTheDocument();
  });

  it('Task15：直接 submitGeneration（server doc 实时持久化，无 flush）', async () => {
    mockNodeData.prompt.text = 'hello image';
    const order: string[] = [];
        mockSubmitGeneration.mockImplementationOnce(async () => { order.push('submit'); return { jobId: 'j1' }; });
    render(<ImageConfigPanel nodeId="img1" />);

    await act(async () => {
      await capturedOnGenerate?.();
    });
    expect(mockSubmitGeneration).toHaveBeenCalledWith('img1', expect.objectContaining({ projectId: 'real-pid' }));
    expect(order).toEqual(['submit']);
  });

  // ── Y0b-2 T6（Z79/Z95/Z118）：手势 token 生命周期（held 一律上送/done 轮换/EXHAUSTED 不自锁） ──
  // 改前形态（intentId 每击 rotate+组件 ref 记忆）随 intentRecord 族退役——轮换判据单源=doc 投影。

  const lastToken = (): string | undefined =>
    (mockSubmitGeneration.mock.calls.at(-1)?.[1] as any)?.regenToken;
  const generate = async () => {
    mockNodeData.prompt.text = 'hello image';
    await act(async () => {
      await capturedOnGenerate?.();
    });
  };
  const setExec = (entry: any) => {
    getMockExec().execStatus = new Map([['img1', entry]]);
  };

  it('普通执行（无 held 非终态）→ body 无 regenToken（内容键——服务端②回放最新/③新行）', async () => {
    render(<ImageConfigPanel nodeId="img1" />);
    await generate();
    await vi.waitFor(() => expect(mockSubmitGeneration).toHaveBeenCalledTimes(1));
    expect(lastToken()).toBeUndefined();
  });

  it('done 投影后点击 → 铸造手势 token 上送+sessionStorage 持有（"重新生成"=新意图照常扣费）', async () => {
    setExec({ status: 'done', attempts: 1 });
    render(<ImageConfigPanel nodeId="img1" />);
    // Z95 轮换：done 投影 ⇒ useEffect 丢弃旧持有（下一击=新"重新生成"）
    await vi.waitFor(() => {
      expect(sessionStorage.getItem('flowweb:regen:real-pid:img1')).toBeNull();
    });
    await generate();
    await vi.waitFor(() => expect(mockSubmitGeneration).toHaveBeenCalledTimes(1));
    const token = lastToken();
    expect(token).toMatch(/^[0-9a-f-]{36}$/); // done 态无 held ⇒ 铸造新手势 token 上送
    expect(sessionStorage.getItem('flowweb:regen:real-pid:img1')).toBe(token); // 持有（终态前重试复用）
  });

  it('error 投影（可 rearm）后 held 上送——失败重试复用同 token（免费 rearm 不双扣，跨刷新存活）', async () => {
    setExec({ status: 'error', attempts: 1, rearmable: true });
    sessionStorage.setItem('flowweb:regen:real-pid:img1', 'held-token-aaaa');
    render(<ImageConfigPanel nodeId="img1" />);
    await generate();
    await vi.waitFor(() => expect(mockSubmitGeneration).toHaveBeenCalledTimes(1));
    expect(lastToken()).toBe('held-token-aaaa'); // held 一律上送（Z118）
    // error∧rearmable ⇒ 不轮换（保留 held 供重试）
    expect(sessionStorage.getItem('flowweb:regen:real-pid:img1')).toBe('held-token-aaaa');
  });

  it('EXHAUSTED（error∧rearmable:false）→ 投影轮换（不自锁）；下一击铸造新 token', async () => {
    setExec({ status: 'error', attempts: 3, rearmable: false });
    sessionStorage.setItem('flowweb:regen:real-pid:img1', 'exhausted-tok');
    render(<ImageConfigPanel nodeId="img1" />);
    await vi.waitFor(() => {
      expect(sessionStorage.getItem('flowweb:regen:real-pid:img1')).toBeNull(); // 轮换 useEffect
    });
    await generate();
    await vi.waitFor(() => expect(mockSubmitGeneration).toHaveBeenCalledTimes(1));
    expect(lastToken()).toMatch(/^[0-9a-f-]{36}$/); // 新 token（同 token rearm 会 409 自锁根堵）
    expect(lastToken()).not.toBe('exhausted-tok');
  });
});
