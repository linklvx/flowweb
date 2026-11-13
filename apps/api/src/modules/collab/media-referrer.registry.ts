// apps/api/src/modules/collab/media-referrer.registry.ts
// C3b-3（plan v3 Task C3b-3——spec 2026-11-11-foundation-batch-design.md §3.4-6 :82）：删除保护
// 引用并集的 **structured/objectKey referrer 单源 registry**——每条 {table,column,kind,resolve}
// （kind=mediaId 直等 ∥ objectKey 经 Media 键族 key→mediaId 映射——ObjectManifest/VideoWork.coverKey
// 是对象键；VideoTrimTask.sourceFileId/outputFileId 经写面实证为 **mediaId**〔video-trim.service.ts
// media.findUnique({where:{id:sourceFileId}})+processor handleTaskCompleted(taskId, media.id)——spec
// §3.4-6 第六轮修正将其归对象键系仓内证据不成立，本处按代码实证归档 mediaId，裁定记录 C3b-3 汇报〕）。
//
// 并集另两臂（Binding+Oracle——spec §3.4-6 命名于 registry 之外）在 media-reference.service：
//  - Binding=MediaBinding.mediaId（投影证人——C3a 帧级投影产物）；
//  - Oracle=CanvasReferenceOracle（PG 证人——**join header 决策级校验** epoch+generation+verifiedSeq，
//    非 registry 形状可表达）。
// **登记义务**：新增 mediaId 引用列必须登记本 registry——check-collab-census ㊴ registry↔schema
// 联动门（mediaId 命名列全登记 ∥ 条目 table/column 实存校验）未登记即红。
//
// 语义对齐（既有 resolveMediaDisposition/media-gc 引用图——scope 语义「projectId/workflowId not 被擦项目」）：
//  - excludedProjectIds=排除项目并集（excludeProjectId ∪ includeDeletedProjects=false 时非 ACTIVE 项目）；
//  - VideoWork/ObjectManifest 无项目/team 锚（作品行 detach 保留/claim 表全局）——恒全体计入不排除；
//  - VideoProject.data=JSON 深扫（collectJsonMediaIds 单源——mediaId 词形递归）；
//  - ObjectManifest 只认**在位 claim**（claimUntil>now=在飞物化保守保留——过期 claim 不算）。
import { Prisma } from '@prisma/client';
import { collectJsonMediaIds } from '../media-delivery/media-gc.service';

/** 引用检查 DB 面（PrismaService ∥ $transaction tx——删除事务内 recheck 直供：两者 delegate 同构）。 */
export type MediaRefDb = Prisma.TransactionClient;

/** registry 条目两态（spec §3.4-6）。 */
export type MediaReferrerKind = 'mediaId' | 'objectKey';

/** resolve 载荷（scope 化——isMediaReferenced 单次调用的并集上下文）。 */
export interface MediaReferrerScope {
  db: MediaRefDb;
  /** 候选 media id（kind=mediaId 直等判据）。 */
  mediaId: string;
  /** objectKey 臂键映射载荷（Media.key+Media.objectKey——thumbnailKey 不入映射〔既有 resolveMediaDisposition
   *  同口径：缩略图生命周期随主对象，无独立引用面〕）。 */
  mediaKeys: readonly string[];
  teamId: string;
  /** 排除项目并集（excludeProjectId ∪ includeDeletedProjects=false 的非 ACTIVE 项目）——空=无排除谓词。 */
  excludedProjectIds: readonly string[];
}

/** registry 单条（census ㊴ 以 {table,column,kind} 三元提取联动 schema——形态漂移即红）。 */
export interface MediaReferrerEntry {
  readonly table: string;
  readonly column: string;
  readonly kind: MediaReferrerKind;
  /** 该 referrer 是否引用候选（true=保护——任一命中即保留）。 */
  resolve(scope: MediaReferrerScope): Promise<boolean>;
}

/**
 * structured/objectKey referrer 全集（十条目——spec §3.4-6 枚举面；新增 mediaId 列同批登记）。
 * 各 resolve=纯读（findFirst/findMany——零写面；VideoProject.data 深扫行集=team 域全量）。
 */
