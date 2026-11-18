// packages/shared/src/canvas/media-refs.ts —— Y1a+Y1b T16（spec :25 裁决③/:80 Z7''/:91 Z18''）：
// doc 媒体引用键扫描单源（C3a-1 收口：collectMediaRefsForNode 逐节点+collectMediaRefs 聚合委托）——
// API（binding-reconcile 惰性 reconcile/GC 引用图/C3a-3 帧级快照投影）与
// web（pendingFacts 消费 fileId 到达判定/重连全量拉 mediaId 集）共用，禁双侧各写一份漂移。
// 结构性入参=DocLike（零 yjs import——api/web 各自 toDocLike 适配注入，fillDoc 同款纪律）。
//
// 【扫描域钉死（spec 评审 P1#1 补全 2026-10-22 grep 实证）】doc 节点引用键全在 **data 域单域**
//（nodes map→nodeId→Y.Map 的 'data' 子 Map）——web 的 updateConfig/updateNodeData/文件引用设置
// 全部经 mergeNodeData 终态全量 merge 后 dispatch updateNodeData 落 data（nodeStore.ts:640-646
// ——「config」只是 store 侧入口命名，doc 无独立 config 域）。
// Y2 B4：九键收六键——fileId 随 doc 禁入已无写者（B3），主槽作者键=媒体身份同名 mediaId；
// 三键（trimmedFileId/videoFileId/audioFileId）随词表退役（B3 已删 doc 写者——迁移 20261118142000 同批删行）。
import type { DocLike } from './docShape';
import { isDocMap, type DocMapLike } from './collab-doc-ops';

/** 媒体引用键词表（MediaBinding.targetField 应用层单源——DB 侧另有 raw SQL CHECK
 *  media_binding_target_field_domain（Y2 B4 迁移 20261118142000 同批收紧至六键），
 *  **加/删键须同批迁移同步 CHECK 域**，否则运行时 DB 拒写；
 *  键形：mediaId/referenceImage/referenceVideo/referenceAudio 为 string 槽（值=mediaId），
 *  images/allImages 为 ImageItem 列表槽（item.id=mediaId）。 */
export const MEDIA_REF_TARGET_FIELDS = [
  'mediaId', 'referenceImage', 'referenceVideo', 'referenceAudio', 'images', 'allImages',
] as const;

export type MediaRefTargetField = (typeof MEDIA_REF_TARGET_FIELDS)[number];

/** string 槽键（值=mediaId；targetItemId 空 sentinel——与 MediaBinding 键对齐）。 */
const SCALAR_REF_FIELDS: readonly MediaRefTargetField[] = [
  'mediaId', 'referenceImage', 'referenceVideo', 'referenceAudio',
];

/** 列表槽键（值=ImageItem 列表——Y1c T17 后 doc 载体=Y.Array 容器〔fillDoc 物化+array-domains
 *  写 seam 结构操作〕；读侧双形态收敛维持：Y.Array 可迭代 / plain array 直用——后者=对抗/
 *  异形 doc 与纯 JSON 装置面；每 item 一槽位 targetItemId=item.id）。 */
const LIST_REF_FIELDS: readonly MediaRefTargetField[] = ['images', 'allImages'];

/** 单条 doc 引用（MediaBinding 槽位键 [projectId,nodeId,role,targetField,targetItemId] 的 doc 侧来源；
 *  role 恒 primary——引用键均为主槽引用（C3a 收口：常量字段钉死槽位键五元组——C3a-5 投影器直接消费）。 */
export interface MediaRef {
  nodeId: string;
  mediaId: string;
  role: 'primary';
  targetField: MediaRefTargetField;
  targetItemId: string;
}

/** 列表槽值收敛为数组（Y.Array 可迭代 / plain array 直用 / 其它形态=无引用）。
 *  item 双形态：Y.Map（get('id')）或 plain object（item.id）——fillDoc 与实时写路径并存实证。 */
function refListOf(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v !== null && typeof v === 'object' && typeof (v as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function') {
    return Array.from(v as Iterable<unknown>);
  }
  return [];
}

