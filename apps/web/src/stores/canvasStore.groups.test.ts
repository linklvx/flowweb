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
    // 包围盒 = (80,30) ~ (820,370)（四周外扩20px，标题外浮容器外顶部无预留）
    expect(group.position).toEqual({ x: 80, y: 30 });
    expect(group.width).toBe(740);
    expect(group.height).toBe(340);
    const child1 = s.nodes.find((n) => n.id === 'n1')!;
    expect(child1.parentId).toBe(groupId);
    expect(child1.extent).toBe('parent');
    expect(child1.position).toEqual({ x: 20, y: 70 }); // 相对组左上角：100 - 30
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

describe('renameGroup / markManuallyResized / 组 data 双写 nodeStore', () => {
  it('groupNodes 创建不设初始 name（默认名由渲染层兜底「分组」，数量由徽标动态显示）', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gId);
    expect((g!.data as any).name).toBeUndefined();
  });

  it('renameGroup 更新 canvasStore data.name 并入组历史（可 Ctrl+Z）', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().renameGroup(gId, '我的分组');
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gId);
    expect((g!.data as any).name).toBe('我的分组');
    // nodeStore 双写（localStorage 快照数据源）
    const ns = useNodeStore.getState();
    expect((ns.nodes[gId].data as any).name).toBe('我的分组');
    // 历史：undo 恢复改名前（创建时无 name）
    expect(useGroupHistory.getState().canUndo()).toBe(true);
    useGroupHistory.getState().undo();
    expect((useCanvasStore.getState().nodes.find((n) => n.id === gId)!.data as any).name).toBeUndefined();
  });

  it('renameGroup 空串/同名 no-op 不产生历史', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    const before = useGroupHistory.getState().pastLength();
    useCanvasStore.getState().renameGroup(gId, '');
    // '' 回退由渲染层做，store 层收到 '' 时存 '分组'
    expect((useCanvasStore.getState().nodes.find((n) => n.id === gId)!.data as any).name).toBe('分组');
    useCanvasStore.getState().renameGroup(gId, '分组');
    expect(useGroupHistory.getState().pastLength()).toBe(before + 1); // 仅第一次生效
  });

  it('markManuallyResized 设标记并双写 nodeStore', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().markManuallyResized(gId);
    expect((useCanvasStore.getState().nodes.find((n) => n.id === gId)!.data as any).manuallyResized).toBe(true);
    const ns = useNodeStore.getState();
    expect((ns.nodes[gId].data as any).manuallyResized).toBe(true);
  });
});

describe('组尺寸持久化行为', () => {
  it('折叠保存 savedSize；无手动标记展开 refit 重算', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    const before = useCanvasStore.getState().nodes.find((n) => n.id === gId)!;
    const beforeWidth = before.width ?? 0;
    const beforeHeight = before.height ?? 0;
    useCanvasStore.getState().toggleCollapse(gId); // 折叠
    const collapsed = useCanvasStore.getState().nodes.find((n) => n.id === gId)!;
    expect((collapsed.data as any).collapsed).toBe(true);
    expect(collapsed.width).toBe(200);
    expect((collapsed.data as any).savedSize).toEqual({ width: beforeWidth, height: beforeHeight });
    useCanvasStore.getState().toggleCollapse(gId); // 展开 → refit
    const expanded = useCanvasStore.getState().nodes.find((n) => n.id === gId)!;
    expect((expanded.data as any).collapsed).toBe(false);
    expect(expanded.width).toBeGreaterThan(200);
  });

  it('manuallyResized 组展开恢复 savedSize（不 refit）', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().toggleCollapse(gId); // 折叠（savedSize 已存）
    useCanvasStore.getState().markManuallyResized(gId);
    // 模拟用户在折叠前手动 resize 过：直接改 savedSize 为自定义值
    useCanvasStore.setState({ nodes: useCanvasStore.getState().nodes.map((n) =>
      n.id === gId ? { ...n, data: { ...n.data, savedSize: { width: 777, height: 555 } } } : n) });
    useCanvasStore.getState().toggleCollapse(gId); // 展开
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gId)!;
    expect(g.width).toBe(777);
    expect(g.height).toBe(555);
  });

  it('convertGroup 清除 manuallyResized/savedSize，默认名「分组」', () => {
    // convertGroup normal→storyboard 需要图片节点，这里手工播种图片节点组
    useCanvasStore.setState({
      nodes: [
        { id: 'g1', type: 'group', position: { x: 100, y: 100 }, width: 340, height: 220, data: { groupType: 'normal', manuallyResized: true, savedSize: { width: 999, height: 888 }, name: '旧名' } },
        { id: 'img1', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 0, y: 0 }, width: 300, height: 180, data: { status: 'done', fileId: 'f1' } },
        { id: 'img2', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 0, y: 0 }, width: 300, height: 180, data: { status: 'done', fileId: 'f2' } },
      ] as any,
      edges: [], selectedId: null,
    });
    // 真实链路中 groupNodes 创建时会写 nodeStore——同步播种带旧标记的版本
    useNodeStore.setState({
      nodes: {
        g1: { id: 'g1', type: 'group', position: { x: 100, y: 100 }, data: { groupType: 'normal', manuallyResized: true, name: '旧名' } } as any,
      },
    });
    useCanvasStore.getState().convertGroup('g1', 'storyboard');
    useCanvasStore.getState().convertGroup('g1', 'normal');
    const g = useCanvasStore.getState().nodes.find((n) => n.id === 'g1')!;
    expect((g.data as any).manuallyResized).toBeUndefined();
    expect((g.data as any).savedSize).toBeUndefined();
    expect((g.data as any).name).toBe('分组');
    // nodeStore 同步清标记（终审发现：localStorage 快照数据源，残留会让恢复误跳过 refit）
    const nsG = useNodeStore.getState().nodes['g1'];
    expect((nsG?.data as any).manuallyResized).toBeUndefined();
    expect((nsG?.data as any).name).toBe('分组');
    expect((nsG?.data as any).groupType).toBe('normal');
  });
});
