// apps/web/src/stores/canvasStore.groups.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { GROUP_NODE_DATA_KEYS, GROUP_PADDING, GROUP_PADDING_TOP, DEFAULT_CHILD_SIZE, calcGroupBounds, calcStoryboardSize, shouldAutoRefit } from '@flowweb/shared';
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

  it('F18 补——折叠组（collapsed:true）转换后 collapsed 键删除（in 断言——残留会令 groupDerive 判 hidden，子节点静默隐藏）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 250,
        data: { groupType: 'normal', collapsed: true } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 20, y: 50 }, data: { status: 'done', fileId: 'f1' } },
    ] as any, edges: [] });
    useCanvasStore.getState().convertGroup('g1', 'storyboard');
    let d = (useCanvasStore.getState().nodes.find((n: any) => n.id === 'g1') as any).data;
    expect('collapsed' in d).toBe(false);
    useCanvasStore.getState().convertGroup('g1', 'normal');
    d = (useCanvasStore.getState().nodes.find((n: any) => n.id === 'g1') as any).data;
    expect('collapsed' in d).toBe(false);
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
      syncStoreToDoc(d, Origin.Server);             // 初态入 doc。plan 原文 LocalUser 会使初态事务入 undo 栈（undoStack=2+undo 恢复到空 doc）——两条断言双红，故初态用 Server（真实链路初态由 server 填充不入栈）
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

