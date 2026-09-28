// canvasStore.storyboardConfig.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import type { StoryboardConfig } from '@/types/group';
import { ASPECT_RATIOS } from '@/types/group';

const doneImage = (id: string, x = 100, y = 100) =>
  ({ id, type: 'imageGen', position: { x, y }, width: 320, height: 180, data: { status: 'done', fileId: `f-${id}` } });

beforeEach(() => {
  useCanvasStore.setState({
    nodes: [doneImage('a'), doneImage('b', 500, 100), doneImage('c', 100, 400), doneImage('d', 500, 400)] as any,
    edges: [], selectedId: null,
  });
  // 播种 nodeStore（生产中这些是既有节点，nodeStore 已有记录）——供 P0-新1 断言验证 resize 不误删
  useNodeStore.setState({
    nodes: {
      a: { id: 'a', type: 'imageGen', position: { x: 100, y: 100 }, data: { status: 'done', fileId: 'f-a' } },
      b: { id: 'b', type: 'imageGen', position: { x: 500, y: 100 }, data: { status: 'done', fileId: 'f-b' } },
      c: { id: 'c', type: 'imageGen', position: { x: 100, y: 400 }, data: { status: 'done', fileId: 'f-c' } },
      d: { id: 'd', type: 'imageGen', position: { x: 500, y: 400 }, data: { status: 'done', fileId: 'f-d' } },
    } as any,
  });
});

describe('updateStoryboardConfig', () => {
  it('切换比例 → 组尺寸重算', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']);
    useCanvasStore.getState().updateStoryboardConfig(gid, { aspectRatio: '1:1' });
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gid)!;
    expect(g.height).toBeCloseTo(2 * 320 + 2); // 1:1 → 单格 320 高
  });

  it('showIndex 切换', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    useCanvasStore.getState().updateStoryboardConfig(gid, { showIndex: true } as Partial<StoryboardConfig>);
    expect((useCanvasStore.getState().nodes.find((n) => n.id === gid)!.data as any).storyboard!.showIndex).toBe(true);
  });
});

describe('resizeStoryboardGrid（减格溢出）', () => {
  it('4 图组减为 2x2→1x2：超出的 2 张移出排右侧 + cells 截断', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']);
    const before = useCanvasStore.getState().nodes.find((n) => n.id === gid)!;
    useCanvasStore.getState().resizeStoryboardGrid(gid, 1, 2);
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    expect(g.data.cells).toEqual(['a', 'c']); // 字典序前 2
    const overflowed = s.nodes.find((n) => n.id === 'b')!;
    expect(overflowed.parentId).toBeUndefined();
    expect(overflowed.position.x).toBeGreaterThan(before.position.x + (before.width ?? 0)); // 组右侧
    expect(overflowed.hidden).toBe(false);
    // P0-新1 回归：溢出节点必须存活（而非被删除），nodeStore 双写一致
    expect(s.nodes.find((n) => n.id === 'd')).toBeTruthy();
    expect(useNodeStore.getState().nodes['b']).toBeTruthy();
  });

  it('增格 → cells 不变（空位由渲染器显示）', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    useCanvasStore.getState().resizeStoryboardGrid(gid, 2, 2);
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gid)!;
    expect(g.data.cells).toHaveLength(2);
    expect((g.data as any).storyboard!.gridRows).toBe(2);
  });
});

describe('clearStoryboard', () => {
  it('删除全部子节点，组保留为空宫格', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']);
    useCanvasStore.getState().clearStoryboard(gid);
    const s = useCanvasStore.getState();
    expect(s.nodes.find((n) => n.id === gid)).toBeTruthy();
    expect(s.nodes.find((n) => n.id === gid)!.data.cells).toEqual([]);
    expect(s.nodes.find((n) => n.id === 'a')).toBeUndefined();
  });
});

// v5：cells 可传——第二槽夹具 [null, 'img1'] 是判别力关键（idx=0 时 col/x 恒 0，位置断言无判别力）
const cloneGroupNode = (id: string, cells: (string | null)[] = ['img1', null]) => ({
  id, type: 'group', position: { x: 0, y: 0 }, parentId: undefined,
  data: { groupType: 'storyboard', cells }, // 无 storyboard（旧克隆产物）
});

