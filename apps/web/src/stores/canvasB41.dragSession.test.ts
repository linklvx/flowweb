// apps/web/src/stores/canvasB41.dragSession.test.ts
// B4'-1（Spec B）：dragSession 生命周期落地——begin/beginResize/endGesture 单收尾+watchdog 分场景。
//
// 红测试锚（plan B4'-1）：
//   ① watchdog 分场景两锚（终裁 47——可达可测）：场景Ⅰ"正常 pointerup 后人为残留 session（abort
//      形态）⇒watchdog 秒级丢弃+cs 回滚 baseline"；场景Ⅱ"吞 pointerup⇒begin 丢弃"（begin 无条件
//      丢弃旧 session——静默 drop 非回滚：pointerup 未达=结果不可判定，doc 落后 cs 由下一命令差分补上）。
//   ② 按住不动 60s / 双指→抬第二指→首指停 5s / 35s 慢拖 ⇒ 不丢不告警（activePointers 键控集合
//      非空=指针仍按住——watchdog 续挂观察而非误杀，终裁 16/25①）。
//   ③ endGesture 语义两锚（终裁 66④）：拖动提交后同 tick cs.position≡末帧拖动位置（cs 侧显式）；
//      松手后人为再触发 endGesture⇒cs 不回跳（收尾幂等）。
//   ④ 中止回滚补强：cs≡baseline ∧ doc 零几何写入 ∧ 拖动中被远端写的被拖节点 cs≡doc 远端值
//      （清 session 后 reconcile 直拷 doc=终态正确——非 baseline）∧ 无关节点保留远端值（baseline=
//      被拖集合快照非整表，终裁 56）。
//   ⑤ O0b-3 行为锚补齐（真实 begin 生命周期，非骨架注入）：拖子中远端改无关节点⇒冻结组帧与全部
//      子 rel 逐帧不变；拖动中远端写⇒松手后 doc.abs≡末帧 cs.abs；resize 扩子代。
//   ⑥ beginResize 首行 discard（终裁 31⑤）；frozenFrames 与 session 同步块清空（含 watchdog
//      clearTimeout——清理字段表：frozenFrames/activePointers/gestureAbandoned/resizePending/
//      resizeTargetId 随 dragSession=null 整对象清）。
//
// 测试纪律：零裸 useCanvasStore.setState（文件级棘轮——几何经 seedCanvas、session 经 store action）；
// applyDocToStore 尾挂 assertDocAbsMatchesCsRel 只查带 parentId 记录且无让位豁免——被拖子 doc.abs
// 须与 rel+冻结 origin 保持一致（B4'-2 手势期零 doc 写前的收敛语义），否则 DEV 假红非本批锚面。
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import * as Y from 'yjs';
import { useCanvasStore, DRAG_STALE_MS } from './canvasStore';
import { applyDocToStore, reconcileGroupGeometry, resolveGestureYield } from './canvasCollabRuntime';
import { fillDoc, toDocLike } from '@/collab/ydocBuilder';
import { stampDocSchema, type DocNodeRecord } from '@flowweb/shared';
import { _setIntentDocForTest } from './canvasIntents';
import { seedCanvas, openRwWindow, resetCanvasStores } from '@/test/fixtures/canvas';

const csNode = (id: string) => useCanvasStore.getState().nodes.find((n: any) => n.id === id) as any;
const session = () => useCanvasStore.getState().dragSession;

/** 夹具：manual 组 g1(100,50,400×300)+双子（c1 rel 20,30 / c1b rel 100,40）+顶层 t1(700,0)。 */
const FIXTURE_RECORDS: DocNodeRecord[] = [
  { id: 'g1', type: 'group', position: { x: 100, y: 50 }, width: 400, height: 300, data: { groupType: 'normal', name: 'manual' } },
  { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 120, y: 80 }, width: 100, height: 60, data: {} },
  { id: 'c1b', type: 'imageGen', parentId: 'g1', position: { x: 200, y: 90 }, width: 80, height: 50, data: {} },
  { id: 't1', type: 'textInput', position: { x: 700, y: 0 }, data: {} },
];