describe('F33——重算型守恒（左上落点才拉动 frame——右下恒绿是 v1 盲区）', () => {
  const seed = () => useCanvasStore.setState({
    nodes: [
      { id: 'g1', type: 'group', position: { x: 100, y: 100 }, width: 300, height: 250, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 20, y: 50 }, width: 100, height: 60, data: {} },
    ] as any, edges: [],
  });
  const absOf = (id: string) => {
    const n = useCanvasStore.getState().nodes.find((x) => x.id === id) as any;
    const p = n.parentId ? (useCanvasStore.getState().nodes.find((x) => x.id === n.parentId) as any).position : { x: 0, y: 0 };
    return { x: n.position.x + p.x, y: n.position.y + p.y };
  };

  it('addToGroup（新成员落左上 {10,10}）：既有成员绝对坐标不变 + 新成员落点=放置点', () => {
    seed();
    useCanvasStore.setState({ nodes: [...useCanvasStore.getState().nodes,
      { id: 'c2', type: 'imageGen', position: { x: 10, y: 10 }, width: 100, height: 60, data: {} }] as any });
    const before = absOf('c1');
    useCanvasStore.getState().addToGroup('g1', 'c2');
    const g = useCanvasStore.getState().nodes.find((n) => n.id === 'g1') as any;
    expect(g.position).toEqual({ x: 10 - GROUP_PADDING, y: 10 - GROUP_PADDING_TOP });
    expect(absOf('c1')).toEqual(before);
    expect(absOf('c2')).toEqual({ x: 10, y: 10 });
  });

  it('dropIntoGroup 同款（c3 落左上 {5,15}）', () => {
    seed();
    useCanvasStore.setState({ nodes: [...useCanvasStore.getState().nodes,
      { id: 'c3', type: 'imageGen', position: { x: 5, y: 15 }, width: 100, height: 60, data: {} }] as any });
    const before = absOf('c1');
    useCanvasStore.getState().dropIntoGroup('c3', 'g1');
    expect(absOf('c1')).toEqual(before);
    expect(absOf('c3')).toEqual({ x: 5, y: 15 });
  });

  it('守卫：已在组 no-op；跨组移动先摘除（旧组 refit）再入新组（现状红：rel 被当绝对坐标双重偏移）', () => {
    seed();
    const before = JSON.stringify(useCanvasStore.getState().nodes.map((n: any) => [n.id, n.parentId, n.position]));
    useCanvasStore.getState().addToGroup('g1', 'c1');   // 已在 g1
    expect(JSON.stringify(useCanvasStore.getState().nodes.map((n: any) => [n.id, n.parentId, n.position]))).toBe(before);

    // 跨组：c1 从 g1 移到 gA
    useCanvasStore.setState({ nodes: [
      ...(useCanvasStore.getState().nodes as any[]),
      { id: 'gA', type: 'group', position: { x: 500, y: 500 }, width: 300, height: 250, data: { groupType: 'normal' } },
    ] as any });
    const absBefore = absOf('c1');
    useCanvasStore.getState().addToGroup('gA', 'c1');
    expect(absOf('c1')).toEqual(absBefore);   // 绝对坐标不变（现状：rel 当绝对用——必红）
    // 源组 g1 失去唯一子 → 空组解组（对齐删除路径语义——v4）
    expect(useCanvasStore.getState().nodes.some((n: any) => n.id === 'g1')).toBe(false);
  });

  it('不 refit 组的反向断言（v5 夹具修正——v4 落点 (210,210) 的 rel=(10,10) 在 clamp 下界 (20,50) 内被夹、与"落点=放置点"断言互斥必红。按纪律二拆两条：本条只声明"框不变"，落点选框内 padding 区外使 clamp 不触发）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'gm', type: 'group', position: { x: 200, y: 200 }, width: 600, height: 400, data: { groupType: 'normal', manuallyResized: true } },
      { id: 'k1', type: 'imageGen', position: { x: 250, y: 300 }, width: 100, height: 60, data: {} },   // rel=(50,100)——界外不触发 clamp
    ] as any, edges: [] });
    const frameBefore = JSON.stringify(['gm', useCanvasStore.getState().nodes.find((n) => n.id === 'gm')?.position, (useCanvasStore.getState().nodes.find((n) => n.id === 'gm') as any).width, (useCanvasStore.getState().nodes.find((n) => n.id === 'gm') as any).height]);
    useCanvasStore.getState().addToGroup('gm', 'k1');
    const gm = useCanvasStore.getState().nodes.find((n) => n.id === 'gm') as any;
    expect(JSON.stringify(['gm', gm.position, gm.width, gm.height])).toBe(frameBefore);   // 框一字不改
    const k1 = useCanvasStore.getState().nodes.find((n) => n.id === 'k1') as any;
    expect(k1.parentId).toBe('gm');
    expect(k1.position).toEqual({ x: 50, y: 100 });   // 落点=放置点（rel=abs−组原点）
  });

  it('clamp 生效分支（v5 独立用例——只声明"被修正"：落点 rel 在 padding 界内 → 拉回 (GROUP_PADDING, GROUP_PADDING_TOP)，用户可见行为变更已登记 spec）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'gm', type: 'group', position: { x: 200, y: 200 }, width: 600, height: 400, data: { groupType: 'normal', manuallyResized: true } },
      { id: 'k2', type: 'imageGen', position: { x: 205, y: 205 }, width: 100, height: 60, data: {} },   // rel=(5,5)——界内
    ] as any, edges: [] });
    useCanvasStore.getState().addToGroup('gm', 'k2');
    const k2 = useCanvasStore.getState().nodes.find((n) => n.id === 'k2') as any;
    expect(k2.position).toEqual({ x: GROUP_PADDING, y: GROUP_PADDING_TOP });   // 夹回界
  });
});

