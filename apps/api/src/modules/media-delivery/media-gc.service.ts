// apps/api/src/modules/media-delivery/media-gc.service.ts —— Y1a+Y1b T16 → C3b-5 消费面切换
//（spec :25 裁决③「Media GC 加 doc 引用检查/grace period 护栏」/:53 GC 引用图/§3.4-4 :78 删除序/
//  §3.4-6 :82 引用并集/§3.4-8 :84 shadow 对拍）：
// **C3b-5 起删除决策=并集单源（isMediaReferenced 五臂闭集——Binding+Oracle+registry）**，流经
// 「barrier prepare（持有窗——Direct port，api 进程）→窗内决策+shadow 对拍→删除序（in-tx recheck
//  终裁）→release」；软删 Media 的硬删候选=引用图判定+grace period（软删期 deletedAt 过 MEDIA_GC_GRACE
//  才进 GC 候选）。旧引用图四源+doc 扫（下方 shadowOldFaceReferenced）=**shadow 对拍面**（spec §3.4-8
//  抽样长期对拍——同 barrier 窗同快照：missing=新面独有证人〔旧面漏保护向〕计数+决策面已阻断保留；
//  extra=旧面独有〔stale binding 过度保留向〕计数+告警+受控 rebuild 清行）；其读失败/超阀不再作决策门
//  （决策面保守性由 decision snapshot 校验链+barrier 预算承载——bail-out=保守保留）。
// 判定无引用 ⇒ 删除序执行（**C3b-4 DELETING 状态机+删除序**——spec §3.4-5 :81/§3.4-7 :83）：
//   ①CAS 抢占 ACTIVE→DELETING（审计三列 deletionRequestedAt/RunId/Reason 同拍落值——双 worker/
//     他删除流〔erasure〕并发恰一者得，一者零行）；
//   ②引用图命中 ⇒ 删除中止+DELETING→ACTIVE 回退+`media_deletion_conflict_total{reason}`+复核窗
//     重置（下轮 sweep 重判——引用消失后自然放行；审计列保留=最近一次尝试痕迹，runbook §13.2）；
//   ③删除序=**对象先删（404/NoSuchKey 容忍——幂等）→行删**（第六轮 P0-7：行先删则对象失败无重试
//     锚——v5「DB 行删先于对象删」撤回）；删除事务内 isMediaReferenced recheck（C3b-3 决策级证人
//     并集直供 tx——终裁）；
//   ④对象失败（非 404）⇒ 行保留 DELETING（重试锚）——下轮 sweep（>MEDIA_DELETING_STALE_MS）接管重试；
//   ⑤用户恢复（deletedAt=null）⇒ 回 ACTIVE（restoreMediaToActive——删除事务 FOR UPDATE 所有权门
//     失守即中止）。
// barrier bail-out（lost-race/flush-timeout/快照不满足/预算过期）⇒ 回 ACTIVE 释放持有+valve-bailout
// 桶保守保留（下轮任意 worker 重判——T19 桶语义：扫描面/预算异常≠引用增长）。
// 【跨 team 语义钉明（spec 评审 P2#7——与裁决③一致）】**跨 team 引用不受本 GC 保护**：裁决③
// 定案跨 team paste=客户端 strip+服务端不建 binding+读 ACL 403 兜底——他队 doc 引用本队 mediaId
// 是被拒形态（无 binding 行、读侧 403），本队软删+过 grace+队内无引用即可硬删；「跨队副本保图」
// 不在本 GC 承诺内（恶意/越权引用不得反向拖住资源回收）。
// 形态=pending-upload sweep/IntentReconcile 同族：原生 setInterval+unref+busy 防重入（R28）。
// 进程归属=api（media-delivery 模块——ExecutionDaemonModule.register role 门内；需 withSession
// doc 读，worker 面零实例化）。
import { Inject, Injectable, Logger, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { collectMediaRefs } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithIncludeDeleted } from '../../prisma/read-path.filter';
import { CollabDocumentService } from '../collab/collab-document.service';
import { MinioService } from '../minio/minio.service';
import { toDocLike } from '../collab/doc-like.util';
import { MediaReferenceService } from '../collab/media-reference.service';
import { DeletionBarrierPort, type DeletionBarrierPrepareWireResult } from '../collab/deletion-barrier.port';
import { controlledRebuildForMedia } from '../collab/binding-rebuild.service';
import {
  mediaGcOutcomeTotal, mediaDeletionConflictTotal, mediaRefShadowMismatchTotal,
} from './binding-reconcile.metrics';

