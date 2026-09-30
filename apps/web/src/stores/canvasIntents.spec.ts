// apps/web/src/stores/canvasIntents.spec.ts
// 批4b-1（门 C 裁决·意图漏斗）正式验收——spike（__spike_canvasIntents.spec.ts）扩展正式化：
//   七 action 全集三面：①doc 直写正确（fillDoc/applyRecordToYMap 形状）②store 投影回填（cs/ns 双 store）
//   ③checkProjectionInvariant 通过（批4a 验收器——驱动后断言 doc ≡ store）；
//   dispatch 入口契约：VIEWER 硬门 canEdit 假时 doc+store 双零写（门 C 判据②——拦截点前移）、
//   复合=序列单 transact（原子）、patch undefined=删键约定、origin 透传；
//   首批换芯接线锚：store action→intent 漏斗实贯通（action 内 dispatch——doc 首写）。
// 装置：裸 doc（_setIntentDocForTest 注入）+ 复位 store，纯漏斗路径（无 bindBridge/无 syncStoreToDoc）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// canvasIntents→canvasCollabRuntime 顶层 import HocuspocusProvider——本 spec 只消费
// checkProjectionInvariant 与 getDoc 通道，空 mock 即可（spike 同款）
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { checkProjectionInvariant } from './canvasCollabRuntime';
import { dispatchCanvasIntent, _setIntentDocForTest } from './canvasIntents';
import { fillDoc } from '@/collab/ydocBuilder';
import { Origin } from './canvasUndo';
import { deleteProjectByNode } from '@/api/videoProjectApi';

vi.mock('@/api/videoProjectApi', () => ({ deleteProjectByNode: vi.fn().mockResolvedValue(undefined) }));

const rec = (id: string, x: number, data: Record<string, unknown> = { content: 'hi' }) => ({
  id, type: 'textInput', parentId: null, width: null, height: null,
  position: { x, y: 0 }, data,
});

/** canEdit 真（hydration ready + 非 readOnly + 无 terminal）——漏斗 dispatch 门放行 */
function openRwWindow() {
  useCanvasStore.setState({
    nodes: [], edges: [], hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1',
  });
  useNodeStore.setState({ nodes: {} });
}

