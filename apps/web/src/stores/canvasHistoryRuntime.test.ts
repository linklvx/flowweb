// apps/web/src/stores/canvasHistoryRuntime.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Node } from '@xyflow/react';

vi.mock('antd', () => ({ message: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/api/projectApi', () => ({ syncNodes: vi.fn(() => Promise.resolve()), syncEdges: vi.fn(() => Promise.resolve()) }));

import { syncNodes, syncEdges } from '@/api/projectApi';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { scheduleSync, withHistoryPaused, undoCanvas, redoCanvas } from './canvasHistoryRuntime';
import { reconcileNodeStore } from './canvasHistory';

const n = (over: Partial<Node> & { id: string }): Node => ({
  type: 'textInput', position: { x: 0, y: 0 }, data: {}, ...over,
} as Node);

describe('scheduleSync', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null, projectId: null, isHydrating: false, _isPointerInteraction: false, nodeProcessMap: {} });
    useCanvasStore.temporal.getState().clear();
    useNodeStore.setState({ nodes: {} });
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('projectId 为 null 时早退不发请求', async () => {
    useCanvasStore.setState({ projectId: null });
    await scheduleSync();
    expect(syncNodes).not.toHaveBeenCalled();
    expect(syncEdges).not.toHaveBeenCalled();
  });

  it('I-2：debounce 300ms 合并连发，payload 取最新状态', async () => {
    useCanvasStore.setState({ projectId: 'p1', nodes: [n({ id: 'a' })], edges: [] });
    useNodeStore.setState({ nodes: { a: { id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: { content: 'x' } as any } } });
    const p1 = scheduleSync();
    useCanvasStore.setState({ nodes: [n({ id: 'a', position: { x: 9, y: 9 } })], edges: [] });   // 连按时状态再变
    const p2 = scheduleSync();
    // 等待 debounce 窗口 + API 调用完成
    await new Promise(resolve => setTimeout(resolve, 500));
    // 不等待 p1/p2（它们会在内部 resolve），直接验证结果
    expect(syncNodes).toHaveBeenCalledTimes(1);                                                  // 合并为一次
    expect(syncNodes).toHaveBeenCalledWith('p1', [expect.objectContaining({ position: { x: 9, y: 9 }, data: { content: 'x' } })]);  // 最新位置 + nodeStore data 为准
    expect(syncEdges).toHaveBeenCalledWith('p1', []);
  });

  it('同步失败 toast 不抛出', async () => {
    (syncNodes as any).mockRejectedValueOnce(new Error('net'));
    useCanvasStore.setState({ projectId: 'p1', nodes: [n({ id: 'a' })], edges: [] });
    const p = scheduleSync();
    await new Promise(resolve => setTimeout(resolve, 500));
    // Promise 应该内部 resolve，即使 syncNodes 失败
    await expect(p).resolves.toBeUndefined();
  });

  it('五审 H-1：debounce 窗口内切换项目 → 旧 projectId 同步被丢弃', async () => {
    useCanvasStore.setState({ projectId: 'p1', nodes: [n({ id: 'a' })], edges: [] });
    const p = scheduleSync();
    useCanvasStore.setState({ projectId: 'p2' });                    // 300ms 内切换
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(syncNodes).not.toHaveBeenCalled();                        // 不用旧 pid 脏写
    expect(syncEdges).not.toHaveBeenCalled();
  });
});

describe('withHistoryPaused', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });
    useCanvasStore.temporal.getState().clear();
  });

  it('内的 set 不记录历史', () => {
    withHistoryPaused(() => {
      useCanvasStore.setState({ nodes: [] as any, edges: [] });
    });
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);
  });

  it('五审 H-2：嵌套调用——内层退出不提前恢复追踪，最外层退出才 resume', () => {
    withHistoryPaused(() => {
      withHistoryPaused(() => {
        useCanvasStore.setState({ nodes: [] as any, edges: [] });
      });
      // 内层 finally 不 resume——外层闭包内后续 set 仍不记录（布尔 pause 会被内层 resume 打穿）
      useCanvasStore.setState({ nodes: [{ id: 'b', type: 'textInput', position: { x: 1, y: 1 }, data: {} } as any], edges: [] });
    });
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);
    useCanvasStore.setState({ nodes: [] as any, edges: [] });          // 退出后恢复记录
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });

  it('异常时 finally resume（不卡记录能力）', () => {
    expect(() => withHistoryPaused(() => { throw new Error('x'); })).toThrow('x');
    useCanvasStore.setState({ nodes: [] as any, edges: [] });
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });
});

