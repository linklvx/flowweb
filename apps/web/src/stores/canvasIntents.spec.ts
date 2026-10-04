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
import type { DocNodeRecord } from '@flowweb/shared';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { checkProjectionInvariant } from './canvasCollabRuntime';
import { dispatchCanvasIntent, dispatchProjectionDiff, captureStoreProjection, _setIntentDocForTest } from './canvasIntents';
import { applyDocToStore } from './canvasCollabRuntime';
import { seedCanvas } from '@/test/fixtures/canvas';
import { fillDoc, toDocLike } from '@/collab/ydocBuilder';
import { stampDocSchema, toDocRecords, calcStoryboardSize, resolveStoryboardConfig } from '@flowweb/shared';
import { Origin } from './canvasUndo';
import { deleteProjectByNode } from '@/api/videoProjectApi';

vi.mock('@/api/videoProjectApi', () => ({ deleteProjectByNode: vi.fn().mockResolvedValue(undefined) }));

// O0a-1：可选键 null 夹具改缺键形态（运行时等价——fillDoc != null 判定 null≡缺键同跳过；
// DocNodeRecord 类型域无 null——键集表精神：不带键而非带 null 键）
const rec = (id: string, x: number, data: Record<string, unknown> = { content: 'hi' }): DocNodeRecord => ({
  id, type: 'textInput',
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
    // O0b-0：auto 组 intent.node 无 position（键集表 0 帧键——cs {0,0} 构造默认随 upsert 落）
    dispatchCanvasIntent({ type: 'addNode', node: {
      id: 'g1', type: 'group', data: { groupType: 'normal' },
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
      id: 'g1', type: 'group', data: { groupType: 'normal' },   // O0b-0：auto 组无 position（键集表）
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
      id: 'g1', type: 'group', data: { groupType: 'normal' },   // O0b-0：auto 组无 position（键集表）
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
      { type: 'addNode', node: { id: 'g1', type: 'group', data: { groupType: 'normal' } } },   // O0b-0：auto 组无 position
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

  it("origin=Geometry 透传不入撤销栈（内容事件/修复域语义——B5'-1 起拖动提交=commitIntents LocalUser 入栈）", () => {
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

  it("moveNode 漏斗锚（B4'-2 后无 session 常规路径=叶子 resize position 批）：doc position 直写 + 不变量（origin=Geometry）——拖动批=手势期零 intent（session 驱动，B5'-1 提交=commitIntents LocalUser）", () => {
    const id = useCanvasStore.getState().addNode('text', { x: 10, y: 0 });
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr) => origins.push(tr.origin));
    useCanvasStore.getState().beginLeafResize();   // 叶子 resize 标记（终裁 30——position-only 批照常派发）
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id, position: { x: 99, y: 88 }, dragging: false },
    ]);
    useCanvasStore.getState().endLeafResize();
    const pos = ((doc.getMap('nodes').get(id) as Y.Map<any>).get('position') as Y.Map<any>).toJSON();
    expect(pos).toEqual({ x: 99, y: 88 });
    expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 99, y: 88 });
    expect(origins).toContain(Origin.Geometry);  // 叶子 resize 常规路径不入栈（拖动提交自 B5'-1 起=LocalUser 入栈）
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('updateStoryboardConfig：改配置⇒cs 帧≡calcStoryboardSize（配置单源重算）+doc 单 transact+零 moveNode 意图（O0b-5——applyGroupFrameRect 退役）', () => {
    const id1 = useCanvasStore.getState().addNode('image', { x: 10, y: 10 }, { status: 'done', fileId: 'f1' });
    const id2 = useCanvasStore.getState().addNode('image', { x: 300, y: 300 }, { status: 'done', fileId: 'f2' });
    const gid = useCanvasStore.getState().groupNodes([id1, id2]);
    useCanvasStore.getState().convertGroup(gid, 'storyboard');
    let txCount = 0;
    doc.on('afterTransaction', () => { txCount++; });   // 观察器在 setup 动作后挂——只计本次改配置
    useCanvasStore.getState().updateStoryboardConfig(gid, { gridRows: 2, gridCols: 2 });
    const cfg = resolveStoryboardConfig({ storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2 } } as any);
    const size = calcStoryboardSize(cfg.gridRows, cfg.gridCols, cfg.aspectRatio);
    const g = useCanvasStore.getState().nodes.find((n: any) => n.id === gid) as any;
    expect(g.width).toBe(size.width);    // cs 帧=calcStoryboardSize 单源（非手写派生第二实现）
    expect(g.height).toBe(size.height);
    const dm = doc.getMap('nodes').get(gid) as Y.Map<any>;
    expect(((dm.get('data') as Y.Map<any>).get('storyboard') as any).gridRows).toBe(2);   // data.storyboard 落 doc
    expect(txCount).toBe(1);             // 单 transact（applyGroupFrameRect+patchGroupData 双 dispatch 退役）
    for (const cid of [id1, id2]) {
      expect((doc.getMap('nodes').get(cid) as Y.Map<any>).has('position')).toBe(false);   // 分镜子无 position——零 moveNode 意图
    }
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

  it('addToGroup：入组信封+组框扩（cs 派生）+既有成员 rel 补偿落 doc（O0b-5：auto 组 doc 恒 0 帧键）', () => {
    const n1 = useCanvasStore.getState().addNode('text', { x: 10, y: 10 });
    const n1b = useCanvasStore.getState().addNode('text', { x: 100, y: 100 });
    const gid = useCanvasStore.getState().groupNodes([n1, n1b]);
    const n2 = useCanvasStore.getState().addNode('text', { x: 300, y: 300 });
    const widthBefore = (useCanvasStore.getState().nodes.find((n: any) => n.id === gid) as any).width;
    useCanvasStore.getState().addToGroup(gid, n2);
    expect((doc.getMap('nodes').get(n2) as Y.Map<any>).get('parentId')).toBe(gid);
    expect((doc.getMap('nodes').get(n2) as Y.Map<any>).get('extent')).toBeUndefined(); // extent 不入投影——doc 无此键
    const g = doc.getMap('nodes').get(gid) as Y.Map<any>;
    expect(g.get('width')).toBeUndefined();   // O0b-5：auto 组 doc 恒 0 帧键（帧=cs 派生——扩框证据在 cs 面）
    expect((useCanvasStore.getState().nodes.find((n: any) => n.id === gid) as any).width).toBeGreaterThan(widthBefore); // cs 组框随新成员扩
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
      // O0a-1 形状变更（预期）：分镜子 doc 无 position 键（键集表——membership 变更点剥键，
      // convert 的 move intent 落"分镜子无 position"；cs 面归零 {0,0} 构造默认保留）
      expect((doc.getMap('nodes').get(cid) as Y.Map<any>).has('position')).toBe(false);
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

  it('toggleCollapse（O0b-5 单意图）：唯 updateNodeData{collapsed} 落 doc——auto 组恒 0 帧键（折叠分支 envelope 写删，终裁 82）∧组 data 键集恰两键（savedSize 随 O0c-3 全链删）', () => {
    const n1 = useCanvasStore.getState().addNode('text', { x: 10, y: 10 });
    const n2 = useCanvasStore.getState().addNode('text', { x: 200, y: 200 });
    const gid = useCanvasStore.getState().groupNodes([n1, n2]);
    useCanvasStore.getState().toggleCollapse(gid);
    const g = doc.getMap('nodes').get(gid) as Y.Map<any>;
    expect(g.get('width')).toBeUndefined(); // auto 组折叠不写帧键——cs 折叠渲染档=COLLAPSED_SIZE 由 reconcile 派生
    expect(g.get('height')).toBeUndefined();
    const data = g.get('data') as Y.Map<any>;
    expect(data.get('collapsed')).toBe(true);
    expect([...data.keys()].sort()).toEqual(['collapsed', 'groupType']);   // 唯 collapsed 写——零快照/标记键
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

// ════════ Spec B editMode 小分片：ephemeral 键集守卫 ════════
// spec 口径 13（v3.16 终裁 53）：editMode/transformMode=本地瞬态+ephemeral——键集仅此两键；
// expanded 是 doc 态（nodeStore toggleExpanded 落 doc+决定渲染尺寸）禁入 ephemeral；
// 断言①"ephemeral 禁入 doc/cs 持久面"（漏斗入口剥键+投影出口剥键）+
// 断言②"远端 apply 后 expanded 保持源值∧渲染尺寸 data 源≡doc 尺寸"。
describe('Spec B editMode 分片：ephemeral 键集守卫（editMode/transformMode 禁入 doc/cs 持久面）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    _setIntentDocForTest(doc);
    openRwWindow();
  });
  afterEach(() => _setIntentDocForTest(null));

  it('① updateNodeData patch 含 ephemeral 键：doc data 剥键+ns data 本地瞬态保留+不变量不破', () => {
    dispatchCanvasIntent({ type: 'addNode', node: rec('n1', 10) }, Origin.LocalUser);
    dispatchCanvasIntent(
      { type: 'updateNodeData', id: 'n1', patch: { editMode: 'crop', transformMode: true, style: '写实' } },
      Origin.LocalUser,
    );
    const docData = (doc.getMap('nodes').get('n1') as Y.Map<any>).get('data') as Y.Map<any>;
    expect(docData.get('editMode')).toBeUndefined();       // ephemeral 禁入 doc（漏斗入口剥键）
    expect(docData.get('transformMode')).toBeUndefined();
    expect(docData.get('style')).toBe('写实');              // 持久键照常落 doc
    // ns=本地瞬态面：ephemeral 键保留（编辑态组件读 ns data）
    expect(useNodeStore.getState().nodes['n1'].data).toMatchObject({ editMode: 'crop', transformMode: true });
    expect(checkProjectionInvariant(doc)).toBe(true);       // 投影出口剥键一致——ephemeral 键不破 doc≡store
  });

  it('① addNode data 含 ephemeral 键：doc 与 cs 双持久面剥键（投影回填同剥）', () => {
    dispatchCanvasIntent(
      { type: 'addNode', node: rec('n1', 10, { editMode: 'crop', transformMode: true, fileId: 'f1' }) },
      Origin.LocalUser,
    );
    const docData = (doc.getMap('nodes').get('n1') as Y.Map<any>).get('data') as Y.Map<any>;
    expect(docData.get('editMode')).toBeUndefined();
    expect(docData.get('transformMode')).toBeUndefined();
    expect(docData.get('fileId')).toBe('f1');
    const csData = useCanvasStore.getState().nodes.find((n: any) => n.id === 'n1')!.data;
    expect('editMode' in csData).toBe(false);               // cs 持久面禁入 ephemeral
    expect('transformMode' in csData).toBe(false);
    expect(csData.fileId).toBe('f1');
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('② expanded 是 doc 态（防剥键扩大化）：同 patch 内 expanded 落 doc/cs、ephemeral 键剥', () => {
    dispatchCanvasIntent(
      {
        type: 'addNode',
        node: rec('m1', 10, { images: [], mainImageIndex: 0, expanded: true, nodeStatus: 'idle', editMode: 'crop' }),
      },
      Origin.LocalUser,
    );
    const docData = (doc.getMap('nodes').get('m1') as Y.Map<any>).get('data') as Y.Map<any>;
    expect(docData.get('expanded')).toBe(true);             // expanded=doc 键——剥键集不含它（终裁 53）
    expect(docData.get('editMode')).toBeUndefined();
    const csData = useCanvasStore.getState().nodes.find((n: any) => n.id === 'm1')!.data;
    expect(csData.expanded).toBe(true);
    expect('editMode' in csData).toBe(false);
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('② 远端 apply（applyDocToStore 重建窗口）后 expanded 保持 doc 源值∧渲染尺寸 data 源≡doc', () => {
    fillDoc(doc, [{
      id: 'm1', type: 'multiImageGen', parentId: null, width: null, height: null,
      position: { x: 0, y: 0 },
      data: { images: [], mainImageIndex: 0, expanded: true, nodeStatus: 'done' },
    } as any], []);
    stampDocSchema(toDocLike(doc));   // O0b-0：读侧版本门要求 v2 戳（fillDoc 不写 meta）
    applyDocToStore(doc);
    // expanded 在 doc——远端 apply 重建 ns/cs 后保持源值（渲染尺寸≡doc 尺寸的 data 前提）
    expect((useNodeStore.getState().nodes['m1'].data as any).expanded).toBe(true);
    expect(
      useCanvasStore.getState().nodes.find((n: any) => n.id === 'm1')!.data.expanded,
    ).toBe(true);
  });

  it('③ 全瞬态单键 patch：{editMode} 无他键 dispatch 后 doc data 与写前逐键相等（全瞬态=零 doc 变更=零撤销栈污染性质锚）', () => {
    dispatchCanvasIntent(
      { type: 'addNode', node: rec('n1', 10, { content: 'hi', style: '写实' }) },
      Origin.LocalUser,
    );
    const docData = (doc.getMap('nodes').get('n1') as Y.Map<any>).get('data') as Y.Map<any>;
    const snapshot = () => Object.fromEntries([...docData.keys()].map((k) => [k, docData.get(k)]));
    const before = snapshot();
    dispatchCanvasIntent(
      { type: 'updateNodeData', id: 'n1', patch: { editMode: 'crop' } },
      Origin.LocalUser,
    );
    expect(snapshot()).toEqual(before);                    // 全瞬态 patch：doc 零变更（逐键相等）
    // dispatch 实走漏斗（ns 瞬态面生效——防恒真）
    expect(useNodeStore.getState().nodes['n1'].data).toMatchObject({ editMode: 'crop' });
    expect(checkProjectionInvariant(doc)).toBe(true);
  });
});

// ════════ O0a-3：差分零几何意图（auto 组 data-only delta——差分 intent 不带几何）════════
// 锚语义：auto 组只改 data ⇒ 恰 1 个 updateNodeData ∧ 零 envelope/moveNode（plan O0a-3 Step 1）。
// 观察面=漏斗出口：data 落 doc 证明 updateNodeData 在场；cs 组对象身份不变证明零 envelope/moveNode
// （两者的 store 投影会重建 cs 节点对象——同值也重建；updateNodeData 走 ns 面、'name' 非桥键
// CANVAS_BRIDGE_KEYS 不触 cs）。
// O0b-0 挂点兑现（原预告 2026-10-02）：夹具改键集表形态——auto 组 fillDoc 不落 position 键
// （O0 键集：auto 组 0 帧键），断言改"doc 无 position 键"。
describe('O0a-3：差分零几何意图（auto 组只改 data）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    _setIntentDocForTest(doc);
    openRwWindow();
  });
  afterEach(() => _setIntentDocForTest(null));

  it('auto 组只改 data ⇒ 恰 1 个 updateNodeData（data 落 doc）∧ 零 envelope/moveNode（cs 组对象身份不变∧doc 无 position 键）', () => {
    // auto 组：cs 无 width/height（record 键集判定非 manual——0 帧键形态）。
    // cs 构造走 seedCanvas 夹具入口（C0-2 纪律——几何 setState 棘轮零增长）
    const autoGroup = () => ({
      id: 'g1', type: 'group', position: { x: 10, y: 20 }, parentId: null,
      data: { groupType: 'normal', name: 'a' },
    } as any);
    seedCanvas([autoGroup()]);
    // O0b-0 键集表形态：doc 面 auto 组无 position 键（cs 层 position 保留=投影面构造）
    fillDoc(doc, [{ id: 'g1', type: 'group', data: { groupType: 'normal', name: 'a' } } as any], []);
    const before = captureStoreProjection();
    // 只改 data：cs 组 data name a→b（F42——组 data 真值在 cs）
    seedCanvas([{ ...autoGroup(), data: { groupType: 'normal', name: 'b' } }]);
    const gBefore = useCanvasStore.getState().nodes[0];
    dispatchProjectionDiff(before, Origin.LocalUser);
    // 恰 1 个 updateNodeData：data 增量落 doc（差分非空且被消费）
    const m = doc.getMap('nodes').get('g1') as Y.Map<any>;
    expect((m.get('data') as Y.Map<any>).get('name')).toBe('b');
    // 零 envelope/moveNode：origin 值不变 ∧ doc 几何键零写入（下方三断言）。
    // O0b-2 写域① 接管（台账 a）：cs 组对象可被漏斗尾 reconcile 重建（wh=派生值接管——空 auto 组
    // COLLAPSED_SIZE 档），对象身份不再是不变量——零几何意图的观察面收敛到 origin 值+doc 侧键集。
    void gBefore;
    expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 10, y: 20 });
    // doc 几何不变：auto 组 doc 无 position 键（键集表形态）∧无 wh 键写入
    expect(m.has('position')).toBe(false);
    expect(m.has('width')).toBe(false);
    expect(m.has('height')).toBe(false);
    expect(checkProjectionInvariant(doc)).toBe(true);
  });
});

// ════════ O0a-1 键集表：diff 剥键（上游构造纪律=唯一剥键写者——v3.17 终裁 64②）════════
describe('O0a-1 键集表：分镜组新增子 ⇒ intent.node 无 position（doc 层剥键，cs {0,0} 构造默认保留）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    _setIntentDocForTest(doc);
    openRwWindow();
  });
  afterEach(() => _setIntentDocForTest(null));

  it('既有分镜组+新子落 cs {0,0}（构造默认）→ dispatchProjectionDiff → doc 子无 position 键', () => {
    // 既有分镜组先入 doc（拖图入组形态——组早已存在；夹具带完整 config——O0b-1 reconcile DEV 门要求）
    const sbGroup = {
      id: 'sb1', type: 'group', position: { x: 0, y: 0 }, width: 660, height: 371,
      data: { groupType: 'storyboard', cells: [], storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' } },
    };
    useCanvasStore.setState({ nodes: [sbGroup] as any });
    fillDoc(doc, toDocRecords([sbGroup] as any, {}) as any, []);   // O0b-0 同构链（storyboard 组剥 wh）
    const before = captureStoreProjection();
    // 新子落 cs：position {0,0}=构造默认（dropImageIntoStoryboard/mergeStoryboard 同款——纯 DOM 宫格坐标无意义）
    const child = {
      id: 'c1', type: 'imageGen', parentId: 'sb1',
      position: { x: 0, y: 0 }, width: 320, height: 180, data: { status: 'done' },
    };
    useCanvasStore.setState({ nodes: [sbGroup, child] as any });
    useNodeStore.setState({ nodes: { c1: { id: 'c1', type: 'imageGen', data: { status: 'done' } } } as any });
    dispatchProjectionDiff(before, Origin.LocalUser);
    // doc 层：子无 position 键（剥键——键集表"分镜子无 position"）
    const m = doc.getMap('nodes').get('c1') as Y.Map<any>;
    expect(m).toBeTruthy();
    expect(m.has('position')).toBe(false);
    // cs 层：构造默认 {0,0} 保留（三层表第三层——渲染面不在剥键域）
    expect(useCanvasStore.getState().nodes.find((n: any) => n.id === 'c1')!.position).toEqual({ x: 0, y: 0 });
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('集成造案：doc 预埋分镜子带 position 违例（doc-only）→ dispatchProjectionDiff 批尾 DEV 断言真抛（删挂载即红——防线假绿防护）', () => {
    // 生产不可能形态（diff 剥键=唯一合法写者）经 fillDoc 直埋 doc——fillDoc 只认记录键不做键集
    // 校验，违例 doc 恰是三层防线②（批尾 DEV throw）要当场暴露而非被静默修好的场景。
    // I-1 后口径：store 可见（afterNodes）的分镜子零位移会被补发 moveNode 剥键（合法自愈）——
    // 违例须落在 diff 触达面外（doc-only，不入 store 投影）才能存活到批尾断言
    fillDoc(doc, [
      { id: 'sb1', type: 'group', position: { x: 0, y: 0 }, width: 660, height: 371,
        data: { groupType: 'storyboard', cells: ['c1'], storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' } } },
      { id: 'c1', type: 'imageGen', parentId: 'sb1', width: 320, height: 180,
        position: { x: 5, y: 5 }, data: { status: 'done' } },
    ] as any, []);
    // store 只镜像 sb1（违例 c1 留 doc-only——store 投影无此节点 ⇒ diff 零 intent 触达违例）
    useCanvasStore.setState({ nodes: [
      { id: 'sb1', type: 'group', position: { x: 0, y: 0 }, width: 660, height: 371,
        data: { groupType: 'storyboard', cells: ['c1'], storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' } } },
    ] as any });
    const before = captureStoreProjection();
    // 无关变更：新节点 n9 入 store → diff=[addNode n9] 非空——才走得到批尾 DEV 断言（空 diff 提前 return）
    useCanvasStore.setState({ nodes: [
      ...useCanvasStore.getState().nodes,
      { id: 'n9', type: 'textInput', position: { x: 999, y: 0 }, data: {} } as any,
    ] });
    expect(() => dispatchProjectionDiff(before, Origin.LocalUser)).toThrow(/键集校验/);
    // 防线只读不修：抛点在 dispatch 之后，违例 position 键仍在 doc（非 normalize pass）
    expect((doc.getMap('nodes').get('c1') as Y.Map<any>).has('position')).toBe(true);
  });

  it('I-1 角点：既有 normal 组子 rel 恰 {0,0} → convertGroup 归分镜组（零位移）→ 补发 moveNode 剥 doc position 键', () => {
    // doc+store 同构：normal 组 g1 + 子 c1 rel {0,0}（normal 组子带 position=doc 合法键；
    // 组在数组前列——convertGroup setWithParentOrder 后的 ensureParentOrder 保证形态）
    const g1 = {
      id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 660, height: 371,
      data: { groupType: 'normal' },
    };
    const c1 = {
      id: 'c1', type: 'imageGen', parentId: 'g1',
      position: { x: 0, y: 0 }, width: 320, height: 180, data: { status: 'done' },
    };
    fillDoc(doc, toDocRecords([g1, c1] as any, {}) as any, []);   // O0b-0 同构链（manual 组保留/子 abs）
    useCanvasStore.setState({ nodes: [g1, c1] as any });
    useNodeStore.setState({ nodes: { c1: { id: 'c1', type: 'imageGen', data: { status: 'done' } } } as any });
    const before = captureStoreProjection();
    // convertGroup('storyboard') 面：组 data 迁 storyboard 配置（patchGroupData 差分半边），
    // 子 cs 归零 {0,0}（原 rel 恰 {0,0} ⇒ 零 delta——无补发时 diff 对 c1 零 intent，doc 旧
    // position 键无写者可剥，批尾 DEV 断言误抛 /键集校验/）
    const g1sb = {
      ...g1,
      data: {
        groupType: 'storyboard', cells: ['c1'],
        storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 1, showIndex: false, stitchResolution: '2K' },
      },
    };
    useCanvasStore.setState({ nodes: [g1sb, { ...c1, selected: false }] as any });
    // 真走 dispatchProjectionDiff 漏斗（同上两案手法）：不抛=补发的零位移 moveNode 经
    // applyIntentToDoc 剥 doc 键（组 updateNodeData 先于子 moveNode——cs 父前子后序）
    dispatchProjectionDiff(before, Origin.LocalUser);
    expect((doc.getMap('nodes').get('c1') as Y.Map<any>).has('position')).toBe(false);
    // cs 面构造默认保留（store 侧同值 no-op——三层表第三层，渲染面不在剥键域）
    expect(useCanvasStore.getState().nodes.find((n: any) => n.id === 'c1')!.position).toEqual({ x: 0, y: 0 });
    expect(checkProjectionInvariant(doc)).toBe(true);
  });
});