function buildDoc(): Y.Doc {
  const d = new Y.Doc();
  fillDoc(d, FIXTURE_RECORDS, []);
  stampDocSchema(toDocLike(d));
  return d;
}

/** 对端远端写（network 事务——applyDocToStore 消费的真实入口形态）。 */
function remoteMutate(d: Y.Doc, fn: (mirror: Y.Doc) => void): void {
  const B = new Y.Doc();
  Y.applyUpdate(B, Y.encodeStateAsUpdate(d));
  fn(B);
  Y.applyUpdate(d, Y.encodeStateAsUpdate(B), 'network');
}

const nodeMap = (d: Y.Doc, id: string) => d.getMap('nodes').get(id) as Y.Map<any>;
const docPos = (d: Y.Doc, id: string) => {
  const p = nodeMap(d, id).get('position') as Y.Map<any>;
  return p ? { x: p.get('x'), y: p.get('y') } : undefined;
};

/** 手势帧（RF position 批的 cs 活值——B4'-2 编排前的等价驱动；经 fixture 单点）。 */
const dragFrame = (id: string, pos: { x: number; y: number }) => {
  seedCanvas(useCanvasStore.getState().nodes.map((n: any) => (
    n.id === id ? { ...n, position: { ...pos } } : n
  )));
};

const begin = (ids: string[], pointerId: number | null) =>
  useCanvasStore.getState().beginDragGesture(ids.map((id) => ({ id })), pointerId);

afterEach(() => {
  _setIntentDocForTest(null);
  if (useCanvasStore.getState().dragSession) useCanvasStore.getState().endGesture('completed');
  vi.useRealTimers();
  resetCanvasStores();
});

// ══════════ beginDragGesture：键控集合+被拖集合快照+冻结框 ══════════

describe("B4'-1 beginDragGesture 装配", () => {
  it('draggingIds=第三参 id 集+baseline=被拖集合快照（非整表）+冻结框=被拖子父组+activePointers={起始 pointerId}', () => {
    seedCanvas([
      { id: 'g1', type: 'group', position: { x: 100, y: 50 }, width: 400, height: 300, data: { groupType: 'normal' } } as any,
      { id: 'c1', type: 'imageGen', position: { x: 20, y: 30 }, parentId: 'g1', data: {} } as any,
      { id: 'c1b', type: 'imageGen', position: { x: 100, y: 40 }, parentId: 'g1', data: {} } as any,
      { id: 't1', type: 'textInput', position: { x: 700, y: 0 }, data: {} } as any,
    ]);
    begin(['c1', 't1'], 7);
    const s = session()!;
    expect([...s.draggingIds].sort()).toEqual(['c1', 't1']);          // 第三参全量（O0b-3 定案）
    expect([...s.baseline.keys()].sort()).toEqual(['c1', 't1']);      // 被拖集合——c1b/g1 不在（非整表）
    expect(s.baseline.get('t1')).toMatchObject({ x: 700, y: 0 });
    expect(s.baseline.get('c1')).toMatchObject({ x: 20, y: 30 });
    expect([...s.frozenFrames.keys()]).toEqual(['g1']);               // 冻结框=被拖子的父组（让位即冻结）
    expect(s.frozenFrames.get('g1')).toMatchObject({ x: 100, y: 50, width: 400, height: 300 });
    expect([...s.dragProtectedIds].sort()).toEqual(['c1', 't1']);     // live 层=被拖集合
    expect([...s.draggedGroupIds]).toEqual([]);                       // 被拖组空（拖子档）
    expect([...s.activePointers]).toEqual([7]);                       // 键控集合={起始 pointerId}（终裁 31①）
    expect(s.gestureKind).toBe('drag');
    expect(s.resizeTargetId).toBeNull();
    expect(s.gestureAbandoned).toBe(false);
    expect(s.delta).toEqual({ x: 0, y: 0 });
  });

  it("吞 pointerup 兜（终裁 47 场景Ⅱ store 面）：begin 无条件丢弃旧 session——静默替换不回滚", () => {
    seedCanvas([{ id: 't1', type: 'textInput', position: { x: 700, y: 0 }, data: {} } as any]);
    begin(['t1'], 1);
    dragFrame('t1', { x: 800, y: 10 });   // 旧手势末帧（pointerup 被吞——结果未定）
    begin(['t1'], 2);                     // 下一次 begin 无条件丢弃旧 session
    const s = session()!;
    expect([...s.activePointers]).toEqual([2]);   // 新起始指针
    expect(s.lastActivityAt).toBeGreaterThan(0);
    expect(csNode('t1').position).toEqual({ x: 800, y: 10 });   // 静默 drop：不回滚（doc 落后 cs 由下一命令差分补上）
  });
});

