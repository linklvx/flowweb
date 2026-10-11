// apps/web/src/stores/canvasUndo.ts
// Y.UndoManager 集成（spec 4.2/4.4）：trackedOrigins 仅 local-user，快捷键入口。
import * as Y from 'yjs';
import { QUOTA_DEFAULTS } from '@flowweb/shared';
import { recordCollabDiag } from '@/utils/collabDiagnostics';

/** spec 全局约定 Origin 常量——trackedOrigins 唯一入栈者 */
// Server 为后端 withDoc transact 预留常量；AutoEdge 为自动边专用 origin——刻意不加入 trackedOrigins（画布撤销栈不收自动边，spec 验收 20/26）；
// Geometry 为几何修复回写专用 origin（S1：applyDocToStore 收尾 refit 差异回写）——同款刻意不入 trackedOrigins（撤销的是修复不是用户编辑，防啃 STACK_LIMIT）
export const Origin = { LocalUser: 'local-user', Server: 'server', AutoEdge: 'auto-edge', Geometry: 'geometry-repair' } as const;

const STACK_LIMIT = 100;

let undoManager: Y.UndoManager | null = null;

// ── Y0b-4 T10：redo 回放帧字节近似（redo precheck 消费）──
/** stack item ↔ LocalUser update 字节累计（captureTimeout 窗内多 transact 求和——新项+合并项均回填）。
 *  yjs 事件序锚：stack-item-added/updated 发于 afterTransaction、doc 'update' 发于其后同事务
 *  cleanup——1:1 配对，update 到达时回填本事务字节（增量累加：合并项=既有值+本事务）。
 *  undo→redoStack 项由 undoCanvas 关联原项字节（undo 事务 origin=UndoManager 不计：回放≠新写）。 */
const stackItemBytes = new WeakMap<object, number>();
let itemNeedingBytes: object | null = null;

export function attachUndoManager(doc: Y.Doc): Y.UndoManager {
  undoManager?.destroy();
  itemNeedingBytes = null;
  const um = new Y.UndoManager([doc.getMap('nodes'), doc.getMap('edges')], {
    trackedOrigins: new Set([Origin.LocalUser]),
    captureTimeout: 500,
  });
  // T10：同事务 update 回填（origin=UndoManager 的 undo/redo 事务不计——回放≠新写）
  doc.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== Origin.LocalUser || itemNeedingBytes == null) return;
    stackItemBytes.set(itemNeedingBytes, (stackItemBytes.get(itemNeedingBytes) ?? 0) + u.byteLength);
    itemNeedingBytes = null;
  });
  um.on('stack-item-added', ({ stackItem, origin, type }) => {
    // yjs 事件 payload 为 { stackItem, origin, type }，type: 'undo' | 'redo'（无 stack 字段）
    if (origin === Origin.LocalUser) itemNeedingBytes = stackItem;
    if (type === 'undo' && um.undoStack.length > STACK_LIMIT) {
      um.undoStack.shift(); // 手动截断（Y.UndoManager 无内建上限）
    }
  });
  um.on('stack-item-updated', ({ stackItem, origin }) => {
    if (origin === Origin.LocalUser) itemNeedingBytes = stackItem;   // captureTimeout 窗内追加合并事务
  });
  undoManager = um;
  return um;
}

export function detachUndoManager() {
  undoManager?.destroy();
  undoManager = null;
  itemNeedingBytes = null;
}

export function stopCapturing() {
  undoManager?.stopCapturing();
}

export function getUndoManager() {
  return undoManager;
}

/** 快捷键入口（保留 S-1 语义：undo 后消失节点的活跃进程取消）——undo 不做预算拦截（只减尺寸） */
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
  um.undo();
  const redoItem = um.redoStack[um.redoStack.length - 1];
  if (redoItem != null && srcBytes != null) stackItemBytes.set(redoItem, srcBytes);
  const afterIds = new Set<string>(um.doc.getMap('nodes').keys()); // 事务同步提交，doc 已是 undo 后状态
  const s = useCanvasStore.getState();
  for (const id of beforeIds) {
    if (!afterIds.has(id) && s.nodeProcessMap[id]) s.cancelNodeProcess(id);
  }
}

/** redo：回放前预算 precheck（T10——undo 不拦，redo 重增内容需过软阈；拒=redoStack 不减+diag）。
 *  回放帧字节取 stack item 创建时累计近似（canApplyIntent 形态适配——localDocBytes+localDelta
 *  +redoBytes 判 softLimit）。 */
export async function redoCanvas(): Promise<void> {
  const um = undoManager;
  if (!um || um.redoStack.length === 0) return;
  // 动态 import：测试重量隔离（undoCanvas 同款）
  const { useCanvasStore } = await import('./canvasStore');
  if (undoManager !== um) return; // await 间隙项目切换防串
  const st = useCanvasStore.getState();
  const redoBytes = stackItemBytes.get(um.redoStack[um.redoStack.length - 1]!) ?? 0;
  const softLimit = st.quotaSoftLimitBytes > 0
    ? st.quotaSoftLimitBytes
    : Math.floor(QUOTA_DEFAULTS.maxDocBytes * QUOTA_DEFAULTS.softEnterRatio);
  if (st.localDocBytes + st.localDelta + redoBytes > softLimit) {
    recordCollabDiag('write_reject', { reason: 'doc-over-budget', via: 'redo-precheck' });
    return;
  }
  um.redo();
}
