import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { VideoConfigPanel } from './VideoConfigPanel';

// Track the maxHeight prop passed to PromptInput
let capturedMaxHeight = 80;
// Track the onPasteImage handler passed to PromptInput
let capturedOnPasteImage: ((file: File) => void) | undefined;
// Track the onGenerate handler passed to PromptInput
let capturedOnGenerate: (() => void) | undefined;

// Mock PromptInput
vi.mock('./prompt-input/PromptInput', () => ({
  default: React.forwardRef((props: any, ref: any) => {
    capturedMaxHeight = props.maxHeight;
    capturedOnPasteImage = props.onPasteImage;
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

// Mock useImageUpload — uploadSingleImage spyable
const mockUploadSingleImage = vi.fn();
vi.mock('./prompt-input/useImageUpload', () => ({
  useImageUpload: () => ({
    uploadSingleImage: mockUploadSingleImage,
    uploadBatchImages: vi.fn(),
    deleteImage: vi.fn(),
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
  ratio: '16:9',
  resolution: '1080p',
  duration: 5,
  audio: true,
  prompt: { text: '', html: '', referencedImageIds: [] },
};

vi.mock('@/stores/nodeStore', () => {
  const buildState = () => ({
    nodes: {
      v1: { id: 'v1', type: 'videoGen', position: { x: 0, y: 0 }, data: mockNodeData },
      img1: { id: 'img1', type: 'imageGen', position: { x: 100, y: 0 }, data: { model: 'sdxl' } },
    },
    updateConfig: mockUpdateConfig,
    updatePromptImages: mockUpdatePromptImages,
    setStatus: vi.fn(),
    getNodeData: () => mockNodeData,
    applyNodeDataPatch: vi.fn(), // 批2-2：面板内容写收口 wrapper（mock 面）
    // Y0b-2 T6：投影两源（token 轮换/三态判据——测试经 hoisted mockExec 注入）
    execStatus: getMockExec().execStatus,
    execAligned: getMockExec().execAligned,
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

let mockCanvasProjectId: string | null = 'real-pid';

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({ nodes: [], edges: [], projectId: mockCanvasProjectId }),
  },
}));

const { mockEnqueueWorkflow, getMockExec } = vi.hoisted(() => {
  // Y0b-2 T6：exec 投影可变注入（buildState 每次读新值——用例内改 entries 即生效）
  const exec = { execStatus: new Map(), execAligned: new Map() };
  return {
    mockEnqueueWorkflow: vi.fn().mockResolvedValue({ jobId: 'job-1', status: 'queued' }),
    getMockExec: () => exec,
  };
});
vi.mock('@/api/executionApi', () => ({
  enqueueWorkflow: mockEnqueueWorkflow,
}));
describe('VideoConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNodeData = {
      model: 'video-model-1',
      status: 'idle',
      ratio: '16:9',
      resolution: '1080p',
      duration: 5,
      audio: true,
      prompt: { text: '', html: '', referencedImageIds: [] },
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

  it('returns null when node type is imageGen (not videoGen)', () => {
    const { container } = render(<VideoConfigPanel nodeId="img1" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders thumbnails from root-level allImages', () => {
    mockNodeData.allImages = [
      { id: 'img1', url: '/u', name: 'x.png', status: 'success' },
      { id: 'img2', url: '/u', name: 'y.png', status: 'success' },
    ];
    const { container } = render(<VideoConfigPanel nodeId="v1" />);
    expect(screen.getByTestId('prompt-input')).toBeTruthy();
    expect(container.querySelectorAll('[data-testid^="thumb-"]').length).toBe(2);
  });

  it('blocks paste upload when root-level allImages is full (9)', async () => {
    mockNodeData.allImages = Array.from({ length: 9 }, (_, i) => ({
      id: `full-${i}`,
      url: `/u/${i}`,
      name: `f${i}.png`,
      status: 'success' as const,
    }));
    render(<VideoConfigPanel nodeId="v1" />);

    const file = new File(['x'], 'paste.png', { type: 'image/png' });
    await act(async () => {
      await capturedOnPasteImage?.(file);
    });
    expect(mockUploadSingleImage).not.toHaveBeenCalled();
  });

  it('allows paste upload when root-level allImages has room (8)', async () => {
    mockNodeData.allImages = Array.from({ length: 8 }, (_, i) => ({
      id: `room-${i}`,
      url: `/u/${i}`,
      name: `r${i}.png`,
      status: 'success' as const,
    }));
    render(<VideoConfigPanel nodeId="v1" />);

    const file = new File(['x'], 'paste.png', { type: 'image/png' });
    await act(async () => {
      await capturedOnPasteImage?.(file);
    });
    expect(mockUploadSingleImage).toHaveBeenCalledTimes(1);
  });

  it('Task15：直接 enqueue（server doc 实时持久化，无 flush）', async () => {
    mockNodeData.prompt.text = 'hello video';
    const order: string[] = [];
        mockEnqueueWorkflow.mockImplementationOnce(async () => { order.push('enqueue'); return { jobId: 'j1' }; });
    render(<VideoConfigPanel nodeId="v1" />);

    await act(async () => {
      await capturedOnGenerate?.();
    });
    expect(mockEnqueueWorkflow).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'real-pid' }));
    expect(order).toEqual(['enqueue']);
  });

  it('should render 2 dividers: after model selector and between voice/credits', () => {
    const { container } = render(<VideoConfigPanel nodeId="v1" />);
    const dividers = container.querySelectorAll('.w-px.h-4');
    expect(dividers.length).toBe(2);
  });

  // ─── Video config button (ratio + resolution + duration + audio) ───

  it('should render video config button with ratio icon and texts', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    const btn = screen.getByTestId('canvas-node-video-config-select');
    expect(btn).toBeTruthy();
    // Should display ratio text: 16:9
    expect(btn.textContent).toContain('16:9');
    // Should display resolution: 1080p
    expect(btn.textContent).toContain('1080p');
    // Should contain a rectangle icon (aspect ratio visual)
    const icon = btn.querySelector('[style*="border: 1.5px solid"]');
    expect(icon).toBeTruthy();
    // Should contain volume SVG icon
    const volumeSvg = btn.querySelector('svg[viewBox]');
    expect(volumeSvg).toBeTruthy();
  });

  it('should open config popup on button click', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    const btn = screen.getByTestId('canvas-node-video-config-select');
    fireEvent.click(btn);
    // Popup should render with section labels
    expect(screen.getByText('清晰度')).toBeTruthy();
    expect(screen.getByText('比例')).toBeTruthy();
    expect(screen.getByText('时长')).toBeTruthy();
    expect(screen.getByText('声音')).toBeTruthy();
  });

  it('should show resolution options in popup', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    fireEvent.click(screen.getByTestId('canvas-node-video-config-select'));
    expect(screen.getByText('1080p')).toBeTruthy();
    expect(screen.getByText('4K')).toBeTruthy();
  });

  it('should show ratio grid options in popup', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    fireEvent.click(screen.getByTestId('canvas-node-video-config-select'));
    expect(screen.getByText('16:9')).toBeTruthy();
    expect(screen.getByText('9:16')).toBeTruthy();
    expect(screen.getByText('1:1')).toBeTruthy();
  });

  it('should show duration options in popup', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    fireEvent.click(screen.getByTestId('canvas-node-video-config-select'));
    expect(screen.getByText('5s')).toBeTruthy();
    expect(screen.getByText('10s')).toBeTruthy();
  });

  it('should show audio toggle in popup', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    fireEvent.click(screen.getByTestId('canvas-node-video-config-select'));
    // Audio toggle button should exist
    const toggle = screen.getByTestId('canvas-node-video-audio-toggle');
    expect(toggle).toBeTruthy();
  });

  it('should NOT close popup when selecting options', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    const btn = screen.getByTestId('canvas-node-video-config-select');
    fireEvent.click(btn);
    expect(screen.getByText('清晰度')).toBeTruthy();
    // Click a ratio option
    fireEvent.click(screen.getByText('9:16'));
    // Popup should still be open
    expect(screen.getByText('清晰度')).toBeTruthy();
  });

  it('should close popup when clicking button again (toggle)', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    const btn = screen.getByTestId('canvas-node-video-config-select');
    fireEvent.click(btn); // open
    expect(screen.getByText('清晰度')).toBeTruthy();
    fireEvent.click(btn); // close
    expect(screen.queryByText('清晰度')).not.toBeInTheDocument();
  });

  it('should close config popup on outside click', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    fireEvent.click(screen.getByTestId('canvas-node-video-config-select'));
    expect(screen.getByText('清晰度')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('清晰度')).not.toBeInTheDocument();
  });

  it('should show volume-up icon on button when audio is on', () => {
    mockNodeData.audio = true;
    render(<VideoConfigPanel nodeId="v1" />);
    const btn = screen.getByTestId('canvas-node-video-config-select');
    const svg = btn.querySelector('svg[viewBox="0 0 24 24"]');
    // VolumeUp has the wave arcs: "v8.05"
    expect(svg!.innerHTML).toContain('v8.05');
  });

  it('should show volume-mute icon on button when audio is off', () => {
    mockNodeData.audio = false;
    render(<VideoConfigPanel nodeId="v1" />);
    const btn = screen.getByTestId('canvas-node-video-config-select');
    const svg = btn.querySelector('svg[viewBox="0 0 24 24"]');
    expect(svg).toBeTruthy();
    // VolumeMute has a stroke-based diagonal line (unlike VolumeUp which is all fill)
    expect(svg!.innerHTML).toContain('stroke');
    // Should NOT contain the wave pattern
    expect(svg!.innerHTML).not.toContain('v8.05');
  });

  // ─── Generate count button ───
  it('should render generate count button showing default 1×', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    const btn = screen.getByTestId('canvas-node-video-count-select');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('1×');
  });

  it('should show custom "生成数量" tooltip above button', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    const btn = screen.getByTestId('canvas-node-video-count-select');
    const tooltip = btn.querySelector('.count-tooltip');
    expect(tooltip).toBeTruthy();
    expect(tooltip?.textContent).toBe('生成数量');
  });

  it('should open count dropdown on click', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    fireEvent.click(screen.getByTestId('canvas-node-video-count-select'));
    expect(screen.getAllByText('1×').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('2×')).toBeTruthy();
    expect(screen.getByText('4×')).toBeTruthy();
    expect(screen.getByText('8×')).toBeTruthy();
  });

  it('should update button text when selecting a count', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    fireEvent.click(screen.getByTestId('canvas-node-video-count-select'));
    fireEvent.click(screen.getByText('2×'));
    expect(screen.getByTestId('canvas-node-video-count-select').textContent).toContain('2×');
  });

  it('should close count dropdown on outside click', () => {
    render(<VideoConfigPanel nodeId="v1" />);
    fireEvent.click(screen.getByTestId('canvas-node-video-count-select'));
    expect(screen.getByText('2×')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('2×')).not.toBeInTheDocument();
    expect(screen.getByText('1×')).toBeTruthy();
  });

  // ── Y0b-2 T6（Z79/Z95/Z118）：手势 token 生命周期（held 一律上送/done 轮换/EXHAUSTED 不自锁） ──
  // 改前形态（intentId 每击 rotate+组件 ref 记忆）随旧手势 id 记忆模块退役——轮换判据单源=doc 投影。

  const lastToken = (): string | undefined => mockEnqueueWorkflow.mock.calls.at(-1)?.[0]?.regenToken;
  const generate = async () => {
    mockNodeData.prompt.text = 'hello video';
    await act(async () => {
      await capturedOnGenerate?.();
    });
  };
  const setExec = (entry: any) => {
    getMockExec().execStatus = new Map([['v1', entry]]);
  };

  it('普通执行（无 held 非终态）→ body 无 regenToken（内容键——服务端②回放最新/③新行）', async () => {
    render(<VideoConfigPanel nodeId="v1" />);
    await generate();
    await vi.waitFor(() => expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1));
    expect(lastToken()).toBeUndefined();
  });

  it('done 投影后点击 → 铸造手势 token 上送+持有（"重新生成"=新意图照常扣费）+done 轮换生效', async () => {
    setExec({ status: 'done', attempts: 1 });
    render(<VideoConfigPanel nodeId="v1" />);
    await vi.waitFor(() => { // Z95 轮换：done 投影 ⇒ useEffect 丢弃旧持有
      expect(sessionStorage.getItem('flowweb:regen:real-pid:v1')).toBeNull();
    });
    await generate();
    await vi.waitFor(() => expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1));
    const token = lastToken();
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(sessionStorage.getItem('flowweb:regen:real-pid:v1')).toBe(token);
  });

  it('error 投影（可 rearm）后 held 上送——失败重试复用同 token（免费 rearm 不双扣）', async () => {
    setExec({ status: 'error', attempts: 1, rearmable: true });
    sessionStorage.setItem('flowweb:regen:real-pid:v1', 'held-token-cccc');
    render(<VideoConfigPanel nodeId="v1" />);
    await generate();
    await vi.waitFor(() => expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1));
    expect(lastToken()).toBe('held-token-cccc'); // held 一律上送（Z118）
    expect(sessionStorage.getItem('flowweb:regen:real-pid:v1')).toBe('held-token-cccc'); // 不轮换
  });

  it('EXHAUSTED（error∧rearmable:false）→ 投影轮换（不自锁）；下一击铸造新 token', async () => {
    setExec({ status: 'error', attempts: 3, rearmable: false });
    sessionStorage.setItem('flowweb:regen:real-pid:v1', 'exhausted-tok');
    render(<VideoConfigPanel nodeId="v1" />);
    await vi.waitFor(() => {
      expect(sessionStorage.getItem('flowweb:regen:real-pid:v1')).toBeNull(); // 轮换 useEffect
    });
    await generate();
    await vi.waitFor(() => expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1));
    expect(lastToken()).toMatch(/^[0-9a-f-]{36}$/);
    expect(lastToken()).not.toBe('exhausted-tok');
  });
});
