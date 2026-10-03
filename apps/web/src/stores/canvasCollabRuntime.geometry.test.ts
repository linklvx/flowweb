// apps/web/src/stores/canvasCollabRuntime.geometry.test.ts
// O0b-0（Spec B）格式批：翻转主锚（几何）+S1 停写锚+web 读侧版本门。
// 几何锚（plan O0b-0 Step 1 终裁 69——版本锚抓不到几何错位）：含 auto 组+分镜组+嵌套子节点夹具：
// 打开（applyDocToStore）⇒cs 子 rel 逐位≡doc.abs−帧 origin ∧ doc 无 auto 组帧键 ∧
// 二次打开逐位不变（无 S1 回写——恢复链零回写锚：远端 apply 后 doc 写入计数=0）。
// reconcile 最小实现（写域②abs→rel 直拷+组帧 origin 同 tick）挂 applyDocToStore 尾——
// doc 读取=readRecordsFromMaps（docShape 单源，禁从 nsNodes/csNodes 反推）。
// 组帧 origin：manual/storyboard 组=doc position 键；auto 组=从成员 doc.abs 推 bbox（calcGroupBounds）；
// 分镜子={0,0} 不动。
import { describe, it, expect, afterEach, vi } from 'vitest';
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { applyDocToStore, checkProjectionInvariant } from './canvasCollabRuntime';
import { fillDoc, toDocLike } from '@/collab/ydocBuilder';
import { stampDocSchema, calcGroupBounds, DEFAULT_CHILD_SIZE } from '@flowweb/shared';
import { _setIntentDocForTest } from './canvasIntents';
import { detachUndoManager, attachUndoManager } from './canvasUndo';

/** rw 漏斗窗口（canEdit 真） */
function openRwWindow() {
  useCanvasStore.setState({
    hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1',
  });
}

/** 翻转夹具（v2.1 档——doc=abs 空间）：manual 组+auto 组+分镜组+嵌套子+顶层，fillDoc 后显式 stamp。 */
function buildFlippedDoc(): Y.Doc {
  const d = new Y.Doc();
  fillDoc(d, [
    // manual 组（帧三键齐——origin=doc position 键）+子 abs(120,80) → cs 期望 rel(20,30)
    { id: 'g1', type: 'group', position: { x: 100, y: 50 }, width: 400, height: 300, data: { groupType: 'normal', name: 'manual' } },
    { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 120, y: 80 }, width: 100, height: 60, data: {} },
    // auto 组（无帧三键——键集表）+2 子 abs → origin=calcGroupBounds(成员 abs bbox)
    { id: 'g2', type: 'group', data: { groupType: 'normal', name: 'auto' } },
    { id: 'c2', type: 'imageGen', parentId: 'g2', position: { x: 300, y: 100 }, width: 200, height: 100, data: {} },
    { id: 'c3', type: 'imageGen', parentId: 'g2', position: { x: 550, y: 100 }, width: 150, height: 80, data: {} },
    // 分镜组（origin=doc position 键）+分镜子（无 position 带 wh——cs {0,0} 构造默认不动）
    { id: 'sb1', type: 'group', position: { x: 0, y: 400 }, data: { groupType: 'storyboard', cells: ['s1'], storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 1, showIndex: true, stitchResolution: '2K' } } },
    { id: 's1', type: 'imageGen', parentId: 'sb1', width: 320, height: 180, data: {} },
    // 顶层普通节点（abs 直拷）
    { id: 't1', type: 'textInput', position: { x: 700, y: 0 }, data: {} },
  ] as any, []);
  stampDocSchema(toDocLike(d));
  return d;
}

const csNode = (id: string) => useCanvasStore.getState().nodes.find((n: any) => n.id === id) as any;

