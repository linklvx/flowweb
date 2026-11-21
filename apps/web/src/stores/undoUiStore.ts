// apps/web/src/stores/undoUiStore.ts
// Y4a T11（plan 2026-11-20-y4a-timeline-domain Task 11——spec §5/§9 锚 6）：canUndo/canRedo
// 事件驱动 UI——两管理器四布尔 { canvasCanUndo, canvasCanRedo, timelineCanUndo, timelineCanRedo }。
// 订阅面（um.on 同 canvasUndo :24-26 模式）：stack-item-added/updated/popped/stack-cleared 四
// 事件族→读两栈长度同步布尔（um.undoStack.length>0 / um.redoStack.length>0——事件只是触发器，
// 真源=栈本身）。断言不轮询（spec §9 锚 6）：零 interval/timeout——事件驱动唯一真源。
//
// Ruling T4-1 终裁（本任务消费面落地）：timelineRedo 软限额预检维持省略——UI 只反映栈真实状态
// （canRedo=栈非空），点击 timelineRedo 内部已有装回闸执法、拒了栈态回写事件自然回滚布尔；
// 无 timeline 域预算状态可预检、字面移植拖 canvasStore（effectiveSoftLimit/localDocBytes——
// redoCanvas precheck 形态）破坏域隔离（T4 裁决原文：配额不新做——单事务闸与撤销按钮后挡按
// spec §0 条 1/条 2 既有单源执法，不另做时间轴预算式）。
//
// 接线（禁双源——一个 manager 一个订阅入口）：
//  - attachCanvasUi(um)：canvasCollabRuntime attachUndoManager 调用紧邻处（返回值直交）；
//    detachCanvasUi 在 canvasCollabRuntime teardownSession 的 detachUndoManager 之前
//    （canvasUndo.detachUndoManager 无内部退订——runtime 侧外部序）。
//  - attachTimelineUi(um)：editorStore 水合/重绑 attachTimelineUndo 调用紧邻处（返回值直交）；
//    detachTimelineUi 收拢在 timelineUndo.detachTimelineUndo 内部序首位（退订先于
//    clear()+destroy——所有卸栈路径含 clearTimelineStackOf/canvasDeleteSplit 删除档共用）。
import { create } from 'zustand';
import type * as Y from 'yjs';

interface UndoUiState {
  canvasCanUndo: boolean;
  canvasCanRedo: boolean;
  timelineCanUndo: boolean;
  timelineCanRedo: boolean;
}

export const useUndoUiStore = create<UndoUiState>()(() => ({
  canvasCanUndo: false,
  canvasCanRedo: false,
  timelineCanUndo: false,
  timelineCanRedo: false,
}));

/** 订阅事件计数（spec §9 锚 6 断言不轮询的观测面——测试只读不灌；生产零消费）。 */
export interface UndoUiEventCounts {
  add: number;
  update: number;
  pop: number;
  clear: number;
}
const canvasCounts: UndoUiEventCounts = { add: 0, update: 0, pop: 0, clear: 0 };
const timelineCounts: UndoUiEventCounts = { add: 0, update: 0, pop: 0, clear: 0 };

export function getUndoUiEventCounts(): { canvas: UndoUiEventCounts; timeline: UndoUiEventCounts } {
  return {
    canvas: { ...canvasCounts },
    timeline: { ...timelineCounts },
  };
}

/** 挂订阅四事件族→读栈同步布尔。um.on 同 canvasUndo :24-26 模式（stack-item-added/updated 在
 *  afterTransaction、popped 在 undo()/redo() 弹栈收尾、stack-cleared 在 clear()——四族全覆盖
 *  栈长度的所有变化路径；已知残余：performedChange=false 时 yjs 静默弹栈零事件——yjs 固有边缘，
 *  不轮询前提下不可覆盖（生产两 manager 默认 deleteFilter））；同点累计订阅事件计数
 *  （spec §9 锚 6 断言不轮询观测面）。 */
function bindManager(
  um: Y.UndoManager,
  counts: UndoUiEventCounts,
  sync: (b: { canUndo: boolean; canRedo: boolean }) => void,
): () => void {
  const fire = (event: 'add' | 'update' | 'pop' | 'clear') => {
    counts[event] += 1;
    sync({ canUndo: um.undoStack.length > 0, canRedo: um.redoStack.length > 0 });
  };
  const onAdd = () => fire('add');
  const onUpdate = () => fire('update');
  const onPop = () => fire('pop');
  const onClear = () => fire('clear');
  um.on('stack-item-added', onAdd);
  um.on('stack-item-updated', onUpdate);
  um.on('stack-item-popped', onPop);
  um.on('stack-cleared', onClear);
  return () => {
    um.off('stack-item-added', onAdd);
    um.off('stack-item-updated', onUpdate);
    um.off('stack-item-popped', onPop);
    um.off('stack-cleared', onClear);
  };
}

let detachCanvasHandlers: (() => void) | null = null;

/** 画布栈订阅入口（attachUndoManager 调用紧邻处接线——先退订旧 manager 再挂新，禁双源）。 */
export function attachCanvasUi(um: Y.UndoManager): void {
  detachCanvasHandlers?.();
  detachCanvasHandlers = bindManager(um, canvasCounts, (b) => useUndoUiStore.setState({
    canvasCanUndo: b.canUndo, canvasCanRedo: b.canRedo,
  }));
  // attach 即初始同步（空栈→false；重挂非空栈 manager 时读栈真值）
  useUndoUiStore.setState({
    canvasCanUndo: um.undoStack.length > 0, canvasCanRedo: um.redoStack.length > 0,
  });
}

/** 画布栈退订+复位（detachUndoManager 之前调——退订须在 manager destroy 之前）。 */
export function detachCanvasUi(): void {
  detachCanvasHandlers?.();
  detachCanvasHandlers = null;
  useUndoUiStore.setState({ canvasCanUndo: false, canvasCanRedo: false });
}

let detachTimelineHandlers: (() => void) | null = null;

/** 时间轴栈订阅入口（editorStore 水合/重绑 attachTimelineUndo 调用紧邻处接线——禁双源）。 */
export function attachTimelineUi(um: Y.UndoManager): void {
  detachTimelineHandlers?.();
  detachTimelineHandlers = bindManager(um, timelineCounts, (b) => useUndoUiStore.setState({
    timelineCanUndo: b.canUndo, timelineCanRedo: b.canRedo,
  }));
  useUndoUiStore.setState({
    timelineCanUndo: um.undoStack.length > 0, timelineCanRedo: um.redoStack.length > 0,
  });
}

/** 时间轴栈退订+复位（detachTimelineUndo 之前调——退订须在 manager clear()+destroy 之前）。 */
export function detachTimelineUi(): void {
  detachTimelineHandlers?.();
  detachTimelineHandlers = null;
  useUndoUiStore.setState({ timelineCanUndo: false, timelineCanRedo: false });
}