// ══════════ beginResize：首行 discard（终裁 31⑤） ══════════

describe("B4'-1 beginResize 首行 discard", () => {
  it('abort 后立即 resize ⇒ 旧 drag session 静默清——让位集合只含 resizeTargetId∪children', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['c1'], 1);                     // 旧 drag session（让位含 c1+冻结 g1）
    useCanvasStore.getState().beginResize('g1', 3);
    const s = session()!;
    expect(s.gestureKind).toBe('resize');
    expect(s.resizePending).toBe(true);
    expect(s.resizeTargetId).toBe('g1');
    expect(s.draggingIds.size).toBe(0);            // 旧 drag 残留清空
    expect(s.frozenFrames.size).toBe(0);
    expect([...s.activePointers]).toEqual([3]);
    // 让位集合实证：g1[帧三字段]∪children(g1)={g1,c1,c1b}——无旧 drag 残留（终裁 31⑤）
    const yieldIds = [...resolveGestureYield(s, useCanvasStore.getState().nodes as any[]).keys()].sort();
    expect(yieldIds).toEqual(['c1', 'c1b', 'g1']);
  });
});

// ══════════ watchdog 分场景（终裁 47——STALE_MS=5s 冻结值） ══════════

describe("B4'-1 watchdog 分场景（终裁 47）", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it("场景Ⅰ：正常 pointerup 后人为残留 session（abort 形态）⇒ 秒级丢弃+cs 回滚 baseline+doc 零几何写入", () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['t1'], 1);
    dragFrame('t1', { x: 800, y: 10 });             // 手势末帧（cs 活值，doc 未写——B4'-2 前手势期形态）
    session()!.activePointers.delete(1);            // pointerup 已达（正常路径后人为残留——abort 形态）
    vi.advanceTimersByTime(DRAG_STALE_MS);
    expect(session()).toBeNull();                   // 秒级丢弃
    expect(csNode('t1').position).toEqual({ x: 700, y: 0 });   // cs 回滚 baseline（静止恢复）
    expect(docPos(d, 't1')).toEqual({ x: 700, y: 0 });         // doc 零几何写入
  });

  it('按住不动 60s ⇒ 不丢不告警（指针仍按住——续挂观察）→ 继续拖末帧保留', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    vi.advanceTimersByTime(3_000);
    begin(['t1'], 1);
    vi.advanceTimersByTime(60_000);                 // 12×STALE_MS 静止按住
    const s = session();
    expect(s).not.toBeNull();
    expect(s!.gestureAbandoned).toBe(false);        // 不告警
    // 继续拖（真实 position 批路径——doc 落末帧）⇒ 收尾保留末帧（delta 正确不丢）
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 't1', position: { x: 750, y: 20 }, dragging: true } as any,
    ]);
    useCanvasStore.getState().endGesture('completed');
    expect(csNode('t1').position).toEqual({ x: 750, y: 20 });
  });

  it('双指→抬第二指→首指停 5s→继续拖不丢（remove 无命中幂等——集合仍含首指 id）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['t1'], 1);
    session()!.activePointers.delete(2);            // 第二指抬起（touchend+pointerup 同帧双上报——delete(2) 幂等无命中）
    vi.advanceTimersByTime(DRAG_STALE_MS);          // 首指停 5s
    expect(session()).not.toBeNull();               // 集合仍含首指 id=非孤儿——不丢
    expect([...session()!.activePointers]).toEqual([1]);
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 't1', position: { x: 760, y: 25 }, dragging: true } as any,
    ]);
    useCanvasStore.getState().endGesture('completed');
    expect(csNode('t1').position).toEqual({ x: 760, y: 25 });
  });

  it('35s 慢拖不丢（活动重挂——noteDragActivity 刷新 lastActivityAt+watchdog）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['t1'], 1);
    for (let i = 0; i < 7; i++) {                   // 7×5s=35s——每 5s 内有 pointermove 活动
      vi.advanceTimersByTime(4_000);
      useCanvasStore.getState().noteDragActivity();
      vi.advanceTimersByTime(1_000);
    }
    expect(session()).not.toBeNull();
    expect(session()!.activePointers.size).toBe(1);
  });

  it('frozenFrames 与 session 同步块清空（含 watchdog clearTimeout）——收尾后零悬挂 timer', () => {
    seedCanvas([{ id: 't1', type: 'textInput', position: { x: 700, y: 0 }, data: {} } as any]);
    begin(['t1'], 1);
    expect(vi.getTimerCount()).toBe(1);             // watchdog armed
    useCanvasStore.getState().endGesture('completed');
    expect(session()).toBeNull();                   // frozenFrames/activePointers/gestureAbandoned/resizePending/resizeTargetId 随整对象清
    expect(vi.getTimerCount()).toBe(0);             // clearTimeout 同步块内
    const frozen = JSON.stringify(useCanvasStore.getState().nodes);
    vi.advanceTimersByTime(60_000);                 // 收尾后 timer 不再触发任何动作
    expect(JSON.stringify(useCanvasStore.getState().nodes)).toBe(frozen);
  });
});

