import { describe, it, expect, afterEach, vi } from 'vitest';
// 批4b-2：syncStoreToDoc 退役——G3/W7 改意图漏斗驱动（_setIntentDocForTest 裸 doc 直驱，
// 行为锚不变：仍读 doc 断言组 data/几何）
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { applyDocToStore } from './canvasCollabRuntime';
import { _setIntentDocForTest } from './canvasIntents';
import { attachUndoManager, detachUndoManager } from './canvasUndo';
import { fillDoc, toDocLike } from '@/collab/ydocBuilder';
import { stampDocSchema } from '@flowweb/shared';

/** rw 漏斗窗口（canEdit 真）——dispatch 落注入的裸 doc */
function openRwWindow() {
  useCanvasStore.setState({
    hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1',
  });
}

// storyboardGroupFixture：按 cs 的 Node 形状构造 storyboard 组节点（data 含 groupType/storyboard 配置）

describe('G3 读 doc 断言（F42 投影分型）', () => {
  afterEach(() => _setIntentDocForTest(null));

  it('G3 读 doc 断言：updateStoryboardConfig 改比例 → doc 里的 storyboard.aspectRatio 更新（F42：组 data 唯一通道 patchGroupData→intent）', () => {
    const d = new Y.Doc();
    _setIntentDocForTest(d);
    openRwWindow();
    fillDoc(d, [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 250,
        data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false, stitchResolution: '2K' } } },
    ] as any, []);
    // cs：storyboard 组（ns 组条目陈旧 16:9——F42 投影组 data 取 cs，污染实证夹具保留）
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 250, data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false, stitchResolution: '2K' } } },
    ] as any, edges: [] });
    useNodeStore.setState({ nodes: {
      g1: { id: 'g1', type: 'group', data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false, stitchResolution: '2K' } } },
    } as any });
    useCanvasStore.getState().updateStoryboardConfig('g1', { aspectRatio: '1:1' });
    const m = d.getMap('nodes').get('g1') as any;
    // yjs 13.x typeMapSet：普通对象存为 ContentAny（JSON 编码），不自动转 Y.Map——
    // data 本身是 Y.Map（fillDoc 显式建），data.storyboard 读回是普通对象
    expect(m.get('data').get('storyboard').aspectRatio).toBe('1:1');
  });
});

