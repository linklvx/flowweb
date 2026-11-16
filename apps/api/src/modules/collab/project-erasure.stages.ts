// apps/api/src/modules/collab/project-erasure.stages.ts
// C4-c1（plan Task C4-3——生产就绪收尾批·project-erasure）：project scope PURGING_DB **执行体**
// （自 poller 拆出——C4-b 质量评审前瞻：poller 只留 claim/心跳/流转骨架，stage 执行体独立文件；
// census ⑰ 闭包纯度=prisma/shared/manifest/spool 族，零 controller/Http 面——卡② K8 起活 doc 扫描
// HTTP 链整链退役，引用判别=isMediaReferenced 单源——本文件零 fetch 面）。
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
//  **P2-3（fail-closed 轮 CanvasProject 行删除宽松档）**：doc 扫描不可达时代（卡② K8 前）本执行体
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
  writeErasureManifest, readErasureManifest, collectSpoolSegments, mergeSpoolSegs, erasureManifestDir, collabSpoolDir, type ErasureManifestInputs,
} from './project-erasure.manifest';
import { assertProjectErasureDbComplete, type ErasureAssertDb } from './project-erasure.assert';
import { claimMediaForDeletion, releaseMediaDeletionClaim } from '../media-delivery/media-gc.service';
import { mediaDeletionConflictTotal } from '../media-delivery/binding-reconcile.metrics';
import { MediaReferenceService } from './media-reference.service';   // C3b-5：并集单源决策面（卡② K8 起唯一引用面）
import { DeletionBarrierPort, HttpDeletionBarrierPort, type DeletionBarrierPrepareWireResult } from './deletion-barrier.port';   // C3b-5：删除窗 barrier（worker=Http loopback；卡② K8 起认领拍同门）
import { ERASURE_RUN_LEASE_MS } from './project-erasure';
import { erasureRunsTotal, erasureStageDuration } from './erasure.metrics';

/** 两阶段复核窗=一个 claim 租约周期（跨 claim 周期——标记与删除不得同窗：窗内在飞写可观测）。 */
const ERASURE_MEDIA_REVIEW_MS = 60_000;
/** 卡② K8（spec §1.5）：认领拍进程内退避（模块级按 erasureId——认领拍 bail/窗内重算为空→下次
 *  prepare 延后 15s 起倍增上限 5min；成功 claim 清掉；kill -9 映射消失即重试；规则③不进退避；
 *  poller 仍 5s 醒、醒了不 prepare——吸收「纯幻影尾段 5s fence 循环」的团队 append 可用性代价）。 */
const CLAIM_BACKOFF_BASE_MS = 15_000;
const CLAIM_BACKOFF_MAX_MS = 300_000;
const claimBackoff = new Map<string, { notBefore: number; attempt: number }>();
function claimBackoffReady(erasureId: string): boolean {
  const b = claimBackoff.get(erasureId);
  return b == null || Date.now() >= b.notBefore;
}
function enterClaimBackoff(erasureId: string): void {
  const attempt = claimBackoff.get(erasureId)?.attempt ?? 0;
  claimBackoff.set(erasureId, { notBefore: Date.now() + Math.min(CLAIM_BACKOFF_BASE_MS * 2 ** Math.min(attempt, 10), CLAIM_BACKOFF_MAX_MS), attempt: attempt + 1 });
}
function clearClaimBackoff(erasureId: string): void { claimBackoff.delete(erasureId); }
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

/** 未 reconcile 引用采集器与 HTTP collector 已随卡② K8 活文档扫描链退役（引用判别=isMediaReferenced
 *  单源——registry∪Binding∪Oracle 三臂）。 */

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

/** Media 三档判别（红⑫——纯读；卡② K8 起引用集=isMediaReferenced 单源 overlay：registry∪Binding∪
 *  Oracle 三臂闭集〔spec §3.4-6〕——旧面 PG 快判/他项目 doc 扫/HTTP 链随 shadow 双轨退役。
 *  任一臂证人即 detach 保留；exclusive=三臂皆无证人。独占集对未 flush 帧系统性失明（oracle 60s 一拍
 *  +binding apply 落后窗）——认领拍在 prepare 围栏内重算（executePurgingDbStage 规则②）。 */
export interface MediaDisposition { detach: string[]; exclusive: string[] }

