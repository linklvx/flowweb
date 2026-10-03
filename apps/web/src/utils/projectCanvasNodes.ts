import { toDocRecords, type CanvasNodeRecord, type MinimalCSNode } from '@flowweb/shared';

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
 *  cs 投影面适配）：ephemeral 键剥（口径 13——shared 不可见的 web 键集）。
 *  O0b-0：剥键形态原样直构（normalizeCanvasRecord 内核 position 无条件写键——必填类型，不满足
 *  剥键形态；cs 回填逆映射也一并删——把键集剥掉的 position/wh 拼回会破 doc≡store 同形。
 *  doc 缺键⇄出口无键同形——fast-deep-equal keys 长度敏感）。O0b-2 投影层几何键全删时本面随收口。 */
export function projectCanvasNodes(
  csNodes: MinimalCSNode[],
  nsNodes: Record<string, { data?: Record<string, unknown> }>,
): CanvasNodeRecord[] {
  return toDocRecords(csNodes, nsNodes).map((r) => ({
    id: r.id,
    type: r.type,
    ...(r.parentId != null ? { parentId: r.parentId } : {}),
    ...(r.position != null ? { position: r.position } : {}),
    ...(r.width != null ? { width: r.width } : {}),
    ...(r.height != null ? { height: r.height } : {}),
    data: stripEphemeralDataKeys(r.data),
  }) as CanvasNodeRecord);
}
