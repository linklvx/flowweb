// canvasStore.cellOps.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { applyDocToStore } from './canvasCollabRuntime';
import { _setIntentDocForTest } from './canvasIntents';
import { fillDoc, toDocLike } from '@/collab/ydocBuilder';
import { stampDocSchema, type DocNodeRecord } from '@flowweb/shared';
import { openRwWindow, resetCanvasStores } from '@/test/fixtures/canvas';
import type { Node } from '@xyflow/react';

const doneImage = (id: string, x = 100, y = 100): Node =>
  ({ id, type: 'imageGen', position: { x, y }, width: 320, height: 180, data: { status: 'done', fileId: `f-${id}` } } as Node);

beforeEach(() => {
  useCanvasStore.setState({
    nodes: [doneImage('a'), doneImage('b', 500, 100), doneImage('c', 100, 400), doneImage('d', 500, 400)],
    edges: [], selectedId: null,
  });
});

describe('addImageToStoryboardCell', () => {
  it('填充空格：cells 补位 + 新隐藏子节点', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']); // 1x2 → [a,b]
    useCanvasStore.getState().resizeStoryboardGrid(gid, 2, 2); // 扩为 2x2，两个空位
    useCanvasStore.getState().addImageToStoryboardCell(gid, 3, 'f-new');
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    const cells = g.data.cells as (string | null)[];
    expect(cells![3]).toBeTruthy();
    const cell3 = s.nodes.find((n) => n.id === cells![3])!;
    expect(cell3.parentId).toBe(gid);
    expect((cell3.data as any).fileId).toBe('f-new');
  });

  it('槽位建图节点 data 不含 mediaUrl 键（R2b-6 写入面清零——F37 presigned URL 不得持久化）', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    useCanvasStore.getState().resizeStoryboardGrid(gid, 2, 2);
    useCanvasStore.getState().addImageToStoryboardCell(gid, 3, 'f-new');
    const s = useCanvasStore.getState();
    const cells = (s.nodes.find((n) => n.id === gid)!.data as any).cells as (string | null)[];
    const csNode = s.nodes.find((n) => n.id === cells![3])!;
    expect(JSON.stringify(csNode.data)).not.toContain('mediaUrl'); // cs 镜像不写
    const nsNode = useNodeStore.getState().nodes[cells![3]!];
    expect(JSON.stringify(nsNode.data)).not.toContain('mediaUrl'); // ns 节点不写（双写第二笔）
  });
});

describe('removeStoryboardCell（删单格：不收缩宫格，序号重排）', () => {
  it('删除 cells[1] → 该格变空、后续前移补位', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']); // 2x2 [a,c,b,d]
    useCanvasStore.getState().removeStoryboardCell(gid, 1); // 删 c
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    expect(g.data.cells).toEqual(['a', 'b', 'd']); // 前移补位（紧凑）
    expect(s.nodes.find((n) => n.id === 'c')).toBeUndefined();
    const storyboard = (g.data as any).storyboard;
    expect(storyboard.gridRows).toBe(2); // 不收缩
  });
});