describe('epsilon 守卫——浮点乒乓', () => {
  it('applyGroupFrame 对 1ULP 级差异 no-op（桥 isEqual 深比较不产生新 diff）', () => {
    // 夹具（v5 补全+修正）：组 g1(0,0) normal；子 c1 rel(100.3,200.7) 100×60（小数——整数恒绿是盲区）
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 250, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 100.3, y: 200.7 }, width: 100, height: 60, data: {} },
    ] as any, edges: [] });
    const pick = () => JSON.stringify(useCanvasStore.getState().nodes
      .filter((n: any) => ['g1', 'c1'].includes(n.id))
      .map((n: any) => [n.id, n.position, n.width, n.height]));
    useCanvasStore.getState().applyGroupFrame('g1');   // 第一次：归位到不变量态（守恒——c1 绝对坐标不变）
    const afterFirst = pick();
    const st1 = useCanvasStore.getState().nodes;
    const c1AbsAfterFirst = { x: (st1.find((n: any) => n.id === 'c1') as any).position.x + (st1.find((n: any) => n.id === 'g1') as any).position.x,
                              y: (st1.find((n: any) => n.id === 'c1') as any).position.y + (st1.find((n: any) => n.id === 'g1') as any).position.y };
    useCanvasStore.getState().applyGroupFrame('g1');   // 第二次：几何已满足不变量 → epsilon 内 no-op
    expect(pick()).toBe(afterFirst);   // 位位同（1ULP 抖动不产生新写——桥 isEqual 不见 diff，乒乓消失）
    const st2 = useCanvasStore.getState().nodes;
    expect({ x: (st2.find((n: any) => n.id === 'c1') as any).position.x + (st2.find((n: any) => n.id === 'g1') as any).position.x,
             y: (st2.find((n: any) => n.id === 'c1') as any).position.y + (st2.find((n: any) => n.id === 'g1') as any).position.y })
      .toEqual(c1AbsAfterFirst);   // 守恒锚（v6 补断言——首次 refit 前后子绝对坐标也应相等：100.3/200.7）
  });
});

describe('几何不变量（§4.8——每个重算型命令后 frame ≡ calcGroupBounds(childrenAbs) ∧ rel ≥ padding）', () => {
  const assertInvariant = () => {
    const nodes = useCanvasStore.getState().nodes as any[];
    for (const g of nodes.filter((n) => n.type === 'group' && shouldAutoRefit(n))) {
      const children = nodes.filter((n) => n.parentId === g.id);
      const abs = children.map((c) => ({ x: c.position.x + g.position.x, y: c.position.y + g.position.y,
        width: c.width ?? DEFAULT_CHILD_SIZE.width, height: c.height ?? DEFAULT_CHILD_SIZE.height }));
      expect({ x: g.position.x, y: g.position.y, width: g.width, height: g.height })
        .toEqual(calcGroupBounds(abs));   // 期望来自纯函数
      children.forEach((c) => {
        expect(c.position.x).toBeGreaterThanOrEqual(GROUP_PADDING);
        expect(c.position.y).toBeGreaterThanOrEqual(GROUP_PADDING_TOP);
      });
    }
  };
  const seedTwoNodes = () => useCanvasStore.setState({ nodes: [
    { id: 'a', type: 'imageGen', position: { x: 100, y: 150 }, width: 100, height: 60, data: {} },
    { id: 'b', type: 'imageGen', position: { x: 300, y: 260 }, width: 80, height: 90, data: {} },
  ] as any, edges: [] });

  it('groupNodes 后不变量成立', () => {
    seedTwoNodes();
    useCanvasStore.getState().groupNodes(['a', 'b']);
    assertInvariant();
  });
  it('addToGroup 后不变量成立', () => {
    seedTwoNodes();
    useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.setState({ nodes: [...useCanvasStore.getState().nodes,
      { id: 'c', type: 'imageGen', position: { x: 40, y: 60 }, width: 60, height: 40, data: {} }] as any });
    useCanvasStore.getState().addToGroup(useCanvasStore.getState().nodes.find((n: any) => n.type === 'group')!.id, 'c');
    assertInvariant();
  });
  it('dropIntoGroup 后不变量成立', () => {
    seedTwoNodes();
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.setState({ nodes: [...useCanvasStore.getState().nodes,
      { id: 'c', type: 'imageGen', position: { x: 40, y: 60 }, width: 60, height: 40, data: {} }] as any });
    useCanvasStore.getState().dropIntoGroup('c', gid);
    assertInvariant();
  });
  it('removeNodeFromGroup 后不变量成立', () => {
    seedTwoNodes();
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.getState().removeNodeFromGroup(gid, 'a');
    assertInvariant();
  });
  it('ungroup(normal) 后子绝对坐标还原（无组——不变量空集）', () => {
    seedTwoNodes();
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    const absBefore = { a: { x: 100, y: 150 }, b: { x: 300, y: 260 } };
    useCanvasStore.getState().ungroup(gid);
    const st = useCanvasStore.getState().nodes as any[];
    expect({ x: st.find((n) => n.id === 'a')!.position.x, y: st.find((n) => n.id === 'a')!.position.y }).toEqual(absBefore.a);
    expect({ x: st.find((n) => n.id === 'b')!.position.x, y: st.find((n) => n.id === 'b')!.position.y }).toEqual(absBefore.b);
  });
  it('convertGroup 两方向后不变量成立', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'a', type: 'imageGen', position: { x: 100, y: 150 }, width: 320, height: 180, data: { status: 'done', fileId: 'f1' } },
      { id: 'b', type: 'imageGen', position: { x: 300, y: 260 }, width: 320, height: 180, data: { status: 'done', fileId: 'f2' } },
    ] as any, edges: [] });
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.getState().convertGroup(gid, 'storyboard');
    const sg = useCanvasStore.getState().nodes.find((n: any) => n.id === gid) as any;
    expect(shouldAutoRefit(sg)).toBe(false);   // storyboard 不在重算域——下方 assertInvariant 断言空集的前提自证
    assertInvariant();
    useCanvasStore.getState().convertGroup(gid, 'normal');
    assertInvariant();
  });
});