describe('W7 红转绿门槛（几何进 doc——删 W7 不丢链路的锚）', () => {
  afterEach(() => _setIntentDocForTest(null));

  it('W7 红转绿门槛：resize 后几何经 intent 进 doc——读 doc 断言 width（onNodesChange setAttributes 真实路径）', () => {
    const d = new Y.Doc();
    _setIntentDocForTest(d);
    openRwWindow();
    // 初态：t1 无 width/height（fillDoc 缺键真删）
    fillDoc(d, [{ id: 't1', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], []);
    useCanvasStore.setState({ nodes: [{ id: 't1', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], edges: [] });
    useNodeStore.setState({ nodes: {} });
    // RF NodeResizer 路径：setAttributes dimensions 写 width/height → updateNodeEnvelope intent
    useCanvasStore.getState().onNodesChange([
      { type: 'dimensions', id: 't1', setAttributes: true, dimensions: { width: 500, height: 400 } } as any,
    ]);
    expect((d.getMap('nodes').get('t1') as any).get('width')).toBe(500);
    expect((d.getMap('nodes').get('t1') as any).get('height')).toBe(400);
  });
});

// O0b-0 停写装置：doc 里 g1 存量几何违反不变量（10×10 框 100×60 子）——S1 已停写（O0b-0），
// doc 保持原值；几何修复职责移交 reconcile 写 cs 面（写域②直拷）。
const S1_DOC = () => {
  useCanvasStore.setState({ nodes: [], edges: [] });
  useNodeStore.setState({ nodes: {} as any });
  const d = new Y.Doc();
  fillDoc(d, [
    { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 10, height: 10, data: { groupType: 'normal' } },
    { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, width: 100, height: 60, data: {} },
    { id: 'n1', type: 'textInput', position: { x: 50, y: 50 }, width: 100, height: 40, data: { fileId: 'new' } },
  ] as any, []);
  stampDocSchema(toDocLike(d));
  return d;
};

describe('O0b-0 S1 停写：恢复链零回写（applyDocToStore 直驱——结构锚）', () => {
  afterEach(() => detachUndoManager());

  it('恢复链零回写+ns 刷新不回退协作者编辑：applyDocToStore 后 doc 零写∧doc fileId 保持远端值', () => {
    const d = S1_DOC();
    // ns 预置陈旧 data：doc 里 fileId 已是协作者刚提交的 'new'，本端 ns 镜像还停在 'old'
    useNodeStore.setState({ nodes: { n1: { id: 'n1', type: 'textInput', data: { fileId: 'old' } } } as any });
    let docWrites = 0;
    d.on('afterTransaction', () => { docWrites++; });
    applyDocToStore(d);
    // ns 刷新发生（C1 语义保留）：storeProjection 普通节点 ns 优先——ns 必须吃到 doc 新值
    expect((useNodeStore.getState().nodes['n1'].data as any).fileId).toBe('new');
    // 零回写（S1 停写）：doc 事务计数=0——陈旧 ns 无回写通道（结构性保证取代时序约束）
    expect(docWrites).toBe(0);
    const m = d.getMap('nodes').get('n1') as any;
    expect(m.get('data').get('fileId')).toBe('new');
  });

  it('undo 栈零污染：applyDocToStore 无 Geometry 回写事务（S1 停写——撤销面无系统修复项）', () => {
    const d = S1_DOC();
    const um = attachUndoManager(d);
    applyDocToStore(d);
    expect(um.undoStack.length).toBe(0);
  });

  it('S1 停写：违反不变量的组框不再回写 doc——doc 原值保持（修复职责移交 reconcile 写 cs 面）', () => {
    const d = S1_DOC();
    useCanvasStore.setState({ collabReadOnly: false });
    applyDocToStore(d);
    const m = d.getMap('nodes').get('g1') as any;
    expect(m.get('width')).toBe(10);   // 非 calcGroupBounds 修复值、非 undefined——doc 停写
    expect(m.get('height')).toBe(10);
    // cs 面：c1 rel=abs−origin=(0−0, 0−0)——reconcile 直拷语义（doc 子 position 现为 abs 空间）
    const c1 = useCanvasStore.getState().nodes.find((n: any) => n.id === 'c1') as any;
    expect(c1.position).toEqual({ x: 0, y: 0 });
  });
});

// 乒乓夹具（Task 18 沿革——O0b-0 后语义=重开逐位不变）：doc=abs 空间，g1(0.1,0.1) 140×130；
// c1 abs(20,50) → cs rel=(20−0.1, 50−0.1)。S1 停写后恢复链结构上零回写（无几何修正无 diff 回写通道）。
// ═══ B5'-1（Spec B 终裁 48）：拖动入栈——本文件旧锚"Geometry 事务不入撤销栈"（:102 沿革——
// 当时拖动经 dragIntents origin=Geometry 不入栈）的拖动域反转锚：拖动提交=commitIntents 单
// transact Origin.LocalUser ⇒ 入撤销栈一步（undo 只回拖动）。S1/恢复链面（:102 现测体）不受
// 影响——applyDocToStore 零回写与拖动入栈正交。
describe("B5'-1 拖动入栈（终裁 48——旧锚反转为入栈）", () => {
  afterEach(() => { _setIntentDocForTest(null); detachUndoManager(); });

  it('拖动松手提交 origin=LocalUser ⇒ undoStack 1 项；undo 一步只回退拖动（doc 回 baseline）', () => {
    useCanvasStore.setState({ nodes: [], edges: [] });
    useNodeStore.setState({ nodes: {} as any });
    const d = new Y.Doc();
    _setIntentDocForTest(d);
    openRwWindow();
    fillDoc(d, [{ id: 't1', type: 'textInput', position: { x: 700, y: 0 }, data: {} } as any], []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    const um = attachUndoManager(d);
    useCanvasStore.getState().beginDragGesture([{ id: 't1' }], 1);
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 't1', position: { x: 820, y: 12 }, dragging: true } as any,
    ]);
    useCanvasStore.getState().commitIntents();
    expect(um.undoStack.length).toBe(1);   // 拖动=一步 undo（旧锚"不入栈"反转）
    um.undo();
    const m = d.getMap('nodes').get('t1') as any;
    expect(m.get('position').get('x')).toBe(700);   // undo 只回退拖动
    expect(m.get('position').get('y')).toBe(0);
  });
});

describe('恢复链重开逐位不变（Task 18 沿革——S1 停写后结构零回写）', () => {
  it('远程 apply → store 与 doc 原文逐节点深等 + doc 无回写（小数坐标）', () => {
    useCanvasStore.setState({ nodes: [], edges: [] });
    useNodeStore.setState({ nodes: {} as any });
    const d = new Y.Doc();
    fillDoc(d, [
      { id: 'g1', type: 'group', position: { x: 0.1, y: 0.1 }, width: 140, height: 130, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 20, y: 50 }, width: 100, height: 60, data: {} },
    ] as any, []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    // 期望 = doc 原文（O0b-0：cs g1=origin 直拷；c1 rel=abs−origin 浮点噪声域内 toBeCloseTo）
    const st = useCanvasStore.getState().nodes as any[];
    const g1 = st.find((n) => n.id === 'g1')!;
    const c1 = st.find((n) => n.id === 'c1')!;
    expect({ id: g1.id, position: g1.position, width: g1.width, height: g1.height })
      .toEqual({ id: 'g1', position: { x: 0.1, y: 0.1 }, width: 140, height: 130 });
    expect({ id: c1.id, parentId: c1.parentId, width: c1.width, height: c1.height })
      .toEqual({ id: 'c1', parentId: 'g1', width: 100, height: 60 });
    // 守恒锚：cs rel+origin ≡ doc.abs（20,50）——reconcile 不搬子
    expect(c1.position.x + g1.position.x).toBeCloseTo(20, 12);
    expect(c1.position.y + g1.position.y).toBeCloseTo(50, 12);
    // doc 无回写（S1 停写——结构性零 diff 回写通道）
    const m = d.getMap('nodes').get('g1') as any;
    expect(m.get('position').get('x')).toBe(0.1);
    expect(m.get('position').get('y')).toBe(0.1);
    expect(m.get('width')).toBe(140);
    expect(m.get('height')).toBe(130);
  });
});
