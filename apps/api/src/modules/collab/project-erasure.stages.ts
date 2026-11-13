// apps/api/src/modules/collab/project-erasure.stages.ts
// C4-c1（plan Task C4-3——生产就绪收尾批·project-erasure）：project scope PURGING_DB **执行体**
// （自 poller 拆出——C4-b 质量评审前瞻：poller 只留 claim/心跳/流转骨架，stage 执行体独立文件；
// census ⑰ 闭包纯度=prisma/shared/manifest/spool 族，零 controller/Http 面——httpMediaRefsCollector
// 经原生 fetch 不引 HttpModule）。
//
// 承接契约（poller C4-b 注释钉死——spec 评审 P1「二扫并集」定形）：
//  ①**DRAINING→PURGING_DB 二扫并集**：manifest 采集（DRAINING）后在飞 finalize（GenerationIntent
//    registerInTx artifact-commit :288/:312）与 coverKey 换绑仍可落新 Media/VideoWork 行 ⇒ 进批删前
//    重扫 live 行集与 manifest 行集**取并集**（只增不减——kill -9 各步重跑幂等）并**重写 manifest**
//    （同 path 覆盖+DB 索引 sha 同步——C4-c2 对象/Redis 清除经并集 manifest 重放；DB 行删除以 live
//    DB 为准兜底：manifest−DB 现存=对象删除面，manifest∩DB 现存=保留〔detach〕行）；
//  ②**无 FK 孤儿族 per-scope 批删**（registry 驱动——PROJECT_COLUMN_MODELS+PROJECT_SCOPE_ALIASES）：
//    FK Cascade 族（CanvasDoc/CanvasDocSnapshot/CanvasDocUpdate/ProjectMember/VideoProject）随
//    CanvasProject 行删除级联不重复删；ExecutionRequest/GenerationIntent=allowlist 计费行保留
//    （intent 只 scrub 内容列）；Template=worker 显式 DELETE WHERE projectId（FK 未改——产品裁定
//    2026-11-05 随项目擦除）；桥表（ExecutionNodePlan/ExecutionInput 经 ExecutionRequest、
//    RefundObligation/ReconcileAction 经 GenerationIntent）raw SQL 子查询批删；
//  ③**Media 三档 registry**（红⑫）：库资产（folderId 非空∨isFavorite∨type='uploaded'——schema
//    :346-348 素材库语义）→detach（projectId=NULL+清 nodeId/taskId+行对象保留）；他项目/已发布作品
//    引用→detach 保留（引用图=VideoWork.videoMediaId/coverKey+NodeArtifact.mediaId+MediaBinding+
//    VideoProject.data 深扫+LightingTask.resultMediaId+VideoTrimTask.sourceFileId/outputFileId+他项目
//    引用〔collectMediaRefs 内部端点——api 不可达=本轮暂停不删 fail-closed〕+ObjectManifest claim
//    〔在位 claim=在飞物化保守保留〕；resultRef 不进引用图——生成产物不跨 scope 仅 scrub）；独占
//    （generated/temp 且无前两档）→删 DB 行（对象全版本删除归 C4-c2）+**两阶段复核**（首扫标记→
//    下一轮 tick 跨 claim 周期复核仍独占才删——复核载体=manifest 目录 sidecar 标记文件，禁加列）；
//  ④**VideoWork detach**（红⑬）：canvasProjectId=NULL——视频/封面/计费/审计保留；
//  ⑤**GenerationIntent scrub**：resultText/gestureKey/resultRef→NULL+计费列保留；
//  ⑥完成=state='PURGING_OBJECTS' **即停**（对象/Redis/VERIFYING 归 C4-c2）；列级机器断言
//    （红⑯——project-erasure.assert）尾步前置位把关；dryRun=走完整流程（二扫/判别/断言）但跳过
//    一切除删与 scrub 写（介质删除跳过含 DB 行删除——完整 DRY_RUN 语义定形归 C4-c2）。
// kill -9 幂等（红⑪）：各内步重跑收敛——并集只增、deleteMany/updateMany 谓词幂等、sidecar 跨 tick
// 复核、行删除 P2025 折幂等；lease 过期他实例重认领=C4-b claim 谓词（执行体不自持锁跨步）。
//
// ═══ C4-c2 骑手裁定登记（2026-11-05——代码注释显性登记非改码；评审需收紧再议）══════════════
//  **P2-1（dryRun 档 manifestSha256 写 run 行口径）**：dryRun 亦执行 ②并集重写 manifest+DB 索引列
//   同步——**裁定=维持现行为**（c1 已然：manifest 采集/索引=run 自身簿记非项目数据清除面；「介质
//   删除跳过含 DB 行删除」的 DRY_RUN 字面不涵盖 run 行自身元数据写；且 dryRun 后真实擦除需要完整
//   并集 manifest 承接——提前采集是前置价值非副作用。红测锚=c1 dryRun 用例 manifestAfter 断言）。
//  **P2-3（fail-closed 轮 CanvasProject 行删除宽松档）**：doc 扫描不可达（docScanFailed）时本执行体
//   仍推进批删+CanvasProject 行删除、**只停独占 media 删除**——裁定=登记非收紧（现行为方向安全：
//   ①Canvas 族写者已被 fence 拒、行删除不可逆性低〔行集可从备份恢复〕；②独占 media 行+对象删除
//   〔不可逆+用户数据〕恒走两阶段复核窗；③收敛性成立——恢复可达后下一 tick 续判独占；④收紧
//   〔fail-closed 停一切〕会让 api 短暂不可达阻塞整个擦除管道=可用性损失换无收益的保守）。
import { Logger } from '@nestjs/common';
import { join } from 'node:path';
import type { ProjectErasureRun } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithIncludeDeleted } from '../../prisma/read-path.filter';
import { ErasureContextService, lockProject, fenceProject } from './project-lock';
import { PROJECT_COLUMN_MODELS, PROJECT_SCOPE_ALIASES } from './scope-column.registry';
import {
  writeErasureManifest, readErasureManifest, collectSpoolSegments, erasureManifestDir, collabSpoolDir, type ErasureManifestInputs,
} from './project-erasure.manifest';
import { assertProjectErasureDbComplete, type ErasureAssertDb } from './project-erasure.assert';
import { ERASURE_MEDIA_REFS_BATCH } from './collab-spool.service';
import { collectJsonMediaIds, claimMediaForDeletion, releaseMediaDeletionClaim } from '../media-delivery/media-gc.service';
import { mediaDeletionConflictTotal, mediaRefShadowMismatchTotal } from '../media-delivery/binding-reconcile.metrics';
import { MediaReferenceService } from './media-reference.service';   // C3b-5：并集单源决策面
import { controlledRebuildForMedia } from './binding-rebuild.service';   // C3b-5：shadow extra 受控 rebuild
import { DeletionBarrierPort, HttpDeletionBarrierPort, type DeletionBarrierPrepareWireResult } from './deletion-barrier.port';   // C3b-5：删除窗 barrier（worker=Http loopback）
import { ERASURE_RUN_LEASE_MS } from './project-erasure';
import { erasureRunsTotal, erasureStageDuration } from './erasure.metrics';