function refItemId(item: unknown): string | null {
  if (item === null || typeof item !== 'object') return null;
  const id = typeof (item as { get?: unknown }).get === 'function'
    ? (item as DocMapLike).get('id')
    : (item as { id?: unknown }).id;
  return typeof id === 'string' && id !== '' ? id : null;
}

/** C3a（spec §3.2-1）：单节点引用扫描单源——帧级快照（C3a-3）对每 touched node 调用，
 *  collectMediaRefs 聚合的逐节点腿。候选无关（第五轮 P0 保守收集）：不按 node type/schema 收窄
 *  （不读 type 键）——全词表扫 data 域，未知/缺失 type 照扫。非 map 条目/无 data 域=空集
 *  （聚合跳过同源语义）。空串/非 string 标量槽跳过（fileId:null 是 clearMedia 钉 null 写语义——
 *  非引用）。 */
export function collectMediaRefsForNode(nodeId: string, entry: unknown): MediaRef[] {
  const out: MediaRef[] = [];
  if (!isDocMap(entry)) return out;
  const data = entry.get('data');
  if (!isDocMap(data)) return out;
  for (const field of SCALAR_REF_FIELDS) {
    const v = data.get(field);
    if (typeof v === 'string' && v !== '') {
      out.push({ nodeId, mediaId: v, role: 'primary', targetField: field, targetItemId: '' });
    }
  }
  for (const field of LIST_REF_FIELDS) {
    for (const item of refListOf(data.get(field))) {
      const id = refItemId(item);
      if (id) out.push({ nodeId, mediaId: id, role: 'primary', targetField: field, targetItemId: id });
    }
  }
  return out;
}

/** collectMediaRefs：扫 doc nodes map 全量节点 → 引用集（聚合=逐节点 collectMediaRefsForNode
 *  并集——单源委托，聚合与帧级快照投影永不漂移；C3a-9 对拍契约与 C3b oracle 端到端消费面）。
 *  同槽位键天然去重输入——map 键唯一+列表 item.id 唯一；跨节点同 media 产多行 binding 是索引语义。 */
export function collectMediaRefs(doc: DocLike): MediaRef[] {
  const out: MediaRef[] = [];
  for (const [nodeId, entry] of doc.getMap('nodes').entries()) {
    out.push(...collectMediaRefsForNode(nodeId, entry));
  }
  return out;
}

/** 全量 mediaId 集（去重）——GC 引用图/web 重连全量拉的集形态出口。 */
export function collectMediaIds(doc: DocLike): Set<string> {
  const ids = new Set<string>();
  for (const r of collectMediaRefs(doc)) ids.add(r.mediaId);
  return ids;
}

/** Y2 D4t（spec v2.13 §3 D5 ⑦ 装入重扫）：单节点按 mediaId 集删引用键——**删域=collectMediaRefsForNode
 *  同一扫描域**（SCALAR_REF_FIELDS 四 string 槽+LIST_REF_FIELDS 两列表槽；非引用键/data 外域零触碰
 *  ——同节点其余存活槽不被误删的零误删保证由「先收集后删」候选集限定承载）。返回真删键数（零=该
 *  节点 no-op）。调用方=DR rescanEnforcedMediaRefs（装载兜底执法腿）同步回调内——禁 await 形态由
 *  调用方承载，本函数纯同步。 */
export function removeMediaRefsForNode(entry: unknown, mediaIds: ReadonlySet<string>): number {
  if (!isDocMap(entry)) return 0;
  const data = entry.get('data');
  if (!isDocMap(data)) return 0;
  let removed = 0;
  for (const field of SCALAR_REF_FIELDS) {
    const v = data.get(field);
    if (typeof v === 'string' && v !== '' && mediaIds.has(v)) {
      data.delete(field);
      removed += 1;
    }
  }
  for (const field of LIST_REF_FIELDS) {
    const list = refListOf(data.get(field));
    if (list.length === 0) continue;
    const keep = list.filter((item) => {
      const id = refItemId(item);
      return !(id != null && mediaIds.has(id));
    });
    if (keep.length !== list.length) {
      data.set(field, keep);   // 写后列表=Y.Map 容器可迭代/read 侧双形态收敛兼容
      removed += list.length - keep.length;
    }
  }
  return removed;
}