/** 软删 grace（素材库删除后悔窗——副本护栏外的用户意图缓冲；spec :25「grace period」）。 */
export const MEDIA_GC_GRACE_MS = 7 * 24 * 3600_000;
/** GC 扫描周期（候选=软删+过 grace——量级低频；小时级即可，对齐 storage-quota/pending sweep 族）。 */
export const MEDIA_GC_SWEEP_INTERVAL_MS = 3600_000;
/** 每轮候选上界（积压按轮消化——同 SWEEP_PAGE 纪律）。 */
export const MEDIA_GC_PAGE = 50;
/** doc 扫描项目上界（C3b-5 起=shadow 对拍面安全阀——超量/读失败=对拍跳过〔非决策门〕：决策面保守性
 *  由 decision snapshot 校验链+barrier 预算承载）。 */
export const MEDIA_GC_DOC_SCAN_PAGE = 500;
/** VideoProject timeline 扫描行上界（shadow 对拍面安全阀——同 doc 扫描）。 */
export const MEDIA_GC_TIMELINE_SCAN_PAGE = 500;

// ═══ C3b-4：DELETING 状态机原语（spec §3.4-5 :81——GC/erasure 共用；erasure 经
//     project-erasure.stages 跨模块引用，collectJsonMediaIds 同族先例）════════════════════

/** DELETING 持有陈旧阈值：超过即视为死轮（对象删除失败/进程崩溃遗留）可被下一删除流接管
 *  （GC sweep 周期 1h ≫ 阈值——活持有窗〔单轮 sweep 秒级/erasure 复核窗 60s〕恒不被误抢）。 */
export const MEDIA_DELETING_STALE_MS = 10 * 60_000;
/** 删除序事务上界（对象删〔网络 IO〕在事务内——MinIO 挂起由本超时兜底回滚：行保留 DELETING 重试）。 */
export const MEDIA_DELETING_TX_TIMEOUT_MS = 15_000;

/** 删除流审计载荷（CAS 抢占时落值——reason=两消费面闭集）。 */
export interface MediaDeletionAudit { runId: string; reason: 'media-gc' | 'project-erasure' }

/** CAS 抢占进 DELETING（spec :81——`UPDATE..WHERE deletionState='ACTIVE' RETURNING`）。三腿谓词：
 *  ①ACTIVE→DELETING（双 worker 并发恰一者得——一者零行）；②DELETING∧同 runId（幂等再持有——
 *  erasure 跨 tick 复核/删除窗同 erasureId）；③DELETING∧陈旧（deletionRequestedAt 超过
 *  MEDIA_DELETING_STALE_MS——死轮接管=对象失败下轮重试的归还面）。审计三列同拍落值。 */
