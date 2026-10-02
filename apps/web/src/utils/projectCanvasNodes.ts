import { normalizeCanvasRecord, toDocRecords, type CanvasNodeRecord, type MinimalCSNode } from '@flowweb/shared';

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

/** store→doc 投影（O0a-3 换芯薄化——双源合并+键集表内剥键单源=shared toDocRecords，本函数只剩
 *  cs 投影面适配）：DocNodeRecord 剥键出口回填 cs 构造几何（三层表第三层：cs 恒有 position——
 *  剥键可见面=toDocRecords 出口非本函数；位置/宽高语义与换芯前逐位等价，diff/invariant 面
 *  行为不变）+ ephemeral 键剥（口径 13——shared 不可见的 web 键集）+ normalizeCanvasRecord
 *  写侧归一（真删键）。width 不含 measured——resize 经 applyNodeChanges 写 cs.width。 */
export function projectCanvasNodes(
  csNodes: MinimalCSNode[],
  nsNodes: Record<string, { data?: Record<string, unknown> }>,
): CanvasNodeRecord[] {
  const csById = new Map(csNodes.map((n) => [n.id, n] as const));
  return toDocRecords(csNodes, nsNodes).map((r) => normalizeCanvasRecord({
    id: r.id,
    type: r.type,
    parentId: r.parentId ?? null,
    position: r.position ?? csById.get(r.id)!.position, // cs 投影面回填（剥键逆映射——identity 逐位）
    width: r.width ?? csById.get(r.id)!.width ?? null,
    height: r.height ?? csById.get(r.id)!.height ?? null,
    data: stripEphemeralDataKeys(r.data),
  }));
}
