// apps/web/src/stores/undoUiStore.spec.ts
// Y4a T11（plan 2026-11-20-y4a-timeline-domain Task 11——spec §5/§9 锚 6）：canUndo/canRedo
// 事件驱动 UI——两管理器四布尔 { canvasCanUndo, canvasCanRedo, timelineCanUndo, timelineCanRedo }。
//
// 断言不轮询（spec §9 锚 6「订阅事件计数」）：fake timers advance（远超 captureTimeout 500ms
// 与任何轮询周期）后布尔零变化——事件驱动唯一真源、0 个 interval/timeout 参与布尔同步；
// 计数面=undoUiStore 导出的订阅事件计数器（add/upd/pop/clear 四族——测试只读不灌）。
//
// 真实 yjs 装置（非 mock——栈行为以 yjs 13.6.32 实测序为准）：undo() 弹 undoStack 顶项并在
// redoStack 上以 origin=UndoManager 自身新栈一项（stack-item-added type='redo' 同步发）；
// redo() 对称弹 redo 项；canUndo/canRedo 布尔=读两栈长度。captureTimeout=0（构装直传——
// 不与真实 500ms 窗纠缠，本 spec 锁事件驱动语义不锁合并窗档——窗档在 timelineUndo.spec.ts ⑤）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { attachUndoManager, detachUndoManager, Origin } from './canvasUndo';
import { attachTimelineUndo, detachTimelineUndo } from './timelineUndo';
import {
  useUndoUiStore, attachCanvasUi, attachTimelineUi, detachCanvasUi, detachTimelineUi,
  getUndoUiEventCounts,
} from './undoUiStore';

describe('undoUiStore（canUndo/canRedo 事件驱动 UI——spec §9 锚 6）', () => {
  let doc: Y.Doc;
  let canvasUm: Y.UndoManager;
  let timelineUm: Y.UndoManager;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    doc = new Y.Doc();
    // 画布栈（canvasUndo 域——LocalUser origin）+时间轴栈（timelineUndo 域——独立 entry scope）
    canvasUm = attachUndoManager(doc);
    const entry = new Y.Map();
    doc.getMap('timelines').set('n1', entry);   // 先入 doc（entry.doc 集成态——attach 契约）
    timelineUm = attachTimelineUndo('n1', entry);
    // attach 两入口（生产接线形态同构——manager 各一、订阅入口各一、禁双源）
    attachCanvasUi(canvasUm);
    attachTimelineUi(timelineUm);
    useUndoUiStore.setState({
      canvasCanUndo: false, canvasCanRedo: false, timelineCanUndo: false, timelineCanRedo: false,
    });
  });

  afterEach(() => {
    detachTimelineUndo();
    detachUndoManager();
    doc.destroy();
    vi.useRealTimers();
  });

  const readBools = () => {
    const s = useUndoUiStore.getState();
    return {
      canvasCanUndo: s.canvasCanUndo, canvasCanRedo: s.canvasCanRedo,
      timelineCanUndo: s.timelineCanUndo, timelineCanRedo: s.timelineCanRedo,
    };
  };

  it('空栈：canUndo/canRedo 全 false（attach 后初始同步）', () => {
    expect(readBools()).toEqual({
      canvasCanUndo: false, canvasCanRedo: false, timelineCanUndo: false, timelineCanRedo: false,
    });
  });

  it('一笔事务→事件驱动变 true（断言不轮询：fake timers advance 1000ms 后仍事件驱动——零 interval/timeout 参与同步）', () => {
    const before = getUndoUiEventCounts();
    // 一笔画布域 LocalUser 事务+一笔时间轴域事务（各自入栈一条）
    doc.transact(() => { doc.getMap('nodes').set('a', new Y.Map()); }, Origin.LocalUser);
    doc.transact(() => { (doc.getMap('timelines').get('n1') as Y.Map<unknown>).set('fps', 60); }, 'timeline-user');
    // 断言不轮询：advance 远超 captureTimeout(500)/任何轮询周期——布尔在 advance 前已定，
    // advance 后零漂移（事件是唯一真源——若实现靠轮询，这两行断言前/后必有一处错）
    const afterAdvance = { ...readBools() };
    vi.advanceTimersByTime(1000);
    expect(readBools()).toEqual(afterAdvance);
    expect(readBools()).toEqual({
      canvasCanUndo: true, canvasCanRedo: false, timelineCanUndo: true, timelineCanRedo: false,
    });
    // 订阅事件计数（spec §9 锚 6「断言不轮询=订阅事件计数」）：add 族至少各 +1
    const counts = getUndoUiEventCounts();
    expect(counts.canvas.add).toBeGreaterThan(before.canvas.add);
    expect(counts.timeline.add).toBeGreaterThan(before.timeline.add);
  });

  it('undo 弹栈→canUndo 变 false；undo 出现 redo 项→canRedo true', () => {
    doc.transact(() => { doc.getMap('nodes').set('a', new Y.Map()); }, Origin.LocalUser);
    doc.transact(() => { (doc.getMap('timelines').get('n1') as Y.Map<unknown>).set('fps', 60); }, 'timeline-user');
    expect(readBools()).toEqual({
      canvasCanUndo: true, canvasCanRedo: false, timelineCanUndo: true, timelineCanRedo: false,
    });
    canvasUm.undo();
    timelineUm.undo();
    expect(readBools()).toEqual({
      canvasCanUndo: false, canvasCanRedo: true, timelineCanUndo: false, timelineCanRedo: true,
    });
    // 事件计数：pop 族（undo/redo 弹栈）+add 族（redo 项入栈）均发过
    const counts = getUndoUiEventCounts();
    expect(counts.canvas.pop).toBeGreaterThan(0);
    expect(counts.timeline.pop).toBeGreaterThan(0);
  });

  it('detach→布尔复位 false+退订（后续同 doc 事务不再改布尔、事件计数不再走）', () => {
    doc.transact(() => { doc.getMap('nodes').set('a', new Y.Map()); }, Origin.LocalUser);
    expect(useUndoUiStore.getState().canvasCanUndo).toBe(true);
    const before = getUndoUiEventCounts();
    detachCanvasUi();
    detachTimelineUi();
    expect(readBools()).toEqual({
      canvasCanUndo: false, canvasCanRedo: false, timelineCanUndo: false, timelineCanRedo: false,
    });
    // 退订后同 doc 再写一笔——布尔不复位回 true、计数零增量
    doc.transact(() => { doc.getMap('nodes').set('b', new Y.Map()); }, Origin.LocalUser);
    vi.advanceTimersByTime(1000);
    expect(useUndoUiStore.getState().canvasCanUndo).toBe(false);
    const after = getUndoUiEventCounts();
    expect(after.canvas.add).toBe(before.canvas.add);
    expect(after.timeline.add).toBe(before.timeline.add);
  });
});