/** 两阶段复核窗=一个 claim 租约周期（跨 claim 周期——标记与删除不得同窗：窗内在飞写可观测）。 */
const ERASURE_MEDIA_REVIEW_MS = 60_000;
/** PURGING_DB 批删事务上限（resolution 写批+scope 批删两事务）。 */
const PURGE_TX_TIMEOUT_MS = 60_000;
/** FK Cascade 族（CanvasProject 行删除 DB 级联——不显式批删）。 */
const FK_CASCADE_PROJECT_MODELS = new Set(['CanvasDoc', 'CanvasDocSnapshot', 'CanvasDocUpdate', 'ProjectMember']);
/** stage 内部 ErasureContext（自包裹——直调测试面免手工包裹；与 poller 双包裹幂等无害〔ALS run 嵌套零语义差〕）。 */
const erasureCtx = new ErasureContextService();

/** live Media 行（二扫/三档判别载荷）。 */
export interface LiveMediaRow {
  id: string; teamId: string; folderId: string | null; isFavorite: boolean; type: string;
  nodeId: string | null; taskId: string | null; key: string; objectKey: string | null;
}
/** live VideoWork 行（二扫载荷）。 */
interface LiveWorkRow { id: string; canvasProjectId: string | null; videoKey: string; coverKey: string | null }

/** 未 reconcile 引用采集器（api 进程 doc 扫描——collectMediaRefs 内部端点的 worker 侧客户端面）。
 *  返回 referenced mediaIds 子集；**null=不可达**（api 停摆/非 serving/限批拒）——调用方 fail-closed
 *  本轮暂停独占判别（不删该 media——下轮 tick 重试）。 */
export type MediaRefsCollector = (args: { teamId: string; excludeProjectId: string; mediaIds: string[] }) => Promise<string[] | null>;

/** worker→api 原生 fetch 采集器（HttpCollabWritePort 同族：loopback api 基址+WORKER_WRITE_TOKEN
 *  bearer；单发不重试——不可达即 null 由下一 tick 兜底〔run 行=唯一唤醒源〕）。 */
