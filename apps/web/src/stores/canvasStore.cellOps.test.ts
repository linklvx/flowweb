// canvasStore.cellOps.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { applyDocToStore } from './canvasCollabRuntime';
import { _setIntentDocForTest } from './canvasIntents';
import { validatePlacementData } from '@flowweb/shared';
import { fillDoc, toDocLike } from '@/collab/ydocBuilder';
import { stampDocSchema, type StoredNodeRecord } from '@flowweb/shared';
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
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']); // 2x2 读序 [a,b,c,d]
    useCanvasStore.getState().removeStoryboardCell(gid, 1); // 删 b
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    // T17（Z17''）：派生 cells 长度恰=capacity(4)；紧凑=后续 slot 整值 -1（c:2→1、d:3→2）
    expect(g.data.cells).toEqual(['a', 'c', 'd', null]);
    // slot 域真源断言：doc 侧 c=1、d=2（整值前移）
    expect(g.data.cells).toHaveLength(4);
    expect(s.nodes.find((n) => n.id === 'b')).toBeUndefined();
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
  // T17（Z17'' cells→slot）：组 data 零 cells（doc 恒无）；格位=子 slot（cellRecord 第二参）。
  // cs data.cells=派生缓存（reconcile 写域⑥ 水合时派生——断言兼容读）。
  const sbData = () => ({
    groupType: 'storyboard',
    storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: true, stitchResolution: '2K' },
  });
  const sbRecord = (): StoredNodeRecord =>
    ({ id: 'sb', type: 'group', position: { x: 100, y: 50 }, data: sbData() });
  const cellRecord = (id: string, slot?: number): StoredNodeRecord =>
    ({ id, type: 'imageGen', parentId: 'sb', width: 320, height: 180,
       data: { status: 'done', fileId: `f-${id}`, ...(slot != null ? { slot } : {}) } });
  const freeRecord = (): StoredNodeRecord =>
    ({ id: 'z', type: 'imageGen', position: { x: 900, y: 900 }, width: 320, height: 180, data: { status: 'done', fileId: 'f-z' } });
  const rig = (records: StoredNodeRecord[]): Y.Doc => {
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
    const d = rig([sbRecord(), cellRecord('c1', 0), freeRecord()]);
    const slot = useCanvasStore.getState().attachMember('sb', 'z');
    expect(slot).toBe(1);                                     // 首空槽（cells=['c1',null]——槽序语义）
    const z = csNode('z');
    expect(z.parentId).toBe('sb');
    expect('extent' in z).toBe(false);                          // 去闸门（终裁 43）：cs 节点无 extent 键
    expect(z.position).toEqual({ x: 0, y: 0 });               // 分镜子坐标无意义（mergeStoryboard/addImageToStoryboardCell 同款归零）
    expect((csNode('sb').data as any).cells).toEqual(['c1', 'z']);   // cs 派生缓存
    // doc 面（membership=内容真源）：parentId 落键；position 剥键（键集表"分镜子无 position"——
    // 顶层入格前带 position，剥键唯一载体=本 intent 的 position:undefined）；格位=子 slot（doc 无 cells）
    const dz = docNode(d, 'z');
    expect(dz.get('parentId')).toBe('sb');
    expect(dz.has('position')).toBe(false);
    expect((dz.get('data') as Y.Map<any>).get('slot')).toBe(1);
    expect((docNode(d, 'sb').get('data') as Y.Map<any>).get('cells')).toBeUndefined();
  });

  it('P1-1 禁两可红线：带根层 order 键的节点入格——attachMember 同 intent 删 order（slot 单键化）∧ validatePlacementData 零违例', () => {
    // 根节点携 allocator 分配的 order 键（生产形态——addNode 建点必带）
    const d = rig([sbRecord(), cellRecord('c1', 0), {
      id: 'z', type: 'imageGen', position: { x: 900, y: 900 }, width: 320, height: 180,
      data: { status: 'done', fileId: 'f-z', order: '9000' },
    }]);
    const slot = useCanvasStore.getState().attachMember('sb', 'z');
    expect(slot).toBe(1);
    // doc 面：slot 落键 ∧ order 键删（同 intent）——禁两可
    const dz = docNode(d, 'z').get('data') as Y.Map<any>;
    expect(dz.get('slot')).toBe(1);
    expect(dz.get('order')).toBeUndefined();
    // ns 面：slot 写 ∧ order 键删
    const nsZ = useNodeStore.getState().nodes.z;
    expect((nsZ.data as any).slot).toBe(1);
    expect('order' in (nsZ.data as any)).toBe(false);
    // 契约表零违例（validatePlacementData 单源）
    expect(validatePlacementData(nsZ.data as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('满员 → 返回 null 零写（cs/doc 逐位不变——溢出处置=caller 策略）', () => {
    const d = rig([sbRecord(), cellRecord('c1', 0), cellRecord('c2', 1), freeRecord()]);
    const beforeCs = snapCs();
    const beforeDoc = Y.encodeStateAsUpdate(d);
    expect(useCanvasStore.getState().attachMember('sb', 'z')).toBeNull();
    expect(snapCs()).toBe(beforeCs);
    expect(Buffer.from(Y.encodeStateAsUpdate(d))).toEqual(Buffer.from(beforeDoc));   // doc 零写
  });

  it('addToGroup/dropIntoGroup 公开面分镜组守卫：拒绝零写（分镜组成员写唯一通道=attachMember）', () => {
    const d = rig([sbRecord(), cellRecord('c1', 0), freeRecord()]);
    const beforeCs = snapCs();
    const beforeDoc = Y.encodeStateAsUpdate(d);
    useCanvasStore.getState().addToGroup('sb', 'z');
    useCanvasStore.getState().dropIntoGroup('z', 'sb');
    expect(snapCs()).toBe(beforeCs);                          // cs 零写（parentId/cells 全不动）
    expect(Buffer.from(Y.encodeStateAsUpdate(d))).toEqual(Buffer.from(beforeDoc));   // doc 零写
  });

  it('dropImageIntoStoryboard imageGen 完成图：经 attachMember 入格（旧 addToGroup 通道已挂守卫退役）', () => {
    rig([sbRecord(), cellRecord('c1', 0), freeRecord()]);
    useCanvasStore.getState().dropImageIntoStoryboard('sb', 'z');
    const z = csNode('z');
    expect(z.parentId).toBe('sb');
    expect((csNode('sb').data as any).cells).toEqual(['c1', 'z']);   // 入格成功（守卫后走 attachMember——拒绝则此断言红）
  });

  it('T17 G55：cells 零残留落 doc——全命令族（attach/remove/clear/resize/addImage/removeCell）后 doc 组 data 恒无 cells ∧ slot 派生单源', () => {
    const d = rig([sbRecord(), cellRecord('c1', 0), freeRecord()]);
    const st = useCanvasStore.getState();
    st.attachMember('sb', 'z');                       // 入格
    st.removeStoryboardCell('sb', 0);                 // 删槽 0（c1）——z slot 1→0 紧凑
    st.addImageToStoryboardCell('sb', 1, 'f-new');    // 槽 1 建图
    st.resizeStoryboardGrid('sb', 2, 2);              // 增格
    // doc 面：组 data 恒无 cells（键集表出口剥+patchGroupData cells 恒剥——回流面收口）
    const sbData = docNode(d, 'sb').get('data') as Y.Map<any>;
    expect(sbData.get('cells')).toBeUndefined();
    expect(sbData.has('cells')).toBe(false);
    // cs 面：派生缓存长度恰=capacity（2x2=4）——deriveStoryboardCells 单源
    const csCells = (csNode('sb').data as any).cells as (string | null)[];
    expect(csCells).toHaveLength(4);
    expect(csCells.filter(Boolean)).toHaveLength(2);  // z（紧凑后槽 0）+新建槽 1
    expect(csCells[0]).toBe('z');
  });

  it('跨组拖入分镜：源组失去最后子 → 解组（addToGroup 善后语义随通道退役移入 caller——原语零善后是刻意分层）', () => {
    rig([
      { id: 'ng', type: 'group', position: { x: 500, y: 500 }, width: 340, height: 220, data: { groupType: 'normal' } },
      { id: 'z', type: 'imageGen', parentId: 'ng', position: { x: 520, y: 520 }, width: 320, height: 180, data: { status: 'done', fileId: 'f-z' } },
      sbRecord(),
      cellRecord('c1', 0),
    ]);
    useCanvasStore.getState().dropImageIntoStoryboard('sb', 'z');
    expect(csNode('z').parentId).toBe('sb');
    expect((csNode('sb').data as any).cells).toEqual(['c1', 'z']);
    expect(useCanvasStore.getState().nodes.some((n: any) => n.id === 'ng')).toBe(false);   // 空源组解组
  });
});
