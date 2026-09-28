// apps/web/src/stores/canvasStore.groups.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { GROUP_NODE_DATA_KEYS } from '@flowweb/shared';
import { Origin, attachUndoManager, detachUndoManager } from './canvasUndo';
import { syncStoreToDoc, applyDocToStore } from './canvasCollabRuntime';

const seedNodes = () => [
  { id: 'n1', type: 'imageGen', position: { x: 100, y: 100 }, width: 300, height: 200, data: {} },
  { id: 'n2', type: 'textInput', position: { x: 500, y: 50 }, width: 300, height: 300, data: {} },
  { id: 'free', type: 'imageGen', position: { x: 2000, y: 2000 }, width: 300, height: 200, data: {} },
];

beforeEach(() => {
  useCanvasStore.setState({ nodes: seedNodes() as any, edges: [], selectedId: null, projectId: null });
  useNodeStore.setState({ nodes: {} });
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
    // 包围盒 = (80,0) ~ (820,370)（上外扩 50px、左右下外扩 20px）
    expect(group.position).toEqual({ x: 80, y: 0 });
    expect(group.width).toBe(740);
    expect(group.height).toBe(370);
    const child1 = s.nodes.find((n) => n.id === 'n1')!;
    expect(child1.parentId).toBe(groupId);
    expect(child1.extent).toBe('parent');
    expect(child1.position).toEqual({ x: 20, y: 100 }); // 相对组左上角：100 - 0
    const child2 = s.nodes.find((n) => n.id === 'n2')!;
    expect(child2.position).toEqual({ x: 420, y: 50 });
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
});

describe('renameGroup / markManuallyResized（F42 镜像退役——组 data 所有权单一归 cs）', () => {
  it('groupNodes 创建不设初始 name（默认名由渲染层兜底「分组」，数量由徽标动态显示）', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gId);
    expect((g!.data as any).name).toBeUndefined();
  });

  it('renameGroup 写 cs（F42 镜像退役——ns 不再双写）', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().renameGroup(gId, '我的分组');
    expect((useCanvasStore.getState().nodes.find((n) => n.id === gId)!.data as any).name).toBe('我的分组');
  });

  it('renameGroup 空串/同名 no-op', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().renameGroup(gId, '');
    // '' 回退由渲染层做，store 层收到 '' 时存 '分组'
    expect((useCanvasStore.getState().nodes.find((n) => n.id === gId)!.data as any).name).toBe('分组');
    useCanvasStore.getState().renameGroup(gId, '分组');
    expect((useCanvasStore.getState().nodes.find((n) => n.id === gId)!.data as any).name).toBe('分组');
  });

  it('markManuallyResized 设标记（F42 镜像退役——只写 cs）', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    useCanvasStore.getState().markManuallyResized(gId);
    expect((useCanvasStore.getState().nodes.find((n) => n.id === gId)!.data as any).manuallyResized).toBe(true);
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

  it('convertGroup 增量 patch 清除 manuallyResized/savedSize，非空 name 跨转换保留（F18）', () => {
    // convertGroup normal→storyboard 需要图片节点，这里手工播种图片节点组
    useCanvasStore.setState({
      nodes: [
        { id: 'g1', type: 'group', position: { x: 100, y: 100 }, width: 340, height: 220, data: { groupType: 'normal', manuallyResized: true, savedSize: { width: 999, height: 888 }, name: '旧名' } },
        { id: 'img1', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 0, y: 0 }, width: 300, height: 180, data: { status: 'done', fileId: 'f1' } },
        { id: 'img2', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 0, y: 0 }, width: 300, height: 180, data: { status: 'done', fileId: 'f2' } },
      ] as any,
      edges: [], selectedId: null,
    });
    useCanvasStore.getState().convertGroup('g1', 'storyboard');
    let d = (useCanvasStore.getState().nodes.find((n) => n.id === 'g1')!.data as any);
    expect('manuallyResized' in d).toBe(false);
    expect('savedSize' in d).toBe(false);
    expect(d.name).toBe('旧名');   // F18：非空 name 保留（现状整块替换丢名——红）
    useCanvasStore.getState().convertGroup('g1', 'normal');
    d = (useCanvasStore.getState().nodes.find((n) => n.id === 'g1')!.data as any);
    expect('manuallyResized' in d).toBe(false);
    expect('savedSize' in d).toBe(false);
    expect('storyboard' in d).toBe(false);
    expect('cells' in d).toBe(false);
    expect(d.name).toBe('旧名');
  });
});

