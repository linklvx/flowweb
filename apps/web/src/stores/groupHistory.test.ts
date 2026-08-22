import { describe, it, expect, beforeEach } from 'vitest';
import { useGroupHistory } from './groupHistory';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';

beforeEach(() => {
  useGroupHistory.getState().clear();
  useCanvasStore.setState({ nodes: [], edges: [], selectedId: null });
});

describe('groupHistory 快照往返', () => {
  it('undo/redo 打组操作：状态完全还原', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} },
        { id: 'n2', type: 'imageGen', position: { x: 500, y: 0 }, data: {} },
      ] as any, edges: [] as any,
    });
    const gid = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    expect(useGroupHistory.getState().canUndo()).toBe(true); // action 自动注册撤销项（集成点）
    expect(useCanvasStore.getState().nodes).toHaveLength(3); // 组+2子

    useGroupHistory.getState().undo();
    let s = useCanvasStore.getState();
    expect(s.nodes).toHaveLength(2); // 组消失
    expect(s.nodes.find((n) => n.id === 'n1')!.parentId).toBeUndefined();
    expect(s.nodes.find((n) => n.id === 'n1')!.position).toEqual({ x: 0, y: 0 }); // 绝对坐标还原

    useGroupHistory.getState().redo();
    s = useCanvasStore.getState();
    expect(s.nodes.find((n) => n.id === gid)).toBeTruthy();
    expect(s.nodes.find((n) => n.id === 'n1')!.parentId).toBe(gid);
  });

  it('tombstone：undo 新增对象（组节点）时从 store 删除', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} },
        { id: 'n2', type: 'imageGen', position: { x: 500, y: 0 }, data: {} },
      ] as any, edges: [] as any,
    });
    const gid = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useGroupHistory.getState().undo();
    expect(useCanvasStore.getState().nodes.find((n) => n.id === gid)).toBeUndefined();
  });

  it('新操作清空 future', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} },
        { id: 'n2', type: 'imageGen', position: { x: 500, y: 0 }, data: {} },
        { id: 'n3', type: 'imageGen', position: { x: 1000, y: 0 }, data: {} },
      ] as any, edges: [] as any,
    });
    useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useGroupHistory.getState().undo();
    useCanvasStore.getState().groupNodes(['n1', 'n3']); // 新操作
    expect(useGroupHistory.getState().canRedo()).toBe(false);
  });

  it('栈上限 50 条', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} },
        { id: 'n2', type: 'imageGen', position: { x: 500, y: 0 }, data: {} },
      ] as any, edges: [] as any,
    });
    for (let i = 0; i < 55; i++) {
      useGroupHistory.getState().record({
        label: `op${i}`, nodeIds: [], edgeIds: [],
        before: { nodes: [], edges: [] }, after: { nodes: [], edges: [] },
      });
    }
    expect(useGroupHistory.getState().pastLength()).toBe(50);
  });
});

describe('undo/redo 与 nodeStore 双写 + 执行中禁令', () => {
  const seed = (ids: string[]) => useCanvasStore.setState({
    nodes: ids.map((id) => ({ id, type: 'imageGen', position: { x: 0, y: 0 }, width: 320, height: 180,
      data: { status: 'done', fileId: `f-${id}` } } as any)),
    edges: [], selectedId: null,
  });

  it('undo 打组 → 组节点从 nodeStore 同步移除（P0-1 双写约定）', () => {
    seed(['a', 'b']);
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    expect(useNodeStore.getState().nodes[gid]).toBeTruthy(); // groupNodes 双写
    useGroupHistory.getState().undo();
    expect(useCanvasStore.getState().nodes.find((x) => x.id === gid)).toBeUndefined();
    expect(useNodeStore.getState().nodes[gid]).toBeUndefined(); // applySnapshot 同步删除
  });

  it('受影响节点执行中 → undo 阻止（P1-7）', () => {
    seed(['a', 'b']);
    useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.setState({
      nodeProcessMap: { a: { processType: 'generating', status: 'processing' } },
    } as any);
    useGroupHistory.getState().undo();
    expect(useCanvasStore.getState().nodes.filter((n) => n.type === 'group')).toHaveLength(1); // 未撤销
  });
});
