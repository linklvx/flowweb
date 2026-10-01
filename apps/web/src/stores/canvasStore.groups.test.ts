// apps/web/src/stores/canvasStore.groups.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { message } from 'antd';
import { useCanvasStore } from './canvasStore';
import * as canvasStoreMod from './canvasStore';
import { useNodeStore } from './nodeStore';
import { GROUP_NODE_DATA_KEYS, GROUP_PADDING, GROUP_PADDING_TOP, DEFAULT_CHILD_SIZE, calcGroupBounds, calcStoryboardSize, shouldAutoRefit, sortForArrange, arrangeRects } from '@flowweb/shared';
import { Origin, attachUndoManager, detachUndoManager } from './canvasUndo';
import { applyDocToStore, checkProjectionInvariant } from './canvasCollabRuntime';
import { _setIntentDocForTest } from './canvasIntents';
import { fillDoc } from '@/collab/ydocBuilder';

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
    // 批4b-2：syncStoreToDoc 退役——patchGroupData 自 dispatch updateNodeData intent（初态 fillDoc
    // 直驱 origin=null 不入 undo 栈，等价旧 Origin.Server 初态不入栈的装置语义）
    _setIntentDocForTest(d);
    try {
      const groupFixture = (id: string, data: Record<string, unknown>) => ({
        id, type: 'group', position: { x: 0, y: 0 }, width: 300, height: 200,
        data: { groupType: 'normal', ...data },
      });
      fillDoc(d, [groupFixture('g1', { name: 'A' })] as any, []);   // 初态入 doc（server 填充形态——origin=null 不入栈）
      useCanvasStore.setState({ nodes: [groupFixture('g1', { name: 'A' })] as any, edges: [] });
      useCanvasStore.setState({ hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1' });
      useCanvasStore.getState().patchGroupData('g1', { name: 'B' });
      useCanvasStore.getState().patchGroupData('g1', { name: 'C' });
      expect(um.undoStack.length).toBe(1);          // 两次 patch 同批（<500ms）→ captureTimeout 合并为 1 项
      um.undo();
      applyDocToStore(d);                           // 显式读回（替代跑不动的 onRemote——Task 10 形参化测试缝）
      const g = (useCanvasStore.getState().nodes.find((n: any) => n.id === 'g1') as any).data;
      expect(g.name).toBe('A');                     // undo 恢复旧值
    } finally {
      _setIntentDocForTest(null);
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

describe('复制型几何例外（§4.8 登记——frame 继承源组±offset，不走重算）', () => {
  it('duplicateGroup 副本 frame=源 frame+offset；cells 重映射后无悬空旧 id（|| id 兜底改 ?? null）', () => {
    // v6 夹具修正：groupType 必须是 'storyboard'——buildGroupCopy 的 cells 重映射只在
    // isStoryboard 分支（normal 组 structuredClone 原样带过 cells → 断言必红且现状也红=判别力零；
    // 且 normal 组带 cells 本身是语义非法输入）
    // 2a-6 夹具修正：duplicateGroup=薄委托 duplicateNodes（runCommand canEdit 门 + resolveNodeData
    // ns 全量取数）——需 rw 会话电平 + ns c1 条目
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 100, y: 100 }, width: 300, height: 250,
        data: { groupType: 'storyboard', cells: ['c1', 'ghost'],
                storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' } } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, data: { status: 'done', fileId: 'f1' } },
    ] as any, edges: [], hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1' });
    useNodeStore.setState({ nodes: { c1: { id: 'c1', type: 'imageGen', data: { status: 'done', fileId: 'f1' } } } as any });
    useCanvasStore.getState().duplicateGroup('g1');
    const st = useCanvasStore.getState().nodes;
    const copy = st.find((n: any) => n.id !== 'g1' && n.type === 'group') as any;
    expect(copy.position).toEqual({ x: 140, y: 100 });
    expect(copy.width).toBe(300);
    expect(copy.data.cells.some((c: string | null) => c === 'c1')).toBe(false);
    expect(copy.data.cells.some((c: string | null) => c === 'ghost')).toBe(false);
    expect((copy.data.cells as (string | null)[]).filter((c) => c == null).length).toBeGreaterThan(0);
  });
});

// ════════ R2a-0：命令公共件 runCommand/resolveNodeData + hidden 写入侧不变量 ════════

describe('runCommand 公共件（2a-0）', () => {
  // 真装置（照 :393-418 既有先例）：真 Y.Doc + fillDoc + _setIntentDocForTest + attachUndoManager。
  // 禁止 vi.mock canvasIntents——mock 空投影会让 dispatchProjectionDiff 算 0 intents 后直接 return，
  // doc 写路径零验证、断言恒绿。
  const rigNodes = () => [
    { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 340, height: 240, data: { groupType: 'normal', name: 'A' } },
    { id: 'a', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 20, y: 50 }, width: 100, height: 60, data: {} },
    { id: 'b', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 140, y: 50 }, width: 100, height: 60, data: {} },
  ];
  const setupRig = () => {
    const d = new Y.Doc();
    const um = attachUndoManager(d);
    _setIntentDocForTest(d);
    fillDoc(d, rigNodes() as any, []);   // 初态 origin=null 不入撤销栈（server 填充形态）
    useCanvasStore.setState({ nodes: rigNodes() as any, edges: [], hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1' });
    return { d, um };
  };
  const teardownRig = () => {
    _setIntentDocForTest(null);
    detachUndoManager();
  };

  it('只读会话早退：canEdit=false 时 fn 不执行 + message.warning（先例 :387-390）', () => {
    useCanvasStore.setState({ hydration: 'ready', collabReadOnly: true, wsAuthNotice: null });   // 只读态注入
    const warnSpy = vi.spyOn(message, 'warning');
    const fn = vi.fn();
    try {
      useCanvasStore.getState().runCommand(fn);
      expect(fn).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith('当前为只读会话，操作已忽略');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('入口 stopCapturing + 单差分收尾：命令后 doc 与 store 投影等价（checkProjectionInvariant——canvasCollabRuntime.ts:250 既有安全网，每命令一条）', () => {
    const { d } = setupRig();
    try {
      useCanvasStore.getState().runCommand(() => {
        useCanvasStore.getState().patchGroupDataInner('g1', { name: 'B' });
      });
      expect((useCanvasStore.getState().nodes.find((n) => n.id === 'g1')!.data as any).name).toBe('B');   // 命令真写了（防 catch 吞错假绿）
      expect(checkProjectionInvariant(d)).toBe(true);
    } finally {
      teardownRig();
    }
  });

  it('单命令单 transact（v2.1）：fn 执行期间 doc 恰发生 1 次 transact（Y.Doc observer 计数——fn 内用 patchGroupDataInner 纯写，防"patchGroupData 自带 dispatch + 外层差分"双 transact 回潮）', () => {
    const { d } = setupRig();
    try {
      let transacts = 0;
      d.on('afterTransaction', () => { transacts++; });
      useCanvasStore.getState().runCommand(() => {
        useCanvasStore.getState().patchGroupDataInner('g1', { name: 'B' });
      });
      expect(transacts).toBe(1);
    } finally {
      teardownRig();
    }
  });

  it('异常边界（v2.1）：fn 中途抛错（resolveNodeData 缺节点）→ catch 提示 + finally 仍收尾 diff → checkProjectionInvariant 仍成立（store/doc 不分裂）', () => {
    const { d } = setupRig();
    const errSpy = vi.spyOn(message, 'error');
    try {
      expect(() => useCanvasStore.getState().runCommand(() => {
        useCanvasStore.getState().patchGroupDataInner('g1', { name: 'B' });   // 已写部分
        canvasStoreMod.resolveNodeData({ id: 'ghost', type: 'imageGen' } as any, useNodeStore.getState().nodes);   // 取不到即红
      })).not.toThrow();
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect((useCanvasStore.getState().nodes.find((n) => n.id === 'g1')!.data as any).name).toBe('B');   // 已写部分保留
      expect(checkProjectionInvariant(d)).toBe(true);   // finally 恒收尾 diff——doc≡store 不分裂
    } finally {
      errSpy.mockRestore();
      teardownRig();
    }
  });

  it('500ms 内连点两次 = 2 undo 项（真 attachUndoManager + um.undo()——照 :393-418 既有装置）', () => {
    const { d, um } = setupRig();
    try {
      useCanvasStore.getState().runCommand(() => { useCanvasStore.getState().patchGroupDataInner('g1', { name: 'B' }); });
      useCanvasStore.getState().runCommand(() => { useCanvasStore.getState().patchGroupDataInner('g1', { name: 'C' }); });
      expect(um.undoStack.length).toBe(2);   // stopCapturing 入口——captureTimeout 500ms 不合并
      um.undo();
      const g1m = d.getMap('nodes').get('g1') as Y.Map<any>;
      expect((g1m.get('data') as Y.Map<any>).get('name')).toBe('B');   // 第二命令独立成步——undo 回到中间态
    } finally {
      teardownRig();
    }
  });

  it('getId 跨端防碰撞（v2.1）：掺会话级随机成分后同毫秒两客户端 id 不等（createSessionSeed 纯缝=每客户端模块初始化恰调一次，两次调用=两个客户端）', () => {
    expect(canvasStoreMod.createSessionSeed()).not.toBe(canvasStoreMod.createSessionSeed());
  });
});

// ════════ R2a-5：arrangeSelection 写回（§4.3——runCommand+组原子块+detached 排除） ════════

describe('arrangeSelection（§4.3）', () => {
  // 真装置（照 runCommand 公共件 2a-0 骨架）：真 Y.Doc + fillDoc + _setIntentDocForTest + attachUndoManager。
  // 禁止 vi.mock canvasIntents/antd——toast 断言走仓内惯例 vi.spyOn(message, 'warning')（先例 :716）。
  const seed = (nodes: unknown[]) => {
    const d = new Y.Doc();
    const um = attachUndoManager(d);
    _setIntentDocForTest(d);
    fillDoc(d, nodes as any, []);   // 初态 origin=null 不入撤销栈（server 填充形态）
    useCanvasStore.setState({ nodes: nodes as any, edges: [], selectedId: null, hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1' });
    return { d, um };
  };
  const teardown = () => {
    _setIntentDocForTest(null);
    detachUndoManager();
  };
  const posOf = (id: string) => useCanvasStore.getState().nodes.find((n) => n.id === id)!.position;

  it('参与项 <2 → no-op（组内单节点 detached 不动）+ 参与项 0/1 分别提示', () => {
    seed([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 340, height: 240, data: { groupType: 'normal' } },
      { id: 'a', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 20, y: 50 }, width: 100, height: 60, data: {} },
      { id: 'r1', type: 'imageGen', position: { x: 500, y: 500 }, width: 100, height: 60, data: {} },
    ]);
    const warnSpy = vi.spyOn(message, 'warning');
    try {
      useCanvasStore.getState().arrangeSelection(['a'], 'grid');   // 唯一选中是组内节点 → detached 排除 → 0 参与项
      expect(warnSpy).toHaveBeenCalledWith('没有可排列的节点：所选节点均在未选中的组内');
      expect(posOf('a')).toEqual({ x: 20, y: 50 });                // detached 不动
      useCanvasStore.getState().arrangeSelection(['r1'], 'grid');  // 单散根 → 1 参与项
      expect(warnSpy).toHaveBeenCalledWith('没有可排列的节点');
      expect(posOf('r1')).toEqual({ x: 500, y: 500 });
      useCanvasStore.getState().arrangeSelection([], 'grid');      // 空选 → 0 参与项
      expect(warnSpy).toHaveBeenCalledWith('没有可排列的节点');
    } finally {
      warnSpy.mockRestore();
      teardown();
    }
  });

  it('detached 排除零位移 + excludedCount 计数提示（N 个组内节点未参与排列）', () => {
    seed([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 600, height: 400, data: { groupType: 'normal' } },
      { id: 'a', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 20, y: 50 }, width: 100, height: 60, data: {} },
      { id: 'b', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 200, y: 50 }, width: 100, height: 60, data: {} },
      { id: 'r1', type: 'imageGen', position: { x: 1000, y: 0 }, width: 100, height: 60, data: {} },
      { id: 'r2', type: 'imageGen', position: { x: 1300, y: 300 }, width: 100, height: 60, data: {} },
    ]);
    const warnSpy = vi.spyOn(message, 'warning');
    try {
      useCanvasStore.getState().arrangeSelection(['r1', 'r2', 'a', 'b'], 'grid');
      expect(warnSpy).toHaveBeenCalledWith('2 个组内节点未参与排列（需调整请先选中其所在组）');
      expect(posOf('a')).toEqual({ x: 20, y: 50 });   // detached 零位移
      expect(posOf('b')).toEqual({ x: 200, y: 50 });
      // r1/r2 真重排（期望来自纯函数——与「几何不变量」describe 的 calcGroupBounds 惯例同源）
      const items = sortForArrange([
        { id: 'r1', x: 1000, y: 0, width: 100, height: 60 },
        { id: 'r2', x: 1300, y: 300, width: 100, height: 60 },
      ]);
      const laid = arrangeRects(items.map(({ id, ...r }) => r), 'grid');
      items.forEach((it, i) => expect(posOf(it.id)).toEqual({ x: laid[i].x, y: laid[i].y }));
    } finally {
      warnSpy.mockRestore();
      teardown();
    }
  });

  it('两个散根 grid：真重排 + parentId 逐节点不变（反向断言）+ 保持原选区 + checkProjectionInvariant', () => {
    const { d } = seed([
      { id: 'r1', type: 'imageGen', position: { x: 100, y: 100 }, width: 300, height: 200, data: {}, selected: true },
      { id: 'r2', type: 'imageGen', position: { x: 500, y: 50 }, width: 300, height: 300, data: {}, selected: true },
    ]);
    useCanvasStore.setState({ selectedId: 'r1' });
    const idsParentSelectedBefore = JSON.stringify(useCanvasStore.getState().nodes.map((n) => [n.id, n.parentId, n.selected]));
    const positionsBefore = JSON.stringify(useCanvasStore.getState().nodes.map((n) => [n.id, n.position]));
    useCanvasStore.getState().arrangeSelection(['r1', 'r2'], 'grid');
    expect(JSON.stringify(useCanvasStore.getState().nodes.map((n) => [n.id, n.position]))).not.toBe(positionsBefore);   // 真重排（防恒绿）
    const items = sortForArrange([
      { id: 'r1', x: 100, y: 100, width: 300, height: 200 },
      { id: 'r2', x: 500, y: 50, width: 300, height: 300 },
    ]);
    const laid = arrangeRects(items.map(({ id, ...r }) => r), 'grid');
    items.forEach((it, i) => expect(posOf(it.id)).toEqual({ x: laid[i].x, y: laid[i].y }));
    expect(JSON.stringify(useCanvasStore.getState().nodes.map((n) => [n.id, n.parentId, n.selected]))).toBe(idsParentSelectedBefore);   // parentId 逐节点不变+保持原选区
    expect(useCanvasStore.getState().selectedId).toBe('r1');
    expect(checkProjectionInvariant(d)).toBe(true);
    teardown();
  });

  it('组=原子块 stored rect：组 position 重排、组内子节点 rel 不变；排列后不 refit 组框（applyGroupDerivations 仅派生 hidden——refit 属 2c-4 显式几何命令语义，两 task 口径不同非矛盾）', () => {
    // 两框故意大于各自子 bbox（不满足 §4.8 不变量）——排列后仍一字不改=证明未 refit
    const { d } = seed([
      { id: 'gA', type: 'group', position: { x: 0, y: 0 }, width: 800, height: 600, data: { groupType: 'normal' } },
      { id: 'a1', type: 'imageGen', parentId: 'gA', extent: 'parent', position: { x: 20, y: 50 }, width: 100, height: 60, data: {} },
      { id: 'gB', type: 'group', position: { x: 1200, y: 900 }, width: 400, height: 300, data: { groupType: 'normal' } },
      { id: 'b1', type: 'imageGen', parentId: 'gB', extent: 'parent', position: { x: 30, y: 60 }, width: 100, height: 60, data: {} },
    ]);
    const childrenBefore = JSON.stringify(useCanvasStore.getState().nodes.filter((n) => n.parentId).map((n) => [n.id, n.parentId, n.position]));
    useCanvasStore.getState().arrangeSelection(['gA', 'gB'], 'grid');
    const items = sortForArrange([
      { id: 'gA', x: 0, y: 0, width: 800, height: 600 },
      { id: 'gB', x: 1200, y: 900, width: 400, height: 300 },
    ]);
    const laid = arrangeRects(items.map(({ id, ...r }) => r), 'grid');
    items.forEach((it, i) => expect(posOf(it.id)).toEqual({ x: laid[i].x, y: laid[i].y }));   // 组 position 真重排（envelope 即 stored rect）
    const gA = useCanvasStore.getState().nodes.find((n) => n.id === 'gA')!;
    expect(gA.width).toBe(800);                                    // 不 refit：框一字不改
    expect(gA.height).toBe(600);
    expect(JSON.stringify(useCanvasStore.getState().nodes.filter((n) => n.parentId).map((n) => [n.id, n.parentId, n.position]))).toBe(childrenBefore);   // 子 rel 不变
    expect(checkProjectionInvariant(d)).toBe(true);
    teardown();
  });

  it('500ms 内连点两次 = 2 undo 项（真 UndoManager）+ 入口 stopCapturing（F13）', () => {
    const { d, um } = seed([
      { id: 'r1', type: 'imageGen', position: { x: 0, y: 0 }, width: 100, height: 60, data: {} },
      { id: 'r2', type: 'imageGen', position: { x: 500, y: 100 }, width: 100, height: 60, data: {} },
    ]);
    useCanvasStore.getState().arrangeSelection(['r1', 'r2'], 'grid');
    const afterFirst = { r1: { ...posOf('r1') }, r2: { ...posOf('r2') } };
    useCanvasStore.getState().arrangeSelection(['r1', 'r2'], 'vertical');   // 换 mode 保第二命令必产新位置（防 diff=0 不入栈假绿）
    expect(um.undoStack.length).toBe(2);   // stopCapturing 入口——captureTimeout 500ms 不合并
    um.undo();
    applyDocToStore(d);                    // 显式读回（替代跑不动的 onRemote——照 :413 测试缝）
    expect(posOf('r1')).toEqual(afterFirst.r1);
    expect(posOf('r2')).toEqual(afterFirst.r2);
    teardown();
  });
});

describe('hidden 写入侧不变量（hidden ⇒ selected===false）', () => {
  it('折叠组：子节点 selected 全部清 false（toggleCollapse 折叠分支）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 340, height: 240, data: { groupType: 'normal' } },
      { id: 'a', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 20, y: 50 }, width: 100, height: 60, data: {}, selected: true },
      { id: 'b', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 140, y: 50 }, width: 100, height: 60, data: {} },
    ] as any, edges: [], hydration: 'idle', collabReadOnly: true, wsAuthNotice: null });
    useCanvasStore.getState().toggleCollapse('g1');
    const a = useCanvasStore.getState().nodes.find((n) => n.id === 'a') as any;
    const b = useCanvasStore.getState().nodes.find((n) => n.id === 'b') as any;
    expect(a.selected).toBe(false);
    expect(a.hidden).toBe(true);   // deriveHidden 折叠推导到位
    expect(b.selected).toBe(false);
  });

  it('转分镜组：子节点 selected 清 false（convertGroup→storyboard）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 100, y: 100 }, width: 340, height: 240, data: { groupType: 'normal' } },
      { id: 'img1', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 20, y: 50 }, width: 300, height: 180, data: { status: 'done', fileId: 'f1' }, selected: true },
      { id: 'img2', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 20, y: 50 }, width: 300, height: 180, data: { status: 'done', fileId: 'f2' } },
    ] as any, edges: [], hydration: 'idle', collabReadOnly: true, wsAuthNotice: null });
    useCanvasStore.getState().convertGroup('g1', 'storyboard');
    const img1 = useCanvasStore.getState().nodes.find((n) => n.id === 'img1') as any;
    expect(img1.selected).toBe(false);
    expect(img1.hidden).toBe(true);   // storyboard 组 hidden 推导
  });

  it('B 端兜底（v2.1）：selected 不进投影键集（projectCanvasNodes.ts:11-19 无 selected、diffProjectionToIntents 只 diff envelope/position/data）→ A 端折叠清 selected 不同步 B 端；B 端 stale selected+hidden 由显示侧读点过滤兜住（组件级钉死 SelectionBoxOverlay.test.tsx；动作消费者面登记 R3：显示侧过滤兜不住键盘命令——B 端 stale selected hidden 子按 Delete/Ctrl+G 仍作用于不可见节点）', () => {
    const d = new Y.Doc();
    _setIntentDocForTest(d);
    const group = { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 340, height: 240, data: { groupType: 'normal', name: 'A' } };
    const a = { id: 'a', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 20, y: 50 }, width: 100, height: 60, data: {}, selected: true };
    const b = { id: 'b', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 140, y: 50 }, width: 100, height: 60, data: {} };
    try {
      fillDoc(d, [group, a, b] as any, []);
      useCanvasStore.setState({ nodes: [group, a, b] as any, edges: [], hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1' });
      useCanvasStore.getState().toggleCollapse('g1');
      // 实证：A 端 selected:false 是纯 store 写——doc 面零 selected 键，B 端收不到清除
      const docA = d.getMap('nodes').get('a') as Y.Map<unknown>;
      expect(docA.has('selected')).toBe(false);
      // 模拟远端 applyDocToStore：hidden 推导到位（B 端投影侧真相）
      applyDocToStore(d);
      const aB = useCanvasStore.getState().nodes.find((n) => n.id === 'a') as any;
      expect(aB.hidden).toBe(true);
      // B 端 stale 形态（selected=true+hidden=true——RF 本端选择态与 doc 重建的时序差）由
      // SelectionBoxOverlay 读点过滤（!n.hidden）兜住——谓词钉死在组件测试（读点所在文件）
    } finally {
      _setIntentDocForTest(null);
      detachUndoManager();
    }
  });
});

