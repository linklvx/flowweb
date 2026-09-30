// AudioConfigPanel.viewer.test.tsx
// 批2-2 VIEWER 第二层组件面（真 store——不 mock nodeStore/canvasStore）：
// 判据：readOnly（hydration ready + collabReadOnly）⇒ 四处内容写（批2-2 收口点）输入不落 store。
//   :69 模型列表加载默认值 effect / :95 模型下拉选择 / :148 生成时 content 提交 / :202 textarea 即时输入。
// rw 锚：read-write 会话同操作落 store（等价旧行为——门不过度拦截）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AudioConfigPanel } from './AudioConfigPanel';
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

/** 真会话电平 + 种子节点（audioGen——model 留空：模型默认值 effect 的写入条件） */
function seedSession(readOnly: boolean) {
  useCanvasStore.setState({
    hydration: 'ready', collabReadOnly: readOnly, wsAuthNotice: null,
    projectId: 'p1', nodes: [], edges: [],
  });
  useNodeStore.setState((s) => ({
    nodes: { ...s.nodes, a1: { id: 'a1', type: 'audioGen', data: { content: '', status: 'idle' } as any } },
  }));
}
const dataOf = () => useNodeStore.getState().nodes.a1?.data as any;
/** flush 模型列表加载 effect（fetch resolve + setState） */
const flushEffects = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('批2-2 AudioConfigPanel：readOnly 输入不落 store（真 store）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/node-types/audio/models')) {
        return ok([{ id: 'am-1', name: 'M1' }, { id: 'am-2', name: 'M2' }]);
      }
      return ok(0); // pricing calculate
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('readOnly :69 模型默认值 effect 不落 store', async () => {
    seedSession(true);
    render(<AudioConfigPanel nodeId="a1" />);
    await flushEffects();
    expect(dataOf().model).toBeUndefined(); // 早退——store 零变更
  });

  it('rw 锚 :69 模型默认值 effect 照常落 store', async () => {
    seedSession(false);
    render(<AudioConfigPanel nodeId="a1" />);
    await flushEffects();
    expect(dataOf().model).toBe('am-1');
  });

  it('readOnly :202 textarea 输入不落 store', () => {
    seedSession(true);
    const { container } = render(<AudioConfigPanel nodeId="a1" />);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'hello audio' } });
    expect(dataOf().content).toBe(''); // store 零变更（本地 state 照变——回弹不闪）
  });

  it('rw 锚 :202 textarea 输入照常落 store', () => {
    seedSession(false);
    const { container } = render(<AudioConfigPanel nodeId="a1" />);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'hello audio' } });
    expect(dataOf().content).toBe('hello audio');
  });

  it('readOnly :95 模型下拉选择不落 store', async () => {
    seedSession(true);
    render(<AudioConfigPanel nodeId="a1" />);
    await flushEffects(); // 模型列表就绪
    fireEvent.click(screen.getByTestId('canvas-node-audio-model-select'));
    fireEvent.click(screen.getByText('M2'));
    expect(dataOf().model).toBeUndefined();
  });

  it('readOnly :148 生成时 content 提交不落 store（enqueue 不在本批门内）', async () => {
    seedSession(true);
    const { container } = render(<AudioConfigPanel nodeId="a1" />);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'gen prompt' } }); // 本地 prompt
    const buttons = container.querySelectorAll('button');
    await act(async () => { fireEvent.click(buttons[buttons.length - 1]); });
    expect(dataOf().content).toBe(''); // 提交快照写被拒
    expect(mockEnqueueWorkflow).toHaveBeenCalledTimes(1); // 提交链路照常（入口置灰归 UI 批）
  });
});