describe('O0b-0 翻转主锚（几何）：打开 ⇒ cs 子 rel 逐位≡doc.abs−帧 origin', () => {
  afterEach(() => {
    _setIntentDocForTest(null);
    detachUndoManager();
    useCanvasStore.setState({ nodes: [], edges: [] });
    useNodeStore.setState({ nodes: {} as any });
  });

  it('manual 组：origin=doc position 键——cs 组=origin、子 rel=abs−origin 逐位', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    expect(csNode('g1').position).toEqual({ x: 100, y: 50 });      // origin=doc position
    expect(csNode('c1').position).toEqual({ x: 20, y: 30 });        // (120,80)−(100,50)
  });

  it('auto 组：origin=calcGroupBounds(成员 doc.abs bbox)——cs 组=origin、子 rel 同 tick 自洽', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    const expected = calcGroupBounds([
      { x: 300, y: 100, width: 200, height: 100 },
      { x: 550, y: 100, width: 150, height: 80 },
    ]);
    expect(csNode('g2').position).toEqual({ x: expected.x, y: expected.y });
    expect(csNode('c2').position).toEqual({ x: 300 - expected.x, y: 100 - expected.y });
    expect(csNode('c3').position).toEqual({ x: 550 - expected.x, y: 100 - expected.y });
  });

  it('分镜组：origin=doc position 键；分镜子={0,0} 不动（doc 无 position 键）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    expect(csNode('sb1').position).toEqual({ x: 0, y: 400 });
    expect(csNode('s1').position).toEqual({ x: 0, y: 0 });
  });

  it('顶层节点 abs 直拷；doc 无 auto 组帧三键（键集表形态保持——翻转只改空间语义不改键集）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    expect(csNode('t1').position).toEqual({ x: 700, y: 0 });
    const g2 = d.getMap('nodes').get('g2') as Y.Map<any>;
    expect(g2.has('position')).toBe(false);
    expect(g2.has('width')).toBe(false);
    expect(g2.has('height')).toBe(false);
  });

  it('二次打开逐位不变（恢复链幂等——reconcile 确定性直拷无漂移）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    const first = JSON.stringify(useCanvasStore.getState().nodes.map((n: any) => ({ id: n.id, position: n.position, width: n.width, height: n.height })));
    applyDocToStore(d);
    const second = JSON.stringify(useCanvasStore.getState().nodes.map((n: any) => ({ id: n.id, position: n.position, width: n.width, height: n.height })));
    expect(second).toBe(first);
    expect(checkProjectionInvariant(d)).toBe(true);
  });

  it('恢复链零回写锚：远端 apply 后 doc 写入计数=0（S1 停写——dispatchSystemIntents 回写通道摘除）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    let nonNetworkWrites = 0;
    d.on('afterTransaction', (tr: any) => { if (tr.origin !== 'network') nonNetworkWrites++; });
    // 对端改无关节点 data → 本端 apply（恢复链）——除远端 network 事务外零 doc 写
    const B = new Y.Doc();
    Y.applyUpdate(B, Y.encodeStateAsUpdate(d));
    (B.getMap('nodes').get('t1') as Y.Map<any>).get('data').set('content', 'remote-edit');
    Y.applyUpdate(d, Y.encodeStateAsUpdate(B), 'network');
    applyDocToStore(d);
    expect(nonNetworkWrites).toBe(0);
  });

  it('S1 停写：违反不变量的组框不再回写 doc——doc 原值保持（修复职责移交 reconcile 写 cs 面）', () => {
    useCanvasStore.setState({ nodes: [], edges: [] });
    useNodeStore.setState({ nodes: {} as any });
    useCanvasStore.setState({ hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1' });
    const d = new Y.Doc();
    fillDoc(d, [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 10, height: 10, data: { groupType: 'normal' } },
      { id: 'c1', parentId: 'g1', position: { x: 0, y: 0 }, width: 100, height: 60, data: {} },
    ] as any, []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    const m = d.getMap('nodes').get('g1') as Y.Map<any>;
    expect(m.get('width')).toBe(10);   // 非 calcGroupBounds 修复值——doc 停写
    expect(m.get('height')).toBe(10);
  });

  it('undo 栈零污染：applyDocToStore（含 reconcile）不产生 Geometry 事务入栈', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    const um = attachUndoManager(d);
    applyDocToStore(d);
    expect(um.undoStack.length).toBe(0);
  });
});

describe('O0b-0 web 读侧版本门（DEV——收到的版本四档同条件）', () => {
  afterEach(() => {
    _setIntentDocForTest(null);
    detachUndoManager();
    useCanvasStore.setState({ nodes: [], edges: [] });
    useNodeStore.setState({ nodes: {} as any });
  });

  it('无戳∧有节点 → applyDocToStore throw（DEV 断言）', () => {
    const d = new Y.Doc();
    fillDoc(d, [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }] as any, []);
    // 不 stamp——无戳有节点（构造纪律：fillDoc 本批已不写 meta，裸形态即门档）
    expect(() => applyDocToStore(d)).toThrow(/schemaVersion/);
  });

  it('戳=1 → applyDocToStore throw（v1 旧档）', () => {
    const d = new Y.Doc();
    d.getMap('meta').set('schemaVersion', 1);
    fillDoc(d, [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }] as any, []);
    expect(() => applyDocToStore(d)).toThrow(/schemaVersion/);
  });

  it('无戳∧零节点（空 doc）→ 放行（合法空档——与门判据一致）', () => {
    expect(() => applyDocToStore(new Y.Doc())).not.toThrow();
  });

  it('v2 档（stamp 夹具）→ 放行且正常水合', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    expect(() => applyDocToStore(d)).not.toThrow();
    expect(useCanvasStore.getState().nodes.length).toBeGreaterThan(0);
  });
});

// DEFAULT_CHILD_SIZE 引用锚（auto 组空档推导的缺省尺寸单源——防本地复制常量）
void DEFAULT_CHILD_SIZE;
