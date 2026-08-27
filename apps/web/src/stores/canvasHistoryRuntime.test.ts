// apps/web/src/stores/canvasHistoryRuntime.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Node } from '@xyflow/react';

vi.mock('antd', () => ({ message: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/api/projectApi', () => ({ syncCanvas: vi.fn(() => Promise.resolve({ version: 99 })) }));

import { message } from 'antd';
import { syncCanvas } from '@/api/projectApi';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { withHistoryPaused, undoCanvas, redoCanvas, beginDragTransaction, endDragTransaction, withHistoryTransaction, hydrateLoaded } from './canvasHistoryRuntime';
import { reconcileNodeStore, structuralEquality, HISTORY_LIMIT } from './canvasHistory';

const n = (over: Partial<Node> & { id: string }): Node => ({
  type: 'textInput', position: { x: 0, y: 0 }, data: {}, ...over,
} as Node);

const syncCanvasMock = vi.mocked(syncCanvas);


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

describe('拖动/resize 事务（D1.1）', () => {
  const nodeA = () => ({ id: 'a', type: 'textInput' as const, position: { x: 0, y: 0 }, data: {} });

  beforeEach(() => {
    useCanvasStore.setState({ nodes: [nodeA()] as any, edges: [], _isPointerInteraction: false, isHydrating: false, projectId: null, selectedId: null, nodeProcessMap: {} });
    useCanvasStore.temporal.getState().clear();   // 节点已在，历史清零（M4 基线；projectId:null 防残留 pending timer）
  });

  it('pause 期间 set 不记录；endDrag 后恰好一条（拖动前快照，无 dragging）', () => {
    beginDragTransaction();
    useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 50, y: 50 } } as any], edges: [] });
    useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 99, y: 99 } } as any], edges: [] });
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);   // pause 中不记录
    endDragTransaction();
    const past = useCanvasStore.temporal.getState().pastStates;
    expect(past.length).toBe(1);                                            // 恰好一条
    expect((past as any)[0].nodes[0].position).toEqual({ x: 0, y: 0 });              // 拖动前
    expect((past as any)[0].nodes[0].dragging).toBeFalsy();
  });

  it('endDrag push 使 futureStates 清空', async () => {
    useCanvasStore.setState({ nodes: [] as any, edges: [] });
    await undoCanvas();
    expect(useCanvasStore.temporal.getState().futureStates.length).toBe(1);
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.setState({ nodes: [nodeA()] as any, edges: [] });        // 基线
    beginDragTransaction();
    useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 5, y: 5 } } as any], edges: [] });
    endDragTransaction();
    expect(useCanvasStore.temporal.getState().futureStates.length).toBe(0); // 新操作清 future
  });

  it('F2：手动 push 同步 limit 截断', () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      beginDragTransaction();
      useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: i, y: 0 } } as any], edges: [] });
      endDragTransaction();
    }
    expect(useCanvasStore.temporal.getState().pastStates.length).toBeLessThanOrEqual(HISTORY_LIMIT);
  });

  it('_isPointerInteraction 事务内为 true，结束复位；endDragTransaction 幂等（M-4 兜底可安全重入）', () => {
    beginDragTransaction();
    expect(useCanvasStore.getState()._isPointerInteraction).toBe(true);
    endDragTransaction();
    expect(useCanvasStore.getState()._isPointerInteraction).toBe(false);
    expect(() => endDragTransaction()).not.toThrow();   // 未 begin 时直调（卸载兜底路径）
  });

  it('B-1：空拖动（无 set / 结构未变 / snapToGrid 回原位）不产生幽灵历史', () => {
    beginDragTransaction();
    endDragTransaction();                                              // 完全无 set（mousedown 即 mouseup）
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);
    beginDragTransaction();
    useCanvasStore.setState({ nodes: [nodeA()] as any, edges: [] });   // set 了但结构与快照相同（回原位）
    endDragTransaction();
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);
  });

  it('B-1：withHistoryTransaction 内无结构变化不 push', () => {
    withHistoryTransaction(() => {
      useCanvasStore.setState({ selectedId: 'x' });                    // 非 partialize 字段
    });
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);
  });

  it('五审 C-1 回归：拖动中 TD-Pos 写 nodeStore（新引用）→ endDrag 后仍恰好 1 条且首次 undo 即回原位', async () => {
    useNodeStore.setState({ nodes: { a: { id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} as any } } });
    beginDragTransaction();
    useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 99, y: 99 } } as any], edges: [] });
    // 模拟 TD-Pos（canvasStore.ts:544-561）：拖动中把新 position 写进 nodeStore 新引用
    useNodeStore.setState({ nodes: { a: { id: 'a', type: 'textInput', position: { x: 99, y: 99 }, data: {} as any } } });
    endDragTransaction();
    const past = useCanvasStore.temporal.getState().pastStates;
    expect(past.length).toBe(1);                                        // 旧顺序（resume→push→复位）此处为 2：复位 set 的 pre(旧snap)/post(catch-up新snap) 不等被 zundo 记录
    await undoCanvas();
    expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 0, y: 0 });   // 首次 undo 即回原位
  });

  it('五审 M-1：同一手势重复 beginDragTransaction 不覆盖首个快照', () => {
    beginDragTransaction();
    useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 5, y: 5 } } as any], edges: [] });
    beginDragTransaction();                                             // RF 边缘场景重复触发 Start
    useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 9, y: 9 } } as any], edges: [] });
    endDragTransaction();
    const past = useCanvasStore.temporal.getState().pastStates;
    expect(past.length).toBe(1);
    expect((past as any)[0].nodes[0].position).toEqual({ x: 0, y: 0 });          // 首个拖动前快照，非 x:5
  });

  it('M-4 时序：RF dragStart 前节点已 dragging:true → 快照被 sanitize 为 false', () => {
    useCanvasStore.setState({ nodes: [{ ...nodeA(), dragging: true } as any], edges: [] });
    useCanvasStore.temporal.getState().clear();                         // 该 set 结构未变，无历史
    beginDragTransaction();
    useCanvasStore.setState({ nodes: [{ ...nodeA(), dragging: true, position: { x: 7, y: 7 } } as any], edges: [] });
    endDragTransaction();
    const past = useCanvasStore.temporal.getState().pastStates;
    expect(past.length).toBe(1);
    expect((past as any)[0].nodes[0].dragging).toBeFalsy();
    expect((past as any)[0].nodes[0].position).toEqual({ x: 0, y: 0 });          // 拖动前
  });

  it('withHistoryTransaction：同步多 set 压成一条历史（Task 9 组操作复用）', () => {
    withHistoryTransaction(() => {
      useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 1, y: 1 } } as any], edges: [] });
      useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 2, y: 2 } } as any], edges: [] });
      useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 3, y: 3 } } as any], edges: [] });
    });
    const past = useCanvasStore.temporal.getState().pastStates;
    expect(past.length).toBe(1);
    expect((past as any)[0].nodes[0].position).toEqual({ x: 0, y: 0 });              // 操作前快照
    expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 3, y: 3 });
  });

  it('withHistoryTransaction：嵌套直通——外层统一 1 条历史（handleDelete N+1 循环用）', () => {
    withHistoryTransaction(() => {
      useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 1, y: 1 } } as any], edges: [] });
      withHistoryTransaction(() => {
        useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 2, y: 2 } } as any], edges: [] });
      });
      expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0); // 外层仍 pause 中
    });
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });

  it('withHistoryTransaction：fn 抛错也 push 且 resume（不卡 pause）', () => {
    expect(() => withHistoryTransaction(() => {
      useCanvasStore.setState({ nodes: [{ ...nodeA(), position: { x: 9, y: 9 } } as any], edges: [] });
      throw new Error('x');
    })).toThrow('x');
    useCanvasStore.setState({ nodes: [nodeA()] as any, edges: [] });        // resume 后恢复记录
    expect(useCanvasStore.temporal.getState().pastStates.length).toBeGreaterThan(0);
  });
});