describe('组内边距保留区夹取（onNodesChange）', () => {
  // groupNodes(['n1','n2']) 后：group(80,0,740×370)；n1 rel(20,100) 300×200；n2 rel(420,50) 300×300
  const setupGroup = () => useCanvasStore.getState().groupNodes(['n1', 'n2']);

  it('顶排子节点 y<50 的 position 变更被夹回 50', () => {
    setupGroup();
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'n2', position: { x: 420, y: 10 }, dragging: true },
    ]);
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n2')!.position)
      .toEqual({ x: 420, y: 50 });
  });

  it('x<20 夹回 20；x 超出右边距夹回 组宽-20-子宽', () => {
    setupGroup();
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'n1', position: { x: 5, y: 100 } },
    ]);
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!.position.x).toBe(20);
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'n1', position: { x: 500, y: 100 } },
    ]);
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!.position.x).toBe(420);
  });

  it('y 超出下边距夹回 组高-20-子高', () => {
    setupGroup();
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'n1', position: { x: 20, y: 300 } },
    ]);
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!.position.y).toBe(150);
  });

  it('无父节点的 position 变更不受影响', () => {
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'free', position: { x: -999, y: -999 } },
    ]);
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'free')!.position)
      .toEqual({ x: -999, y: -999 });
  });

  it('分镜组子节点不受影响（groupType 门控）', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'sg', type: 'group', position: { x: 500, y: 500 }, width: 642, height: 182, data: {
          groupType: 'storyboard', cells: ['c1'],
          storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' },
        } },
        { id: 'c1', type: 'imageGen', parentId: 'sg', extent: 'parent', position: { x: 0, y: 0 }, width: 320, height: 180, data: {} },
      ] as any,
      edges: [], selectedId: null,
    });
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'c1', position: { x: -999, y: -999 } },
    ]);
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'c1')!.position)
      .toEqual({ x: -999, y: -999 });
  });

  it('子节点 dimensions 变更（setAttributes）触发即时夹取', () => {
    setupGroup();
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'n1', position: { x: 420, y: 100 } },
    ]);
    useCanvasStore.getState().onNodesChange([
      { type: 'dimensions', id: 'n1', dimensions: { width: 500, height: 100 }, setAttributes: true } as any,
    ]);
    const n1 = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!;
    expect(n1.width).toBe(500);
    expect(n1.position.x).toBe(220); // 740-20-500
    expect(n1.position.y).toBe(100); // yMax=370-20-100=250 > 100，不动
  });

  it('select-only 与无 position 字段的变更不夹取', () => {
    setupGroup();
    useCanvasStore.getState().onNodesChange([
      { type: 'select', id: 'n1', selected: true },
      { type: 'position', id: 'n1', dragging: false } as any,
    ]);
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!.position)
      .toEqual({ x: 20, y: 100 });
  });
});

