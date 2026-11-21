// apps/web/src/stores/canvasUndo.ts
// Y.UndoManager 集成（spec 4.2/4.4 + Y1c §3.3 单 manager 收口）：trackedOrigins=[LocalUser,
// ySyncPluginKey]（S3 spike 结论③——T16 addTrackedOrigin 后置接线已撤，构造面一次到位=T18）；
// 栈上限/捕获窗/溢出策略引 shared undo-policy 冻结契约单源（UNDO_STACK_LIMIT=100/
// UNDO_CAPTURE_TIMEOUT_MS=500/UNDO_OVERFLOW_ACTION='clear-whole-stack'——偏离 31：
// 溢出=整栈 clear()=唯一公开 keep 释放口；无 keepItem 精确释放、无「shift 后字节回落」验收；
// shift 丢最旧项使 redo 链对不上前序状态=旧 bug，clear 收口）。远端变更=网络 applyUpdate
// origin（连接对象）不入栈——语义不变。
//
// Y4a T4（plan 2026-11-20-y4a-timeline-domain Task 4——spec §0 条 5/条 7）：①scope 三根
// UNDO_STACK_BASE（+timelines——画布栈捕获 timelines 根删除，undo 带回节点+时间轴；scope 缺
// 这棵根则撤销恢复不复活 timelines item〔yjs isParentOf〕、删除的撤销带回节点边而时间轴丢失）；
// ②两张表分立（spec §0 条 5——捕获策略记账，不实现 openCapture 重放）：doc.on('update') 继续
// 只写正向表 stackItemBytes（redoCanvas 预检消费——不动）；新 stackItemRestoreBytes 只记装回字节、
// itemNeedingBytes 同款回填机制（事件序沿用 :24-26 钉死配对——stack-item-added/updated 在
// afterTransaction、doc 'update' 在其后）；undoCanvas 装回闸放 await import 与 undoManager!==um
// 之后、um.undo() 之前（:85-90 现序保持——S-1 活跃进程取消逻辑不动）+弹栈后双向抄（undo/redo
// 每次 new StackItem 非挪对象、不抄=缺失当 0）。pendingRestoreBytes 按 origin 分开（本模块画布域
// local-user/ySyncPluginKey——timeline-user 域各持一份在 timelineUndo.ts）、update 写完就清；
// 零帧事务（删缺 id 等不发 update）经 afterTransaction 无条件清该 origin 的 pending——只在
// update 里清会把待记装回字节挂到下一笔同 origin 栈项上、小撤销被误拦。
import * as Y from 'yjs';
import { ySyncPluginKey } from 'y-prosemirror';
import {
  SERVER_TRANSACT_ORIGIN, UNDO_CAPTURE_TIMEOUT_MS, UNDO_STACK_BASE, UNDO_TIMELINE_ORIGIN,
  RESTORE_GATE_BYTES, undoOverflowAction,
} from '@flowweb/shared';
import { recordCollabDiag, recordRingOnlyCollabDiag } from '@/utils/collabDiagnostics';

/** spec 全局约定 Origin 常量——trackedOrigins 唯一入栈者 */
// Server=Y0c T10 已消费（shared SERVER_TRANSACT_ORIGIN 单源同值引用：后端 withDoc 最外层写事务
// origin，gateway docDelta 按此分流不计客户端配额口径）；AutoEdge 为自动边专用 origin——刻意不加入 trackedOrigins（画布撤销栈不收自动边，spec 验收 20/26）；
// Geometry 为几何修复回写专用 origin（S1：applyDocToStore 收尾 refit 差异回写）——同款刻意不入 trackedOrigins（撤销的是修复不是用户编辑，防啃 STACK_LIMIT）；
// TimelineUser=Y4a T1 时间轴编辑 origin（undo-policy UNDO_TIMELINE_ORIGIN 同值——时间轴编辑栈
// trackedOrigins 专属值，画布栈刻意不含：域隔离由 origin 保证）
export const Origin = { LocalUser: 'local-user', Server: SERVER_TRANSACT_ORIGIN, AutoEdge: 'auto-edge', Geometry: 'geometry-repair', TimelineUser: UNDO_TIMELINE_ORIGIN } as const;