describe('hydrateLoaded', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });
    useCanvasStore.temporal.getState().clear();
  });

  it('清空 past/future（防 undo 到上一个项目）', () => {
    useCanvasStore.setState({ nodes: [] as any, edges: [] });   // 产生 1 条历史
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
    hydrateLoaded();
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);
    expect(useCanvasStore.temporal.getState().futureStates.length).toBe(0);
  });
});

describe('B-2：删除路径采样契约（先 set 后清 nodeStore）', () => {
  const seedNode = (id: string) => {
    useCanvasStore.setState({
      nodes: [{ id, type: 'textGen', position: { x: 1, y: 2 }, data: {} } as any],
      edges: [],
      selectedId: null, projectId: null, nodeProcessMap: {},
    });
    useNodeStore.setState({
      nodes: { [id]: { id, type: 'textGen', position: { x: 1, y: 2 }, data: { prompt: '完整配置', extConfig: { model: 'x' } } as any } },
    });
    useCanvasStore.temporal.getState().clear();
  };

  it('undo 真实 deleteNode → nodeStore data 完整恢复', async () => {
    seedNode('a');
    useCanvasStore.getState().deleteNode('a');
    expect(useNodeStore.getState().nodes.a).toBeUndefined();   // 删除路径已清理
    expect(useCanvasStore.getState().nodes.length).toBe(0);
    await undoCanvas();
    expect(useCanvasStore.getState().nodes.some((nd) => nd.id === 'a')).toBe(true);
    expect((useNodeStore.getState().nodes.a?.data as any).prompt).toBe('完整配置');
    expect((useNodeStore.getState().nodes.a?.data as any).extConfig).toEqual({ model: 'x' });
  });

  it('undo 真实 deleteTransformNode → data 完整恢复', async () => {
    seedNode('t1');
    useCanvasStore.getState().deleteTransformNode!('t1');
    expect(useNodeStore.getState().nodes.t1).toBeUndefined();
    await undoCanvas();
    expect((useNodeStore.getState().nodes.t1?.data as any).prompt).toBe('完整配置');
  });
});