export async function claimMediaForDeletion(
  db: Prisma.TransactionClient, ids: readonly string[], audit: MediaDeletionAudit,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const staleBefore = new Date(Date.now() - MEDIA_DELETING_STALE_MS);
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "Media" SET
      "deletionState" = 'DELETING',
      "deletionRequestedAt" = now(),
      "deletionRunId" = ${audit.runId}::text,
      "deletionReason" = ${audit.reason}::text
    WHERE "id" = ANY(${[...ids]}::text[])
      AND (
        "deletionState" = 'ACTIVE'
        OR ("deletionState" = 'DELETING' AND "deletionRunId" = ${audit.runId}::text)
        OR ("deletionState" = 'DELETING' AND "deletionRequestedAt" < ${staleBefore})
      )
    RETURNING "id"`;
  return new Set(rows.map((r) => r.id));
}

/** DELETING→ACTIVE 回退（spec :81「删除中止+回退+复核窗重置」）。owned 守卫（deletionRunId=本
 *  run——禁回退他消费者持有行）；审计列保留=最近一次尝试痕迹。返回回退行数（调用方计
 *  media_deletion_conflict_total{reason}）。 */
export async function releaseMediaDeletionClaim(
  db: Prisma.TransactionClient, ids: readonly string[], runId: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  return db.$executeRaw`
    UPDATE "Media" SET "deletionState" = 'ACTIVE'
    WHERE "id" = ANY(${[...ids]}::text[]) AND "deletionState" = 'DELETING' AND "deletionRunId" = ${runId}::text`;
}

/** 用户恢复（spec :81「用户恢复〔deletedAt=null〕→回 ACTIVE」）：DELETING 行恢复=deletedAt 置
 *  null+删除态复位（用户意图压过在飞删除——删除事务 FOR UPDATE 所有权门随后失守即中止）。行已硬删
 *  （删除事务先提交）=零行——恢复面按不存在档处理。 */
export async function restoreMediaToActive(db: Prisma.TransactionClient, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  return db.$executeRaw`
    UPDATE "Media" SET "deletionState" = 'ACTIVE', "deletedAt" = NULL
    WHERE "id" = ANY(${[...ids]}::text[]) AND "deletionState" = 'DELETING'`;
}

export interface MediaGcSweepSummary {
  candidates: number;
  deleted: number;
  guarded: number;
  /** C3b-4：recheck 命中中止行数（conflict 计数行——同时计入 guarded〔保留语义〕）。 */
  conflicted: number;
  objectDeleteFailed: number;
}

/** VideoProject.data JSON 深扫：收集 clip.mediaId 值（词形=shared types/video-project.ts
 *  VideoClip/ImageClip/AudioClip 三态 clip 均携 mediaId: string；递归扫任意嵌套——未来词形演进
 *  不漏）。数组/对象递归，string 叶子仅在键名==='mediaId' 时入集。 */
export function collectJsonMediaIds(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) collectJsonMediaIds(v, out);
    return out;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'mediaId' && typeof v === 'string' && v !== '') out.add(v);
      else collectJsonMediaIds(v, out);
    }
  }
  return out;
}

@Injectable()
export class MediaGcService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MediaGcService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;
  private destroyed = false;
  /** 删除事务 recheck 面（C3b-3 isMediaReferenced——直构注入，DeletionBarrierService 同款体例：
   *  保持四参构造签名〔barrier 为 C3b-5 新增第四参〕）。 */
  private readonly mediaRef: MediaReferenceService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(CollabDocumentService) private readonly docs: CollabDocumentService,
    /** C3b-5：barrier 端口（api 进程=Direct 形态——collab.module 装配；测试注入 stub/real port）。 */
    @Inject(DeletionBarrierPort) private readonly barrier: DeletionBarrierPort,
  ) {
    this.mediaRef = new MediaReferenceService(prisma);
  }

  onModuleInit(): void {
    const t = setInterval(() => {
      void this.sweep().catch((e) => this.logger.warn(`mediaGc sweep: ${(e as Error).message}`));
    }, MEDIA_GC_SWEEP_INTERVAL_MS);
    t.unref?.();
    this.timer = t;
  }

  onApplicationShutdown(): void {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 一轮 GC（busy 防重入；destroyed 后零动作）。测试直调入口。候选跨 team→逐 team 删除窗
   *  （barrier=team 维——顺序 prepare，每 team ≤总预算）。 */
  async sweep(): Promise<MediaGcSweepSummary> {
    const summary: MediaGcSweepSummary = { candidates: 0, deleted: 0, guarded: 0, conflicted: 0, objectDeleteFailed: 0 };
    if (this.sweeping || this.destroyed) return summary;
    this.sweeping = true;
    try {
      const cutoff = new Date(Date.now() - MEDIA_GC_GRACE_MS);
      const candidates = await this.prisma.media.findMany({
        where: { deletedAt: { not: null, lt: cutoff } },
        orderBy: { deletedAt: 'asc' },
        take: MEDIA_GC_PAGE,
        select: { id: true, key: true, teamId: true },
      });
      summary.candidates = candidates.length;
      if (candidates.length === 0) return summary;
      // ── DELETING CAS 抢占（C3b-4 ①——本 runId 持有：双 sweep 实例/erasure 并发恰一者得；
      //    上轮对象失败遗留的 DELETING 行经陈旧腿接管重试）──
      const runId = randomUUID();
      const won = await claimMediaForDeletion(this.prisma, candidates.map((c) => c.id), { runId, reason: 'media-gc' });
      const claimed = candidates.filter((c) => won.has(c.id));
      if (claimed.length === 0) return summary;
      const byTeam = new Map<string, typeof claimed>();
      for (const c of claimed) {
        const list = byTeam.get(c.teamId);
        if (list) list.push(c); else byTeam.set(c.teamId, [c]);
      }
      for (const [teamId, teamClaimed] of byTeam) {
        await this.sweepTeam(teamId, teamClaimed, runId, summary);
      }
      return summary;
    } finally {
      this.sweeping = false;
    }
  }

  /** 单 team 删除窗（C3b-5 消费面切换——spec §3.4-4 :78 删除序 ②-⑥ 消费侧）：barrier prepare
   *  （持有窗）→[预算自查]→窗内并集决策+shadow 同快照对拍→判定执行（删除序 in-tx recheck 终裁）
   *  →finally release（配对纪律——崩溃=expiresAt TTL 自愈）。 */
  private async sweepTeam(
    teamId: string, claimed: { id: string; key: string; teamId: string }[], runId: string, summary: MediaGcSweepSummary,
  ): Promise<void> {
    const ids = claimed.map((c) => c.id);
    let prep: DeletionBarrierPrepareWireResult;
    try {
      prep = await this.barrier.prepare(teamId);
    } catch (e) {
      prep = { outcome: 'bail-out', reason: 'unexpected-error' };
      this.logger.warn(`mediaGc barrier prepare 异常: ${(e as Error).message}`);
    }
    if (prep.outcome !== 'verified') {
      await this.conservativeRetain(ids, runId, summary, `barrier bail-out(${prep.reason})`);
      return;
    }
    try {
      // M3 预算自查（port 头注纪律）：过期=围栏已漏（seal 惰性失效+appendBatch 放行）——窗内决策/
      // 对拍/删除全段前置自查，过期即保守保留（与 barrier-expired 同语义档）。
      const expired = (): boolean => Date.now() >= prep.expiresAt;
      if (expired()) {
        await this.conservativeRetain(ids, runId, summary, 'barrier 已过期（窗内预算耗尽）');
        return;
      }
      // ── 决策面（并集单源——spec §3.4-6：Binding+Oracle+registry 五臂闭集；回滚开关 MEDIA_REF_
      //    ORACLE_ONLY='true' 时 Binding 臂 skip=降级纯 oracle）──
      const unionRefs = new Set<string>();
      for (const id of ids) {
        if (await this.mediaRef.isMediaReferenced(this.prisma, id, { teamId })) unionRefs.add(id);
      }
      if (expired()) {
        await this.conservativeRetain(ids, runId, summary, 'barrier 已过期（决策段后）');
        return;
      }
      // ── shadow 对拍（spec §3.4-8——同快照：ACTIVE 窗内 appendBatch 封帧=pgSeq/epoch 冻结，两面
      //    读同一冻结宇宙〔第六轮 P1-7〕）。新面=registry∪Oracle 证人面（skipBindingArm——Binding
      //    臂两面共有，纳入即互掩）；旧面读失败/超阀=对拍跳过（非决策门）。──
      const shadowOld = await this.shadowOldFaceReferenced(teamId, ids);
      if (shadowOld != null && !expired()) {
        const faceB = new Set<string>();
        for (const id of ids) {
          if (await this.mediaRef.isMediaReferenced(this.prisma, id, { teamId, skipBindingArm: true })) faceB.add(id);
        }
        for (const id of ids) {
          const oldHit = shadowOld.has(id);
          const newHit = faceB.has(id);
          if (newHit && !oldHit) {
            mediaRefShadowMismatchTotal.inc({ consumer: 'media-gc', dir: 'missing' });   // 旧面漏保护向（决策面已阻断保留）
          } else if (oldHit && !newHit) {
            // 过度保留向=stale binding 形态（旧面 binding 腿独有——doc 已无引用而行在）→告警+受控
            // rebuild 清行（清理后下轮对拍零差+决策放行）；本轮决策面含 Binding 臂=保守保留非越证删。
            mediaRefShadowMismatchTotal.inc({ consumer: 'media-gc', dir: 'extra' });
            this.logger.warn(`mediaGc shadow extra（stale binding 过度保留向）media=${id} → 受控 rebuild`);
            await controlledRebuildForMedia(this.prisma, id).catch(() => undefined);   // 受控（内部计数+日志）
          }
        }
      }
      if (expired()) {
        await this.conservativeRetain(ids, runId, summary, 'barrier 已过期（对拍段后）');
        return;
      }
      // ── 判定执行（C3b-4 删除序）：决策面命中→中止回 ACTIVE+conflict；否则删除序（对象先删
      //    404 容忍→行删；事务内 recheck 命中→中止回退）──
      for (let i = 0; i < claimed.length; i += 1) {
        const c = claimed[i]!;
        // Minor-1（spec 评审）：逐候选 expired() 自查——删除事务上界 15s×候选数（MEDIA_GC_PAGE≤50）
        // 可越过 expiresAt（barrier 总预算 10s）；未处理尾段保守保留出循环（已处理段语义已落定：
        // deleted/conflict 回退/object-failed 留 DELETING 重试锚——不回卷）。
        if (expired()) {
          await this.conservativeRetain(claimed.slice(i).map((x) => x.id), runId, summary, 'barrier 已过期（判定执行段）');
          return;
        }
        if (unionRefs.has(c.id)) {
          const n = await releaseMediaDeletionClaim(this.prisma, [c.id], runId);
          if (n > 0) {
            summary.conflicted += 1;
            mediaDeletionConflictTotal.inc({ reason: 'media-gc' });   // 删除中止（回 ACTIVE+复核窗重置）
          }
          summary.guarded += 1;
          mediaGcOutcomeTotal.inc({ outcome: 'guarded' });
          continue;
        }
        const outcome = await this.executeDeletionSequence(c, runId);
        if (outcome === 'deleted') {
          summary.deleted += 1;
          mediaGcOutcomeTotal.inc({ outcome: 'deleted' });
        } else if (outcome === 'object-failed') {
          // 对象删除失败（非灭失）——行保留 DELETING 待下轮（pending-upload sweep 同语义；MinIO 环境红非回归）
          summary.objectDeleteFailed += 1;
          mediaGcOutcomeTotal.inc({ outcome: 'object-delete-failed' });
          this.logger.warn(`mediaGc 对象删除失败（行保留 DELETING 下轮重试）key=${c.key}`);
        } else if (outcome === 'conflict') {
          // 删除事务 recheck 命中（isMediaReferenced 终裁）→中止回 ACTIVE
          summary.conflicted += 1;
          summary.guarded += 1;
          mediaGcOutcomeTotal.inc({ outcome: 'guarded' });
          mediaDeletionConflictTotal.inc({ reason: 'media-gc' });
        }
        // 'lost'=用户恢复（回 ACTIVE）/他消费者接管——零计数（下轮自然重判）
      }
    } finally {
      await this.barrier.release(teamId, prep.barrierId).catch((e) =>
        this.logger.warn(`mediaGc barrier release 失败（expiresAt TTL 自愈）: ${(e as Error).message}`));
    }
  }

  /** 保守保留单点（barrier bail-out/预算过期）：回 ACTIVE 释放持有+valve-bailout 桶计数（T19 分桶
   *  ——扫描面/预算异常≠引用增长，零 conflict 计数）。 */
  private async conservativeRetain(ids: readonly string[], runId: string, summary: MediaGcSweepSummary, why: string): Promise<void> {
    await releaseMediaDeletionClaim(this.prisma, [...ids], runId);
    summary.guarded += ids.length;
    for (let i = 0; i < ids.length; i += 1) mediaGcOutcomeTotal.inc({ outcome: 'valve-bailout' });
    this.logger.warn(`mediaGc ${why}——本轮保守保留 ${ids.length} 候选（回 ACTIVE 释放持有，下轮重判）`);
  }

  /** shadow 旧引用面（C3b-5 前的预筛引用图——四源 PG 快判+doc 扫描原样；返回 referenced 集，
   *  null=对拍跳过〔doc 读失败/超安全阀——非决策门〕）。同 barrier ACTIVE 窗内调用=同快照。 */
  private async shadowOldFaceReferenced(teamId: string, ids: readonly string[]): Promise<Set<string> | null> {
    const referenced = new Set<string>();
    const fromBindings = await this.prisma.mediaBinding.findMany({
      where: { mediaId: { in: [...ids] } }, select: { mediaId: true },
    });
    for (const b of fromBindings) referenced.add(b.mediaId);
    const fromArtifacts = await this.prisma.nodeArtifact.findMany({
      where: { mediaId: { in: [...ids] } }, select: { mediaId: true },
    });
    for (const a of fromArtifacts) if (a.mediaId) referenced.add(a.mediaId);
    const fromWorks = await this.prisma.videoWork.findMany({
      where: { videoMediaId: { in: [...ids] } }, select: { videoMediaId: true },
    });
    for (const w of fromWorks) if (w.videoMediaId) referenced.add(w.videoMediaId);
    // I-2（C4-a 评审承接）：引用图判定（doc 扫描候选项目集）应含 DELETING 项目（擦除中项目的 doc
    // 仍引用候选 media）——runWithIncludeDeleted 包裹（保守侧=全量项目集入扫描）。
    const projects = await runWithIncludeDeleted(() => this.prisma.canvasProject.findMany({
      where: { teamId },
      orderBy: { id: 'asc' },
      take: MEDIA_GC_DOC_SCAN_PAGE + 1,   // +1=超量探测（===PAGE+1 ⇒ 对拍跳过）
      select: { id: true, teamId: true },
    }));
    if (projects.length > MEDIA_GC_DOC_SCAN_PAGE) {
      this.logger.warn(`mediaGc shadow doc 扫描超安全阀（>${MEDIA_GC_DOC_SCAN_PAGE} 项目）——本轮对拍跳过`);
      return null;
    }
    // VideoProject（剪辑 timeline——team 维度行集；JSON 深扫 mediaId 词形）；超阀=对拍跳过
    const videoProjects = await this.prisma.videoProject.findMany({
      where: { teamId },
      orderBy: { id: 'asc' },
      take: MEDIA_GC_TIMELINE_SCAN_PAGE + 1,
      select: { data: true },
    });
    if (videoProjects.length > MEDIA_GC_TIMELINE_SCAN_PAGE) {
      this.logger.warn(`mediaGc shadow VideoProject 扫描超安全阀（>${MEDIA_GC_TIMELINE_SCAN_PAGE} 行）——本轮对拍跳过`);
      return null;
    }
    const timelineRefs = new Set<string>();
    for (const vp of videoProjects) collectJsonMediaIds(vp.data, timelineRefs);
    for (const id of ids) if (timelineRefs.has(id)) referenced.add(id);
    // doc 引用扫描（副本/copy 引用未进 binding 索引的窗——旧面的终裁腿）；读失败=对拍跳过
    for (const p of projects) {
      try {
        const refs = await this.docs.withSession(p.id, (doc) => collectMediaRefs(toDocLike(doc)), { mode: 'read' });
        for (const r of refs) referenced.add(r.mediaId);
      } catch (e) {
        this.logger.warn(`mediaGc shadow doc 扫描失败 project=${p.id}（本轮对拍跳过）: ${(e as Error).message}`);
        return null;
      }
    }
    return referenced;
  }

  /** 删除序（spec §3.4-7 :83——**对象先删（404/NoSuchKey 容忍）→行删**；对象失败→行保留 DELETING
   *  下轮重试）。单事务：FOR UPDATE 所有权门（deletionState='DELETING'∧deletionRunId=本 run——
   *  用户恢复/接管即失守中止；行锁与恢复写串行化）→删除事务 recheck（isMediaReferenced 直供 tx
   *  ——spec :81「删除事务 recheck 命中任一证人」）→命中中止回 ACTIVE→对象删→行删（无 mediaId FK
   *  ——孤儿 binding 行由 drift→dirty→runner rebuild 清理，C3a-8）。MinIO 挂起=事务超时兜底回滚
   *  （行保留 DELETING 重试）。 */
  private async executeDeletionSequence(
    c: { id: string; teamId: string }, runId: string,
  ): Promise<'deleted' | 'object-failed' | 'conflict' | 'lost'> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ key: string }[]>`
        SELECT "key" FROM "Media"
        WHERE "id" = ${c.id}::text AND "deletionState" = 'DELETING' AND "deletionRunId" = ${runId}::text
        FOR UPDATE`;
      if (rows.length === 0) return 'lost';   // 用户恢复（回 ACTIVE）/陈旧被他消费者接管——中止
      if (await this.mediaRef.isMediaReferenced(tx, c.id, { teamId: c.teamId })) {
        const n = await tx.$executeRaw`
          UPDATE "Media" SET "deletionState" = 'ACTIVE'
          WHERE "id" = ${c.id}::text AND "deletionState" = 'DELETING' AND "deletionRunId" = ${runId}::text`;
        return n === 1 ? 'conflict' : 'lost';   // 删除中止（回 ACTIVE+复核窗重置——计数在提交后）
      }
      try {
        await this.minio.delete(rows[0]!.key);
      } catch (e) {
        const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
          ?? (e as { name?: string }).name;
        if (status !== 404 && status !== 'NoSuchKey') {
          // 底层因（503/超时/网络）在此落日志——调用面 outcome 汇总只余 key，排障信息不丢
          this.logger.warn(`mediaGc 对象删除失败 key=${rows[0]!.key}: ${(e as Error).message ?? e}`);
          return 'object-failed';   // 行保留=重试锚（spec §3.4-7）
        }
      }
      await tx.media.delete({ where: { id: c.id } });
      return 'deleted';
    }, { timeout: MEDIA_DELETING_TX_TIMEOUT_MS, maxWait: 5_000 });
  }
}