describe('patchGroupData（undefined=delete，只写 cs——所有权单一）', () => {
  it('undefined 值删除键（in 断言——spread+undefined 不删键是 P0-2 同源坑）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal', name: 'A', color: 'red' } },
    ] as any, edges: [] });
    useCanvasStore.getState().patchGroupData('g1', { color: undefined });
    const g = (useCanvasStore.getState().nodes[0] as any).data;
    expect('color' in g).toBe(false);
    expect(g.name).toBe('A');
  });

  it('F18——convertGroup 增量 patch：normal→storyboard 保 name/color + savedSize/manuallyResized 删除（in 断言）+ storyboard 注入', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 250,
        data: { groupType: 'normal', name: '我的组', color: 'red', manuallyResized: true, savedSize: { width: 300, height: 250 } } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 20, y: 50 }, data: { status: 'done', fileId: 'f1' } },
    ] as any, edges: [] });
    useCanvasStore.getState().convertGroup('g1', 'storyboard');
    const d = (useCanvasStore.getState().nodes.find((n) => n.id === 'g1') as any).data;
    expect(d.name).toBe('我的组');
    expect(d.color).toBe('red');
    expect('savedSize' in d).toBe(false);
    expect('manuallyResized' in d).toBe(false);
    expect('storyboard' in d).toBe(true);
  });

  it('组 data 键 ⊆ GROUP_NODE_DATA_KEYS（合并不发明新键——9 键白名单门禁）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 },
        data: { groupType: 'normal', name: 'A', color: 'red', nameCustom: true, manuallyResized: true, savedSize: { width: 1, height: 1 } } },
    ] as any, edges: [] });
    useCanvasStore.getState().patchGroupData('g1', { collapsed: false, cells: [] });
    const d = (useCanvasStore.getState().nodes[0] as any).data;
    expect(Object.keys(d).every((k) => (GROUP_NODE_DATA_KEYS as readonly string[]).includes(k))).toBe(true);
  });

  it('patch collapsed:true → applyGroupDerivations → 子节点 hidden===true（derivations 配对契约——patch 不内嵌派生，调用方负责）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 10, y: 10 }, data: {} },
    ] as any, edges: [] });
    useCanvasStore.getState().patchGroupData('g1', { collapsed: true });
    useCanvasStore.getState().applyGroupDerivations();
    expect((useCanvasStore.getState().nodes.find((n) => n.id === 'c1') as any).hidden).toBe(true);
  });

  it('undo 语义：patchGroupData 入栈+500ms 合并+undo 恢复旧 data', async () => {
    const d = new Y.Doc();
    const um = attachUndoManager(d);
    try {
      const groupFixture = (id: string, data: Record<string, unknown>) => ({
        id, type: 'group', position: { x: 0, y: 0 }, width: 300, height: 200,
        data: { groupType: 'normal', ...data },
      });
      useCanvasStore.setState({ nodes: [groupFixture('g1', { name: 'A' })] as any, edges: [] });
      syncStoreToDoc(d, Origin.Server);             // 初态入 doc（真实链路 server 填充——非 tracked origin 不入 undo 栈）
      useCanvasStore.getState().patchGroupData('g1', { name: 'B' });
      useCanvasStore.getState().patchGroupData('g1', { name: 'C' });
      syncStoreToDoc(d, Origin.LocalUser);          // 两次 patch 同批（<500ms）→ captureTimeout 合并为 1 项
      expect(um.undoStack.length).toBe(1);
      um.undo();
      applyDocToStore(d);                           // 显式读回（替代跑不动的 onRemote——Task 10 形参化测试缝）
      const g = (useCanvasStore.getState().nodes.find((n: any) => n.id === 'g1') as any).data;
      expect(g.name).toBe('A');                     // undo 恢复旧值
    } finally {
      detachUndoManager();
    }
  });
});

describe('cells 修复（第 7 写者——键盘 Delete 路径）', () => {
  it('onNodesChange remove 分镜组子节点 → cells 同步清死 id（现状红：removes 段无组清理）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', cells: ['c1', 'c2'] } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, data: {} },
      { id: 'c2', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, data: {} },
    ] as any, edges: [] });
    useCanvasStore.getState().onNodesChange([{ id: 'c1', type: 'remove' } as any]);
    const cells = ((useCanvasStore.getState().nodes.find((n) => n.id === 'g1') as any).data).cells;
    expect(cells.includes('c1')).toBe(false);   // 现状：cells 仍含 'c1'——必红
  });

  it('删组=级联删子（v6 改裁决——现状红：deleteNode 只处理被删节点的父组，被删节点是组 → 子节点 parentId 悬空。修=级联，对齐菜单 GroupContextMenu 先删子再删组的既有语义）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 100, y: 100 }, width: 300, height: 250, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 20, y: 50 }, data: {} },
      { id: 'top', type: 'imageGen', position: { x: 500, y: 500 }, data: {} },
    ] as any, edges: [] });
    useCanvasStore.getState().deleteNode('g1');
    const st = useCanvasStore.getState().nodes;
    expect(st.some((n: any) => n.id === 'g1')).toBe(false);   // 组删
    expect(st.some((n: any) => n.id === 'c1')).toBe(false);   // 子级联删（无悬空）
    expect(st.some((n: any) => n.id === 'top')).toBe(true);   // 无关节点不动
  });

  it('removeNodeFromGroup 移出最后子 → normal 空组解组（v5 C2——现状红：留空框；v6 组原点非零 (100,100)——原点为 0 时 rel==abs 无判别力）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 100, y: 100 }, width: 300, height: 250, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 20, y: 50 }, data: {} },
    ] as any, edges: [] });
    useCanvasStore.getState().removeNodeFromGroup('g1', 'c1');
    expect(useCanvasStore.getState().nodes.some((n: any) => n.id === 'g1')).toBe(false);
    expect((useCanvasStore.getState().nodes.find((n) => n.id === 'c1') as any).position).toEqual({ x: 120, y: 150 });   // 绝对还原（rel+组原点）
  });
});
