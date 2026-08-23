// apps/web/src/stores/canvasStore.groups.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { useGroupHistory } from './groupHistory';

const seedNodes = () => [
  { id: 'n1', type: 'imageGen', position: { x: 100, y: 100 }, width: 300, height: 200, data: {} },
  { id: 'n2', type: 'textInput', position: { x: 500, y: 50 }, width: 300, height: 300, data: {} },
  { id: 'free', type: 'imageGen', position: { x: 2000, y: 2000 }, width: 300, height: 200, data: {} },
];

beforeEach(() => {
  useCanvasStore.setState({ nodes: seedNodes() as any, edges: [], selectedId: null, projectId: null });
  useNodeStore.setState({ nodes: {} });
  useGroupHistory.setState({ past: [], future: [] });
});

// RF v12 updateChildNode 要求父节点在 nodes 数组中位于子节点之前（否则忽略 parentId）
const expectParentBeforeChild = (groupId: string, childId: string) => {
  const nodes = useCanvasStore.getState().nodes;
  const gi = nodes.findIndex((n) => n.id === groupId);
  const ci = nodes.findIndex((n) => n.id === childId);
  expect(gi).toBeGreaterThanOrEqual(0);
  expect(ci).toBeGreaterThanOrEqual(0);
  expect(gi).toBeLessThan(ci);
};

describe('groupNodes', () => {
  it('创建组节点并挂靠子节点（相对坐标 + extent）', () => {
    const groupId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    const s = useCanvasStore.getState();
    const group = s.nodes.find((n) => n.id === groupId)!;
    expect(group.type).toBe('group');
    expect(group.data.groupType).toBe('normal');
    // 包围盒 = (80,30) ~ (820,370)（外扩20px）
    expect(group.position).toEqual({ x: 80, y: 30 });
    expect(group.width).toBe(740);
    expect(group.height).toBe(340);
    const child1 = s.nodes.find((n) => n.id === 'n1')!;
    expect(child1.parentId).toBe(groupId);
    expect(child1.extent).toBe('parent');
    expect(child1.position).toEqual({ x: 20, y: 70 }); // 相对组左上角
  });

  it('选中含 group 节点时抛错（禁止嵌套）', () => {
    const g1 = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    expect(() => useCanvasStore.getState().groupNodes(['free', g1])).toThrow(/嵌套/);
  });

  it('少于 2 个节点抛错', () => {
    expect(() => useCanvasStore.getState().groupNodes(['n1'])).toThrow(/至少/);
  });
});

describe('ungroup', () => {
  it('坐标转绝对、组节点删除', () => {
    const groupId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().ungroup(groupId);
    const s = useCanvasStore.getState();
    expect(s.nodes.find((n) => n.id === groupId)).toBeUndefined();
    const child1 = s.nodes.find((n) => n.id === 'n1')!;
    expect(child1.parentId).toBeUndefined();
    expect(child1.position).toEqual({ x: 100, y: 100 }); // 回到原始绝对坐标
  });

  it('分镜组解组：按 cells 网格重排，{0,0} 子节点不堆叠（spec 5.3 解组=转普通组布局+删组节点）', () => {
    // 手工播种分镜组（mergeStoryboard 在 Task 10 才实现）：子节点坐标 {0,0}（纯 DOM 宫格）
    useCanvasStore.setState({
      nodes: [
        { id: 'sg', type: 'group', position: { x: 500, y: 500 }, width: 642, height: 182, data: {
          groupType: 'storyboard', cells: ['c1', 'c2'],
          storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' },
        } },
        { id: 'c1', type: 'imageGen', parentId: 'sg', extent: 'parent', position: { x: 0, y: 0 }, width: 320, height: 180, data: { status: 'done', fileId: 'f1' } },
        { id: 'c2', type: 'imageGen', parentId: 'sg', extent: 'parent', position: { x: 0, y: 0 }, width: 320, height: 180, data: { status: 'done', fileId: 'f2' } },
      ] as any,
      edges: [], selectedId: null,
    });
    useCanvasStore.getState().ungroup('sg');
    const s = useCanvasStore.getState();
    expect(s.nodes.find((n) => n.id === 'sg')).toBeUndefined();
    const c1 = s.nodes.find((n) => n.id === 'c1')!;
    const c2 = s.nodes.find((n) => n.id === 'c2')!;
    expect(c1.position).toEqual({ x: 500, y: 500 }); // 组位置 + 网格相对坐标（第 1 列 = 0）
    expect(c2.position.x).toBe(500 + 320 + 40); // 第 2 列 = 组位置 + (320+40)
    expect(c2.position.y).toBe(500);
    expect(c1.parentId).toBeUndefined();
  });
});

