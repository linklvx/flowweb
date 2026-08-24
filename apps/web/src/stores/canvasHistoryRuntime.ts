// apps/web/src/stores/canvasHistoryRuntime.ts
// canvas undo/redo 运行时：undo/redo 执行链、事务族、DB 同步。
// ⚠️ 循环依赖裁定（plan 头部）：canvasStore 顶层 import 本模块（组 action 函数体内调用事务），
//    本模块顶层 import canvasStore——**顶层严禁访问 useCanvasStore/historyPartialize 的值**
//    （只允许 import 声明、函数定义、纯常量），否则 canvasStore 先求值时 TDZ 崩溃。
import { message } from 'antd';
import { useCanvasStore, historyPartialize } from './canvasStore';
import { useNodeStore } from './nodeStore';
import type { HistoryPartial } from './canvasHistory';
import { reconcileNodeStore } from './canvasHistory';
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
    data: ns.nodes[nd.id]?.data ?? nd.data,
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

/** S9：统一执行链（同步主体，async 仅因 scheduleSync）。undo=true 撤销 / false 重做。
 *  五审 H-2：pause/resume 复用 withHistoryPaused 深度计数——zundo undo/redo 不检查
 *  isTracking 且经原始 set 应用状态（源码实证），pause 窗口内执行安全且不会重录 */
function applyHistory(direction: 'undo' | 'redo'): Promise<void> {
  const t = useCanvasStore.temporal.getState() as {
    pastStates: HistoryPartial[]; futureStates: HistoryPartial[];
    undo(): void; redo(): void;
  };
  const s = useCanvasStore.getState();
  const stack = direction === 'undo' ? t.pastStates : t.futureStates;
  if (stack.length === 0 || s._isPointerInteraction || s.isHydrating) return Promise.resolve();
  const target = stack[stack.length - 1];

  // isApplyingHistory 不在 partialize 视图 → 窗口外 set 的 pre/post 相等，不产生历史
  useCanvasStore.setState({ isApplyingHistory: true });
  let ok = false;
  withHistoryPaused(() => {
    try {
      const beforeIds = new Set(s.nodes.map((nd) => nd.id));
      if (direction === 'undo') t.undo(); else t.redo();
      // S-1：历史切换后（undo/redo 双向）从结构中消失且仍有活跃进程的节点 → cancel（防生成完成
      // 回调经 nodeStore.updateConfig 为缺失 id 重建节点 → 刷新时幽灵复活）
      const afterState = useCanvasStore.getState();
      const afterIds = new Set(afterState.nodes.map((nd) => nd.id));
      // 取消 beforeIds 中存在但 afterIds 中不存在的节点的进程
      for (const id of beforeIds) {
        if (!afterIds.has(id) && afterState.nodeProcessMap[id]) {
          afterState.cancelNodeProcess(id);
        }
      }
      // 取消 afterIds 中存在但 beforeIds 中不存在的节点的进程（撤销删除时）
      for (const id of afterIds) {
        if (!beforeIds.has(id) && afterState.nodeProcessMap[id]) {
          afterState.cancelNodeProcess(id);
        }
      }
      useNodeStore.setState({
        nodes: reconcileNodeStore(afterState.nodes, target.__nodeDataSnap, useNodeStore.getState().nodes),
      });
      afterState.applyGroupDerivations();
      useCanvasStore.setState({ __nodeDataSnap: undefined });
      ok = true;
    } catch (err) {
      console.error('[canvasHistory] history apply failed', err);
      useCanvasStore.setState({ __nodeDataSnap: undefined });   // S9：半成品最小清理
      message.error('撤销失败，画布状态可能不一致，请刷新页面');
    }
  });
  useCanvasStore.setState({ isApplyingHistory: false });
  return ok ? scheduleSync() : Promise.resolve();
}

export function undoCanvas() { return applyHistory('undo'); }
export function redoCanvas() { return applyHistory('redo'); }
