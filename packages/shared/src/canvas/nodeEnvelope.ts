// packages/shared/src/canvas/nodeEnvelope.ts
import type { DocNodeRecord } from './docShape';

/** 节点信封唯一类型（spec §4.7 纯数据方案，不含 yjs——防跨实例 instanceof 静默失败）。
 *  null 语义（批4a 读归一修订 v3 分家契约）：本函数真删键；doc 读侧出口（O0a-1 起 readRecordsFromMaps
 *  直出 DocNodeRecord——null 值键消除在读侧自做）。API normalizeNodeRecord 是 JSON 序列化边界语义，
 *  不收敛；读侧出口=docShape readRecordsFromMaps 双端同形（O0a-2 起 api 读收编——readDocCanvas
 *  符号已删，null 值键消除两侧同形，?? null 出口不复存在）。 */
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

/** 写侧归一单入口：可选键 null→真删键（显式构造，键不进对象）。
 *  O0a-1 四兜底表第一项删除：position 不再兜底 {0,0}——分镜子无键构造面透传，doc 层 != null 判定兜住
 *  （键集表跳过）；data undefined→{} 保留（空 data 是合法全量）。将来加第四个可选字段必须进本函数。
 *  只碰信封键，不碰 data 内部。 */
export function normalizeCanvasRecord(n: CanvasNodeRecord): CanvasNodeRecord {
  const out: CanvasNodeRecord = {
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data ?? {},
  };
  if (n.parentId != null) out.parentId = n.parentId;
  if (n.width != null) out.width = n.width;
  if (n.height != null) out.height = n.height;
  return out;
}

/** 信封面→作者态 doc 面（O0a-1 类型分裂桥）：normalizeCanvasRecord 同内核（null 真删）+ DocNodeRecord
 *  出口——docShape 家族（fillDoc/applyRecordToYMap）与 buildDocFromSnapshot 的唯一入参桥。
 *  position 原样拷贝（identity 档——分片不变量①：不解释空间，翻转判据在 O0b-0）。 */
export function toDocRecord(n: CanvasNodeRecord): DocNodeRecord {
  const r = normalizeCanvasRecord(n);
  return {
    id: r.id,
    type: r.type,
    position: r.position,
    data: r.data,
    ...(r.parentId != null ? { parentId: r.parentId } : {}),
    ...(r.width != null ? { width: r.width } : {}),
    ...(r.height != null ? { height: r.height } : {}),
  };
}