describe('addToGroup / removeNodeFromGroup', () => {
  it('addToGroup 后子节点相对坐标正确、组框扩展', () => {
    const groupId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().addToGroup(groupId, 'free');
    const s = useCanvasStore.getState();
    const free = s.nodes.find((n) => n.id === 'free')!;
    expect(free.parentId).toBe(groupId);
    expect(free.position.x).toBe(2000 - 80); // 绝对 - 组左上角
    expect(s.nodes.find((n) => n.id === groupId)!.width).toBeGreaterThan(740); // 扩展
  });

  it('removeNodeFromGroup 坐标转绝对', () => {
    const groupId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().removeNodeFromGroup(groupId, 'n1');
    const s = useCanvasStore.getState();
    const n1 = s.nodes.find((n) => n.id === 'n1')!;
    expect(n1.parentId).toBeUndefined();
    expect(n1.position).toEqual({ x: 100, y: 100 });
  });
});

describe('父前子后不变式（RF updateChildNode 要求）', () => {
  it('groupNodes 后组在子节点前', () => {
    const groupId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    expectParentBeforeChild(groupId, 'n1');
    expectParentBeforeChild(groupId, 'n2');
  });

  it('mergeStoryboard 后组在子节点前', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'm1', type: 'imageGen', position: { x: 0, y: 0 }, width: 320, height: 180, data: { status: 'done', fileId: 'f1' } },
        { id: 'm2', type: 'imageGen', position: { x: 500, y: 0 }, width: 320, height: 180, data: { status: 'done', fileId: 'f2' } },
      ] as any,
    });
    const gid = useCanvasStore.getState().mergeStoryboard(['m1', 'm2']);
    expectParentBeforeChild(gid, 'm1');
    expectParentBeforeChild(gid, 'm2');
  });

  it('convertGroup(→storyboard) 后组在子节点前（乱序继承修复）', () => {
    // 播种乱序组：子在前父在后（历史数据/快照恢复可能出现的顺序）
    useCanvasStore.setState({
      nodes: [
        { id: 'c1', type: 'imageGen', parentId: 'g', extent: 'parent', position: { x: 0, y: 0 }, width: 320, height: 180, data: { status: 'done', fileId: 'f1' } },
        { id: 'c2', type: 'imageGen', parentId: 'g', extent: 'parent', position: { x: 340, y: 0 }, width: 320, height: 180, data: { status: 'done', fileId: 'f2' } },
        { id: 'g', type: 'group', position: { x: 100, y: 100 }, width: 700, height: 220, data: { groupType: 'normal' } },
      ] as any,
    });
    useCanvasStore.getState().convertGroup('g', 'storyboard');
    expectParentBeforeChild('g', 'c1');
    expectParentBeforeChild('g', 'c2');
  });

  it('addToGroup 后组在新子节点前', () => {
    const groupId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().addToGroup(groupId, 'free');
    expectParentBeforeChild(groupId, 'free');
  });

  it('dropIntoGroup 后组在新子节点前', () => {
    const groupId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().dropIntoGroup('free', groupId);
    expectParentBeforeChild(groupId, 'free');
  });

  it('undo→redo 打组后组在子节点前（applySnapshot 排序）', () => {
    const groupId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    // 模拟快照恢复顺序不定：手动打乱 store 顺序（子在前父在后）
    useCanvasStore.setState((s) => {
      const g = s.nodes.find((n) => n.id === groupId)!;
      const n1 = s.nodes.find((n) => n.id === 'n1')!;
      const rest = s.nodes.filter((n) => n.id !== groupId && n.id !== 'n1');
      return { nodes: [n1, g, ...rest] };
    });
    useGroupHistory.getState().undo();
    useGroupHistory.getState().redo();
    expectParentBeforeChild(groupId, 'n1');
    expectParentBeforeChild(groupId, 'n2');
  });
});