describe('D5 不可变纪律守护', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [] as any, edges: [], selectedId: null, projectId: null, isHydrating: false, _isPointerInteraction: false });
    useCanvasStore.temporal.getState().clear();
    useNodeStore.setState({ nodes: {} });
  });
  it('后续 set 不污染 pastStates 中的旧快照节点', () => {
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, data: { v: 1 } } as any], edges: [] });
    useCanvasStore.setState({ nodes: [{ id: 'a', type: 'textInput', position: { x: 5, y: 5 }, data: { v: 1 } } as any], edges: [] });
    const snap = useCanvasStore.temporal.getState().pastStates.at(-1)!;   // 尾条 = 上一次 set 前状态
    expect(snap.nodes![0].position).toEqual({ x: 0, y: 0 });
    expect(snap.nodes![0].data).toEqual({ v: 1 });
  });

  it('连续 5 次 undo 再 5 次 redo 结构一致（验收 11，S3：多节点累积）', async () => {
    useCanvasStore.temporal.getState().clear();
    const nodes: any[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      nodes.push(n({ id }));
      useCanvasStore.setState({ nodes: [...nodes], edges: [] });   // 累积，非替换
    }
    const finalIds = useCanvasStore.getState().nodes.map((nd) => nd.id).join(',');
    for (let i = 0; i < 5; i++) await undoCanvas();
    expect(useCanvasStore.getState().nodes.length).toBe(0);
    for (let i = 0; i < 5; i++) await redoCanvas();
    expect(useCanvasStore.getState().nodes.map((nd) => nd.id).join(',')).toBe(finalIds);
  });

  it('undo 后 canvasStore 结构与 nodeStore 键集合一致（验收 13，无幽灵/缺失）', async () => {
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.setState({ nodes: [n({ id: 'a' })], edges: [] });
    useCanvasStore.setState({ nodes: [], edges: [] });
    await undoCanvas();
    const csIds = new Set(useCanvasStore.getState().nodes.map((nd) => nd.id));
    const nsIds = new Set(Object.keys(useNodeStore.getState().nodes));
    expect([...csIds].every((id) => nsIds.has(id))).toBe(true);
  });

  it('五审 C-2 语义守护：非 partialize 字段 set 不产生历史（zundo per-set equality 基线，防升级变语义）', () => {
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.setState({ nodes: [n({ id: 'a' })], edges: [] });   // 1 条
    useCanvasStore.setState({ selectedId: 'a' });                      // 非 partialize 字段
    useCanvasStore.setState({ viewport: { x: 10, y: 10, zoom: 1 } });  // 非 partialize 字段
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(1);
  });
});

describe('S-2：组派生不产生多余历史（一致态守卫）', () => {
  it('父子一致态下 applyGroupDerivations 不产生历史', () => {
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null, projectId: null });
    useCanvasStore.temporal.getState().clear();
    useNodeStore.setState({ nodes: {} });
    // 构造一致态组：groupNodes 后 derivations 已在 action 内跑过，此态为一致态
    useCanvasStore.setState((s) => ({
      nodes: [
        { id: 'g', type: 'group', position: { x: 0, y: 0 }, width: 600, height: 400, data: { groupType: 'normal' } } as any,
        { id: 'c', type: 'text', position: { x: 10, y: 10 }, parentId: 'g', extent: 'parent', data: {} } as any,
      ],
    }));
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().applyGroupDerivations();
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(0);
  });
});
