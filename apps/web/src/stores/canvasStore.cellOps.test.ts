// canvasStore.cellOps.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { applyDocToStore } from './canvasCollabRuntime';
import { _setIntentDocForTest } from './canvasIntents';
import { validatePlacementData } from '@flowweb/shared';
import { fillDoc, toDocLike } from '@/collab/ydocBuilder';
import { readFileSync } from 'fs';
import * as path from 'path';
import { type StoredNodeRecord } from '@flowweb/shared';
import { openRwWindow, resetCanvasStores } from '@/test/fixtures/canvas';
import type { Node } from '@xyflow/react';

const doneImage = (id: string, x = 100, y = 100): Node =>
  ({ id, type: 'imageGen', position: { x, y }, width: 320, height: 180, data: { mediaId: `f-${id}` } } as Node);

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
    // Y2 A3：cs cells 派生缓存退役（写域⑥）——成员判据改 slot/membership
    const cell3 = s.nodes.find((n: any) => n.parentId === gid && (n.data as any).slot === 3);
    expect(cell3).toBeTruthy();
    expect((cell3!.data as any).mediaId).toBe('f-new');   // Y2 B3：格位新子=放置写 mediaId
  });

  it('槽位建图节点 data 不含 mediaUrl 键（R2b-6 写入面清零——F37 presigned URL 不得持久化）', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    useCanvasStore.getState().resizeStoryboardGrid(gid, 2, 2);
    useCanvasStore.getState().addImageToStoryboardCell(gid, 3, 'f-new');
    const s = useCanvasStore.getState();
    // Y2 A3：cs cells 派生缓存退役（写域⑥）——成员判据改 slot/membership
    const cell3 = s.nodes.find((n: any) => n.parentId === gid && (n.data as any).slot === 3)!;
    expect(JSON.stringify(cell3.data)).not.toContain('mediaUrl'); // 作者缓存面不写
    const nsNode = useNodeStore.getState().nodes[cell3.id];
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
    expect(g.data.cells).toBeUndefined();   // Y2 A3：cs cells 派生缓存退役（写域⑥ 收口——渲染面 cellNodes 派生；格位真源=子 slot）
    // slot 域真源断言：doc 侧 c=1、d=2（整值前移）
    expect(g.data.cells).toBeUndefined();   // Y2 A3：cs cells 派生缓存退役（写域⑥ 收口——渲染面 cellNodes 派生；格位真源=子 slot）
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
    // Y2 A3：cs cells 派生缓存退役——全入格判据=组内成员数（a+b+m1+m2）∧无 multi 残留
    expect(s.nodes.filter((n: any) => n.parentId === gid)).toHaveLength(4);
    expect(s.nodes.every((n: any) => n.id !== 'multi' || n.parentId !== gid)).toBe(true);
    expect((g.data as any).cells).toBeUndefined();
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
       data: { mediaId: `f-${id}`, ...(slot != null ? { slot } : {}) } });
  const freeRecord = (): StoredNodeRecord =>
    ({ id: 'z', type: 'imageGen', position: { x: 900, y: 900 }, width: 320, height: 180, data: { mediaId: 'f-z' } });
  const rig = (records: StoredNodeRecord[]): Y.Doc => {
    openRwWindow();
    const d = new Y.Doc();
    fillDoc(d, records, []);
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
    expect((csNode('sb').data as any).cells).toBeUndefined();   // Y2 A3：cs cells 派生缓存退役（写域⑥ 收口——渲染面 cellNodes 派生；格位真源=子 slot）
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
      data: { mediaId: 'f-z', order: '9000' },
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
    expect((csNode('sb').data as any).cells).toBeUndefined();   // Y2 A3：cs cells 派生缓存退役过渡（A5 全收）
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
    // Y2 A3：cs 面 cells 派生缓存退役——格位真源=子 slot（z 紧凑后槽 0+新建槽 1）
    expect((csNode('sb').data as any).cells).toBeUndefined();
    expect(useNodeStore.getState().nodes['z']?.data as any).toMatchObject({ slot: 0 });
  });

  it('跨组拖入分镜：源组失去最后子 → 解组（addToGroup 善后语义随通道退役移入 caller——原语零善后是刻意分层）', () => {
    rig([
      { id: 'ng', type: 'group', position: { x: 500, y: 500 }, width: 340, height: 220, data: { groupType: 'normal' } },
      { id: 'z', type: 'imageGen', parentId: 'ng', position: { x: 520, y: 520 }, width: 320, height: 180, data: { mediaId: 'f-z' } },
      sbRecord(),
      cellRecord('c1', 0),
    ]);
    useCanvasStore.getState().dropImageIntoStoryboard('sb', 'z');
    expect(csNode('z').parentId).toBe('sb');
    expect((csNode('sb').data as any).cells).toBeUndefined();   // Y2 A3：cs cells 派生缓存退役过渡（A5 全收）
    expect(useCanvasStore.getState().nodes.some((n: any) => n.id === 'ng')).toBe(false);   // 空源组解组
  });
});