let undoManager: Y.UndoManager | null = null;

// ── Y0b-4 T10：redo 回放帧字节近似（redo precheck 消费）──
/** stack item ↔ LocalUser update 字节累计（captureTimeout 窗内多 transact 求和——新项+合并项均回填）。
 *  yjs 事件序锚：stack-item-added/updated 发于 afterTransaction、doc 'update' 发于其后同事务
 *  cleanup——1:1 配对，update 到达时回填本事务字节（增量累加：合并项=既有值+本事务）。
 *  undo→redoStack 项由 undoCanvas 关联原项字节（undo 事务 origin=UndoManager 不计：回放≠新写）。 */
const stackItemBytes = new WeakMap<object, number>();
let itemNeedingBytes: object | null = null;

// ── Y4a T4（spec §0 条 5）：装回字节表（与正向表分立——undoCanvas 弹栈闸消费）──
/** stack item ↔ 装回字节累计（撤销=把删除装回——undo 帧大小口径；捕获策略记账非逐帧重放）。 */
const stackItemRestoreBytes = new WeakMap<object, number>();
/** per-origin 待记装回字节（写编排器在 doc.transact 之前登记本笔预检量的 undoBytes——update
 *  到达时落到栈项、写完立刻清；零帧事务经 afterTransaction 清——不挂到下一笔）。 */
const pendingRestoreBytes = new Map<unknown, number>();
/** per-origin 待记栈项（stack-item-added/updated 在 afterTransaction 设置——update 到达时回填）。 */
const itemNeedingRestoreBytes = new Map<unknown, object>();

/** 低级登记面：commit 编排写前登记本笔预检量的 undoBytes（T4 时间轴执行器同族机制在
 *  timelineUndo.ts 各持一份；本模块画布域消费方=T5 分割删除等写前预检编排）。 */
export function setPendingRestoreBytes(origin: unknown, undoBytes: number): void {
  pendingRestoreBytes.set(origin, undoBytes);
}

/** 装回字节读（测试/诊断观测面——缺失当 0 与消费面同口径）。 */
export function getStackItemRestoreBytes(item: object): number {
  return stackItemRestoreBytes.get(item) ?? 0;
}

