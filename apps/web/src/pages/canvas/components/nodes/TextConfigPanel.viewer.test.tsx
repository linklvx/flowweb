// TextConfigPanel.viewer.test.tsx
// 批2-2 VIEWER 第二层组件面（真 store）：readOnly ⇒ 四处内容写不落 store。
//   :66 模型列表加载默认值 effect / :92 模型下拉选择 / :153 生成时 content 提交 / :220 textarea 即时输入。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TextConfigPanel } from './TextConfigPanel';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';

vi.mock('@xyflow/react', () => ({
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  Handle: () => null,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

const { mockEnqueueWorkflow } = vi.hoisted(() => ({
  mockEnqueueWorkflow: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
}));
vi.mock('@/api/executionApi', () => ({ enqueueWorkflow: mockEnqueueWorkflow }));

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data }), { status: 200 });

function seedSession(readOnly: boolean) {
  useCanvasStore.setState({
    hydration: 'ready', collabReadOnly: readOnly, wsAuthNotice: null,
    projectId: 'p1', nodes: [], edges: [],
  });
  useNodeStore.setState((s) => ({
    nodes: { ...s.nodes, t1: { id: 't1', type: 'textInput', data: { content: '', prompt: '' } as any } },
  }));
}
const dataOf = () => useNodeStore.getState().nodes.t1?.data as any;
const flushEffects = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('批2-2 TextConfigPanel：readOnly 输入不落 store（真 store）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/node-types/text/models')) {
        return ok([{ id: 'tm-1', name: 'T1' }, { id: 'tm-2', name: 'T2' }]);
      }
      return ok(0);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('readOnly :66 模型默认值 effect 不落 store', async () => {
    seedSession(true);
    render(<TextConfigPanel nodeId="t1" />);
    await flushEffects();
    expect(dataOf().model).toBeUndefined();
  });

  it('rw 锚 :66 模型默认值 effect 照常落 store', async () => {
    seedSession(false);
    render(<TextConfigPanel nodeId="t1" />);
    await flushEffects();
    expect(dataOf().model).toBe('tm-1');
  });

  it('readOnly :220 textarea 输入不落 store', () => {
    seedSession(true);
    const { container } = render(<TextConfigPanel nodeId="t1" />);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'hello text' } });
    expect(dataOf().prompt).toBe('');
  });

  it('rw 锚 :220 textarea 输入照常落 store', () => {
    seedSession(false);
    const { container } = render(<TextConfigPanel nodeId="t1" />);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'hello text' } });
    expect(dataOf().prompt).toBe('hello text');
  });

  it('readOnly :92 模型下拉选择不落 store', async () => {
    seedSession(true);
    render(<TextConfigPanel nodeId="t1" />);
    await flushEffects();
    fireEvent.click(screen.getByTestId('canvas-node-text-model-select'));
    fireEvent.click(screen.getByText('T2'));
    expect(dataOf().model).toBeUndefined();
  });

  it('readOnly :153 生成时 content 提交不落 store', async () => {
    seedSession(true);
    const { container } = render(<TextConfigPanel nodeId="t1" />);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'gen prompt' } });
    const buttons = container.querySelectorAll('button');
    await act(async () => { fireEvent.click(buttons[buttons.length - 1]); });
    expect(dataOf().content).toBe('');
    expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1);
  });
});