// ══════════ endGesture 语义（终裁 66④ 两锚+中止回滚补强） ══════════

describe("B4'-1 endGesture 语义（终裁 66④）", () => {
  it('①拖动提交后同 tick cs.position≡末帧拖动位置（真实 onNodesChange 路径——cs 侧显式，不被收尾抹掉）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['t1'], 1);
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 't1', position: { x: 800, y: 10 }, dragging: true } as any,
    ]);
    expect(docPos(d, 't1')).toEqual({ x: 800, y: 10 });   // 真实路径 doc 已落（提交面）
    useCanvasStore.getState().endGesture('completed');
    expect(csNode('t1').position).toEqual({ x: 800, y: 10 });   // cs≡末帧（同 tick）
  });

  it('②收尾幂等：松手后再人为触发一次 endGesture ⇒ cs 不回跳（无 session=no-op）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['t1'], 1);
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 't1', position: { x: 800, y: 10 }, dragging: true } as any,
    ]);
    useCanvasStore.getState().endGesture('completed');
    useCanvasStore.getState().endGesture('aborted');       // 人为再触发（含回滚分支）
    expect(csNode('t1').position).toEqual({ x: 800, y: 10 });   // 不回跳
    expect(session()).toBeNull();
  });

  it('中止回滚：被拖节点 cs.position≡baseline ∧ doc 零几何写入', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['c1'], 1);
    dragFrame('c1', { x: 45, y: 60 });
    useCanvasStore.getState().endGesture('aborted');
    expect(csNode('c1').position).toEqual({ x: 20, y: 30 });     // baseline（begin 时点 cs 值）
    expect(docPos(d, 'c1')).toEqual({ x: 120, y: 80 });          // doc 零几何写入
    expect(nodeMap(d, 'g1').get('width')).toBe(400);
  });

  it('拖动中被远端写的被拖节点：清 session 后 reconcile 直拷 doc=终态（cs≡doc 远端值——非 baseline）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['c1'], 1);
    dragFrame('c1', { x: 45, y: 60 });
    remoteMutate(d, (B) => {                                  // 拖动中远端写被拖节点（不经 applyDocToStore——
      nodeMap(B, 'c1').get('position').set('x', 200);         // 尾挂断言无让位豁免，见文件头纪律；锚面=收尾链
      nodeMap(B, 'c1').get('position').set('y', 150);         // 自身：清 session 后 reconcile 直拷 doc）
    });
    useCanvasStore.getState().endGesture('aborted');
    expect(csNode('c1').position).toEqual({ x: 100, y: 100 });  // =doc 远端 abs(200,150)−origin(100,50)——终态正确非 baseline(20,30)
  });

  it('baseline=被拖集合域（非整表）：拖动中止回滚后无关节点保留远端值（终裁 56）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['c1'], 1);
    dragFrame('c1', { x: 45, y: 60 });
    // 手势期 doc.abs 与 rel+冻结 origin 一致（尾挂断言无让位豁免——见文件头纪律）
    nodeMap(d, 'c1').get('position').set('x', 145);
    nodeMap(d, 'c1').get('position').set('y', 110);
    remoteMutate(d, (B) => {
      nodeMap(B, 't1').get('position').set('x', 999);
      nodeMap(B, 't1').get('position').set('y', 999);
    });
    applyDocToStore(d);
    useCanvasStore.getState().endGesture('aborted');
    expect(csNode('t1').position).toEqual({ x: 999, y: 999 });  // 无关节点保留远端值（baseline 非整表——t1 不在快照内不被回滚）
    expect(csNode('c1').position).toEqual({ x: 45, y: 60 });    // 被拖节点取 doc 终态（手势 doc 已一致落 145,110）
  });
});