export const MEDIA_REFERRERS: readonly MediaReferrerEntry[] = [
  {
    // 生成产物权威（mediaId 直等——projectId 排除=被擦项目自身 artifact 随批删）
    table: 'NodeArtifact',
    column: 'mediaId',
    kind: 'mediaId',
    resolve: ({ db, mediaId, excludedProjectIds: ex }) => db.nodeArtifact.findFirst({
      where: ex.length > 0 ? { mediaId, projectId: { notIn: [...ex] } } : { mediaId },
      select: { id: true },
    }).then((r) => r != null),
  },
  {
    // 已发布作品（videoMediaId=mediaId 臂；作品行 erasure detach 保留——全体计入无排除）
    table: 'VideoWork',
    column: 'videoMediaId',
    kind: 'mediaId',
    resolve: ({ db, mediaId }) => db.videoWork.findFirst({ where: { videoMediaId: mediaId }, select: { id: true } }).then((r) => r != null),
  },
  {
    // 作品封面（objectKey 臂——coverKey∈Media 键族命中即保留）
    table: 'VideoWork',
    column: 'coverKey',
    kind: 'objectKey',
    resolve: ({ db, mediaKeys }) => db.videoWork.findFirst({
      where: { coverKey: { in: [...mediaKeys] } },
      select: { id: true },
    }).then((r) => r != null),
  },
  {
    // 打光产物（resultMediaId=mediaId 臂——projectId 排除同 NodeArtifact）
    table: 'LightingTask',
    column: 'resultMediaId',
    kind: 'mediaId',
    resolve: ({ db, mediaId, excludedProjectIds: ex }) => db.lightingTask.findFirst({
      where: ex.length > 0 ? { resultMediaId: mediaId, projectId: { notIn: [...ex] } } : { resultMediaId: mediaId },
      select: { id: true },
    }).then((r) => r != null),
  },
  {
    // 剪辑任务源（sourceFileId=Media.id——写面实证 mediaId 非 mediaKey；workflowId=项目别名列排除）
    table: 'VideoTrimTask',
    column: 'sourceFileId',
    kind: 'mediaId',
    resolve: ({ db, mediaId, excludedProjectIds: ex }) => db.videoTrimTask.findFirst({
      where: ex.length > 0 ? { sourceFileId: mediaId, workflowId: { notIn: [...ex] } } : { sourceFileId: mediaId },
      select: { id: true },
    }).then((r) => r != null),
  },
  {
    // 剪辑任务产物（outputFileId=Media.id——processor handleTaskCompleted(taskId, media.id) 实证）
    table: 'VideoTrimTask',
    column: 'outputFileId',
    kind: 'mediaId',
    resolve: ({ db, mediaId, excludedProjectIds: ex }) => db.videoTrimTask.findFirst({
      where: ex.length > 0 ? { outputFileId: mediaId, workflowId: { notIn: [...ex] } } : { outputFileId: mediaId },
      select: { id: true },
    }).then((r) => r != null),
  },
  {
    // 剪辑工程 timeline（JSON 深扫——collectJsonMediaIds 单源 mediaId 词形递归；team 域+workflowId 排除）
    table: 'VideoProject',
    column: 'data',
    kind: 'mediaId',
    resolve: async ({ db, mediaId, teamId, excludedProjectIds: ex }) => {
      const rows = await db.videoProject.findMany({
        where: ex.length > 0 ? { teamId, workflowId: { notIn: [...ex] } } : { teamId },
        select: { data: true },
      });
      return rows.some((vp) => collectJsonMediaIds(vp.data).has(mediaId));
    },
  },
  {
    // 对象清单在位 claim（objectKey 臂——claimUntil>now=在飞物化保守保留；过期 claim 不算）
    table: 'ObjectManifest',
    column: 'objectKey',
    kind: 'objectKey',
    resolve: ({ db, mediaKeys }) => db.objectManifest.findFirst({
      where: { objectKey: { in: [...mediaKeys] }, claimUntil: { gt: BigInt(Date.now()) } },
      select: { id: true },
    }).then((r) => r != null),
  },
  {
    // 投影 outbox（mediaId 臂——C3b-3 新入并集；projectId 排除=被擦项目自身投影行随 scope 批删）
    table: 'ArtifactProjection',
    column: 'mediaId',
    kind: 'mediaId',
    resolve: ({ db, mediaId, excludedProjectIds: ex }) => db.artifactProjection.findFirst({
      where: ex.length > 0 ? { mediaId, projectId: { notIn: [...ex] } } : { mediaId },
      select: { id: true },
    }).then((r) => r != null),
  },
  {
    // 生成意图产物引用（resultRef=Media id / 产物 URL 混合列——直等判据 URL 永不命中 UUID；projectId 排除：
    // 被擦项目自身 intent scrub 先行但决策面按排除语义——与旧 resolveMediaDisposition「resultRef 不进
    // 引用图」不同，spec §3.4-6 v5 显式入并集）
    table: 'GenerationIntent',
    column: 'resultRef',
    kind: 'mediaId',
    resolve: ({ db, mediaId, excludedProjectIds: ex }) => db.generationIntent.findFirst({
      where: ex.length > 0 ? { resultRef: mediaId, projectId: { notIn: [...ex] } } : { resultRef: mediaId },
      select: { id: true },
    }).then((r) => r != null),
  },
];