export function attachUndoManager(doc: Y.Doc): Y.UndoManager {
  undoManager?.destroy();
  itemNeedingBytes = null;
  // Y4a T4（spec §0 条 7）：scope 三根 UNDO_STACK_BASE（+timelines——早于同步在空文档上挂：
  // 同名根同对象、早挂零时序风险；不设 share.has 位位门——scope 缺这棵根则删除的撤销不复活
  // timelines item）
  const um = new Y.UndoManager(UNDO_STACK_BASE.map((root) => doc.getMap(root)), {
    // Y1c T18（S3 ③/T16 登记移交）：构造面一次到位——ySyncPlugin 本地键入事务 origin=
    // ySyncPluginKey（PluginKey 单例——exact pin 1.3.7）与 LocalUser 双 tracked；不 addToScope
    //（scope 父链已覆盖嵌套子类型——S3 实证七用例零例外）；不挂 yUndoPlugin（单 manager）。
    trackedOrigins: new Set([Origin.LocalUser, ySyncPluginKey]),
    captureTimeout: UNDO_CAPTURE_TIMEOUT_MS,
  });
  // T10：同事务 update 回填（origin=UndoManager 的 undo/redo 事务不计——回放≠新写）。
  // T18：trackedOrigins 构造面双 origin ⇒ 回填同覆盖 ySyncPluginKey 事务（编辑器键入帧——
  // 漏计会使 redoCanvas 预检查 redoBytes 低估）。
  // Y4a T4（spec §0 条 5）：同 handler 内装回表回填——正向面原样不动（redoCanvas 预检消费），
  // 装回面读 pendingRestoreBytes（写编排器登记的预检量）增量累加到 afterTransaction 记录的栈项。
  doc.on('update', (u: Uint8Array, origin: unknown) => {
    if ((origin === Origin.LocalUser || origin === ySyncPluginKey) && itemNeedingBytes != null) {
      stackItemBytes.set(itemNeedingBytes, (stackItemBytes.get(itemNeedingBytes) ?? 0) + u.byteLength);
      itemNeedingBytes = null;
    }
    const pending = pendingRestoreBytes.get(origin);
    if (pending !== undefined) {
      const item = itemNeedingRestoreBytes.get(origin);
      if (item !== undefined) {
        stackItemRestoreBytes.set(item, (stackItemRestoreBytes.get(item) ?? 0) + pending);
        itemNeedingRestoreBytes.delete(origin);
      }
      pendingRestoreBytes.delete(origin);   // update 写完立刻清——下一笔不继承
    }
  });
  // Y4a T4（spec §0 条 5）：零帧事务清挂——删除缺 id/空片段列表这类事务不发 update，只在
  // update 里清会把待记装回字节挂到下一笔同 origin 栈项上（afterTransaction 在 update 之前
  // 跑——以「事务确实零内容」判定：changed/deleteSet 皆空=update 必不发，此时清挂）。
  doc.on('afterTransaction', (tr: Y.Transaction) => {
    if (pendingRestoreBytes.size === 0) return;
    if (tr.changed.size === 0 && tr.deleteSet.clients.size === 0) pendingRestoreBytes.delete(tr.origin);
  });
  um.on('stack-item-added', ({ stackItem, origin, type }) => {
    // yjs 事件 payload 为 { stackItem, origin, type }，type: 'undo' | 'redo'（无 stack 字段）
    if (origin === Origin.LocalUser || origin === ySyncPluginKey) itemNeedingBytes = stackItem;
    // Y4a T4：装回表回填同点（本笔有 pending 的 origin 才记录——无 pending 的栈项缺失当 0）
    if (pendingRestoreBytes.has(origin)) itemNeedingRestoreBytes.set(origin, stackItem);
    // Y1c T18（偏离 31）：栈上限>100=**整栈 clear()**——undoOverflowAction 判定引 shared 冻结契约
    //（clear-whole-stack=诚实语义：撤销项成对可逆，shift 丢最旧=redo 链断裂+被弃项 keep 泄漏）。
    // clear()=唯一公开 keep 释放口（yjs keepItem 模块私有）；「shift 后字节回落」验收已废——禁复活。
    if (type === 'undo' && undoOverflowAction(um.undoStack.length) === 'clear-whole-stack') {
      um.clear();
    }
  });
  um.on('stack-item-updated', ({ stackItem, origin }) => {
    if (origin === Origin.LocalUser || origin === ySyncPluginKey) itemNeedingBytes = stackItem;   // captureTimeout 窗内追加合并事务（T18 双 origin 同覆盖）
    // Y4a T4：标量窗内合并档增量累加点（stack-item-updated=窗口项——pending 在 update 到达时加）
    if (pendingRestoreBytes.has(origin)) itemNeedingRestoreBytes.set(origin, stackItem);
  });
  undoManager = um;
  return um;
}

export function detachUndoManager() {
  undoManager?.destroy();
  undoManager = null;
  itemNeedingBytes = null;
  pendingRestoreBytes.clear();
  itemNeedingRestoreBytes.clear();
}

export function stopCapturing() {
  undoManager?.stopCapturing();
}

export function getUndoManager() {
  return undoManager;
}

/** 快捷键入口（保留 S-1 语义：undo 后消失节点的活跃进程取消）——undo 不做预算拦截（只减尺寸）
 *  Y4a T4（spec §0 条 1/条 5）：弹栈前装回闸——栈项累计装回字节>RESTORE_GATE_BYTES(520192)→
 *  不弹栈保持删除态提示「单次操作过大」（判断位=await import 与 undoManager!==um 之后、
 *  um.undo() 之前——:85-90 现序保持——S-1 活跃进程取消逻辑不动）；弹栈后装回字节抄到新 redo
 *  栈项（与正向字节抄写同位——undo()/redo() 每次 new StackItem 非挪对象、不抄=缺失当 0）。 */
