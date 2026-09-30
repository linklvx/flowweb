// ImageConfigPanel.viewer.test.tsx
// 批2-2 VIEWER 第二层组件面（真 store）：readOnly ⇒ :64 模型默认值 effect 不落 store。
// config-panel 子组件 mock 为 null（本测只驱动面板主体的模型加载 effect，与既有 Video 测试 mock PromptInput 同口径）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ImageConfigPanel } from './ImageConfigPanel';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';

vi.mock('@xyflow/react', () => ({
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  Handle: () => null,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

// 子组件全部置空——面板主体（模型加载 effect + 收口写点）是真码
vi.mock('./config-panel/ModelSelector', () => ({ ModelSelector: () => null }));
vi.mock('./config-panel/RatioResolutionPopover', () => ({ RatioResolutionPopover: () => null }));
vi.mock('./config-panel/GenerateCountSelector', () => ({ GenerateCountSelector: () => null }));
vi.mock('./config-panel/CreditDisplay', () => ({ CreditDisplay: () => null }));
vi.mock('./config-panel/RunButton', () => ({ RunButton: () => null }));
vi.mock('./config-panel/PromptEditor', () => ({ PromptEditor: () => null }));

const { mockFetchModels } = vi.hoisted(() => ({
  mockFetchModels: vi.fn().mockResolvedValue([{ id: 'im-1', name: 'IM1' }]),
}));
vi.mock('@/api/imageNodeApi', () => ({
  fetchModels: mockFetchModels,
  getCreditCost: vi.fn().mockResolvedValue(0),
  submitGeneration: vi.fn().mockResolvedValue({}),
}));

function seedSession(readOnly: boolean) {
  useCanvasStore.setState({
    hydration: 'ready', collabReadOnly: readOnly, wsAuthNotice: null,
    projectId: 'p1', nodes: [], edges: [],
  });
  useNodeStore.setState((s) => ({
    nodes: { ...s.nodes, i1: { id: 'i1', type: 'imageGen', data: { status: 'idle' } as any } },
  }));
}
const dataOf = () => useNodeStore.getState().nodes.i1?.data as any;
const flushEffects = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('批2-2 ImageConfigPanel：readOnly 输入不落 store（真 store）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchModels.mockResolvedValue([{ id: 'im-1', name: 'IM1' }]);
  });

  it('readOnly :64 模型默认值 effect 不落 store', async () => {
    seedSession(true);
    render(<ImageConfigPanel nodeId="i1" />);
    await flushEffects();
    expect(dataOf().model).toBeUndefined();
  });

  it('rw 锚 :64 模型默认值 effect 照常落 store', async () => {
    seedSession(false);
    render(<ImageConfigPanel nodeId="i1" />);
    await flushEffects();
    expect(dataOf().model).toBe('im-1');
  });
});
