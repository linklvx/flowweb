// packages/shared/src/canvas/media-refs.ts —— Y1a+Y1b T16（spec :25 裁决③/:80 Z7''/:91 Z18''）：
// doc 媒体引用键扫描单源（mediaRefsOf）——API（binding-reconcile 惰性 reconcile/GC 引用图）与
// web（pendingFacts 消费 fileId 到达判定/重连全量拉 mediaId 集）共用，禁双侧各写一份漂移。
// 结构性入参=DocLike（零 yjs import——api/web 各自 toDocLike 适配注入，fillDoc 同款纪律）。
//
// 【扫描域钉死（spec 评审 P1#1 补全 2026-10-22 grep 实证）】doc 节点引用键全在 **data 域单域**
//（nodes map→nodeId→Y.Map 的 'data' 子 Map）——web 的 updateConfig/updateNodeData/文件引用设置
// 全部经 mergeNodeData 终态全量 merge 后 dispatch updateNodeData 落 data（nodeStore.ts:640-646
// ——「config」只是 store 侧入口命名，doc 无独立 config 域）；referenceVideo/referenceAudio
//（AddNodeMenu.tsx:247-251 视频/音频上传引用）/referenceImage（ImageGenNode.tsx:360）/
// trimmedFileId（nodeStore.setTrimmedResult:855）均此路径。videoFileId/audioFileId 现网不落 doc
//（VideoGenNode.tsx:176-200 分离产物以 fileId 落**子节点**）——spec :80 七键词表原文名目保留
//（未来直落形态预留），与 referenceVideo/referenceAudio 一并进词表（应用层单源——DB CHECK 见下行）。
import type { DocLike } from './docShape';
import { isDocMap, type DocMapLike } from './collab-doc-ops';

/** 媒体引用键词表（MediaBinding.targetField 应用层单源——DB 侧另有 raw SQL CHECK
 *  media_binding_target_field_domain（migration 20261020200300 建、20261022070000 放宽至九键），
 *  **加第十键须同批迁移同步 CHECK 域**，否则运行时 DB 拒写；
 *  键形实证 2026-10-22 grep：fileId/referenceImage/referenceVideo/referenceAudio/trimmedFileId/
 *  videoFileId/audioFileId 为 string 槽（值=mediaId；web 写入面 AddNodeMenu/ImageGenNode/
 *  VideoGenNode/AudioGenNode/nodeStore.trim），images/allImages 为 ImageItem 列表槽
 *  （item.id=mediaId——imageNodeApi/ImageGenNode allImages 写入形态）。 */
export const MEDIA_REF_TARGET_FIELDS = [
  'fileId', 'referenceImage', 'referenceVideo', 'referenceAudio', 'images', 'allImages',
  'trimmedFileId', 'videoFileId', 'audioFileId',
] as const;

export type MediaRefTargetField = (typeof MEDIA_REF_TARGET_FIELDS)[number];

/** string 槽键（值=mediaId；targetItemId 空 sentinel——与 MediaBinding 键对齐）。 */
const SCALAR_REF_FIELDS: readonly MediaRefTargetField[] = [
  'fileId', 'referenceImage', 'referenceVideo', 'referenceAudio', 'trimmedFileId', 'videoFileId', 'audioFileId',
];

/** 列表槽键（值=ImageItem 数组〔Y.Array 或 plain array 双形态——fillDoc 写 plain、canvasIntents
 *  实时可写 Y.Array〕；每 item 一槽位 targetItemId=item.id）。 */
const LIST_REF_FIELDS: readonly MediaRefTargetField[] = ['images', 'allImages'];

/** 单条 doc 引用（MediaBinding 槽位键 [projectId,nodeId,role,targetField,targetItemId] 的 doc 侧来源；
 *  role 恒 primary——引用键均为主槽引用）。 */
export interface MediaRef {
  nodeId: string;
  mediaId: string;
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

/** mediaRefsOf：扫 doc nodes map 全量节点的 data 域引用键 → 引用集（同槽位键天然去重输入——map
 *  键唯一+列表 item.id 唯一；跨节点同 media 产多行 binding 是索引语义）。空串/非 string 标量槽跳过
 *  （fileId:null 是 clearMedia 钉 null 写语义——非引用）。 */
export function collectMediaRefs(doc: DocLike): MediaRef[] {
  const out: MediaRef[] = [];
  const nodes = doc.getMap('nodes');
  for (const [nodeId, entry] of nodes.entries()) {
    if (!isDocMap(entry)) continue;
    const data = entry.get('data');
    if (!isDocMap(data)) continue;
    for (const field of SCALAR_REF_FIELDS) {
      const v = data.get(field);
      if (typeof v === 'string' && v !== '') {
        out.push({ nodeId, mediaId: v, targetField: field, targetItemId: '' });
      }
    }
    for (const field of LIST_REF_FIELDS) {
      for (const item of refListOf(data.get(field))) {
        const id = refItemId(item);
        if (id) out.push({ nodeId, mediaId: id, targetField: field, targetItemId: id });
      }
    }
  }
  return out;
}

/** 全量 mediaId 集（去重）——GC 引用图/web 重连全量拉的集形态出口。 */
export function collectMediaIds(doc: DocLike): Set<string> {
  const ids = new Set<string>();
  for (const r of collectMediaRefs(doc)) ids.add(r.mediaId);
  return ids;
}