export async function undoCanvas(): Promise<void> {
  const um = undoManager;
  if (!um || um.undoStack.length === 0) return;
  // 动态 import：测试重量隔离——canvasUndo.test.ts 只拉 yjs，静态引入会把 antd/@xyflow 全图拖进测试
  const { useCanvasStore } = await import('./canvasStore');
  if (undoManager !== um) return; // await 间隙项目切换防串
  const beforeIds = new Set(useCanvasStore.getState().nodes.map((n: any) => n.id));
  // T10：redo 项字节关联原 undo 项（redo 回放≈原项内容——undo 事务自身字节=删除集会低估）
  const srcItem = um.undoStack[um.undoStack.length - 1];
  const srcBytes = srcItem != null ? stackItemBytes.get(srcItem) : undefined;
  // Y4a T4：装回闸（undo 按钮后挡——RESTORE_GATE_BYTES=硬闸−4096 只作弹栈挡、不作删除判据）
  const srcRestore = srcItem != null ? stackItemRestoreBytes.get(srcItem) : undefined;
  if (srcRestore != null && srcRestore > RESTORE_GATE_BYTES) {
    recordRingOnlyCollabDiag('write_reject', { reason: 'tx-too-large', via: 'undo-restore-gate' });
    void import('antd').then(({ message }) => { message.warning('单次操作过大'); });
    return;   // 不弹栈、doc 保持删除态（S-1 afterIds/cancel 不跑——doc 未动）
  }
  um.undo();
  const redoItem = um.redoStack[um.redoStack.length - 1];
  if (redoItem != null && srcBytes != null) stackItemBytes.set(redoItem, srcBytes);
  if (redoItem != null && srcRestore != null) stackItemRestoreBytes.set(redoItem, srcRestore);
  const afterIds = new Set<string>(um.doc.getMap('nodes').keys()); // 事务同步提交，doc 已是 undo 后状态
  const s = useCanvasStore.getState();
  for (const id of beforeIds) {
    if (!afterIds.has(id) && s.nodeProcessMap[id]) s.cancelNodeProcess(id);
  }
}

/** redo：回放前预算 precheck（T10——undo 不拦，redo 重增内容需过软阈；拒=redoStack 不减+diag）。
 *  回放帧字节取 stack item 创建时累计近似（canApplyIntent 形态适配——localDocBytes+localDelta
 *  +redoBytes 判 softLimit）。
 *  Y4a T4（spec §0 条 5）：redo 弹栈后把装回字节抄回新 undo 项（双向抄——undoCanvas 同族）。 */
export async function redoCanvas(): Promise<void> {
  const um = undoManager;
  if (!um || um.redoStack.length === 0) return;
  // 动态 import：测试重量隔离（undoCanvas 同款）。effectiveSoftLimit 动态取同因——canvasIntents
  // 顶层静态 import canvasStore，静态引入即破隔离；import('./canvasStore') 已连带求值 canvasIntents（零额外开销）。
  const { useCanvasStore } = await import('./canvasStore');
  const { effectiveSoftLimit } = await import('./canvasIntents');
  if (undoManager !== um) return; // await 间隙项目切换防串
  const st = useCanvasStore.getState();
  const srcItem = um.redoStack[um.redoStack.length - 1]!;
  const redoBytes = stackItemBytes.get(srcItem) ?? 0;
  const softLimit = effectiveSoftLimit(st);
  if (st.localDocBytes + st.localDelta + redoBytes > softLimit) {
    recordCollabDiag('write_reject', { reason: 'doc-over-budget', via: 'redo-precheck' });
    return;
  }
  const srcRestore = stackItemRestoreBytes.get(srcItem);
  um.redo();
  const newUndoItem = um.undoStack[um.undoStack.length - 1];
  if (newUndoItem != null && srcRestore != null) stackItemRestoreBytes.set(newUndoItem, srcRestore);
}
