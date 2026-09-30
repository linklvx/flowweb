import { normalizeCanvasRecord, type CanvasNodeRecord } from '@flowweb/shared';

/** store→doc 投影单源（canvasIntents 差分换芯与不变量校验共用）：几何真值在 canvasStore（width 缺即缺——
 *  投影不含 measured：渲染期 ResizeObserver 量，帧变渲染时序函数→跨客户端漂移源）；
 *  data 所有权分型（F42）：组节点取 cs（所有权单一——Task 11 删镜像后 ns 无组 data），
 *  普通节点取 ns（updateConfig 域）、ns 缺席回落 cs（恢复窗口）。输出经写侧归一（真删键）。 */
export function projectCanvasNodes(
  csNodes: { id: string; type?: string; position: { x: number; y: number }; parentId?: string | null; width?: number | null; height?: number | null; measured?: { width?: number; height?: number }; data?: Record<string, unknown> }[],
  nsNodes: Record<string, { data?: Record<string, unknown> }>,
): CanvasNodeRecord[] {
  return csNodes.map((nd) => normalizeCanvasRecord({
    id: nd.id,
    type: nd.type || 'videoGen',
    parentId: nd.parentId ?? null,
    position: nd.position,
    width: nd.width ?? null,      // 不含 measured——resize 经 applyNodeChanges 写 cs.width
    height: nd.height ?? null,
    data: nd.type === 'group' ? (nd.data ?? {}) : (nsNodes[nd.id]?.data ?? nd.data ?? {}),
  }));
}