describe('dropImageIntoStoryboard（multiImageGen 展开拖入）', () => {
  it('multi 展开填空位、原节点移除、组节点不重复', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']); // 1x2 [a,b]
    useCanvasStore.getState().resizeStoryboardGrid(gid, 2, 2); // 扩为 2x2，两个空位
    useCanvasStore.setState({
      nodes: [...useCanvasStore.getState().nodes, {
        id: 'multi', type: 'multiImageGen', position: { x: 1000, y: 100 }, width: 320, height: 200,
        data: { images: [
          { id: 'm1', url: 'u1', name: 'n', status: 'success' },
          { id: 'm2', url: 'u2', name: 'n', status: 'success' },
        ], nodeStatus: 'done' },
      } as Node],
    });
    useCanvasStore.getState().dropImageIntoStoryboard(gid, 'multi');
    const s = useCanvasStore.getState();
    expect(s.nodes.filter((n) => n.id === gid)).toHaveLength(1); // 组节点唯一（回归：曾因旧实例未排除而重复）
    expect(s.nodes.find((n) => n.id === 'multi')).toBeUndefined();
    const g = s.nodes.find((n) => n.id === gid)!;
    const cells = g.data.cells as (string | null)[];
    expect(cells.filter(Boolean)).toHaveLength(4); // a + b + m1 + m2 全入格
    expect(cells.every((c) => c !== 'multi')).toBe(true);
    const expanded = s.nodes.filter((n) => (n.data as any).__fromMulti === 'multi');
    expect(expanded).toHaveLength(2);
    expect(expanded.every((n) => n.parentId === gid)).toBe(true);
  });

  it('展开节点 data 不含 mediaUrl 键（R2b-6 写入面清零——F37）', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    useCanvasStore.getState().resizeStoryboardGrid(gid, 2, 2);
    useCanvasStore.setState({
      nodes: [...useCanvasStore.getState().nodes, {
        id: 'multi', type: 'multiImageGen', position: { x: 1000, y: 100 }, width: 320, height: 200,
        data: { images: [
          { id: 'm1', url: 'u1', name: 'n', status: 'success' },
          { id: 'm2', url: 'u2', name: 'n', status: 'success' },
        ], nodeStatus: 'done' },
      } as Node],
    });
    useCanvasStore.getState().dropImageIntoStoryboard(gid, 'multi');
    const expanded = useCanvasStore.getState().nodes.filter((n) => (n.data as any).__fromMulti === 'multi');
    expect(expanded.length).toBeGreaterThan(0);
    expect(expanded.every((n) => !JSON.stringify(n.data).includes('mediaUrl'))).toBe(true);
  });
});

// ════════ O0c-3：attachMember 分镜成员原语（membership=内容真源、cells=槽序——卡三）════════
// 公开面分层：addToGroup/dropIntoGroup 拒分镜组（零写）；分镜入格唯一通道=attachMember。