describe('collapse→expand 往返（三分派——Task 18 2c）', () => {
  it('normal 组展开后 frame 恢复（纯函数期望——calcGroupBounds(子绝对)）', () => {
    const gId = useCanvasStore.getState().groupNodes(['n1', 'n2']);
    const st0 = useCanvasStore.getState();
    const g0 = st0.nodes.find((n) => n.id === gId)!;
    const abs = st0.nodes.filter((n) => n.parentId === gId).map((c) => ({
      x: c.position.x + g0.position.x, y: c.position.y + g0.position.y,
      width: c.width ?? DEFAULT_CHILD_SIZE.width, height: c.height ?? DEFAULT_CHILD_SIZE.height,
    }));
    const expectFrame = calcGroupBounds(abs);
    useCanvasStore.getState().toggleCollapse(gId);   // 折叠
    useCanvasStore.getState().toggleCollapse(gId);   // 展开
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gId)!;
    expect({ x: g.position.x, y: g.position.y, width: g.width, height: g.height }).toEqual(expectFrame);
  });

  it('storyboard 组展开 frame=配置尺寸（v6：配置是分镜框真理，不用 savedSize——现状红：旧重算按子 (0,0) 归位缩成 360×250）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'sg', type: 'group', position: { x: 500, y: 500 }, width: 300, height: 250, data: {
        groupType: 'storyboard', cells: ['c1', 'c2'],
        storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' },
      } },
      { id: 'c1', type: 'imageGen', parentId: 'sg', extent: 'parent', position: { x: 0, y: 0 }, width: 320, height: 180, data: { status: 'done', fileId: 'f1' } },
      { id: 'c2', type: 'imageGen', parentId: 'sg', extent: 'parent', position: { x: 0, y: 0 }, width: 320, height: 180, data: { status: 'done', fileId: 'f2' } },
    ] as any, edges: [] });
    const expectSize = calcStoryboardSize(1, 2, '16:9');
    useCanvasStore.getState().toggleCollapse('sg');   // 折叠
    expect((useCanvasStore.getState().nodes.find((n) => n.id === 'sg') as any).width).toBe(200);
    useCanvasStore.getState().toggleCollapse('sg');   // 展开
    const g = useCanvasStore.getState().nodes.find((n) => n.id === 'sg')!;
    expect(g.width).toBe(expectSize.width);
    expect(g.height).toBe(expectSize.height);
    expect(g.position).toEqual({ x: 500, y: 500 });   // 位置不动（三分派只写尺寸）
  });
});