// ══════════ Y2 A5（分镜只走 cellNodes）：渲染零 store 扫描锚+cells 缓存退役回归锚+占格保通锚 ══════════
describe('Y2 A5 分镜渲染通道（D2——cellNodes 单通道）', () => {
  // 装置同 O0c-3（生产同构链）：openRwWindow→fillDoc（doc 恒无 cells——格位真源=子 slot）→
  // applyDocToStore 水合。不手写 cs cells（旧 F38 夹具形态=生产不可达态：cs 由 doc 水合，
  // 而 doc 写路径键集表恒剥 cells——cs 水合态恒无 cells）。
  const sbRecord = (): StoredNodeRecord =>
    ({ id: 'sb', type: 'group', position: { x: 100, y: 50 }, data: {
      groupType: 'storyboard',
      storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: true, stitchResolution: '2K' },
    } });
  const cellRecord = (id: string, slot?: number): StoredNodeRecord =>
    ({ id, type: 'imageGen', parentId: 'sb', width: 320, height: 180,
       data: { mediaId: `f-${id}`, ...(slot != null ? { slot } : {}) } });
  const hydrate = (records: readonly StoredNodeRecord[]): Y.Doc => {
    openRwWindow();
    const d = new Y.Doc();
    fillDoc(d, records, []);
    applyDocToStore(d);
    _setIntentDocForTest(d);
    return d;
  };
  const csNode = (id: string) => useCanvasStore.getState().nodes.find((n: any) => n.id === id) as any;
  afterEach(() => { _setIntentDocForTest(null); resetCanvasStores(); });

  it('① 分镜渲染通道零 parentId 扫描（StoryboardGroupRendererCellNodes 函数体——cellNodes=渲染节点 data 携带）——现状必红', () => {
    const src = readFileSync(path.join(process.cwd(), 'src/pages/canvas/components/groups/GroupNode.tsx'), 'utf8');
    // 锚域=分镜渲染组件函数体（普通组 Resizer 的子包围盒 parentId 读=合法 cs 几何消费，不在退役面）
    const fnSrc = src.slice(src.indexOf('function StoryboardGroupRendererCellNodes'), src.indexOf('export const GroupNode'));
    expect(fnSrc).not.toMatch(/parentId\s*===/);   // 现拼扫描退役（改消费渲染节点 data.cellNodes）
  });

  it('② cells 缓存退役回归锚（A3 写域⑥已收口）：远端写分镜 config 水合后 cs 镜像零 cells 键', () => {
    const d = hydrate([sbRecord(), cellRecord('c1', 0)]);
    // 远端事务（合法写面：storyboard config——同码对端经键集表恒剥 cells，doc 恒无 cells）
    const B = new Y.Doc();
    Y.applyUpdate(B, Y.encodeStateAsUpdate(d));
    ((B.getMap('nodes').get('sb') as any).get('data') as Y.Map<any>)
      .set('storyboard', { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' });
    Y.applyUpdate(d, Y.encodeStateAsUpdate(B), 'network');
    applyDocToStore(d);
    const sb = csNode('sb');
    expect((sb.data as any).storyboard.gridRows).toBe(2);   // 远端变更落 cs（证非陈旧断言）
    expect((sb.data as any).cells).toBeUndefined();         // 水合零派生写（deriveStoryboardCellsCache 退役面）
  });

  it('③ 水合后 ungroup 占格保通：子按 slot 格位散开+组原点翻 abs——读侧现算回归锚（现状必红）', () => {
    const d = hydrate([sbRecord(), cellRecord('c1', 0), cellRecord('c2', 1)]);
    useCanvasStore.getState().ungroup('sb');
    const c1 = csNode('c1');
    const c2 = csNode('c2');
    expect(c1.parentId).toBeUndefined();
    expect(c2.parentId).toBeUndefined();
    expect(csNode('sb')).toBeUndefined();   // 组删
    // 槽位散开（placeGrid v5：16:9 基准 320×180、CONVERT_GAP=40——slot0 rel(0,0) slot1 rel(360,0)）
    // +组原点 {100,50} 翻 abs。水合态 cs 无 cells（A3 退役）——placeGrid 输入须由 slot 现算
    // （A5 Step2 读侧 computeStoryboardCellsPatch），缓存时代/读侧现算同语义。
    expect(c1.position).toEqual({ x: 100, y: 50 });
    expect(c2.position).toEqual({ x: 460, y: 50 });
    const dc2 = d.getMap('nodes').get('c2') as Y.Map<any>;
    expect((dc2.toJSON() as any).position).toEqual({ x: 460, y: 50 });   // doc 面=真源（diff 落写；position=Y.Map 容器）
  });
});