describe('批4b-1：七 action 三面（doc 直写 + store 投影回填 + 批4a 不变量）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    _setIntentDocForTest(doc);
    openRwWindow();
  });
  afterEach(() => _setIntentDocForTest(null));

  it('①addNode：fillDoc 形状（type/parentId/width/height/position/data）+ 双 store + 不变量', () => {
    dispatchCanvasIntent({ type: 'addNode', node: rec('n1', 10) }, Origin.LocalUser);
    const m = doc.getMap('nodes').get('n1') as Y.Map<any>;
    expect(m).toBeTruthy();
    expect(m.get('type')).toBe('textInput');
    // fillDoc：null 可选键真删键（不写 Y.Map）
    expect(m.get('parentId')).toBeUndefined();
    expect(m.get('width')).toBeUndefined();
    expect((m.get('position') as Y.Map<any>).toJSON()).toEqual({ x: 10, y: 0 });
    expect((m.get('data') as Y.Map<any>).get('content')).toBe('hi');
    expect(useCanvasStore.getState().nodes.map((n: any) => n.id)).toEqual(['n1']);
    expect(useNodeStore.getState().nodes['n1']).toBeTruthy();
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('①addNode 幂等：同 node 重复 dispatch → doc 无膨胀（同值 no-op 守卫——对齐其他 action）', () => {
    dispatchCanvasIntent({ type: 'addNode', node: rec('n1', 10) }, Origin.LocalUser);
    const sv = Y.encodeStateVector(doc);
    const keysBefore = [...doc.getMap('nodes').keys()];
    dispatchCanvasIntent({ type: 'addNode', node: rec('n1', 10) }, Origin.LocalUser);
    expect(Y.encodeStateVector(doc)).toEqual(sv);                // SV 不变=no-op 未产生新 Y item
    expect([...doc.getMap('nodes').keys()]).toEqual(keysBefore); // 键不变（无重复膨胀）
  });

  it('①addNode 组子形态（parentId/width/height）：信封完整落 doc 与 cs', () => {
    dispatchCanvasIntent({ type: 'addNode', node: {
      id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal' },
    } }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'addNode', node: {
      id: 'c1', type: 'textInput', parentId: 'g1', width: 320, height: 180,
      position: { x: 5, y: 5 }, data: {},
    } }, Origin.LocalUser);
    const c1 = doc.getMap('nodes').get('c1') as Y.Map<any>;
    expect(c1.get('parentId')).toBe('g1');
    expect(c1.get('width')).toBe(320);
    expect(c1.get('height')).toBe(180);
    const csC1 = useCanvasStore.getState().nodes.find((n: any) => n.id === 'c1')!;
    expect(csC1.parentId).toBe('g1');
    expect(csC1.width).toBe(320);
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('②updateNodeData：doc data 逐键更新 + ns 投影 + 不变量', () => {
    dispatchCanvasIntent({ type: 'addNode', node: rec('n1', 10) }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n1', patch: { content: 'changed', status: 'idle' } }, Origin.LocalUser);
    const data = (doc.getMap('nodes').get('n1') as Y.Map<any>).get('data') as Y.Map<any>;
    expect(data.get('content')).toBe('changed');
    expect(data.get('status')).toBe('idle');
    expect(useNodeStore.getState().nodes['n1'].data).toMatchObject({ content: 'changed', status: 'idle' });
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('②updateNodeData 删键约定：patch 值 undefined ⇒ doc delete 键 + ns 真删键（不留 undefined 值键）', () => {
    dispatchCanvasIntent({ type: 'addNode', node: rec('n1', 10, { content: 'hi', temp: 'x' }) }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n1', patch: { temp: undefined } }, Origin.LocalUser);
    const data = (doc.getMap('nodes').get('n1') as Y.Map<any>).get('data') as Y.Map<any>;
    expect(data.has('temp')).toBe(false);            // doc 键删（全量对账"缺键删除"的意图对应物）
    expect('temp' in (useNodeStore.getState().nodes['n1'].data as any)).toBe(false); // ns 不留 undefined 值键
    expect(checkProjectionInvariant(doc)).toBe(true); // undefined 残键会破投影等价（fast-deep-equal keys 长度）
  });

  it('③deleteNode：doc 删 + 级联删引用边（doc/cs 双端）+ ns 清 + 不变量', () => {
    dispatchCanvasIntent({ type: 'addNode', node: rec('n1', 0) }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'addNode', node: rec('n2', 100) }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'upsertEdge', edge: { id: 'e1', source: 'n1', target: 'n2' } }, Origin.LocalUser);
    expect(checkProjectionInvariant(doc)).toBe(true);
    dispatchCanvasIntent({ type: 'deleteNode', id: 'n1' }, Origin.LocalUser);
    expect(doc.getMap('nodes').get('n1')).toBeUndefined();
    expect(doc.getMap('edges').get('e1')).toBeUndefined(); // 孤儿边级联删——不删则不变量抓双端分叉
    expect(useCanvasStore.getState().edges).toEqual([]);
    expect(useNodeStore.getState().nodes['n1']).toBeUndefined();
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('④moveNode：doc position 子 Map 逐键 + cs.nodes 同步 + 不变量', () => {
    dispatchCanvasIntent({ type: 'addNode', node: rec('n1', 10) }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'moveNode', id: 'n1', position: { x: 99, y: 88 } }, Origin.LocalUser);
    const pos = ((doc.getMap('nodes').get('n1') as Y.Map<any>).get('position') as Y.Map<any>).toJSON();
    expect(pos).toEqual({ x: 99, y: 88 });
    expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 99, y: 88 });
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('⑤updateNodeEnvelope：width/height/parentId/type 四键直写 + cs 投影 + 不变量', () => {
    dispatchCanvasIntent({ type: 'addNode', node: {
      id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal' },
    } }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'addNode', node: rec('n1', 10) }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'updateNodeEnvelope', id: 'n1', patch: { parentId: 'g1', width: 500, height: 400 } }, Origin.LocalUser);
    const m = doc.getMap('nodes').get('n1') as Y.Map<any>;
    expect(m.get('parentId')).toBe('g1');
    expect(m.get('width')).toBe(500);
    expect(m.get('height')).toBe(400);
    const csN1 = useCanvasStore.getState().nodes.find((n: any) => n.id === 'n1')!;
    expect(csN1.parentId).toBe('g1');
    expect(csN1.width).toBe(500);
    expect(csN1.height).toBe(400);
    expect(checkProjectionInvariant(doc)).toBe(true);
    // resize 语义（width 收窄）+ type 键（convertGroup 形态）
    dispatchCanvasIntent({ type: 'updateNodeEnvelope', id: 'n1', patch: { width: 320, type: 'textInput' } }, Origin.LocalUser);
    expect((doc.getMap('nodes').get('n1') as Y.Map<any>).get('width')).toBe(320);
    expect(useCanvasStore.getState().nodes.find((n: any) => n.id === 'n1')!.width).toBe(320);
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('⑤updateNodeEnvelope 删键约定：patch 值 undefined ⇒ 信封键删（脱离组形态）', () => {
    dispatchCanvasIntent({ type: 'addNode', node: {
      id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal' },
    } }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'addNode', node: {
      id: 'c1', type: 'textInput', parentId: 'g1', width: 320, height: 180,
      position: { x: 0, y: 0 }, data: {},
    } }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'updateNodeEnvelope', id: 'c1', patch: { parentId: undefined } }, Origin.LocalUser);
    const m = doc.getMap('nodes').get('c1') as Y.Map<any>;
    expect(m.get('parentId')).toBeUndefined();       // 对齐 applyRecordToYMap 缺键→delete 语义
    expect(useCanvasStore.getState().nodes.find((n: any) => n.id === 'c1')!.parentId).toBeUndefined();
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('⑥upsertEdge：新建 + 同 id 更新（source/target）双分支 + 不变量', () => {
    dispatchCanvasIntent({ type: 'addNode', node: rec('n1', 0) }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'addNode', node: rec('n2', 100) }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'addNode', node: rec('n3', 200) }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'upsertEdge', edge: { id: 'e1', source: 'n1', target: 'n2' } }, Origin.LocalUser);
    expect(useCanvasStore.getState().edges).toEqual([{ id: 'e1', source: 'n1', target: 'n2' }]);
    // 更新分支：同 id 改 target——不叠新边
    dispatchCanvasIntent({ type: 'upsertEdge', edge: { id: 'e1', source: 'n1', target: 'n3' } }, Origin.LocalUser);
    const e = doc.getMap('edges').get('e1') as Y.Map<any>;
    expect(e.get('target')).toBe('n3');
    expect(useCanvasStore.getState().edges).toHaveLength(1);
    expect(useCanvasStore.getState().edges[0]).toMatchObject({ id: 'e1', target: 'n3' });
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('⑦deleteEdge：doc/cs 双删 + 不变量', () => {
    dispatchCanvasIntent({ type: 'addNode', node: rec('n1', 0) }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'addNode', node: rec('n2', 100) }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'upsertEdge', edge: { id: 'e1', source: 'n1', target: 'n2' } }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'deleteEdge', id: 'e1' }, Origin.LocalUser);
    expect(doc.getMap('edges').get('e1')).toBeUndefined();
    expect(useCanvasStore.getState().edges).toEqual([]);
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('变异（防恒真式）：只写 doc 不走 store 投影 → 不变量必红', () => {
    dispatchCanvasIntent({ type: 'addNode', node: rec('n1', 10) }, Origin.LocalUser);
    const m = new Y.Map(); m.set('type', 'textInput');
    const p = new Y.Map(); p.set('x', 50); p.set('y', 0); m.set('position', p);
    m.set('data', new Y.Map());
    doc.getMap('nodes').set('ghost', m);
    expect(checkProjectionInvariant(doc)).toBe(false);
  });
});

describe('批4b-1：dispatch 入口契约（门 C 判据②——拦截点前移锚）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    _setIntentDocForTest(doc);
    openRwWindow();
  });
  afterEach(() => _setIntentDocForTest(null));

  it('readOnly（collabReadOnly=true）：doc+store 双零写——无"先改后回弹"', () => {
    dispatchCanvasIntent({ type: 'addNode', node: rec('n1', 10) }, Origin.LocalUser);
    useCanvasStore.setState({ collabReadOnly: true });
    dispatchCanvasIntent({ type: 'moveNode', id: 'n1', position: { x: 999, y: 999 } }, Origin.LocalUser);
    const pos = ((doc.getMap('nodes').get('n1') as Y.Map<any>).get('position') as Y.Map<any>).toJSON();
    expect(pos).toEqual({ x: 10, y: 0 });                            // doc 零写
    expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 10, y: 0 }); // store 零写（dispatch 层）
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('hydration 非 ready：同款双零写（canEdit 合取分量）', () => {
    useCanvasStore.setState({ hydration: 'pending' });
    dispatchCanvasIntent({ type: 'addNode', node: rec('n1', 10) }, Origin.LocalUser);
    expect(doc.getMap('nodes').get('n1')).toBeUndefined();
    expect(useCanvasStore.getState().nodes).toEqual([]);
    expect(useNodeStore.getState().nodes).toEqual({});
  });

  it('复合序列=单 transact 原子（groupNodes 形态：组+子+入组信封+连线一个事务）+ origin 透传', () => {
    let txCount = 0;
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr) => { txCount++; origins.push(tr.origin); });
    dispatchCanvasIntent([
      { type: 'addNode', node: { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal' } } },
      { type: 'addNode', node: rec('c1', 10) },
      { type: 'updateNodeEnvelope', id: 'c1', patch: { parentId: 'g1' } },
      { type: 'upsertEdge', edge: { id: 'e1', source: 'g1', target: 'c1' } },
    ], Origin.LocalUser);
    expect(txCount).toBe(1);                    // 四 intent 一个事务（对端一帧收齐）
    expect(origins).toEqual([Origin.LocalUser]); // origin 透传（撤销栈 trackedOrigins 判据）
    expect(doc.getMap('nodes').get('g1')).toBeTruthy();
    expect((doc.getMap('nodes').get('c1') as Y.Map<any>).get('parentId')).toBe('g1');
    expect(useCanvasStore.getState().edges).toEqual([{ id: 'e1', source: 'g1', target: 'c1' }]);
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('拖拽 origin=Geometry：透传不入撤销栈语义（trackedOrigins 判据沿 canvasUndo 契约）', () => {
    dispatchCanvasIntent({ type: 'addNode', node: rec('n1', 10) }, Origin.LocalUser);
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr) => origins.push(tr.origin));
    dispatchCanvasIntent({ type: 'moveNode', id: 'n1', position: { x: 42, y: 0 } }, Origin.Geometry);
    expect(origins).toEqual([Origin.Geometry]);
  });
});

