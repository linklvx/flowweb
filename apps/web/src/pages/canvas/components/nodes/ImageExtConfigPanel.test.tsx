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
    // Y0b-2 T6：投影两源（token 轮换/三态判据——测试经 hoisted mockExec 注入）
    execStatus: getMockExec().execStatus,
    execAligned: getMockExec().execAligned,
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

const { mockSubmitGeneration, getMockExec } = vi.hoisted(() => {
  // Y0b-2 T6：exec 投影可变注入（buildState 每次读新值——用例内改 entries 即生效）
  const exec = { execStatus: new Map(), execAligned: new Map() };
  return {
    mockSubmitGeneration: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
    getMockExec: () => exec,
  };
});

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
    expect(mockSubmitGeneration).toHaveBeenCalledWith('imgext1', expect.objectContaining({ projectId: 'real-pid' }));
    expect(order).toEqual(['submit']);
  });

  // ── Y0b-2 T6（Z79/Z95/Z118）：手势 token 生命周期（held 一律上送/done 轮换/EXHAUSTED 不自锁） ──
  // 改前形态（intentId 每击 rotate+组件 ref 记忆）随旧手势 id 记忆模块退役——轮换判据单源=doc 投影。

  const lastToken = (): string | undefined =>
    (mockSubmitGeneration.mock.calls.at(-1)?.[1] as any)?.regenToken;
  const generate = async () => {
    mockNodeData.prompt.text = 'hello image ext';
    await act(async () => {
      await capturedOnGenerate?.();
    });
  };
  const setExec = (entry: any) => {
    getMockExec().execStatus = new Map([['imgext1', entry]]);
  };

  it('普通执行（无 held 非终态）→ body 无 regenToken（内容键——服务端②回放最新/③新行）', async () => {
    render(<ImageExtConfigPanel nodeId="imgext1" />);
    await generate();
    await vi.waitFor(() => expect(mockSubmitGeneration).toHaveBeenCalledTimes(1));
    expect(lastToken()).toBeUndefined();
  });

  it('done 投影后点击 → 铸造手势 token 上送+持有（"重新生成"=新意图照常扣费）+done 轮换生效', async () => {
    setExec({ status: 'done', attempts: 1 });
    render(<ImageExtConfigPanel nodeId="imgext1" />);
    await vi.waitFor(() => { // Z95 轮换：done 投影 ⇒ useEffect 丢弃旧持有
      expect(sessionStorage.getItem('flowweb:regen:real-pid:imgext1')).toBeNull();
    });
    await generate();
    await vi.waitFor(() => expect(mockSubmitGeneration).toHaveBeenCalledTimes(1));
    const token = lastToken();
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(sessionStorage.getItem('flowweb:regen:real-pid:imgext1')).toBe(token);
  });

  it('error 投影（可 rearm）后 held 上送——失败重试复用同 token（免费 rearm 不双扣）', async () => {
    setExec({ status: 'error', attempts: 1, rearmable: true });
    sessionStorage.setItem('flowweb:regen:real-pid:imgext1', 'held-token-dddd');
    render(<ImageExtConfigPanel nodeId="imgext1" />);
    await generate();
    await vi.waitFor(() => expect(mockSubmitGeneration).toHaveBeenCalledTimes(1));
    expect(lastToken()).toBe('held-token-dddd'); // held 一律上送（Z118）
    expect(sessionStorage.getItem('flowweb:regen:real-pid:imgext1')).toBe('held-token-dddd'); // 不轮换
  });

  it('EXHAUSTED（error∧rearmable:false）→ 投影轮换（不自锁）；下一击铸造新 token', async () => {
    setExec({ status: 'error', attempts: 3, rearmable: false });
    sessionStorage.setItem('flowweb:regen:real-pid:imgext1', 'exhausted-tok');
    render(<ImageExtConfigPanel nodeId="imgext1" />);
    await vi.waitFor(() => {
      expect(sessionStorage.getItem('flowweb:regen:real-pid:imgext1')).toBeNull(); // 轮换 useEffect
    });
    await generate();
    await vi.waitFor(() => expect(mockSubmitGeneration).toHaveBeenCalledTimes(1));
    expect(lastToken()).toMatch(/^[0-9a-f-]{36}$/);
    expect(lastToken()).not.toBe('exhausted-tok');
  });
});
