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
      // Y1c T16：forceSync 删；getRichText=只读导出（fragment 单源——mock 固定文本）
      focus: vi.fn(), clear: vi.fn(), insertImage: vi.fn(), removeImage: vi.fn(), setText: vi.fn(),
      getRichText: () => ({ text: 'hello video', html: '<p>hello video</p>', json: [] }),
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

  it('readOnly 生成提交：prompt 引用不变（Y1c T16——:185 prompt 快照写整链删除，域键零 ns 写面）', async () => {
    seedSession(true);
    render(<VideoConfigPanel nodeId="v1" />);
    const before = promptRef();
    await act(async () => { capturedOnGenerate?.(); });
    expect(promptRef()).toBe(before); // prompt 权威=doc 容器——生成链零 ns 域键写
    expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1); // 提交链路照常
  });

  it('rw 锚：生成提交 prompt 引用同样不变（T16 后快照写=xml 域对抗面——生成判据经 getRichText 只读）', async () => {
    seedSession(false);
    render(<VideoConfigPanel nodeId="v1" />);
    const before = promptRef();
    await act(async () => { capturedOnGenerate?.(); });
    expect(promptRef()).toBe(before); // Y1c T16：快照写删除（原 :185 写为 PromptValue JSON 整串——容器替换对抗面）
    expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1);
  });
});