describe('批4b-1：首批换芯接线锚（store action→intent 漏斗实贯通——doc 首写）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    _setIntentDocForTest(doc);
    openRwWindow();
  });
  afterEach(() => _setIntentDocForTest(null));

  it('cs.addNode：action 内 dispatch——doc 有节点（fillDoc 形）+ 不变量', () => {
    const id = useCanvasStore.getState().addNode('text', { x: 10, y: 0 });
    const m = doc.getMap('nodes').get(id) as Y.Map<any>;
    expect(m).toBeTruthy();
    expect(m.get('type')).toBe('textInput');
    // textInput 初始 300×300 信封也落 doc（width/height）
    expect(m.get('width')).toBe(300);
    expect(useCanvasStore.getState().nodes.map((n: any) => n.id)).toEqual([id]);
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('cs.addChildNode：node+edge 双 intent（doc 连带）+ 不变量', () => {
    const sid = useCanvasStore.getState().addNode('text', { x: 0, y: 0 });
    const cid = useCanvasStore.getState().addChildNode(sid, { content: 'child' });
    expect(cid).not.toBeNull();
    expect(doc.getMap('nodes').get(cid!)).toBeTruthy();
    const edgeIds = [...doc.getMap('edges').keys()];
    expect(edgeIds).toHaveLength(1);
    expect(doc.getMap('edges').get(edgeIds[0])).toMatchObject({} as any);
    const e = doc.getMap('edges').get(edgeIds[0]) as Y.Map<any>;
    expect(e.get('source')).toBe(sid);
    expect(e.get('target')).toBe(cid);
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('cs.deleteNode：doc 删 + 级联删边 + 不变量（store 终态等价——三件套原逻辑保留）', () => {
    const s = useCanvasStore.getState();
    const n1 = s.addNode('text', { x: 0, y: 0 });
    const n2 = s.addNode('text', { x: 100, y: 0 });
    useCanvasStore.getState().onConnect({ source: n1, target: n2 } as any);
    expect(doc.getMap('edges').size).toBe(1);
    useCanvasStore.getState().deleteNode(n1);
    expect(doc.getMap('nodes').get(n1)).toBeUndefined();
    expect(doc.getMap('edges').size).toBe(0);   // 级联边删直达 doc
    expect(useCanvasStore.getState().nodes.map((n: any) => n.id)).toEqual([n2]);
    expect(useNodeStore.getState().nodes[n1]).toBeUndefined();
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('rw 窗口 videoEdit 级联回归锚：cascade 判型读变更前 state（dispatch 投影 filter 不得提前删型）', () => {
    useCanvasStore.setState({
      nodes: [{ id: 'e1', type: 'videoEdit', position: { x: 0, y: 0 }, data: {} } as any],
      edges: [], selectedId: null,
    });
    useCanvasStore.getState().deleteNode('e1');
    expect(vi.mocked(deleteProjectByNode)).toHaveBeenCalledWith('e1'); // 投影已 filter 仍须判中型
    expect(useCanvasStore.getState().nodes).toEqual([]);
  });

  it('moveNode 拖拽：onNodesChange position 批量变更 → doc position 直写 + 不变量（origin=Geometry）', () => {
    const id = useCanvasStore.getState().addNode('text', { x: 10, y: 0 });
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr) => origins.push(tr.origin));
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id, position: { x: 99, y: 88 }, dragging: true },
    ]);
    const pos = ((doc.getMap('nodes').get(id) as Y.Map<any>).get('position') as Y.Map<any>).toJSON();
    expect(pos).toEqual({ x: 99, y: 88 });
    expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 99, y: 88 });
    expect(origins).toContain(Origin.Geometry);  // 拖拽高频路径不入撤销栈
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('updateNodeEnvelope resize 链：applyGroupFrameRect（toggleCollapse/updateStoryboardConfig 消费点）→ doc width/height/position', () => {
    const gid = useCanvasStore.getState().addNode('text', { x: 0, y: 0 });
    useCanvasStore.getState().applyGroupFrameRect(gid, { x: 7, y: 8, width: 500, height: 400 });
    const m = doc.getMap('nodes').get(gid) as Y.Map<any>;
    expect(m.get('width')).toBe(500);
    expect(m.get('height')).toBe(400);
    expect((m.get('position') as Y.Map<any>).toJSON()).toEqual({ x: 7, y: 8 });
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('edge 族：onEdgesChange remove → doc 边删 + 不变量', () => {
    const n1 = useCanvasStore.getState().addNode('text', { x: 0, y: 0 });
    const n2 = useCanvasStore.getState().addNode('text', { x: 100, y: 0 });
    useCanvasStore.getState().onConnect({ source: n1, target: n2 } as any);
    const edgeId = [...doc.getMap('edges').keys()][0];
    useCanvasStore.getState().onEdgesChange([{ type: 'remove', id: edgeId }]);
    expect(doc.getMap('edges').size).toBe(0);
    expect(useCanvasStore.getState().edges).toEqual([]);
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('ns.applyNodeDataPatch（2-2 wrapper）：doc data 直写 + 不变量（setStatus/setFileResult 同 wrapper 链）', () => {
    const id = useCanvasStore.getState().addNode('text', { x: 0, y: 0 });
    useNodeStore.getState().applyNodeDataPatch(id, { content: 'changed' });
    const data = (doc.getMap('nodes').get(id) as Y.Map<any>).get('data') as Y.Map<any>;
    expect(data.get('content')).toBe('changed');
    expect(checkProjectionInvariant(doc)).toBe(true);
  });
});

// ════════ 批4b-2（组 2 收口）：剩余写点全量换芯锚 ════════
// 双路径并存退役——bindBridge 删除后这些 action 的 doc 联动只剩 dispatch 一条路。
// 复合信封写点断言"action → doc（结构+几何）+ 批4a 不变量"；数据写点断言"action → doc data"。
describe('批4b-2：复合信封写点换芯锚（组族——doc 联动+不变量）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    _setIntentDocForTest(doc);
    openRwWindow();
  });
  afterEach(() => _setIntentDocForTest(null));

  it('groupNodes：组+入组信封+rel 坐标落 doc（addNode+envelope+moveNode 序列）', () => {
    const n1 = useCanvasStore.getState().addNode('text', { x: 10, y: 10 });
    const n2 = useCanvasStore.getState().addNode('text', { x: 200, y: 200 });
    const gid = useCanvasStore.getState().groupNodes([n1, n2]);
    const g = doc.getMap('nodes').get(gid) as Y.Map<any>;
    expect(g).toBeTruthy();
    expect(g.get('type')).toBe('group');
    expect((g.get('data') as Y.Map<any>).get('groupType')).toBe('normal');
    for (const cid of [n1, n2]) {
      expect((doc.getMap('nodes').get(cid) as Y.Map<any>).get('parentId')).toBe(gid);
    }
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('ungroup：组删 + 出组信封删键 + abs 坐标还原落 doc', () => {
    const n1 = useCanvasStore.getState().addNode('text', { x: 10, y: 10 });
    const n2 = useCanvasStore.getState().addNode('text', { x: 200, y: 200 });
    const gid = useCanvasStore.getState().groupNodes([n1, n2]);
    expect(doc.getMap('nodes').get(gid)).toBeTruthy(); // 前置：组已落 doc（groupNodes 换芯）——否则删除面无载体
    useCanvasStore.getState().ungroup(gid);
    expect(doc.getMap('nodes').get(gid)).toBeUndefined();
    for (const cid of [n1, n2]) {
      const m = doc.getMap('nodes').get(cid) as Y.Map<any>;
      expect(m.get('parentId')).toBeUndefined(); // 出组=信封键删
    }
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('addToGroup：入组信封+组框+既有成员 rel 补偿落 doc', () => {
    const n1 = useCanvasStore.getState().addNode('text', { x: 10, y: 10 });
    const n1b = useCanvasStore.getState().addNode('text', { x: 100, y: 100 });
    const gid = useCanvasStore.getState().groupNodes([n1, n1b]);
    const n2 = useCanvasStore.getState().addNode('text', { x: 300, y: 300 });
    useCanvasStore.getState().addToGroup(gid, n2);
    expect((doc.getMap('nodes').get(n2) as Y.Map<any>).get('parentId')).toBe(gid);
    expect((doc.getMap('nodes').get(n2) as Y.Map<any>).get('extent')).toBeUndefined(); // extent 不入投影——doc 无此键
    const g = doc.getMap('nodes').get(gid) as Y.Map<any>;
    expect(g.get('width')).toBeGreaterThan(0); // 组框随新成员扩
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('removeNodeFromGroup：出组 + abs 还原 + 组框收缩落 doc（留子 → 组存活）', () => {
    const n1 = useCanvasStore.getState().addNode('text', { x: 10, y: 10 });
    const n2 = useCanvasStore.getState().addNode('text', { x: 200, y: 200 });
    const gid = useCanvasStore.getState().groupNodes([n1, n2]);
    expect(doc.getMap('nodes').get(gid)).toBeTruthy(); // 前置同 ungroup 锚
    useCanvasStore.getState().removeNodeFromGroup(gid, n1);
    const m = doc.getMap('nodes').get(n1) as Y.Map<any>;
    expect(m.get('parentId')).toBeUndefined();
    expect((m.get('position') as Y.Map<any>).toJSON()).toEqual({ x: 10, y: 10 }); // abs 还原
    expect((doc.getMap('nodes').get(n2) as Y.Map<any>).get('parentId')).toBe(gid); // 留子仍在组
    expect(doc.getMap('nodes').get(gid)).toBeTruthy(); // 仍有子 → 组不解
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('convertGroup→storyboard：组框配置化 + 子归零 + cells/storyboard data 落 doc', () => {
    // isImageCompletedNode 要求：imageGen + status done + fileId
    const id1 = useCanvasStore.getState().addNode('image', { x: 10, y: 10 }, { status: 'done', fileId: 'f1' });
    const id2 = useCanvasStore.getState().addNode('image', { x: 300, y: 300 }, { status: 'done', fileId: 'f2' });
    const gid = useCanvasStore.getState().groupNodes([id1, id2]);
    useCanvasStore.getState().convertGroup(gid, 'storyboard');
    const g = doc.getMap('nodes').get(gid) as Y.Map<any>;
    const data = g.get('data') as Y.Map<any>;
    expect(data.get('groupType')).toBe('storyboard');
    expect((data.get('cells') as any[]).length).toBe(2);
    expect((data.get('storyboard') as any).gridCols).toBeGreaterThan(0);
    for (const cid of [id1, id2]) {
      expect(((doc.getMap('nodes').get(cid) as Y.Map<any>).get('position') as Y.Map<any>).toJSON())
        .toEqual({ x: 0, y: 0 }); // 分镜子坐标归零
    }
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('patchGroupData：组 data 增量 patch 落 doc（唯一通道——renameGroup/cells 族共用）', () => {
    const n1 = useCanvasStore.getState().addNode('text', { x: 10, y: 10 });
    const n2 = useCanvasStore.getState().addNode('text', { x: 200, y: 200 });
    const gid = useCanvasStore.getState().groupNodes([n1, n2]);
    useCanvasStore.getState().renameGroup(gid, '我的组');
    const data = (doc.getMap('nodes').get(gid) as Y.Map<any>).get('data') as Y.Map<any>;
    expect(data.get('name')).toBe('我的组');
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('toggleCollapse：折叠组框 COLLAPSED_SIZE + collapsed/savedSize data 落 doc', () => {
    const n1 = useCanvasStore.getState().addNode('text', { x: 10, y: 10 });
    const n2 = useCanvasStore.getState().addNode('text', { x: 200, y: 200 });
    const gid = useCanvasStore.getState().groupNodes([n1, n2]);
    useCanvasStore.getState().toggleCollapse(gid);
    const g = doc.getMap('nodes').get(gid) as Y.Map<any>;
    expect(g.get('width')).toBe(200); // COLLAPSED_SIZE 200×64（组框写点=折叠分支直写——非 applyGroupFrameRect）
    expect(g.get('height')).toBe(64);
    expect((g.get('data') as Y.Map<any>).get('collapsed')).toBe(true);
    expect((g.get('data') as Y.Map<any>).get('savedSize')).toBeTruthy();
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('duplicateGroup：组+子+组内边全量复制落 doc（addNode×N+upsertEdge×M）', () => {
    const n1 = useCanvasStore.getState().addNode('text', { x: 10, y: 10 });
    const n2 = useCanvasStore.getState().addNode('text', { x: 300, y: 300 });
    useCanvasStore.getState().onConnect({ source: n1, target: n2 } as any);
    const gid = useCanvasStore.getState().groupNodes([n1, n2]);
    const beforeNodes = doc.getMap('nodes').size;
    const beforeEdges = doc.getMap('edges').size;
    const newGid = useCanvasStore.getState().duplicateGroup(gid);
    expect(newGid).not.toBeNull();
    expect(doc.getMap('nodes').size).toBe(beforeNodes + 3); // 组+双子
    expect(doc.getMap('edges').size).toBe(beforeEdges + 1); // 组内边
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('clearStoryboard：cells 成员删（级联边删）+ cells 清空落 doc', () => {
    const id1 = useCanvasStore.getState().addNode('image', { x: 0, y: 0 }, { status: 'done', fileId: 'f1' });
    const id2 = useCanvasStore.getState().addNode('image', { x: 300, y: 0 }, { status: 'done', fileId: 'f2' });
    const gid = useCanvasStore.getState().groupNodes([id1, id2]);
    useCanvasStore.getState().convertGroup(gid, 'storyboard');
    useCanvasStore.getState().clearStoryboard(gid);
    expect(doc.getMap('nodes').get(id1)).toBeUndefined();
    expect(doc.getMap('nodes').get(id2)).toBeUndefined();
    const data = (doc.getMap('nodes').get(gid) as Y.Map<any>).get('data') as Y.Map<any>;
    expect(data.get('cells')).toEqual([]);
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('removeStoryboardCell：槽成员删 + cells 紧凑前移落 doc', () => {
    const id1 = useCanvasStore.getState().addNode('image', { x: 0, y: 0 }, { status: 'done', fileId: 'f1' });
    const id2 = useCanvasStore.getState().addNode('image', { x: 300, y: 0 }, { status: 'done', fileId: 'f2' });
    const gid = useCanvasStore.getState().groupNodes([id1, id2]);
    useCanvasStore.getState().convertGroup(gid, 'storyboard');
    useCanvasStore.getState().removeStoryboardCell(gid, 0);
    const data = (doc.getMap('nodes').get(gid) as Y.Map<any>).get('data') as Y.Map<any>;
    expect(doc.getMap('nodes').get(id1)).toBeUndefined();
    expect(data.get('cells')).toEqual([id2]); // 紧凑前移
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('deleteTransformNode：删 + 级联引用边落 doc', () => {
    const n1 = useCanvasStore.getState().addNode('text', { x: 0, y: 0 });
    const n2 = useCanvasStore.getState().addNode('text', { x: 100, y: 0 });
    useCanvasStore.getState().onConnect({ source: n1, target: n2 } as any);
    useCanvasStore.getState().deleteTransformNode(n1);
    expect(doc.getMap('nodes').get(n1)).toBeUndefined();
    expect(doc.getMap('edges').size).toBe(0);
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('auto 边：ensureAutoEdges 路径（addEdge 确定性 id）→ doc 建边 + origin=AutoEdge（不入撤销栈契约）', async () => {
    const s1 = useCanvasStore.getState().addNode('text', { x: 0, y: 0 });
    const edit1 = useCanvasStore.getState().addNode('text', { x: 100, y: 0 });
    const { attachUndoManager } = await import('./canvasUndo');
    const um = attachUndoManager(doc);   // 建节点（LocalUser）之后挂——栈上只应有后续 auto 边（零项）
    const seenOrigins: unknown[] = [];
    doc.on('afterTransaction', (tr) => { if (tr.origin === 'auto-edge') seenOrigins.push(tr.origin); });
    const { ensureAutoEdges } = await import('@/pages/canvas/video-editor/timeline/auto-edges');
    ensureAutoEdges(edit1, { clips: { c1: { type: 'video', sourceNodeId: s1 } } } as any);
    const e = doc.getMap('edges').get(`auto:${edit1}:${s1}`) as Y.Map<any>;
    expect(e).toBeTruthy();
    expect(e.get('source')).toBe(s1);
    expect(seenOrigins).toContain('auto-edge'); // AutoEdge origin 契约（撤销栈不收自动边）
    expect(um.undoStack.length).toBe(0);       // auto 边建边不入栈
  });
});

describe('批4b-2：nodeStore 数据写点换芯锚（ns 剩余 action → doc data）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    _setIntentDocForTest(doc);
    openRwWindow();
  });
  afterEach(() => _setIntentDocForTest(null));

  const dataOf = (id: string) => (doc.getMap('nodes').get(id) as Y.Map<any>).get('data') as Y.Map<any>;

  it('updateText：content 落 doc data', () => {
    const id = useCanvasStore.getState().addNode('text', { x: 0, y: 0 });
    useNodeStore.getState().updateText(id, '新内容');
    expect(dataOf(id).get('content')).toBe('新内容');
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('updateConfig：mergeNodeData 终态全量落 doc data（含 defaults）', () => {
    // doc+cs 种子（ns 缺席——updateConfig 幽灵守卫过 cs 面；投影 data ns 缺席回落 cs）
    fillDoc(doc, [{ id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any], []);
    useCanvasStore.setState({
      nodes: [{ id: 'img1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any],
    });
    useNodeStore.setState({ nodes: {} });
    useNodeStore.getState().updateConfig('img1', { style: '动漫' });
    const d = dataOf('img1');
    expect(d.get('style')).toBe('动漫');
    expect(d.get('model')).toBe('sdxl'); // mergeNodeData defaults 同步落 doc（旧全量同步同语义）
    expect(d.get('imageRotation')).toBe(0); // 通用 defaults 同
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('updateExtConfig：extConfig 合并终态落 doc data', () => {
    fillDoc(doc, [{ id: 'ext1', type: 'imageExtGen', position: { x: 0, y: 0 },
      data: { extConfig: { ratio: '16:9' } } } as any], []);
    useCanvasStore.setState({
      nodes: [{ id: 'ext1', type: 'imageExtGen', position: { x: 0, y: 0 },
        data: { extConfig: { ratio: '16:9' } } } as any],
    });
    useNodeStore.setState({
      nodes: { ext1: { id: 'ext1', type: 'imageExtGen', data: { extConfig: { ratio: '16:9' } } as any } },
    });
    useNodeStore.getState().updateExtConfig('ext1', { model: 'new-model' });
    expect((dataOf('ext1').get('extConfig') as any).model).toBe('new-model');
    expect((dataOf('ext1').get('extConfig') as any).ratio).toBe('16:9'); // 既有键保留
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('trim 三写点：updateVideoTrim/setTrimTaskStatus/setTrimmedResult 落 doc data', () => {
    fillDoc(doc, [{ id: 'vid1', type: 'videoGen', position: { x: 0, y: 0 }, data: { model: 'm' } } as any], []);
    useCanvasStore.setState({
      nodes: [{ id: 'vid1', type: 'videoGen', position: { x: 0, y: 0 }, data: { model: 'm' } } as any],
    });
    useNodeStore.setState({
      nodes: { vid1: { id: 'vid1', type: 'videoGen', data: { model: 'm' } as any } },
    });
    useNodeStore.getState().updateVideoTrim('vid1', 5.2, 18.7);
    useNodeStore.getState().setTrimTaskStatus('vid1', 'processing');
    useNodeStore.getState().setTrimmedResult('vid1', 'file-x');
    const d = dataOf('vid1');
    expect(d.get('trimStart')).toBe(5.2);
    expect(d.get('trimEnd')).toBe(18.7);
    expect(d.get('trimTaskStatus')).toBe('done');
    expect(d.get('trimmedFileId')).toBe('file-x');
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('multiImage 三写点：images/mainImageIndex/nodeStatus 落 doc data', () => {
    fillDoc(doc, [{ id: 'm1', type: 'multiImageGen', position: { x: 0, y: 0 },
      data: { images: [], mainImageIndex: 0, expanded: false, nodeStatus: 'idle' } } as any], []);
    useCanvasStore.setState({
      nodes: [{ id: 'm1', type: 'multiImageGen', position: { x: 0, y: 0 },
        data: { images: [], mainImageIndex: 0, expanded: false, nodeStatus: 'idle' } as any }],
    });
    useNodeStore.setState({
      nodes: { m1: { id: 'm1', type: 'multiImageGen', data: { images: [], mainImageIndex: 0, expanded: false, nodeStatus: 'idle' } as any } },
    });
    const imgs = [{ id: 'i1', url: 'u', name: 'n', status: 'success' }];
    useNodeStore.getState().updateMultiImageImages('m1', imgs as any);
    useNodeStore.getState().setMainImageIndex('m1', 3);
    useNodeStore.getState().updateMultiImageNodeStatus('m1', 'done');
    useNodeStore.getState().toggleExpanded('m1');
    const d = dataOf('m1');
    expect(d.get('images')).toEqual(imgs);
    expect(d.get('mainImageIndex')).toBe(3);
    expect(d.get('nodeStatus')).toBe('done');
    expect(d.get('expanded')).toBe(true);
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('updatePromptImages：allImages 落 doc data', () => {
    fillDoc(doc, [{ id: 'img2', type: 'imageGen', position: { x: 0, y: 0 }, data: { allImages: [] } } as any], []);
    useCanvasStore.setState({
      nodes: [{ id: 'img2', type: 'imageGen', position: { x: 0, y: 0 }, data: { allImages: [] } as any }],
    });
    useNodeStore.setState({
      nodes: { img2: { id: 'img2', type: 'imageGen', data: { allImages: [] } as any } },
    });
    const imgs = [{ id: 'r1', url: 'u', name: 'n', status: 'success' }];
    useNodeStore.getState().updatePromptImages('img2', imgs as any);
    expect(dataOf('img2').get('allImages')).toEqual(imgs);
    expect(checkProjectionInvariant(doc)).toBe(true);
  });
});