// ════════ R2a-6：副本体系统一 buildCopyPlan——duplicateNodes/duplicateGroup/paste 三薄壳 ════════

describe('duplicateNodes/duplicateGroup/paste 三薄壳（2a-6）', () => {
  // 真装置（照 runCommand 公共件 2a-0 / arrangeSelection 2a-5 骨架）：真 Y.Doc + fillDoc +
  // _setIntentDocForTest + attachUndoManager。禁止 vi.mock canvasIntents——mock 空投影会让
  // dispatchProjectionDiff 算 0 intents 后直接 return，doc 写路径零验证、断言恒绿。
  const rigNodes = () => [
    { id: 'g1', type: 'group', position: { x: 100, y: 100 }, width: 340, height: 240, data: { groupType: 'normal', name: 'A', color: 'red' } },
    { id: 'a', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 20, y: 50 }, width: 100, height: 60, data: { status: 'done', fileId: 'f1', prompt: 'ns-fresh' } },
    { id: 'b', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 140, y: 50 }, width: 100, height: 60, data: { status: 'done', fileId: 'f2', prompt: 'p-b' } },
  ];
  const seed = (nodes: unknown[], edges: unknown[] = []) => {
    const d = new Y.Doc();
    const um = attachUndoManager(d);
    _setIntentDocForTest(d);
    // cs 普通节点 data 刻意留陈旧值（保真②断言面：薄壳取数必须走 ns 全量而非 cs 镜像）
    const csStale = (nodes as any[]).map((n) => (n.id === 'a' ? { ...n, data: { ...n.data, prompt: 'cs-stale' } } : n));
    fillDoc(d, csStale as any, edges as any);
    useCanvasStore.setState({ nodes: csStale as any, edges: edges as any, selectedId: null, hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1' });
    const nsNodes: Record<string, any> = {};
    for (const n of nodes as any[]) {
      if (n.type !== 'group') nsNodes[n.id] = { id: n.id, type: n.type, data: n.data };
    }
    useNodeStore.setState({ nodes: nsNodes });
    return { d, um };
  };
  const teardown = () => {
    _setIntentDocForTest(null);
    detachUndoManager();
  };

  it('保真①：子节点数相等（选组复制不产空壳）', () => {
    seed(rigNodes());
    try {
      const newGid = useCanvasStore.getState().duplicateNodes(['g1']);
      const st = useCanvasStore.getState();
      expect(st.nodes.find((n) => n.id === newGid)!.type).toBe('group');
      expect(st.nodes.filter((n) => n.parentId === newGid)).toHaveLength(2);   // == 源子节点数
    } finally { teardown(); }
  });

  it('保真②：非桥接键 prompt 取 ns 全量（ns 改后复制得新值；buildGroupCopy 旧路径得 cs 陈旧值——先红）', () => {
    seed(rigNodes());
    try {
      const newGid = useCanvasStore.getState().duplicateNodes(['g1']);
      const child = useCanvasStore.getState().nodes.find((n) => n.parentId === newGid && (n.data as any).fileId === 'f1')!;
      expect((child.data as any).prompt).toBe('ns-fresh');   // 旧路径 structuredClone(cs data) → 'cs-stale'
    } finally { teardown(); }
  });

  it('保真③：cells 无旧 id；组 data（color/name）保真；折叠组副本继承 collapsed', () => {
    seed([
      { id: 'g1', type: 'group', position: { x: 100, y: 100 }, width: 340, height: 240,
        data: { groupType: 'normal', name: 'A', color: 'red', collapsed: true, savedSize: { width: 340, height: 240 } } },
      { id: 'a', type: 'imageGen', parentId: 'g1', extent: 'parent', position: { x: 20, y: 50 }, width: 100, height: 60, data: { fileId: 'f1' } },
    ]);
    try {
      useCanvasStore.getState().duplicateNodes(['g1']);
      const copy = useCanvasStore.getState().nodes.find((n) => n.type === 'group' && n.id !== 'g1') as any;
      expect(copy.data.name).toBe('A');
      expect(copy.data.color).toBe('red');
      expect(copy.data.collapsed).toBe(true);
    } finally { teardown(); }
    seed([
      { id: 'sg', type: 'group', position: { x: 0, y: 0 }, width: 642, height: 182,
        data: { groupType: 'storyboard', cells: ['c1', 'ghost'],
                storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' } } },
      { id: 'c1', type: 'imageGen', parentId: 'sg', extent: 'parent', position: { x: 0, y: 0 }, width: 320, height: 180, data: { status: 'done', fileId: 'f1' } },
    ]);
    try {
      useCanvasStore.getState().duplicateNodes(['sg']);
      const copySg = useCanvasStore.getState().nodes.find((n) => n.type === 'group' && n.id !== 'sg') as any;
      expect(copySg.data.cells.every((c: any) => c === null || !['c1', 'ghost'].includes(c))).toBe(true);
    } finally { teardown(); }
  });

  it('duplicateGroup ≡ duplicateNodes([id])（等价断言——两条路径产物逐键深等（除 id））', () => {
    const snapshotOf = (run: () => unknown) => {
      seed(rigNodes(), [{ id: 'e-in', source: 'a', target: 'b' }]);
      try {
        run();
        const st = useCanvasStore.getState();
        const origIds = new Set(['g1', 'a', 'b']);
        const copies = st.nodes.filter((n) => !origIds.has(n.id));
        const slot = new Map(copies.map((c, i) => [c.id, `#${i}`]));   // id 槽位归一——两路径 id 序列独立
        return JSON.stringify({
          copies: copies.map((c) => ({
            type: c.type,
            parent: c.parentId ? slot.get(c.parentId) : null,
            position: c.position,
            width: c.width,
            height: c.height,
            data: c.data,
            selected: c.selected ?? false,
          })),
          newEdges: st.edges.filter((e) => e.id !== 'e-in')
            .map((e) => `${slot.get(e.source)}->${slot.get(e.target)}`).sort(),
        });
      } finally { teardown(); }
    };
    const viaNodes = snapshotOf(() => useCanvasStore.getState().duplicateNodes(['g1']));
    const viaGroup = snapshotOf(() => useCanvasStore.getState().duplicateGroup('g1'));
    expect(viaGroup).toBe(viaNodes);
  });

  it('粘贴坐标（shell 直用 flow 位置——screenToFlowPosition 换算缝在调用点）+ clipboard 存 ns 全量快照（schema 含 edges）', () => {
    seed(rigNodes(), [{ id: 'e-in', source: 'a', target: 'b' }]);
    try {
      useCanvasStore.getState().copyGroupToClipboard('g1');
      expect(useCanvasStore.getState().hasGroupClipboard()).toBe(true);
      // 复制后改 ns——粘贴必须得复制时点快照（clipboard.records=ns 全量冻结，粘贴不重取数）
      useNodeStore.setState((s) => ({
        nodes: { ...s.nodes, a: { ...s.nodes.a, data: { ...(s.nodes.a as any).data, prompt: 'changed-after-copy' } } },
      }));
      const newGid = useCanvasStore.getState().pasteGroupClipboard({ x: 500, y: 300 });
      const st = useCanvasStore.getState();
      expect(st.nodes.find((n) => n.id === newGid)!.position).toEqual({ x: 500, y: 300 });   // position 直落
      const child = st.nodes.find((n) => n.parentId === newGid && (n.data as any).fileId === 'f1')!;
      expect((child.data as any).prompt).toBe('ns-fresh');   // 复制时点快照，非 changed-after-copy
      // schema 含 edges：删原内部边后再次粘贴——副本内部边仍由 clipboard.edges 承载恢复
      useCanvasStore.getState().removeEdge('e-in');
      const newGid2 = useCanvasStore.getState().pasteGroupClipboard({ x: 900, y: 300 });
      const copyIds2 = useCanvasStore.getState().nodes.filter((n) => n.parentId === newGid2).map((n) => n.id);
      expect(useCanvasStore.getState().edges.filter((e) => copyIds2.includes(e.source) && copyIds2.includes(e.target))).toHaveLength(1);
    } finally { teardown(); }
  });

  it('paste 补 undo 断言：500ms 内连点两次粘贴 = 2 undo 项', () => {
    const { um } = seed(rigNodes());
    try {
      useCanvasStore.getState().copyGroupToClipboard('g1');
      useCanvasStore.getState().pasteGroupClipboard({ x: 500, y: 300 });
      useCanvasStore.getState().pasteGroupClipboard({ x: 900, y: 300 });
      expect(um.undoStack.length).toBe(2);   // stopCapturing 入口——captureTimeout 500ms 不合并
    } finally { teardown(); }
  });

  it('B-2 顺序（cs set 先于 ns.addNode）+ 500ms 连点=2 undo', () => {
    const { um } = seed(rigNodes());
    try {
      let csHadCopyAtFirstNsWrite: boolean | null = null;
      let nsFired = 0;
      const unsub = useNodeStore.subscribe(() => {
        nsFired++;
        if (csHadCopyAtFirstNsWrite === null) {
          // 首个 ns 写点观察：cs 必已含组副本——结构 set 先于 ns.addNode（B-2 纪律）
          csHadCopyAtFirstNsWrite = useCanvasStore.getState().nodes.some((n) => n.type === 'group' && n.id !== 'g1');
        }
      });
      useCanvasStore.getState().duplicateNodes(['g1']);
      unsub();
      expect(nsFired).toBeGreaterThan(0);
      expect(csHadCopyAtFirstNsWrite).toBe(true);
      useCanvasStore.getState().duplicateNodes(['g1']);
      expect(um.undoStack.length).toBe(2);
    } finally { teardown(); }
  });

  it('copyNode/buildGroupCopy/rebuildFromClipboard 已删——接口与实现零残留', () => {
    expect((useCanvasStore.getState() as any).copyNode).toBeUndefined();
    // buildGroupCopy/rebuildFromClipboard 为模块级函数——零残留由 grep 门禁兜底（三符号 grep 零命中）
  });
});
