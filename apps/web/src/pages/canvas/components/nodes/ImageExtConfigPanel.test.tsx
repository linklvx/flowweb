import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { message } from 'antd';
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
    expect(mockSubmitGeneration).toHaveBeenCalledWith('imgext1', expect.objectContaining({ projectId: 'real-pid' }));
    expect(order).toEqual(['submit']);
  });

  // ── 批0.5-8b 意图 id 上送（幂等键——失败重试复用、新点击 rotate、额度尽 rotate） ──

  const lastIntentId = (): string | undefined =>
    (mockSubmitGeneration.mock.calls.at(-1)?.[1] as any)?.intentId;
  const generate = async () => {
    mockNodeData.prompt.text = 'hello image ext';
    await act(async () => {
      await capturedOnGenerate?.();
    });
  };

  it('handleGenerate 上送 intentId（=sessionStorage 留存值，键含 projectId/nodeId）', async () => {
    render(<ImageExtConfigPanel nodeId="imgext1" />);
    await generate();
    await vi.waitFor(() => expect(mockSubmitGeneration).toHaveBeenCalledTimes(1));
    const intentId = lastIntentId();
    expect(intentId).toBeTruthy();
    expect(sessionStorage.getItem('flowweb:intent:real-pid:imgext1')).toBe(intentId);
  });

  it('失败后重试复用同 intentId（表命中不双扣）', async () => {
    mockSubmitGeneration.mockRejectedValueOnce(new Error('network down'));
    render(<ImageExtConfigPanel nodeId="imgext1" />);
    await generate();
    await vi.waitFor(() => expect(mockSubmitGeneration).toHaveBeenCalledTimes(1));
    const intent1 = lastIntentId();

    await generate();
    await vi.waitFor(() => expect(mockSubmitGeneration).toHaveBeenCalledTimes(2));
    expect(lastIntentId()).toBe(intent1);
  });

  it('成功后新点击 rotate 不同 intentId（新点击=新扣费意图）', async () => {
    render(<ImageExtConfigPanel nodeId="imgext1" />);
    await generate();
    await vi.waitFor(() => expect(mockSubmitGeneration).toHaveBeenCalledTimes(1));
    const intent1 = lastIntentId();

    await generate();
    await vi.waitFor(() => expect(mockSubmitGeneration).toHaveBeenCalledTimes(2));
    expect(lastIntentId()).toBeTruthy();
    expect(lastIntentId()).not.toBe(intent1);
  });

  it('INTENT_EXHAUSTED → rotate 新 intentId（下次提交照常扣费）', async () => {
    mockSubmitGeneration.mockRejectedValueOnce(
      Object.assign(new Error('重试次数已用尽'), { errorCode: 'INTENT_EXHAUSTED' })
    );
    render(<ImageExtConfigPanel nodeId="imgext1" />);
    await generate();
    await vi.waitFor(() => expect(mockSubmitGeneration).toHaveBeenCalledTimes(1));
    const sentIntentId = lastIntentId();
    expect(sentIntentId).toBeTruthy();
    await vi.waitFor(() => {
      expect(sessionStorage.getItem('flowweb:intent:real-pid:imgext1')).not.toBe(sentIntentId);
    });
  });

  it('INTENT_CONTEXT_MISMATCH → rotate + 改参提示 + 下次提交用新 id（改参重试死循环根堵）', async () => {
    const warnSpy = vi.spyOn(message, 'warning');
    mockSubmitGeneration
      .mockRejectedValueOnce(Object.assign(new Error('意图上下文不匹配'), { errorCode: 'INTENT_CONTEXT_MISMATCH' }))
      .mockResolvedValueOnce({ jobId: 'job-2' });
    render(<ImageExtConfigPanel nodeId="imgext1" />);
    await generate();
    await vi.waitFor(() => expect(mockSubmitGeneration).toHaveBeenCalledTimes(1));
    const intent1 = lastIntentId();
    expect(intent1).toBeTruthy();
    // 已 rotate：sessionStorage 当前值 ≠ 本次上送值
    await vi.waitFor(() => {
      expect(sessionStorage.getItem('flowweb:intent:real-pid:imgext1')).not.toBe(intent1);
    });
    // 提示出现：明确告知参数变更已重置（不被通用"提交失败"文案吞掉）
    expect(warnSpy).toHaveBeenCalledWith('参数已变更，已重置生成会话，请重新发起');
    // 死循环根堵：下次提交用新 id（不再撞 mismatch）
    await generate();
    await vi.waitFor(() => expect(mockSubmitGeneration).toHaveBeenCalledTimes(2));
    expect(lastIntentId()).toBeTruthy();
    expect(lastIntentId()).not.toBe(intent1);
    warnSpy.mockRestore();
  });
});