export function httpMediaRefsCollector(opts: { baseUrl?: string; token?: string } = {}): MediaRefsCollector {
  return async ({ teamId, excludeProjectId, mediaIds }) => {
    const baseUrl = (opts.baseUrl ?? `http://127.0.0.1:${process.env.PORT ?? '3000'}`).replace(/\/+$/, '');
    const token = opts.token ?? process.env.WORKER_WRITE_TOKEN;
    const referenced = new Set<string>();
    for (let i = 0; i < mediaIds.length; i += ERASURE_MEDIA_REFS_BATCH) {
      try {
        const res = await fetch(`${baseUrl}/api/collab/doc/media-refs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ teamId, excludeProjectId, mediaIds: mediaIds.slice(i, i + ERASURE_MEDIA_REFS_BATCH) }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status !== 200) return null;
        const body = await res.json() as { referenced?: unknown };
        if (!Array.isArray(body.referenced)) return null;
        for (const r of body.referenced) if (typeof r === 'string') referenced.add(r);
      } catch {
        return null;   // 网络错误族（ECONNREFUSED/超时）——不可达档
      }
    }
    return [...referenced];
  };
}

/** 两阶段复核 sidecar（manifest 目录同域耐久标记——**禁为一次性复核加 schema 列**的载体落地：
 *  `<erasureId>.pending-media.json`，temp→rename 原子写）。 */
export interface PendingMediaMarker { schemaVersion: 1; markAt: string; teamId: string | null; mediaIds: string[] }

export function pendingMediaMarkerPath(dir: string, erasureId: string): string {
  return join(dir, `${erasureId}.pending-media.json`);
}

async function readPendingMediaMarker(dir: string, erasureId: string): Promise<PendingMediaMarker | null> {
  const { readFile } = await import('node:fs/promises');
  try {
    const raw = JSON.parse(await readFile(pendingMediaMarkerPath(dir, erasureId), 'utf8')) as PendingMediaMarker;
    if (raw == null || typeof raw !== 'object' || !Array.isArray(raw.mediaIds) || typeof raw.markAt !== 'string') return null;
    return { schemaVersion: 1, markAt: raw.markAt, teamId: typeof raw.teamId === 'string' ? raw.teamId : null, mediaIds: raw.mediaIds.filter((x): x is string => typeof x === 'string') };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    return null;
  }
}

async function writePendingMediaMarker(dir: string, erasureId: string, marker: PendingMediaMarker): Promise<void> {
  const { writeFile, rename } = await import('node:fs/promises');
  const path = pendingMediaMarkerPath(dir, erasureId);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(marker)}\n`, 'utf8');
  await rename(tmp, path);
}

async function removePendingMediaMarker(dir: string, erasureId: string): Promise<void> {
  const { rm } = await import('node:fs/promises');
  await rm(pendingMediaMarkerPath(dir, erasureId), { force: true }).catch(() => undefined);
}

/** 二扫：live 行集重扫（DB 行为准兜底——manifest 冻结域缺口的发现面）。 */
export async function rescanProjectMediaWork(prisma: PrismaService, pid: string): Promise<{ mediaRows: LiveMediaRow[]; workRows: LiveWorkRow[] }> {
  const [mediaRows, workRows] = await Promise.all([
    prisma.$queryRaw<LiveMediaRow[]>`
      SELECT id, "teamId", "folderId", "isFavorite", type, "nodeId", "taskId", key, "objectKey"
      FROM "Media" WHERE "projectId" = ${pid}::text ORDER BY id`,
    prisma.$queryRaw<LiveWorkRow[]>`
      SELECT id, "canvasProjectId", "videoKey", "coverKey" FROM "VideoWork"
      WHERE "canvasProjectId" = ${pid}::text ORDER BY id`,
  ]);
  return { mediaRows, workRows };
}

/** 并集（manifest 行集 ∪ live 行集——**只增不减**：已删/detach 行在 manifest 留档=C4-c2 对象重放面）。 */
export function unionManifestRows(
  manifest: { media: ErasureManifestInputs['mediaRows']; work: ErasureManifestInputs['workRows'] },
  live: { mediaRows: LiveMediaRow[]; workRows: LiveWorkRow[] },
): { media: ErasureManifestInputs['mediaRows']; work: ErasureManifestInputs['workRows']; grew: boolean } {
  const mediaById = new Map(manifest.media.map((m) => [m.id, m]));
  let grew = false;
  for (const m of live.mediaRows) {
    if (!mediaById.has(m.id)) {
      // 采集后 finalize 新落行（二扫载荷=判别面〔键族〕；bucket/size 档案列不进判别——对象删除面=键族，
      // size=0 占位非账面）
      mediaById.set(m.id, { id: m.id, bucket: '', key: m.key, thumbnailKey: null, objectKey: m.objectKey, size: 0n });
      grew = true;
    }
  }
  const workById = new Map(manifest.work.map((w) => [w.id, w]));
  for (const w of live.workRows) {
    if (!workById.has(w.id)) {
      workById.set(w.id, { id: w.id, canvasProjectId: w.canvasProjectId, videoKey: w.videoKey, coverKey: w.coverKey });
      grew = true;
    }
  }
  const media = [...mediaById.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const work = [...workById.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  return { media, work, grew };
}

/** 从并集 manifest 派生 AuditLog 脱敏断言的 forbidden 内容（介质键族）。 */
function deriveForbiddenContent(union: { media: ErasureManifestInputs['mediaRows']; work: ErasureManifestInputs['workRows'] }): string[] {
  return [
    ...union.media.flatMap((m) => [m.key, m.thumbnailKey, m.objectKey]),
    ...union.work.flatMap((w) => [w.videoKey, w.coverKey]),
  ].filter((k): k is string => typeof k === 'string' && k.length > 0);
}

/** Media 三档判别（红⑫——纯读；docScanFailed=独占档不可信→exclusive 空、候选留原态下轮重判）。
 *  C3b-5 消费面切换：决策引用集=旧面（erasureOldFaceReferenced——PG 快判+他项目 doc 扫）∪
 *  **并集单源 overlay**（isMediaReferenced 五臂闭集——spec §3.4-6：Binding+Oracle+registry。保守取并：
 *  任一面证人即 detach 保留；exclusive=两面皆无证人）。 */
export interface MediaDisposition { detach: string[]; exclusive: string[]; docScanFailed: boolean; docScanSkipped: boolean }

/** erasure 旧引用面（C3b-5 前的引用图——resolveMediaDisposition 引用集判定单源+删除窗 shadow 对拍
 *  复用）：PG 快判（他项目 binding/NodeArtifact/LightingTask/VideoTrim+作品 videoMediaId/coverKey+
 *  VideoProject timeline+ObjectManifest claim）+他项目 doc 扫描（collector）。返回 referenced 集；
 *  **null=collector 不可达**（api 停摆——对拍跳过〔决策面=union 不受影响〕；判别面经
 *  resolveMediaDisposition 承接为 docScanFailed fail-closed）。 */
export async function erasureOldFaceReferenced(
  prisma: PrismaService, pid: string, rest: LiveMediaRow[], collectRefs: MediaRefsCollector,
): Promise<Set<string> | null> {
  const restIds = rest.map((m) => m.id);
  const restIdSet = new Set(restIds);
  const keyToId = new Map<string, string>();
  for (const m of rest) { keyToId.set(m.key, m.id); if (m.objectKey) keyToId.set(m.objectKey, m.id); }
  const referenced = new Set<string>();
  const markRefs = (ids: Iterable<string | null | undefined>) => {
    for (const id of ids) if (typeof id === 'string' && id !== '') referenced.add(id);
  };
  // ── PG 快判引用面（本项目自引用不算——引用行随本 scope 批删/工作 detach 后自消）──
  markRefs((await prisma.mediaBinding.findMany({ where: { mediaId: { in: restIds }, projectId: { not: pid } }, select: { mediaId: true } })).map((r) => r.mediaId));
  markRefs((await prisma.nodeArtifact.findMany({ where: { mediaId: { in: restIds }, projectId: { not: pid } }, select: { mediaId: true } })).map((r) => r.mediaId));
  // VideoWork 全体计入（作品行不删〔detach 保留〕——videoMediaId 引用者存活=被引 media 须保留；
  // coverKey=键引用面：候选键族命中作品封面即保留）
  const works = await prisma.videoWork.findMany({ where: { OR: [{ videoMediaId: { in: restIds } }, { coverKey: { in: [...keyToId.keys()] } }] }, select: { videoMediaId: true, coverKey: true } });
  markRefs(works.map((w) => w.videoMediaId));
  for (const w of works) if (w.coverKey && keyToId.has(w.coverKey)) referenced.add(keyToId.get(w.coverKey)!);
  markRefs((await prisma.lightingTask.findMany({ where: { resultMediaId: { in: restIds }, projectId: { not: pid } }, select: { resultMediaId: true } })).map((r) => r.resultMediaId));
  const trims = await prisma.videoTrimTask.findMany({
    where: { workflowId: { not: pid }, OR: [{ sourceFileId: { in: restIds } }, { outputFileId: { in: restIds } }] },
    select: { sourceFileId: true, outputFileId: true },
  });
  markRefs(trims.flatMap((t) => [t.sourceFileId, t.outputFileId]));
  // VideoProject timeline 深扫（本 team 他项目——collectJsonMediaIds 复用 media-gc 单源：mediaId 词形递归）
  const teamId = rest[0]!.teamId;
  for (const vp of await prisma.videoProject.findMany({ where: { teamId, workflowId: { not: pid } }, select: { data: true } })) {
    for (const id of collectJsonMediaIds(vp.data)) if (restIdSet.has(id)) referenced.add(id);
  }
  // ObjectManifest claim（在位未过=在飞物化——保守保留〔对象归 C4-c2；行保留待 claim 出清后下轮判别〕）
  for (const c of await prisma.objectManifest.findMany({
    where: { objectKey: { in: [...keyToId.keys()] }, claimUntil: { gt: BigInt(Date.now()) } },
    select: { objectKey: true },
  })) {
    const id = keyToId.get(c.objectKey);
    if (id) referenced.add(id);
  }
  // ── 他项目 doc 扫描（未 reconcile 引用——副本/copy 未进 binding 索引窗；经 api 内部端点）──
  const otherProjects = await prisma.canvasProject.count({ where: { teamId, id: { not: pid } } });
  if (otherProjects === 0) return referenced;   // 零他项目=零未 reconcile 引用可达
  const refs = await collectRefs({ teamId, excludeProjectId: pid, mediaIds: restIds });
  if (refs == null) return null;   // 不可达：判别面=fail-closed（下轮重试）；对拍面=跳过
  markRefs(refs);
  return referenced;
}

export async function resolveMediaDisposition(
  prisma: PrismaService, pid: string, candidates: LiveMediaRow[],
  collectRefs: MediaRefsCollector,
): Promise<MediaDisposition> {
  const detach: string[] = [];
  const rest: LiveMediaRow[] = [];
  for (const m of candidates) {
    // 档 a：库资产（schema :346-348 素材库语义——folderId 非空∨收藏∨上传）
    if (m.folderId != null || m.isFavorite || m.type === 'uploaded') detach.push(m.id);
    else rest.push(m);
  }
  if (rest.length === 0) return { detach, exclusive: [], docScanFailed: false, docScanSkipped: true };
  const referenced = await erasureOldFaceReferenced(prisma, pid, rest, collectRefs);
  if (referenced == null) return { detach, exclusive: [], docScanFailed: true, docScanSkipped: false };   // fail-closed：本轮不判独占（不删）
  // ── C3b-5 并集单源 overlay（决策面=spec §3.4-6 五臂闭集——含 registry 臂〔ArtifactProjection/
  //    GenerationIntent.resultRef 等〕+Oracle 臂〔PG doc 证人〕；被擦项目排除同旧面语义）。
  //    注记（spec 评审 Minor-2）：回滚开关 MEDIA_REF_ORACLE_ONLY 仅辖 isMediaReferenced 决策臂
  //    （=GC 全效）；erasure 决策另含旧面 binding 快判腿（常驻）——开关后 erasure 仍计 binding
  //    证人=过度保留向无安全损失（runbook §13.3 开关辖面）。──
  const teamId = rest[0]!.teamId;
  const mediaRef = new MediaReferenceService(prisma);
  for (const m of rest) {
    if (await mediaRef.isMediaReferenced(prisma, m.id, { teamId, excludeProjectId: pid })) referenced.add(m.id);
  }
  return {
    detach: [...detach, ...rest.filter((m) => referenced.has(m.id)).map((m) => m.id)],
    exclusive: rest.filter((m) => !referenced.has(m.id)).map((m) => m.id),
    docScanFailed: false, docScanSkipped: false,
  };
}

/** 模型名→delegate 键（camelCase 首字母小写——fillWriteGateRegistry 同款键形转换）。 */
function delegateKey(model: string): string {
  return model[0]!.toLowerCase() + model.slice(1);
}

type DeleteManyDelegate = { deleteMany(args: unknown): Promise<unknown> };

/**
 * PURGING_DB 写批（R15「每批删除各自取同键锁」——两批各自 lockProject→fenceProject 首句）：
 *  批一（resolution 写）：Media detach（projectId=NULL+清 nodeId/taskId）+独占行删+GenerationIntent
 *   scrub+VideoWork detach。**独占行删=逐 id 删除事务内 isMediaReferenced recheck 终裁**（C3b-5 spec
 *   评审 P1-1 根修）：删除集在 barrier 窗内算出后 **release 在先行删在后**（60s 批删 tx 不入 10s
 *   fence 窗——spec §3.4-4 :78「⑤删除在 barrier 持有期内完成」的可达成等价形态），release→行删窗内
 *   新投影 binding 照写 DELETING 媒体且 MediaBinding 无 mediaId FK（C1-1 去 FK）=悬挂引用无 DB 兜底
 *   ⇒ 唯一根修面=行删事务内逐 id recheck：命中即该 id 中止保留（claims 留 DELETING，本 tick 收敛
 *   pending-review 下轮 disposition 重判）；返回 deletedMediaIds=实际删除集（中止 id 留
 *   remainingExclusive——调用方 ⑥ 消费）。
 *  批二（scope 批删+行删除）：registry 直列/别名/桥全量 deleteMany+CanvasProject 行删除（FK Cascade
 *   载体；P2025 折幂等——kill -9 重跑行已删）。
 *  批量界注记（C4-c1 质量评审 M6）：单 scope 行集无界批=已知界——谓词幂等重试+60s tx 上界承载；
 *  in 列表超 PG 65535 绑定参数上限=硬错（C4-c2 对象重放批化时一并再议）。
 */
async function applyProjectErasureWrites(
  prisma: PrismaService, pid: string,
  opts: { detachMediaIds: readonly string[]; deleteMediaIds: readonly string[] },
): Promise<{ deletedMediaIds: string[] }> {
  // ── 批一：resolution 写（detach/scrub——谓词幂等：已 detach/scrub 行再跑零匹配）──
  const deletedMediaIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    await lockProject(tx, pid);
    await fenceProject(tx, pid);
    if (opts.detachMediaIds.length > 0) {
      await tx.media.updateMany({
        where: { id: { in: [...opts.detachMediaIds] }, projectId: pid },
        data: { projectId: null, nodeId: null, taskId: null },
      });
    }
    if (opts.deleteMediaIds.length > 0) {
      // 逐 id in-tx recheck 终裁（P1-1——头注根由）：窗内算出的删除集跨 release→行删窗后逐 id 在
      // 删除事务内重判；命中（release 后投影照写 binding 等新引用）=该 id 中止保留（不删——claims
      // 留 DELETING，remainingExclusive 收敛 pending-review 下轮 disposition 重判）。谓词保持
      // id∧projectId=pid（detach 态行不误删；kill -9 重跑已删行=findUnique 零行折幂等跳过）。
      const mediaRef = new MediaReferenceService(prisma);
      for (const id of opts.deleteMediaIds) {
        const row = await tx.media.findUnique({ where: { id }, select: { teamId: true, projectId: true } });
        if (row == null || row.projectId !== pid) continue;   // 行已删/detach（重跑收敛面——非本批删除）
        if (await mediaRef.isMediaReferenced(tx, id, { teamId: row.teamId, excludeProjectId: pid })) continue;   // recheck 命中→中止保留
        if ((await tx.media.deleteMany({ where: { id, projectId: pid } })).count === 1) deletedMediaIds.push(id);
      }
    }
    await tx.generationIntent.updateMany({
      where: { projectId: pid, OR: [{ resultText: { not: null } }, { gestureKey: { not: null } }, { resultRef: { not: null } }] },
      data: { resultText: null, gestureKey: null, resultRef: null },
    });
    await tx.videoWork.updateMany({ where: { canvasProjectId: pid }, data: { canvasProjectId: null } });
  }, { timeout: PURGE_TX_TIMEOUT_MS, maxWait: 10_000 });
  // ── 批二：scope 批删+行删除 ──
  await prisma.$transaction(async (tx) => {
    await lockProject(tx, pid);
    await fenceProject(tx, pid);
    const del = tx as unknown as Record<string, DeleteManyDelegate>;
    for (const model of PROJECT_COLUMN_MODELS) {
      if (FK_CASCADE_PROJECT_MODELS.has(model)) continue;   // FK Cascade（行删除承载）
      if (model === 'Media' || model === 'ExecutionRequest' || model === 'GenerationIntent') continue;   // 三档（批一）/allowlist 计费行保留
      await del[delegateKey(model)]!.deleteMany({ where: { projectId: pid } });
    }
    for (const alias of PROJECT_SCOPE_ALIASES) {
      if (alias.model === 'VideoTrimTask' || alias.model === 'VideoSeparateTask') {
        await del[delegateKey(alias.model)]!.deleteMany({ where: { workflowId: pid } });
      }
      // VideoProject=FK Cascade；VideoWork=批一 detach；ExecutionNodePlan/ExecutionInput/RefundObligation/
      // ReconcileAction=下方桥批删；AuditLog=谓词行保留（断言钉死）
    }
    await tx.$executeRaw`DELETE FROM "ExecutionNodePlan" WHERE "requestId" IN (SELECT id FROM "ExecutionRequest" WHERE "projectId" = ${pid}::text)`;
    await tx.$executeRaw`DELETE FROM "ExecutionInput" WHERE "requestId" IN (SELECT id FROM "ExecutionRequest" WHERE "projectId" = ${pid}::text)`;
    await tx.$executeRaw`DELETE FROM "RefundObligation" WHERE "intentRowId" IN (SELECT id FROM "GenerationIntent" WHERE "projectId" = ${pid}::text)`;
    await tx.$executeRaw`DELETE FROM "ReconcileAction" WHERE "intentRowId" IN (SELECT id FROM "GenerationIntent" WHERE "projectId" = ${pid}::text)`;
    try {
      await tx.canvasProject.delete({ where: { id: pid } });   // FK Cascade 载体（CanvasDoc/Snapshot/Update/ProjectMember/VideoProject）
    } catch (e) {
      if ((e as { code?: string })?.code !== 'P2025') throw e;   // 行已删（kill -9 重跑）折幂等
    }
  }, { timeout: PURGE_TX_TIMEOUT_MS, maxWait: 10_000 });
  return { deletedMediaIds };
}

/** stage 结果（poller 只记日志/续租——状态推进见 outcome）。 */
export type PurgingDbStageResult =
  | { outcome: 'purging-objects' }                                                        // 完成：state=PURGING_OBJECTS（C4-c2 续）
  | { outcome: 'pending-review'; remainingExclusive: number; docScanFailed: boolean }     // 复核窗内/doc 扫描不可达：停 PURGING_DB
  | { outcome: 'dry-run'; detach: number; exclusive: number; docScanFailed: boolean };    // dryRun：零写预览

export interface PurgingDbStageDeps {
  prisma: PrismaService;
  run: ProjectErasureRun;
  collectMediaRefs: MediaRefsCollector;
  /** C3b-5：删除窗 barrier 端口（worker 进程缺省=HttpDeletionBarrierPort loopback api；测试注入
   *  stub——真 barrier 全链归 deletion-barrier.int.spec）。 */
  barrier?: DeletionBarrierPort;
  /** manifest 目录（缺省 erasureManifestDir()——sidecar 同域）。 */
  manifestDir?: string;
  /** spool 目录（并集重写时段重采——poller 同源传入；缺省=COLLAB_SPOOL_DIR∥CWD 缺省档）。 */
  spoolDir?: string;
  /** 复核窗（缺省 ERASURE_MEDIA_REVIEW_MS——测试注入缩短）。 */
  reviewWindowMs?: number;
}

/**
 * PURGING_DB 执行体（poller processProjectRun 消费——state=PURGING_DB∧manifestPath 在档的前置位起）。
 * 自包裹 ErasureContext+runWithIncludeDeleted（poller 双包裹幂等；直调测试面免手工包裹）。
 */
export async function executePurgingDbStage(deps: PurgingDbStageDeps): Promise<PurgingDbStageResult> {
  const { prisma, run } = deps;
  const pid = run.scopeId;
  const manifestDir = deps.manifestDir ?? erasureManifestDir();
  const logger = new Logger('ProjectErasureStages');
  const stageStart = Date.now();
  return erasureCtx.withErasure(run.erasureId, () => runWithIncludeDeleted(async () => {
    // ① manifest 读（footer SHA 复算不等=诚实披露抛错——R16）
    const manifest = await readErasureManifest(run.manifestPath!);
    // ② 二扫并集（kill -9 各步重跑：并集只增不减；grew/DB 索引 sha 漂移→重写+索引同步）
    const live = await rescanProjectMediaWork(prisma, pid);
    const union = unionManifestRows(manifest, live);
    if (union.grew || run.manifestSha256 !== manifest.footer.sha256) {
      const spoolDir = deps.spoolDir ?? collabSpoolDir();
      const rewritten = await writeErasureManifest({
        erasureId: run.erasureId, scopeType: 'project', scopeId: pid, projectIds: [pid],
        requestedAt: run.requestedAt, mediaRows: union.media, workRows: union.work,
        spoolSegs: await collectSpoolSegments(spoolDir, [pid]),
      }, manifestDir);
      await prisma.projectErasureRun.update({ where: { erasureId: run.erasureId }, data: { manifestSha256: rewritten.manifestSha256 } });
      logger.log(JSON.stringify({ event: 'erasure_manifest_union', erasureId: run.erasureId, projectId: pid, media: union.media.length, work: union.work.length, grew: union.grew }));
    }
    // ③ 三档判别（红⑫——纯读面）；dryRun 到此为止（零写：跳过一切删除/scrub/sidecar/状态写）
    const disposition = await resolveMediaDisposition(prisma, pid, live.mediaRows, deps.collectMediaRefs);
    if (run.dryRun) return { outcome: 'dry-run', detach: disposition.detach.length, exclusive: disposition.exclusive.length, docScanFailed: disposition.docScanFailed };
    // ④ 两阶段复核（首扫标记→跨 claim 周期复核仍独占才删；sidecar=复核载体〔禁加列〕）
    //    C3b-4 DELETING 状态机接线（spec §3.4-5 :81）：标记时 CAS 抢占独占集进 DELETING（审计列
    //    runId=erasureId/reason=project-erasure——与 GC 双流互斥+复核窗期 facts 过滤/命令面拒绑）；
    //    复核集漂移（首扫后新引用——独占候选离集）→中止回 ACTIVE+media_deletion_conflict_total；
    //    删除窗 claim 幂等再持有（同 erasureId）——他消费者活持有的行不删（下轮重试）。
    const sidecar = await readPendingMediaMarker(manifestDir, run.erasureId);
    const exclusiveSet = new Set(disposition.exclusive);
    const sidecarSet = new Set(sidecar?.mediaIds ?? []);
    const sameSet = sidecar != null && sidecarSet.size === exclusiveSet.size && [...exclusiveSet].every((id) => sidecarSet.has(id));
    let deletable: string[] = [];
    if (!sameSet) {
      // 复核集漂移：离集候选=首扫后新引用（recheck 命中）→中止回退+conflict 计数（复核窗重置=新标记）；
      // docScanFailed 档独占集人为空——非真漂移不回退（fail-closed 下轮重判）。
      const departed = sidecar != null && !disposition.docScanFailed
        ? [...sidecarSet].filter((id) => !exclusiveSet.has(id)) : [];
      if (departed.length > 0) {
        const n = await releaseMediaDeletionClaim(prisma, departed, run.erasureId);
        if (n > 0) mediaDeletionConflictTotal.inc({ reason: 'project-erasure' }, n);
      }
      if (disposition.exclusive.length > 0) {   // 标记（首次/新晋独占/判别漂移——复核窗重起：保守方向）
        await claimMediaForDeletion(prisma, disposition.exclusive, { runId: run.erasureId, reason: 'project-erasure' });
        await writePendingMediaMarker(manifestDir, run.erasureId, { schemaVersion: 1, markAt: new Date().toISOString(), teamId: live.mediaRows[0]?.teamId ?? sidecar?.teamId ?? null, mediaIds: disposition.exclusive });
      }
    } else if (Date.now() - Date.parse(sidecar!.markAt) >= (deps.reviewWindowMs ?? ERASURE_MEDIA_REVIEW_MS) && !disposition.docScanFailed) {
      // 删除窗（C3b-5 barrier 接线——spec §3.4-4 :78 删除序 ②-⑥ 消费侧）：prepare（exclude=被擦项目
      // ——其自身引用不算保护）→窗内 union 终裁+shadow 同快照对拍算出删除集→release（60s 批删 tx
      // 不入 10s fence 窗——配对纪律）→⑤ 批删事务内逐 id in-tx recheck 终裁后行删（P1-1 头注）。
      // bail-out/预算过期=保守不删（pending-review 下轮 tick 重试——同 erasureId 幂等再持有）。
      const teamId = live.mediaRows[0]?.teamId ?? sidecar?.teamId ?? null;
      if (teamId != null && sidecar!.mediaIds.length > 0) {
        const barrier = deps.barrier ?? new HttpDeletionBarrierPort();
        let prep: DeletionBarrierPrepareWireResult;
        try {
          prep = await barrier.prepare(teamId, { excludeProjectId: pid });
        } catch (e) {
          prep = { outcome: 'bail-out', reason: 'unexpected-error' };
          logger.warn(`erasure barrier prepare 异常（pending-review 下轮重试）: ${(e as Error).message}`);
        }
        if (prep.outcome === 'verified') {
          try {
            if (Date.now() < prep.expiresAt) {   // M3 预算自查：过期=围栏已漏——保守不删
              const mediaRef = new MediaReferenceService(prisma);
              // 对拍域=并集 manifest media−档a−已删行（**非 live**：引用面候选在首扫 tick 已 detach
              // 〔projectId=NULL 出 live 集〕——union 域含 manifest 冻结行+二扫新行，detached 行仍可对拍）。
              const rest: LiveMediaRow[] = [];
              for (const um of union.media) {
                const row = await prisma.media.findUnique({
                  where: { id: um.id },
                  select: { id: true, teamId: true, folderId: true, isFavorite: true, type: true, nodeId: true, taskId: true, key: true, objectKey: true },
                });
                if (row == null || row.folderId != null || row.isFavorite || row.type === 'uploaded') continue;
                rest.push(row);
              }
              const restTeamId = rest[0]?.teamId ?? teamId;
              const unionFace = new Set<string>();
              const faceB = new Set<string>();
              for (const m of rest) {
                if (await mediaRef.isMediaReferenced(prisma, m.id, { teamId: restTeamId, excludeProjectId: pid })) unionFace.add(m.id);
                if (await mediaRef.isMediaReferenced(prisma, m.id, { teamId: restTeamId, excludeProjectId: pid, skipBindingArm: true })) faceB.add(m.id);
              }
              // ── shadow 同快照对拍（spec §3.4-8——ACTIVE 窗内两面读同一冻结宇宙）：新面=registry∪
              //    Oracle 证人面（skipBindingArm）；旧面=erasureOldFaceReferenced（null=collector
              //    不可达=对拍跳过——决策不受影响）。missing=新面独有证人（决策已 detach 保留）；
              //    extra=旧面独有 stale binding→受控 rebuild 清行（被擦项目自身 binding 随批删非对象）。──
              const shadowOld = await erasureOldFaceReferenced(prisma, pid, rest, deps.collectMediaRefs);
              if (shadowOld != null) {
                for (const m of rest) {
                  const newHit = faceB.has(m.id);
                  const oldHit = shadowOld.has(m.id);
                  if (newHit && !oldHit) mediaRefShadowMismatchTotal.inc({ consumer: 'project-erasure', dir: 'missing' });
                  else if (oldHit && !newHit) {
                    mediaRefShadowMismatchTotal.inc({ consumer: 'project-erasure', dir: 'extra' });
                    logger.warn(`erasure shadow extra（stale binding 过度保留向）media=${m.id} → 受控 rebuild`);
                    await controlledRebuildForMedia(prisma, m.id, { excludeProjectIds: [pid] }).catch(() => undefined);
                  }
                }
              }
              // ── union 终裁（窗内漂移=首扫后新引用——sidecar 离集候选中止回 ACTIVE+conflict；
              //    与 ④ 复核集漂移同语义：窗内重判的漂移腿）──
              const departed = sidecar!.mediaIds.filter((id) => unionFace.has(id));
              if (departed.length > 0) {
                const n = await releaseMediaDeletionClaim(prisma, departed, run.erasureId);
                if (n > 0) mediaDeletionConflictTotal.inc({ reason: 'project-erasure' }, n);
              }
              // 删除窗：同 runId 幂等再持有（claim 三腿谓词②）——他消费者活持有的行（新鲜 DELETING）不归
              // 本 run 即不删（remainingExclusive 收口下轮重试；陈旧行经接管腿回收）。
              const owned = await claimMediaForDeletion(prisma, sidecar!.mediaIds, { runId: run.erasureId, reason: 'project-erasure' });
              deletable = sidecar!.mediaIds.filter((id) => owned.has(id) && !unionFace.has(id));   // 复核窗已满∧本 tick 判别仍全独占（sameSet）∧窗内 union 终裁→删（所有权内）
            }
          } finally {
            await barrier.release(teamId, prep.barrierId).catch(() => undefined);   // 配对纪律（stale 零行；崩溃=expiresAt TTL 自愈）
          }
        }
      }
    }
    // ⑤ 写批（两批各自锁——kill -9 各步幂等）。删除=**窗内算出+release 后批删事务内逐 id in-tx
    //    recheck 终裁**（P1-1——applyProjectErasureWrites 头注：60s 批删 tx 不入 10s fence 窗的
    //    spec 可达成等价；中止 id 留 deletedMediaIds 外→remainingExclusive 收敛 pending-review）。
    const { deletedMediaIds } = await applyProjectErasureWrites(prisma, pid, { detachMediaIds: disposition.detach, deleteMediaIds: deletable });
    // ⑥ sidecar 收敛+未决判定（复核窗内/doc 扫描不可达→停 PURGING_DB 续租等下轮）
    const remainingExclusive = disposition.exclusive.filter((id) => !deletedMediaIds.includes(id));
    if (remainingExclusive.length !== disposition.exclusive.length || (disposition.exclusive.length === 0 && sidecar != null)) {
      if (remainingExclusive.length > 0) {
        await writePendingMediaMarker(manifestDir, run.erasureId, { schemaVersion: 1, markAt: sidecar?.markAt ?? new Date().toISOString(), teamId: live.mediaRows[0]?.teamId ?? sidecar?.teamId ?? null, mediaIds: remainingExclusive });
      } else {
        await removePendingMediaMarker(manifestDir, run.erasureId);
      }
    }
    if (remainingExclusive.length > 0 || disposition.docScanFailed) {
      const now = new Date();
      await prisma.projectErasureRun.update({
        where: { erasureId: run.erasureId },
        data: { state: 'PURGING_DB', heartbeatAt: now, leaseUntil: new Date(now.getTime() + ERASURE_RUN_LEASE_MS) },
      });
      return { outcome: 'pending-review', remainingExclusive: remainingExclusive.length, docScanFailed: disposition.docScanFailed };
    }
    // ⑦ 列级机器断言（红⑯——registry 全表清点；violations 非空=不前置位〔租约恢复面重试〕）
    const assertion = await assertProjectErasureDbComplete(prisma as unknown as ErasureAssertDb, pid, { forbiddenContent: deriveForbiddenContent(union) });
    if (!assertion.ok) throw new Error(`PURGING_DB 列级断言红（${pid}）: ${assertion.violations.join('；')}`);
    // ⑧ 前置位：PURGING_OBJECTS 即停（对象/Redis/VERIFYING 归 C4-c2——objects/cache/verifying 执行体）
    const now = new Date();
    await prisma.projectErasureRun.update({
      where: { erasureId: run.erasureId },
      data: { state: 'PURGING_OBJECTS', stage: 'PURGING_DB', heartbeatAt: now, leaseUntil: new Date(now.getTime() + ERASURE_RUN_LEASE_MS), attempts: 0 },
    });
    erasureRunsTotal.inc({ state: 'PURGING_OBJECTS' });
    erasureStageDuration.observe({ stage: 'PURGING_DB' }, (Date.now() - stageStart) / 1000);
    logger.log(JSON.stringify({ event: 'erasure_purging_db_done', erasureId: run.erasureId, projectId: pid, mediaUnion: union.media.length, workUnion: union.work.length, note: 'PURGING_OBJECTS 前置位（对象/Redis saga 归 C4-c2）' }));
    return { outcome: 'purging-objects' };
  }));
}
