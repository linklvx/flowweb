// apps/web/src/stores/canvasHistory.ts
// 结构层 undo/redo 历史纯函数（spec: canvas-undo-redo.md v5）
// ⚠️ 本模块严禁 import 任何 store（含 nodeStore——nodeStore 顶层 import canvasStore，
//    会构成 canvasHistory → nodeStore → canvasStore → canvasHistory 环，
//    在本模块先于 canvasStore 求值时 TDZ 崩溃）。store 访问一律依赖注入。
// zundo pastStates 同时是 undo 回写载荷 → partialize 必须返回完整引用（G1），
// 结构过滤（UI/派生态不触发历史）下沉到 equality 层。
import type { Node, Edge } from '@xyflow/react';
import isEqual from 'fast-deep-equal';

export const HISTORY_LIMIT = 100;

export interface NodeDataSnapEntry {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface HistoryPartial {
  nodes: Node[];
  edges: Edge[];
  __nodeDataSnap: Record<string, NodeDataSnapEntry>;
}

/** nodeStore 最小结构（依赖注入接口，防循环 import） */
export interface NodeStoreLike {
  nodes: Record<string, NodeDataSnapEntry>;
}

/** equality/白名单共用提取：只保留触发历史的结构字段 */
export function pickStructNodes(nodes: Node[]) {
  return nodes.map((nd) => ({
    id: nd.id,
    type: nd.type,
    position: nd.position,
    parentId: nd.parentId,
    width: nd.width,
    height: nd.height,
  }));
}

export function pickStructEdges(edges: Edge[]) {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: e.type,
  }));
}

/** G1 sanitize：dragStart 瞬间 RF 已置 dragging=true，完整引用会污染快照 → 仅 clone dragging 节点 */
export function sanitizeDragging(nodes: Node[]): Node[] {
  return nodes.some((nd) => nd.dragging)
    ? nodes.map((nd) => (nd.dragging ? { ...nd, dragging: false } : nd))
    : nodes;
}

/** S-3：structuredClone 失败（data 混入函数/Blob/DOM 引用）降级浅拷贝——
 *  partialize 在 zundo _handleSet 内同步执行，抛错会打崩每一次 set */
function cloneSnap(nodes: Record<string, NodeDataSnapEntry>): Record<string, NodeDataSnapEntry> {
  try {
    return structuredClone(nodes);
  } catch (err) {
    console.warn('[canvasHistory] structuredClone failed, fallback to shallow copy', err);
    return { ...nodes };
  }
}

/** F1 缓存闭包：nodeStore 引用未变时复用上次深拷贝（源码确认每次 set 双跑 partialize 且 pause 期也跑第一次）。
 *  getNodeStore 由 canvasStore.ts 注入（Task 2 创建单例实例）。
 *  I-1：指针交互中（drag/resize，_isPointerInteraction）跳过采样复用 cachedSnap——TD-Pos 同步
 *  （onNodesChange :544-561）拖动中每帧写 nodeStore 新引用会使缓存每帧 miss → 每帧全量
 *  structuredClone；而 pause 期间 partialize 产物整体被 zundo _handleSet 丢弃（isTracking 检查），
 *  无消费者，跳过安全；结束后下次调用 catch-up（catch-up 采样点 = resume 后首个 set 的 pre-partialize，
 *  故复位 set 必须在 pause 窗口内——五审 C-1，见 canvasHistoryRuntime endDragTransaction） */
export function createPartialize(getNodeStore: () => NodeStoreLike) {
  let cachedSnap: HistoryPartial['__nodeDataSnap'] = {};
  let cachedRef: unknown = null;
  return (state: { nodes: Node[]; edges: Edge[]; _isPointerInteraction?: boolean }): HistoryPartial => {
    if (!state._isPointerInteraction) {
      const ns = getNodeStore();
      if (ns.nodes !== cachedRef) {
        cachedSnap = cloneSnap(ns.nodes);
        cachedRef = ns.nodes;
      }
    }
    return { nodes: sanitizeDragging(state.nodes), edges: state.edges, __nodeDataSnap: cachedSnap };
  };
}

/** G1：结构过滤在 equality 层——selected/hidden/dragging/data 变化不产生历史 */
export function structuralEquality(
  past: { nodes: Node[]; edges: Edge[] },
  current: { nodes: Node[]; edges: Edge[] },
): boolean {
  return isEqual(pickStructNodes(past.nodes), pickStructNodes(current.nodes))
    && isEqual(pickStructEdges(past.edges), pickStructEdges(current.edges));
}