describe('undoCanvas / redoCanvas', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null, projectId: null, isHydrating: false, _isPointerInteraction: false, nodeProcessMap: {}, __nodeDataSnap: undefined, isApplyingHistory: false });
    useCanvasStore.temporal.getState().clear();
    useNodeStore.setState({ nodes: {} });
  });

  it('undo 恢复结构且 node 携带完整渲染字段（G1 验收14）', async () => {
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: { k: 1 }, style: { color: 'red' }, measured: { width: 300, height: 300 } } as any], edges: [] });
    useCanvasStore.setState({ nodes: [], edges: [] });
    await undoCanvas();
    const restored = useCanvasStore.getState().nodes[0];
    expect(restored.data).toEqual({ k: 1 });
    expect(restored.style).toEqual({ color: 'red' });
    expect(restored.measured).toEqual({ width: 300, height: 300 });
  });

  it('undo 删除 → nodeStore data 从快照回补（D2）', async () => {
    useNodeStore.setState({ nodes: { a: { id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '配置' } as any } } });
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });
    useCanvasStore.setState({ nodes: [], edges: [] });                       // 删除（set 前快照含 a 的 nodeStore data）
    useNodeStore.setState({ nodes: {} });                                     // 删除路径清 nodeStore
    await undoCanvas();
    expect((useNodeStore.getState().nodes.a?.data as any).content).toBe('配置');
  });

  it('undo 后 redo 恢复到撤销前结构', async () => {
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });
    useCanvasStore.setState({ nodes: [], edges: [] });
    await undoCanvas();
    expect(useCanvasStore.getState().nodes.length).toBe(1);
    await redoCanvas();
    expect(useCanvasStore.getState().nodes.length).toBe(0);
  });

  it('undo 后 __nodeDataSnap 已清除、isApplyingHistory 复位、栈移位', async () => {
    useCanvasStore.setState({ nodes: [], edges: [] });
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });
    const before = useCanvasStore.temporal.getState().pastStates.length;
    await undoCanvas();
    const s = useCanvasStore.getState();
    expect(s.__nodeDataSnap).toBeUndefined();
    expect(s.isApplyingHistory).toBe(false);
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(before - 1);
    expect(useCanvasStore.temporal.getState().futureStates.length).toBe(1);
  });

  it('空栈 no-op；isHydrating/_isPointerInteraction no-op', async () => {
    await expect(undoCanvas()).resolves.toBeUndefined();
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });
    useCanvasStore.setState({ _isPointerInteraction: true });
    await undoCanvas();
    expect(useCanvasStore.getState().nodes.length).toBe(1);
    useCanvasStore.setState({ _isPointerInteraction: false, isHydrating: true });
    await undoCanvas();
    expect(useCanvasStore.getState().nodes.length).toBe(1);
  });

  it('异常路径：执行链抛错时 __nodeDataSnap 清理且标志复位，不抛出（S9 catch）', async () => {
    const orig = useCanvasStore.getState().applyGroupDerivations;
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });
    useCanvasStore.setState({ nodes: [], edges: [] });
    (useCanvasStore.getState() as any).applyGroupDerivations = () => { throw new Error('boom'); };
    await expect(undoCanvas()).resolves.toBeUndefined();
    expect(useCanvasStore.getState().__nodeDataSnap).toBeUndefined();
    expect(useCanvasStore.getState().isApplyingHistory).toBe(false);
    (useCanvasStore.getState() as any).applyGroupDerivations = orig;
  });

  it('S-1：undo 撤销创建时取消该节点的活跃进程（防完成回调幽灵复活）', async () => {
    const abort = vi.fn();
    // 模拟创建节点的历史：先添加节点（生成历史状态），再撤销时触发 cancel
    useCanvasStore.setState({
      nodes: [{ id: 'a', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any],
      edges: [],
      nodeProcessMap: { a: { status: 'PROCESSING', progress: 50, abortController: { abort } } as any },
    });
    // 现在的 pastStates 有一个状态（包含 'a'），undo 会回到空状态
    await undoCanvas();
    expect(useCanvasStore.getState().nodeProcessMap.a).toBeUndefined();
    expect(abort).toHaveBeenCalled();
  });

  it('S-1：undo 不影响仍在结构中的节点进程', async () => {
    const abort = vi.fn();
    useCanvasStore.setState({
      nodes: [
        { id: 'a', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any,
        { id: 'b', type: 'textInput', position: { x: 9, y: 9 }, data: {} } as any
      ],
      edges: [],
      nodeProcessMap: { a: { status: 'PROCESSING', progress: 10, abortController: { abort } } as any },
    });
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });  // 删除 b
    await undoCanvas();
    expect(useCanvasStore.getState().nodeProcessMap.a).toBeDefined();
    expect(abort).not.toHaveBeenCalled();
  });
});
