// VideoConfigPanel.viewer.test.tsx
// 批2-2 VIEWER 第二层组件面（真 store）：readOnly ⇒ :185 生成时 prompt 快照写不落 store。
// 判据用 data.prompt 引用（setStatus('loading') 会重建 data 对象但保留 prompt 键引用——
// 收口写点若执行会替换 prompt 引用，早退则引用不变；值等价场景下引用判据是唯一可观察差异）。
// PromptInput mock 照既有 VideoConfigPanel.test（capture onGenerate）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { VideoConfigPanel } from './VideoConfigPanel';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';

let capturedOnGenerate: (() => void) | undefined;
vi.mock('./prompt-input/PromptInput', () => ({
  default: React.forwardRef((_props: any, ref: any) => {
    capturedOnGenerate = _props.onGenerate;
    React.useImperativeHandle(ref, () => ({
      forceSync: vi.fn(), focus: vi.fn(), clear: vi.fn(), insertImage: vi.fn(), removeImage: vi.fn(), setText: vi.fn(),
    }));
    return <div data-testid="prompt-input">PromptInput</div>;
  }),
}));
vi.mock('./prompt-input/useImageUpload', () => ({
  useImageUpload: () => ({ uploadSingleImage: vi.fn(), uploadBatchImages: vi.fn(), deleteImage: vi.fn() }),
}));
vi.mock('./prompt-input/ImageThumbnailBar', () => ({ ImageThumbnailBar: () => null }));
vi.mock('@xyflow/react', () => ({
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  Handle: () => null,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

const { mockEnqueueWorkflow } = vi.hoisted(() => ({
  mockEnqueueWorkflow: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
}));
vi.mock('@/api/executionApi', () => ({ enqueueWorkflow: mockEnqueueWorkflow }));

function seedSession(readOnly: boolean) {
  useCanvasStore.setState({
    hydration: 'ready', collabReadOnly: readOnly, wsAuthNotice: null,
    projectId: 'p1', nodes: [], edges: [],
  });
  useNodeStore.setState((s) => ({
    nodes: { ...s.nodes, v1: { id: 'v1', type: 'videoGen', data: { model: 'vm-1', status: 'idle', prompt: { text: 'hello video', html: '', referencedImageIds: [] } } as any } },
  }));
}
const promptRef = () => (useNodeStore.getState().nodes.v1?.data as any)?.prompt;

describe('批2-2 VideoConfigPanel：readOnly 生成提交不落 store（真 store）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    capturedOnGenerate = undefined;
  });

  it('readOnly :185 生成时 prompt 快照写不落 store（data.prompt 引用不变——setStatus 重建 data 但保留键引用）', async () => {
    seedSession(true);
    render(<VideoConfigPanel nodeId="v1" />);
    const before = promptRef();
    await act(async () => { capturedOnGenerate?.(); });
    expect(promptRef()).toBe(before); // 收口写点早退——prompt 键引用原样
    expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1); // 提交链路照常
  });

  it('rw 锚 :185 生成时 prompt 快照照常落 store（引用更新）', async () => {
    seedSession(false);
    render(<VideoConfigPanel nodeId="v1" />);
    const before = promptRef();
    await act(async () => { capturedOnGenerate?.(); });
    expect(promptRef()).not.toBe(before); // 新 prompt 对象写入
  });
});
