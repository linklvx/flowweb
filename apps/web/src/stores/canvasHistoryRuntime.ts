// apps/web/src/stores/canvasHistoryRuntime.ts
// canvas undo/redo 运行时：undo/redo 执行链、事务族、DB 同步。
// ⚠️ 循环依赖裁定（plan 头部）：canvasStore 顶层 import 本模块（组 action 函数体内调用事务），
//    本模块顶层 import canvasStore——**顶层严禁访问 useCanvasStore/historyPartialize 的值**
//    （只允许 import 声明、函数定义、纯常量），否则 canvasStore 先求值时 TDZ 崩溃。
import { message } from 'antd';
import { useCanvasStore, historyPartialize } from './canvasStore';
import { useNodeStore } from './nodeStore';
import type { HistoryPartial } from './canvasHistory';
import { syncNodes, syncEdges } from '@/api/projectApi';

/** undo/redo 后的 DB 全量同步载荷：canvasStore 结构为基准 + nodeStore data */
function buildSyncPayload() {
  const cs = useCanvasStore.getState();
  const ns = useNodeStore.getState();
  return cs.nodes.map((nd) => ({
    id: nd.id,
    type: nd.type || 'videoGen',
    parentId: nd.parentId ?? null,
    position: nd.position,
    data: (ns.nodes[nd.id]?.data ?? nd.data) as Record<string, unknown>,
    width: nd.width,
    height: nd.height,
  }));
}

/** undo/redo 后的 DB 全量同步（失败 toast，spec D3）。
 *  I-2：300ms trailing debounce——快速连按 Ctrl+Z 会发出多个并发全量 PUT，
 *  乱序完成会使 DB 落旧状态；debounce 合并为一次，且 payload 取 debounce 结束时最新状态 */
let syncTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSync(): Promise<void> {
  const { projectId } = useCanvasStore.getState();
  if (!projectId) return Promise.resolve();
  if (syncTimer) clearTimeout(syncTimer);
  return new Promise((resolve) => {
    syncTimer = setTimeout(() => {
      syncTimer = null;
      // 五审 H-1：debounce 窗口内可能已切换项目——重读并校验，防止用旧 projectId
      // 写入当前（新项目/过渡）状态脏写旧项目（page.tsx 切换路径不调 scheduleSync，旧 timer 会存活）
      const pid = useCanvasStore.getState().projectId;
      if (!pid || pid !== projectId) { resolve(); return; }
      Promise.all([
        syncNodes(pid, buildSyncPayload()),
        syncEdges(pid, useCanvasStore.getState().edges),
      ])
        .then(() => resolve())
        .catch((e) => {
          console.error('[canvasHistory] undo sync failed', e);
          message.warning('撤销结果未能保存到服务器，刷新后可能恢复到撤销前状态');
          resolve();
        });
    }, 300);
  });
}

let pauseDepth = 0;

/** M7：DB/本地快照恢复等远程回写统一走此包装，不产生历史。
 *  五审 H-2：zundo pause/resume 为布尔 set 非计数——嵌套调用时内层 resume 会使外层
 *  仍期望 pause 的闭包提前恢复追踪；深度计数保证仅最外层退出时 resume。
 *  定义在 Task 3（而非 Task 6）——Task 4 applyHistory 即复用，pause 全收敛此单一机制 */
export function withHistoryPaused<T>(fn: () => T): T {
  const t = useCanvasStore.temporal.getState();
  if (pauseDepth === 0) t.pause();
  pauseDepth++;
  try {
    return fn();
  } finally {
    pauseDepth--;
    if (pauseDepth === 0) t.resume();
  }
}
