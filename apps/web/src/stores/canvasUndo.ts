// apps/web/src/stores/canvasUndo.ts
// Y.UndoManager 集成（spec 4.2/4.4）：trackedOrigins 仅 local-user，快捷键入口。
import * as Y from 'yjs';

/** spec 全局约定 Origin 常量——trackedOrigins 唯一入栈者 */
// Server 为后端 withDoc transact 预留常量；AutoEdge 为自动边专用 origin——刻意不加入 trackedOrigins（画布撤销栈不收自动边，spec 验收 20/26）；
// Geometry 为几何修复回写专用 origin（S1：applyDocToStore 收尾 refit 差异回写）——同款刻意不入 trackedOrigins（撤销的是修复不是用户编辑，防啃 STACK_LIMIT）
export const Origin = { LocalUser: 'local-user', Server: 'server', AutoEdge: 'auto-edge', Geometry: 'geometry-repair' } as const;

const STACK_LIMIT = 100;

let undoManager: Y.UndoManager | null = null;

export function attachUndoManager(doc: Y.Doc): Y.UndoManager {
  undoManager?.destroy();
  const um = new Y.UndoManager([doc.getMap('nodes'), doc.getMap('edges')], {
    trackedOrigins: new Set([Origin.LocalUser]),
    captureTimeout: 500,
  });
  um.on('stack-item-added', ({ type }) => {
    // yjs 事件 payload 为 { stackItem, type }，type: 'undo' | 'redo'（无 stack 字段）
    if (type === 'undo' && um.undoStack.length > STACK_LIMIT) {
      um.undoStack.shift(); // 手动截断（Y.UndoManager 无内建上限）
    }
  });
  undoManager = um;
  return um;
}

export function detachUndoManager() {
  undoManager?.destroy();
  undoManager = null;
}

export function stopCapturing() {
  undoManager?.stopCapturing();
}

export function getUndoManager() {
  return undoManager;
}

/** 快捷键入口（保留 S-1 语义：undo 后消失节点的活跃进程取消） */
export async function undoCanvas(): Promise<void> {
  const um = undoManager;
  if (!um || um.undoStack.length === 0) return;
  // 动态 import：测试重量隔离——canvasUndo.test.ts 只拉 yjs，静态引入会把 antd/@xyflow 全图拖进测试
  const { useCanvasStore } = await import('./canvasStore');
  if (undoManager !== um) return; // await 间隙项目切换防串
  const beforeIds = new Set(useCanvasStore.getState().nodes.map((n: any) => n.id));
  um.undo();
  const afterIds = new Set<string>(um.doc.getMap('nodes').keys()); // 事务同步提交，doc 已是 undo 后状态
  const s = useCanvasStore.getState();
  for (const id of beforeIds) {
    if (!afterIds.has(id) && s.nodeProcessMap[id]) s.cancelNodeProcess(id);
  }
}

export async function redoCanvas(): Promise<void> {
  if (!undoManager || undoManager.redoStack.length === 0) return;
  undoManager.redo();
}