describe('O0c-3 attachMember 分镜成员原语', () => {
  // 生产同构链装置（O0b-2 sizing 同款）：openRwWindow→fillDoc→stamp→applyDocToStore 水合→action；
  // 零裸几何 setState（文件级棘轮 allow-list 纪律）。
  const sbData = (cells: (string | null)[]) => ({
    groupType: 'storyboard', cells,
    storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: true, stitchResolution: '2K' },
  });
  const sbRecord = (cells: (string | null)[]): DocNodeRecord =>
    ({ id: 'sb', type: 'group', position: { x: 100, y: 50 }, data: sbData(cells) });
  const cellRecord = (id: string): DocNodeRecord =>
    ({ id, type: 'imageGen', parentId: 'sb', width: 320, height: 180, data: { status: 'done', fileId: `f-${id}` } });
  const freeRecord = (): DocNodeRecord =>
    ({ id: 'z', type: 'imageGen', position: { x: 900, y: 900 }, width: 320, height: 180, data: { status: 'done', fileId: 'f-z' } });
  const rig = (records: DocNodeRecord[]): Y.Doc => {
    openRwWindow();
    const d = new Y.Doc();
    fillDoc(d, records, []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    _setIntentDocForTest(d);
    return d;
  };
  const csNode = (id: string) => useCanvasStore.getState().nodes.find((n: any) => n.id === id) as any;
  const docNode = (d: Y.Doc, id: string) => d.getMap('nodes').get(id) as Y.Map<any>;
  const snapCs = () => JSON.stringify(useCanvasStore.getState().nodes);
  afterEach(() => { _setIntentDocForTest(null); resetCanvasStores(); });

  it('直调 attachMember 到分镜组走正常入格：cs membership+首空槽 ∧ doc parentId 落+分镜子 position 剥键', () => {
    const d = rig([sbRecord(['c1', null]), cellRecord('c1'), freeRecord()]);
    const slot = useCanvasStore.getState().attachMember('sb', 'z');
    expect(slot).toBe(1);                                     // 首空槽（cells=['c1',null]——槽序语义）
    const z = csNode('z');
    expect(z.parentId).toBe('sb');
    expect('extent' in z).toBe(false);                          // 去闸门（终裁 43）：cs 节点无 extent 键
    expect(z.position).toEqual({ x: 0, y: 0 });               // 分镜子坐标无意义（mergeStoryboard/addImageToStoryboardCell 同款归零）
    expect((csNode('sb').data as any).cells).toEqual(['c1', 'z']);
    // doc 面（membership=内容真源）：parentId 落键；position 剥键（键集表"分镜子无 position"——
    // 顶层入格前带 position，剥键唯一载体=本 intent 的 position:undefined）
    const dz = docNode(d, 'z');
    expect(dz.get('parentId')).toBe('sb');
    expect(dz.has('position')).toBe(false);
    expect((docNode(d, 'sb').get('data') as Y.Map<any>).get('cells')).toEqual(['c1', 'z']);
  });

  it('满员 → 返回 null 零写（cs/doc 逐位不变——溢出处置=caller 策略）', () => {
    const d = rig([sbRecord(['c1', 'c2']), cellRecord('c1'), cellRecord('c2'), freeRecord()]);
    const beforeCs = snapCs();
    const beforeDoc = Y.encodeStateAsUpdate(d);
    expect(useCanvasStore.getState().attachMember('sb', 'z')).toBeNull();
    expect(snapCs()).toBe(beforeCs);
    expect(Buffer.from(Y.encodeStateAsUpdate(d))).toEqual(Buffer.from(beforeDoc));   // doc 零写
  });

  it('addToGroup/dropIntoGroup 公开面分镜组守卫：拒绝零写（分镜组成员写唯一通道=attachMember）', () => {
    const d = rig([sbRecord(['c1', null]), cellRecord('c1'), freeRecord()]);
    const beforeCs = snapCs();
    const beforeDoc = Y.encodeStateAsUpdate(d);
    useCanvasStore.getState().addToGroup('sb', 'z');
    useCanvasStore.getState().dropIntoGroup('z', 'sb');
    expect(snapCs()).toBe(beforeCs);                          // cs 零写（parentId/cells 全不动）
    expect(Buffer.from(Y.encodeStateAsUpdate(d))).toEqual(Buffer.from(beforeDoc));   // doc 零写
  });

  it('dropImageIntoStoryboard imageGen 完成图：经 attachMember 入格（旧 addToGroup 通道已挂守卫退役）', () => {
    rig([sbRecord(['c1', null]), cellRecord('c1'), freeRecord()]);
    useCanvasStore.getState().dropImageIntoStoryboard('sb', 'z');
    const z = csNode('z');
    expect(z.parentId).toBe('sb');
    expect((csNode('sb').data as any).cells).toEqual(['c1', 'z']);   // 入格成功（守卫后走 attachMember——拒绝则此断言红）
  });

  it('跨组拖入分镜：源组失去最后子 → 解组（addToGroup 善后语义随通道退役移入 caller——原语零善后是刻意分层）', () => {
    rig([
      { id: 'ng', type: 'group', position: { x: 500, y: 500 }, width: 340, height: 220, data: { groupType: 'normal' } },
      { id: 'z', type: 'imageGen', parentId: 'ng', position: { x: 520, y: 520 }, width: 320, height: 180, data: { status: 'done', fileId: 'f-z' } },
      sbRecord(['c1', null]),
      cellRecord('c1'),
    ]);
    useCanvasStore.getState().dropImageIntoStoryboard('sb', 'z');
    expect(csNode('z').parentId).toBe('sb');
    expect((csNode('sb').data as any).cells).toEqual(['c1', 'z']);
    expect(useCanvasStore.getState().nodes.some((n: any) => n.id === 'ng')).toBe(false);   // 空源组解组
  });
});
