import { normalizeCanvasRecord, type CanvasNodeRecord } from '@flowweb/shared';

/** ephemeral 键集（Spec B editMode 口径 13，v3.16 终裁 53）：editMode/transformMode=本地瞬态
 *  UI 键（编辑态只活在 ns data 本地面），禁入 doc/cs 持久面；expanded 是 doc 态
 *  （toggleExpanded 落 doc+决定渲染尺寸）禁入本键集——剥键扩大化由 canvasIntents.spec 守卫。
 *  键集单源在此（canvasIntents 漏斗入口消费本出口——防双源漂移）。 */
export const EPHEMERAL_DATA_KEYS = new Set(['editMode', 'transformMode']);

/** ephemeral 键剥除（浅拷贝逐键过滤——非整表替换）：投影出口（invariant/diff 快照单源）与
 *  doc 漏斗入口（applyIntentToDoc 落 doc/cs upsert）共用。 */
export function stripEphemeralDataKeys(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!EPHEMERAL_DATA_KEYS.has(k)) out[k] = v;
  }
  return out;
}

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
    data: stripEphemeralDataKeys(
      nd.type === 'group' ? (nd.data ?? {}) : (nsNodes[nd.id]?.data ?? nd.data ?? {}),
    ),
  }));
}