// ══════════ O0b-3 行为锚补齐（真实 begin 生命周期） ══════════

describe("B4'-1 O0b-3 行为锚补齐（真实生命周期——非骨架注入）", () => {
  it('拖子中远端改无关节点 ⇒ 冻结组帧与全部子 rel 逐帧不变（两轮）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['c1'], 1);
    dragFrame('c1', { x: 45, y: 60 });
    // 手势期 doc.abs 与 rel+冻结 origin 保持一致（尾挂断言无让位豁免——见文件头纪律）
    nodeMap(d, 'c1').get('position').set('x', 145);
    nodeMap(d, 'c1').get('position').set('y', 110);
    remoteMutate(d, (B) => {
      nodeMap(B, 't1').get('position').set('x', 950);
      nodeMap(B, 't1').get('position').set('y', 5);
    });
    applyDocToStore(d);
    expect(csNode('g1').position).toEqual({ x: 100, y: 50 });   // 冻结组帧三字段逐帧不变
    expect(csNode('g1').width).toBe(400);
    expect(csNode('g1').height).toBe(300);
    expect(csNode('c1').position).toEqual({ x: 45, y: 60 });    // 被拖子=手势活值
    expect(csNode('c1b').position).toEqual({ x: 100, y: 40 });  // 全部子 rel 不变
    expect(csNode('t1').position).toEqual({ x: 950, y: 5 });    // 无关节点取远端值
    // 第二轮（逐帧）
    remoteMutate(d, (B) => {
      nodeMap(B, 't1').get('position').set('x', 960);
      nodeMap(B, 't1').get('position').set('y', 6);
    });
    applyDocToStore(d);
    expect(csNode('g1').position).toEqual({ x: 100, y: 50 });
    expect(csNode('g1').width).toBe(400);
    expect(csNode('g1').height).toBe(300);
    expect(csNode('c1').position).toEqual({ x: 45, y: 60 });
    expect(csNode('c1b').position).toEqual({ x: 100, y: 40 });
    expect(csNode('t1').position).toEqual({ x: 960, y: 6 });
  });

  it('拖动中远端写 ⇒ 松手后 doc.abs≡末帧 cs.abs（真实路径+远端无关节点写夹档）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['t1'], 1);
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 't1', position: { x: 810, y: 15 }, dragging: true } as any,
    ]);
    remoteMutate(d, (B) => {
      nodeMap(B, 'c1').get('position').set('x', 150);
      nodeMap(B, 'c1').get('position').set('y', 100);
    });
    applyDocToStore(d);
    expect(csNode('t1').position).toEqual({ x: 810, y: 15 });   // 让位保护维持末帧
    useCanvasStore.getState().endGesture('completed');
    expect(docPos(d, 't1')).toEqual({ x: 810, y: 15 });         // doc.abs≡末帧
    expect(csNode('t1').position).toEqual({ x: 810, y: 15 });   // cs.abs（顶层 rel≡abs）逐位一致
    expect(csNode('c1').position).toEqual({ x: 50, y: 50 });    // 远端值落位（(150,100)−origin）
  });

  it('resize 扩子代：beginResize+远端写 ⇒ 组帧≡预览+子代三字段保护（让位两层 live 扩展）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    useCanvasStore.getState().beginResize('g1', 9);
    seedCanvas(useCanvasStore.getState().nodes.map((n: any) => (
      n.id === 'g1' ? { ...n, width: 500, height: 350 } : n     // resize 预览帧（手势内核写者面）
    )));
    remoteMutate(d, (B) => {
      nodeMap(B, 'g1').set('width', 888);
      nodeMap(B, 'g1').set('height', 777);
      nodeMap(B, 't1').get('position').set('x', 999);
      nodeMap(B, 't1').get('position').set('y', 999);
    });
    applyDocToStore(d);
    expect(csNode('g1').width).toBe(500);                       // 预览帧不被 doc 旧值覆盖
    expect(csNode('g1').height).toBe(350);
    expect(csNode('g1').position).toEqual({ x: 100, y: 50 });
    expect(csNode('c1').position).toEqual({ x: 20, y: 30 });    // children(resizeTargetId) 帧三字段保护
    expect(csNode('c1').width).toBe(100);
    expect(csNode('c1b').position).toEqual({ x: 100, y: 40 });
    expect(csNode('t1').position).toEqual({ x: 999, y: 999 });  // 非让位控制组照常
    // reconcile 路径子保护（远端改子 doc——让位硬规则终裁 66③）
    remoteMutate(d, (B) => {
      nodeMap(B, 'c1').get('position').set('x', 300);
      nodeMap(B, 'c1').get('position').set('y', 300);
      nodeMap(B, 'c1').set('width', 250);
      nodeMap(B, 'c1').set('height', 250);
    });
    reconcileGroupGeometry(d, 'doc');
    expect(csNode('c1').position).toEqual({ x: 20, y: 30 });    // position+wh 全保护（resize 分型）
    expect(csNode('c1').width).toBe(100);
    expect(csNode('c1').height).toBe(60);
  });

  it('remove 谓词：远端删被拖节点 ⇒ endGesture("removed") 事后回滚（幸存被拖成员回 baseline）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['c1', 't1'], 1);
    dragFrame('t1', { x: 800, y: 10 });             // 幸存被拖成员的手势末帧（doc 未写）
    remoteMutate(d, (B) => { B.getMap('nodes').delete('c1'); });
    applyDocToStore(d);
    expect(session()).toBeNull();                   // remove 谓词触发单收尾
    expect(useCanvasStore.getState().nodes.some((n: any) => n.id === 'c1')).toBe(false);
    expect(csNode('t1').position).toEqual({ x: 700, y: 0 });   // 事后回滚=baseline
    expect(csNode('g1').position).toEqual({ x: 100, y: 50 });  // 组帧善后完好
  });
});
