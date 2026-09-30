/** 节点信封唯一类型（spec §4.7 纯数据方案，不含 yjs——防跨实例 instanceof 静默失败）。
 *  null 语义（批4a 读归一修订 v3 分家契约）：本函数真删键；读侧出口 readCanvasFromDoc
 *  同过本函数（null 值键/缺键统一消除——读写两侧单一形状）。API normalizeNodeRecord 是
 *  JSON 序列化边界语义，不收敛；后端 readDocCanvas 仍保持 ?? null 出口（服务端消费域，未归一）。 */
export interface CanvasNodeRecord {
  id: string;
  type: string;
  parentId?: string | null;
  width?: number | null;
  height?: number | null;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export const NODE_ENVELOPE_KEYS = [
  'id', 'type', 'parentId', 'width', 'height', 'position', 'data',
] as const satisfies readonly (keyof CanvasNodeRecord)[];

// 双向编译锚定（R0 group.ts 同款手法——satisfies 只抓多余键，Exclude 补抓缺键）
type _MissingFromKeys = Exclude<keyof CanvasNodeRecord, (typeof NODE_ENVELOPE_KEYS)[number]>;
type _AssertNoMissing<T extends never> = T;
type _Anchor = _AssertNoMissing<_MissingFromKeys>;  // 勿删——删即静默失去缺键防护

/** 写侧归一单入口：可选键 null→真删键（显式构造，键不进对象）；position/data undefined/null→兜底（?? 双吃）。
 *  将来加第四个可选字段必须进本函数。只碰信封键，不碰 data 内部。 */
export function normalizeCanvasRecord(n: CanvasNodeRecord): CanvasNodeRecord {
  const out: CanvasNodeRecord = {
    id: n.id,
    type: n.type,
    position: n.position ?? { x: 0, y: 0 },
    data: n.data ?? {},
  };
  if (n.parentId != null) out.parentId = n.parentId;
  if (n.width != null) out.width = n.width;
  if (n.height != null) out.height = n.height;
  return out;
}