describe('克隆体上 storyboard store 命令不崩（F2 消费点③④⑤）+ NaN 双点全维断言（⑥⑦）', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      nodes: [
        cloneGroupNode('g1'),
        { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, parentId: 'g1', data: {} },
      ] as any, edges: [],
    });
  });

  it('ungroup：无 storyboard 不抛', () => {
    expect(() => useCanvasStore.getState().ungroup('g1')).not.toThrow();
  });

  it('convertGroup(g1, normal)：无 storyboard 且无 cells 不抛（:1212 resolver + :1219 守卫双覆盖）', () => {
    useCanvasStore.setState({ nodes: [{ ...cloneGroupNode('g1'), data: { groupType: 'storyboard' } }] as any, edges: [] });
    expect(() => useCanvasStore.getState().convertGroup('g1', 'normal')).not.toThrow();
  });

  it('convertGroup：cells 缺失但有子节点——:1220 守卫半边可连性（旧代码 gd.cells.indexOf 此处 TypeError）', () => {
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, parentId: undefined, data: { groupType: 'storyboard' } }, // 无 storyboard 且无 cells
      { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, parentId: 'g1', data: {} },
    ] as any, edges: [] });
    expect(() => useCanvasStore.getState().convertGroup('g1', 'normal')).not.toThrow();
    const img = useCanvasStore.getState().nodes.find((n) => n.id === 'img1') as any;
    expect(img).toBeDefined();   // 子节点未被删除（守卫跳过网格重排，节点保持）
  });

  it('convertGroup(g1, normal)：有 cells 时子节点按 resolver 提供的网格重排（守 resolver 输出口径，v5 判别力修正）', () => {
    // v5：img1 放第二槽——idx=0 时 col 恒 0、x 恒 0，原 isFinite(x) 断言恒真零判别力；
    // idx=1 + resolver 默认 gridCols=1 → row=1 → y = 1*(Math.round(320/(16/9)) + CONVERT_GAP) = 1*(180+40) = 220。
    // 两向判别力：gridCols 误算为 2 → row=0 → y=0 红；cfg 未接 resolver（undefined）→ TypeError 红。
    useCanvasStore.setState({ nodes: [cloneGroupNode('g1', [null, 'img1']), { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, parentId: 'g1', data: {} }] as any, edges: [] });
    useCanvasStore.getState().convertGroup('g1', 'normal');
    const img = useCanvasStore.getState().nodes.find((n) => n.id === 'img1') as any;
    expect(img).toBeDefined();
    expect(img.position.y).toBe(220);   // 钉住 gridCols/行列计算参与（v5——原 isFinite(x) 恒真）
  });

  it('updateStoryboardConfig：组宽高有限 + 写进 doc 的 aspectRatio ∈ 枚举 + gridRows 整数（NaN 面⑥全维）', () => {
    useCanvasStore.getState().updateStoryboardConfig('g1', { aspectRatio: '9:16' });
    const g = useCanvasStore.getState().nodes.find((n) => n.id === 'g1')!;
    expect(Number.isFinite(g.width)).toBe(true);
    expect(Number.isFinite(g.height)).toBe(true);
    expect((ASPECT_RATIOS as readonly string[])).toContain((g.data as any).storyboard.aspectRatio);
    expect(Number.isInteger((g.data as any).storyboard.gridRows)).toBe(true);
  });

  it('updateStoryboardConfig：patch 带 NaN 被外层归一钳制（双层设计的直接断言——简化回单层必红）', () => {
    useCanvasStore.getState().updateStoryboardConfig('g1', { gridRows: Number.NaN } as any);
    const g = useCanvasStore.getState().nodes.find((n) => n.id === 'g1')!;
    expect(Number.isFinite((g.data as any).storyboard.gridRows)).toBe(true);
    expect((g.data as any).storyboard.gridRows).toBe(1);   // NaN → clampInt 回退 DEFAULT.gridRows=1
  });

  it('resizeStoryboardGrid：同上全维（NaN 面⑦；v3 简化——rows/cols 为受控数值，单层归一即可）', () => {
    useCanvasStore.getState().resizeStoryboardGrid('g1', 2, 2);
    const g = useCanvasStore.getState().nodes.find((n) => n.id === 'g1')!;
    expect(Number.isFinite(g.width)).toBe(true);
    expect((ASPECT_RATIOS as readonly string[])).toContain((g.data as any).storyboard.aspectRatio);
    expect(Number.isInteger((g.data as any).storyboard.gridCols)).toBe(true);
  });

  it('resizeStoryboardGrid 缩格不变量：真溢出夹具——img2 被移出组（parentId undefined）而非删除（:1330 注释语义的行为面，v4 修正夹具）', () => {
    // v4：cells 两槽均为真实节点（v3 的 [img1, null] 溢出的是 null 槽——img1 本在 keep 内测不到移出）
    // v5：cells 直接进 setState 夹具（不再 mutate store 节点对象——绕过 setState 改状态是坏习惯示范）
    useCanvasStore.setState({ nodes: [
      cloneGroupNode('g1', ['img1', 'img2']),
      { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, parentId: 'g1', width: 100, height: 60, data: {} },
      { id: 'img2', type: 'imageGen', position: { x: 0, y: 0 }, parentId: 'g1', width: 100, height: 60, data: {} },
    ] as any, edges: [] });
    useCanvasStore.getState().resizeStoryboardGrid('g1', 1, 1); // 容量 1，img2 溢出
    const g = useCanvasStore.getState().nodes.find((n) => n.id === 'g1')!;
    expect(((g.data as any).cells as unknown[]).length).toBeLessThanOrEqual(1);
    const img2 = useCanvasStore.getState().nodes.find((n) => n.id === 'img2') as any;
    expect(img2).toBeDefined();               // 未被删除
    expect(img2.parentId).toBeUndefined();    // 被移出组（顶层化）
  });

  it('【F38 基线·修复属 R2a】ungroup 覆盖子节点尺寸为 CELL_WIDTH（现状缺陷面钉死——R0 改此分支但勿顺手修，R2a 修复后本断言翻转为保留值）', () => {
    // 夹具：img1 带 width: 500, height: 400（用户手动尺寸）；v5：img1 放第二槽（idx=1 进覆盖分支同款，顺带钉行列计算）
    useCanvasStore.setState({ nodes: [cloneGroupNode('g1', [null, 'img1']), { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, parentId: 'g1', width: 500, height: 400, data: {} }] as any, edges: [] });
    useCanvasStore.getState().ungroup('g1');
    const img = useCanvasStore.getState().nodes.find((n) => n.id === 'img1') as any;
    expect(img.width).toBe(320); // = CELL_WIDTH：登记现状覆盖行为
    expect(img.position.y).toBe(220); // v5：idx=1 → row=1（gridCols=1）→ 180+40；ungroup 第二段加 gp={0,0} 不影响
  });

  it('【F38 基线·修复属 R2a】convertGroup→normal 同款覆盖子节点尺寸（spec F38 整类第二处）', () => {
    useCanvasStore.setState({ nodes: [cloneGroupNode('g1', [null, 'img1']), { id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, parentId: 'g1', width: 500, height: 400, data: {} }] as any, edges: [] });
    useCanvasStore.getState().convertGroup('g1', 'normal');
    const img = useCanvasStore.getState().nodes.find((n) => n.id === 'img1') as any;
    expect(img.width).toBe(320);
    expect(img.position.y).toBe(220); // v5：第二槽行列计算同款（组内相对坐标——convertGroup 后组仍在不加 gp）
  });

  it('dropImageIntoStoryboard：无 storyboard 不抛（消费点④）', () => {
    expect(() => useCanvasStore.getState().dropImageIntoStoryboard('g1', 'img1')).not.toThrow();
  });
});