export async function resolveMediaDisposition(
  prisma: PrismaService, pid: string, candidates: LiveMediaRow[],
): Promise<MediaDisposition> {
  const detach: string[] = [];
  const rest: LiveMediaRow[] = [];
  for (const m of candidates) {
    // 档 a：库资产（schema :346-348 素材库语义——folderId 非空∨收藏∨上传）
    if (m.folderId != null || m.isFavorite || m.type === 'uploaded') detach.push(m.id);
    else rest.push(m);
  }
  if (rest.length === 0) return { detach, exclusive: [] };
  const teamId = rest[0]!.teamId;
  const mediaRef = new MediaReferenceService(prisma);
  const referenced = new Set<string>();
  for (const m of rest) {
    if (await mediaRef.isMediaReferenced(prisma, m.id, { teamId, excludeProjectId: pid })) referenced.add(m.id);
  }
  return {
    detach: [...detach, ...rest.filter((m) => referenced.has(m.id)).map((m) => m.id)],
    exclusive: rest.filter((m) => !referenced.has(m.id)).map((m) => m.id),
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
  | { outcome: 'purging-objects' }                       // 完成：state=PURGING_OBJECTS（C4-c2 续）
  | { outcome: 'pending-review'; remainingExclusive: number }   // 复核窗内/认领拍未 verified：停 PURGING_DB
  | { outcome: 'dry-run'; detach: number; exclusive: number };  // dryRun：零写预览（窗前三臂口径，非决策级）

export interface PurgingDbStageDeps {
  prisma: PrismaService;
  run: ProjectErasureRun;
  /** C3b-5：删除窗 barrier 端口（worker 进程缺省=HttpDeletionBarrierPort loopback api；测试注入
   *  stub——真 barrier 全链归 deletion-barrier.int.spec）。卡② K8 起认领拍与删除拍同门（fence 化）。 */
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
      // TD-33/C1b T14：spoolSegs 单调保留（spool 清理时点前移后 PURGING_DB 重试窗内段可能已清——
      // 重写取 旧值∪新采集，只增不减；审计证据链缺口不因清理时点产生）
      const spoolSegs = mergeSpoolSegs(manifest.spool, await collectSpoolSegments(spoolDir, [pid]));
      const rewritten = await writeErasureManifest({
        erasureId: run.erasureId, scopeType: 'project', scopeId: pid, projectIds: [pid],
        requestedAt: run.requestedAt, mediaRows: union.media, workRows: union.work,
        spoolSegs,
      }, manifestDir);
      await prisma.projectErasureRun.update({ where: { erasureId: run.erasureId }, data: { manifestSha256: rewritten.manifestSha256 } });
      logger.log(JSON.stringify({ event: 'erasure_manifest_union', erasureId: run.erasureId, projectId: pid, media: union.media.length, work: union.work.length, grew: union.grew }));
    }
    // ③ 三档判别（红⑫——纯读面；引用集=isMediaReferenced 单源）；dryRun 到此为止（零 fence/零
    //    claim/零 marker/零写——预览计数=窗前三臂口径，非决策级）
    const disposition = await resolveMediaDisposition(prisma, pid, live.mediaRows);
    if (run.dryRun) return { outcome: 'dry-run', detach: disposition.detach.length, exclusive: disposition.exclusive.length };
    // ── 卡② K8（spec §1.5）：认领拍 fence 化——cohort 规范化+四规则+一拍一段+进程内退避 ──
    // 分流锚=**进入本拍时的 marker**（不看规范化后结果——reviewWindowMs=0 用例同拍串段会把新
    // cohort 在其复核窗起点的同一拍删掉；新 exclusive 留下一拍走②、开自己的新 markAt）。
    const sidecarAtEntry = await readPendingMediaMarker(manifestDir, run.erasureId);
    const exclusiveSet = new Set(disposition.exclusive);
    const liveRowOf = new Map(live.mediaRows.map((m) => [m.id, m] as const));
    const teamId = live.mediaRows[0]?.teamId ?? sidecarAtEntry?.teamId ?? null;
    // ① cohort 规范化（每拍非干跑先跑——认领集/删除集只允许缩小）：markerKeep=sidecar∩exclusive；
    //    差集立即 release，按原因计 conflict（三档）：③ 证人命中离开（在 detach 且非档 a=E2 路径）
    //    →计；档 a/行不在→不计（腿⑥）；④ unionFace 命中在④内计一次（不在此）。markerKeep 空→删
    //    marker，非空→原 markAt 写回；差集 id 不再 claim。候选宇宙=本拍 exclusive，窗内只剔除不增补。
    let markerKeep: string[] = [];
    if (sidecarAtEntry != null) {
      markerKeep = sidecarAtEntry.mediaIds.filter((id) => exclusiveSet.has(id));
      const departed = sidecarAtEntry.mediaIds.filter((id) => !exclusiveSet.has(id));
      if (departed.length > 0) {
        const witnessDeparted = departed.filter((id) => {
          const row = liveRowOf.get(id);
          return row != null && disposition.detach.includes(id)
            && !(row.folderId != null || row.isFavorite || row.type === 'uploaded');
        });
        await releaseMediaDeletionClaim(prisma, departed, run.erasureId);
        if (witnessDeparted.length > 0) mediaDeletionConflictTotal.inc({ reason: 'project-erasure' }, witnessDeparted.length);
      }
      if (markerKeep.length > 0) {
        await writePendingMediaMarker(manifestDir, run.erasureId, { schemaVersion: 1, markAt: sidecarAtEntry.markAt, teamId: sidecarAtEntry.teamId, mediaIds: markerKeep });   // 原 markAt 写回（窗起点不重置）
      } else {
        await removePendingMediaMarker(manifestDir, run.erasureId);
      }
    }
    // ②③④ 一拍一段执行
    let deletable: string[] = [];
    let deletePhaseKept: string[] | null = null;   // ⑥ 作用域锚：仅本拍进入④∧verified∧kept 已算出
    let prepared = false;                          // 本拍调用了 prepare（推进门「未 verified」定义域）
    let preparedVerified = false;
    let preparedExpiredAfter = false;
    const markerAtEntry = sidecarAtEntry != null && sidecarAtEntry.mediaIds.length > 0;
    if (!markerAtEntry) {
      // 规则②（认领拍——仅进入本拍时无 marker）：exclusive 非空才 prepare（deps.barrier ?? Http 同
      // 删除窗——认领写与删除写同门）。未 verified：零 claim 零 marker 走 pending-review（不造第三
      // 态）+进退避。verified 后只对 exclusive 逐 id 重算（**不得沿用窗前 ③**——③ 对未 flush 帧系统
      // 性失明：oracle 60s 一拍+binding apply 落后窗）；循环内过期即中止；空→零 claim 零 marker（进
      // 退避）；非空→**先写 marker（新 markAt）再 claim**（崩溃窗口=有 marker 未 claim，下一拍规则
      // ③/④接上；反向=DELETING 等 10min 陈旧接管）；claim 返回后再查时钟——过期→release 本批+删
      // marker+pending-review；finally release 围栏（配对纪律同删除窗）。
      if (disposition.exclusive.length > 0 && teamId != null && claimBackoffReady(run.erasureId)) {
        const barrier = deps.barrier ?? new HttpDeletionBarrierPort();
        let prep: DeletionBarrierPrepareWireResult;
        prepared = true;
        try {
          prep = await barrier.prepare(teamId, { excludeProjectId: pid });
        } catch (e) {
          prep = { outcome: 'bail-out', reason: 'unexpected-error' };
          logger.warn(`erasure 认领拍 prepare 异常（pending-review 下轮重试）: ${(e as Error).message}`);
        }
        if (prep.outcome === 'verified') {
          try {
            const mediaRef = new MediaReferenceService(prisma);
            const rechecked: string[] = [];
            for (const id of disposition.exclusive) {
              if (Date.now() >= prep.expiresAt) break;   // 预算自查：过期=围栏已漏——中止重算
              if (!(await mediaRef.isMediaReferenced(prisma, id, { teamId, excludeProjectId: pid }))) rechecked.push(id);
            }
            if (rechecked.length > 0) {
              await writePendingMediaMarker(manifestDir, run.erasureId, { schemaVersion: 1, markAt: new Date().toISOString(), teamId, mediaIds: rechecked });
              await claimMediaForDeletion(prisma, rechecked, { runId: run.erasureId, reason: 'project-erasure' });
              if (Date.now() >= prep.expiresAt) {
                // claim 返回后时钟已过——回滚本批（release+删 marker；腿⑤）
                await releaseMediaDeletionClaim(prisma, rechecked, run.erasureId);
                await removePendingMediaMarker(manifestDir, run.erasureId);
                preparedExpiredAfter = true;
              } else {
                preparedVerified = true;
                clearClaimBackoff(run.erasureId);   // 成功 claim——退避清除
              }
            } else {
              enterClaimBackoff(run.erasureId);   // 空重算/循环中止→退避（腿⑨）
            }
          } finally {
            await barrier.release(teamId, prep.barrierId).catch(() => undefined);   // 配对纪律（stale 零行；崩溃=expiresAt TTL 自愈）
          }
        } else {
          enterClaimBackoff(run.erasureId);   // bail-out→退避
        }
      }
    } else if (Date.now() - Date.parse(sidecarAtEntry!.markAt) >= (deps.reviewWindowMs ?? ERASURE_MEDIA_REVIEW_MS)) {
      // 规则④（删除拍——仅进入时有 marker∧窗满∧规范化后 markerKeep 非空；markerKeep=∅=cohort 已
      // 消解——本拍不 prepare 不 claim，出口见推进门）。kept=markerKeep−unionFace（unionFace 命中
      // 释放+计 conflict——④内只此一计，与规范化差集不重复）；只 claim kept；deletable=kept∩owned；
      // prepare 未 verified 或入口已过期：不删、不丢 marker、不推进。机器不变量 deletable⊆exclusive
      // ∧∩unionFace=∅（结构保证：kept⊆markerKeep⊆exclusive 且 kept 与 unionFace 互斥）。第二次
      // prepare+窗内 unionFace+批删 in-tx recheck 原样（applyProjectErasureWrites 头注）。
      if (markerKeep.length > 0 && teamId != null) {
        const barrier = deps.barrier ?? new HttpDeletionBarrierPort();
        let prep: DeletionBarrierPrepareWireResult;
        prepared = true;
        try {
          prep = await barrier.prepare(teamId, { excludeProjectId: pid });
        } catch (e) {
          prep = { outcome: 'bail-out', reason: 'unexpected-error' };
          logger.warn(`erasure 删除拍 prepare 异常（pending-review 下轮重试）: ${(e as Error).message}`);
        }
        if (prep.outcome === 'verified') {
          try {
            if (Date.now() < prep.expiresAt) {   // 入口过期=保守不删不丢 marker
              preparedVerified = true;
              const mediaRef = new MediaReferenceService(prisma);
              const unionFace = new Set<string>();
              for (const id of markerKeep) {
                if (await mediaRef.isMediaReferenced(prisma, id, { teamId, excludeProjectId: pid })) unionFace.add(id);
              }
              const keptHit = markerKeep.filter((id) => unionFace.has(id));
              if (keptHit.length > 0) {
                await releaseMediaDeletionClaim(prisma, keptHit, run.erasureId);
                mediaDeletionConflictTotal.inc({ reason: 'project-erasure' }, keptHit.length);
              }
              const kept = markerKeep.filter((id) => !unionFace.has(id));
              deletePhaseKept = kept;
              // 删除窗：同 runId 幂等再持有（claim 三腿谓词②）——他消费者活持有的行（新鲜 DELETING）
              // 不归本 run 即不删（remainingExclusive 收口下轮重试；陈旧行经接管腿回收）。
              const owned = await claimMediaForDeletion(prisma, kept, { runId: run.erasureId, reason: 'project-erasure' });
              deletable = kept.filter((id) => owned.has(id));
            }
          } finally {
            await barrier.release(teamId, prep.barrierId).catch(() => undefined);   // 配对纪律（stale 零行；崩溃=expiresAt TTL 自愈）
          }
        }
      }
    }
    // 规则③（窗未满——仅进入时有 marker）：零 prepare、markAt 不动（规范化已写回 markerKeep）、
    // exclusive 多出 id 不进 marker、只参加推进门——无操作。
    // ⑤ 写批（两批各自锁——kill -9 各步幂等；**先于推进判定执行、deletable 为空不跳过**——E2 的
    //    projectId=null detach 写批靠它）。删除=窗内算出+批删事务内逐 id in-tx recheck 终裁。
    const { deletedMediaIds } = await applyProjectErasureWrites(prisma, pid, { detachMediaIds: disposition.detach, deleteMediaIds: deletable });
    // ⑥（作用域=仅规则④——本拍进入④∧verified∧kept 已算出时改写 marker=kept−deleted，markAt 不变、
    //    exclusive 新 id 不写入〔新 cohort 下一拍走②开自己的窗〕；②拍新写 marker/③拍规范化写回
    //    markerKeep 保留；④未 verified 或未进删除体不覆盖）
    if (deletePhaseKept != null) {
      const residual = deletePhaseKept.filter((id) => !deletedMediaIds.includes(id));
      if (residual.length > 0) {
        await writePendingMediaMarker(manifestDir, run.erasureId, { schemaVersion: 1, markAt: sidecarAtEntry!.markAt, teamId, mediaIds: residual });
      } else {
        await removePendingMediaMarker(manifestDir, run.erasureId);
      }
    }
    // 推进门：marker 仍有 id（⊆remainingExclusive——markerKeep/rechecked/④残留均 ⊆ exclusive−deleted）
    // /exclusive−deleted 非空/本拍 prepare 未 verified 或调用后入口已过期→pending-review；皆空才
    // PURGING_OBJECTS。「未 verified」=本拍调用了 prepare 且结果非 verified，或调用后入口已过期——
    // 进入时有 marker∧markerKeep=∅ 的拍（本拍未调用 prepare）**不计**：exclusive−deleted 空（E2）
    // →purging-objects；仍非空（腿⑧）→pending-review、下一拍走②（第十一轮精确定义）。
    const remainingExclusive = disposition.exclusive.filter((id) => !deletedMediaIds.includes(id));
    const unverified = prepared && (!preparedVerified || preparedExpiredAfter);
    if (remainingExclusive.length > 0 || unverified) {
      const now = new Date();
      await prisma.projectErasureRun.update({
        where: { erasureId: run.erasureId },
        data: { state: 'PURGING_DB', heartbeatAt: now, leaseUntil: new Date(now.getTime() + ERASURE_RUN_LEASE_MS) },
      });
      return { outcome: 'pending-review', remainingExclusive: remainingExclusive.length };
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
