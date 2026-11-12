// apps/api/src/modules/media-delivery/binding-reconcile.service.ts
// C3a-8（plan v3 Task C3a-8——spec 2026-11-11-foundation-batch-design.md §3.2-3/§3.2-7）：
// MediaBinding **只读漂移检测**（Y1a+Y1b T16 的 current-state upsert 写面随单写者纪律退役）。
//
// 语义（第六轮 P1-4 裁定）：doc 真值经 **PG 定代前缀**重建——readRebuildAnchor(g,pgSeq)+
// loadForHydrationAt(pid,{generation,pgSeq})（repository 单源；**禁 withSession 活 doc**：活 doc=当前
// 内存态非已提交前缀，与 binding 水位不可比）。发现面=**CanvasDoc 全表分页**（游标轮转）——漂移可能
// 存在于「dirty=false 且水位齐」的项目（DB 行被手工删/并发写错），故不只扫候选集。
//
// 单项目检测（reconcileProject——幂等可重入）：
//   ① anchor=readRebuildAnchor（行缺=跳过；清理归 erasure/FK cascade）
//   ② 定代重放 doc@pgSeq → collectMediaRefs（shared 单源）
//   ③ 准入过滤=**与 projector 同款**（admitMediaRef 单源：Media 行存在∧team 同队∧
//      (DELETING∨deletedAt=null)）→desired 槽集（mediaBindingSlotKey 五元组）
//   ④ 与 DB MediaBinding 行 diff：missing（doc 引用缺行）/extra（行无 doc 引用）/mismatch（同槽异
//      mediaId）——`media_binding_drift_total{kind}` 计数+WARN 日志
//   ⑤ 漂移命中→`canvasDoc.updateMany` 置 bindingsDirty=true + `runner.enqueue(pid)`（**唯一修复路径=
//      全量 rebuild；本服务零 MediaBinding 写**——静态单写者门禁白名单已移除本文件）
//
// 触发形态（双 timer 不变）：①post-apply 触发（投影 poller mark projected 后 requestReconcile）；
// ②周期发现轮（CanvasDoc 全表 5min）。drain 仍为 5s/8 项目上界——单项目读=一次定代 RR 事务。
// 项目行缺失（readRebuildAnchor=null）=跳过：其 binding 行由项目 FK Cascade/erasure 清理，不产生漂移。
import { Inject, Injectable, Logger, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MediaRef } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasDocUpdateRepository } from '../collab/canvas-doc-update.repository';
import { ProjectionBackfillRunner } from '../collab/projection-backfill.runner';
import { collectRefsAt } from '../collab/binding-rebuild.service';
import { admitMediaRef, mediaBindingSlotKey } from '../collab/media-binding-projector';
import { mediaBindingDriftTotal } from '../collab/media-binding.metrics';
import { mediaBindingReconcileOutcomeTotal } from './binding-reconcile.metrics';

// ── reconcile 参数（同族纪律：常数不进 env——热循环红线非立即重投） ──
/** 触发队列排水周期（post-apply 请求的收敛延迟上界）。 */
export const RECONCILE_DRAIN_INTERVAL_MS = 5_000;
/** 周期候选发现轮（CanvasDoc 全表漂移巡检——未被任何触发路径触及的项目兜底）。 */
export const RECONCILE_DISCOVER_INTERVAL_MS = 5 * 60_000;
/** 每 drain tick 排水上界（单 doc 读成本摊薄——积压按轮消化）。 */
export const RECONCILE_DRAIN_BUDGET = 8;
/** 周期发现每轮候选上界（游标轮转——sweepOrphanExec 同款全量轮转非进度承诺）。 */
export const RECONCILE_DISCOVER_PAGE = 64;

/** 单轮只读 reconcile 摘要（测试/观测面——漂移形态，写面计数已退役）。 */
export interface ReconcileSummary {
  projectId: string;
  /** 检测可执行（false=项目行/文档行缺失、候选跳过或扫描失败——本轮跳过）。 */
  ok: boolean;
  /** C3a-8 质量收口 I-2：候选跳过原因（dirty=rebuild 在途/lag=水位未齐——已由 rebuild 队列覆盖，
   *  禁全量重放+假 drift 噪声；drift 只在 clean 项目计入）。 */
  skipped: 'dirty' | 'lag' | null;
  /** doc@pgSeq 引用条目数（准入前）。 */
  scanned: number;
  /** 漂移分类计数（missing=doc 引用缺行/extra=行无引用/mismatch=同槽异 mediaId）。 */
  drift: { missing: number; extra: number; mismatch: number };
  /** 漂移命中→已置 dirty+入队（false=零漂移零动作）。 */
  dirtyMarked: boolean;
}

@Injectable()
export class BindingReconcileService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BindingReconcileService.name);
  /** post-apply/发现轮共用的待 reconcile 队列（Set 去重——同 project 并发触发恰一轮）。 */
  private readonly queue = new Set<string>();
  /** 发现轮游标（重启回起点无害——轮转非进度承诺）。 */
  private discoverCursor: string | null = null;
  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private discoverTimer: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private destroyed = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CanvasDocUpdateRepository) private readonly repo: CanvasDocUpdateRepository,
    @Inject(ProjectionBackfillRunner) private readonly backfill: ProjectionBackfillRunner,
  ) {}

  onModuleInit(): void {
    const drain = setInterval(() => {
      void this.drain().catch((e) => this.logger.warn(`reconcile drain: ${(e as Error).message}`));
    }, RECONCILE_DRAIN_INTERVAL_MS);
    drain.unref?.();
    this.drainTimer = drain;
    const discover = setInterval(() => {
      void this.discover().catch((e) => this.logger.warn(`reconcile discover: ${(e as Error).message}`));
    }, RECONCILE_DISCOVER_INTERVAL_MS);
    discover.unref?.();
    this.discoverTimer = discover;
  }

  onApplicationShutdown(): void {
    this.destroyed = true;
    if (this.drainTimer) clearInterval(this.drainTimer);
    if (this.discoverTimer) clearInterval(this.discoverTimer);
    this.drainTimer = null;
    this.discoverTimer = null;
    this.queue.clear();
  }

  /** post-apply 触发入口（投影 poller mark projected 后 fire-and-forget——零 await 零阻塞）。 */
  requestReconcile(projectId: string): void {
    if (this.destroyed) return;
    this.queue.add(projectId);
  }

  /** 排水一轮（budget 上界——busy 防重入）。测试直调入口。 */
  async drain(): Promise<number> {
    if (this.draining || this.destroyed) return 0;
    this.draining = true;
    try {
      let processed = 0;
      for (const projectId of this.queue) {
        if (processed >= RECONCILE_DRAIN_BUDGET || this.destroyed) break;
        this.queue.delete(projectId);
        // I-2：预算按**尝试数**计（失败/跳过也 +1——防 PG 抖动风暴把整轮预算耗在异常重扫）；
        // 扫描异常在 reconcileProject 内计数 scan-failed。
        await this.reconcileProject(projectId).catch((e) => {
          this.logger.warn(`reconcile project=${projectId} 失败（下轮触发重扫）: ${(e as Error).message}`);
          return null;
        });
        processed += 1;
      }
      return processed;
    } finally {
      this.draining = false;
    }
  }

  /** 周期发现（**CanvasDoc 全表**游标轮转——发现面含「干净但漂移」项目；页尽回卷）。 */
  async discover(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ projectId: string }[]>(Prisma.sql`
      SELECT "projectId" FROM "CanvasDoc"
      WHERE "projectId" > ${this.discoverCursor ?? ''}
      ORDER BY "projectId" LIMIT ${RECONCILE_DISCOVER_PAGE}`);
    if (rows.length > 0) {
      this.discoverCursor = rows[rows.length - 1].projectId;
      if (rows.length < RECONCILE_DISCOVER_PAGE) this.discoverCursor = null;   // 轮尽回卷
      for (const r of rows) this.requestReconcile(r.projectId);
    } else {
      this.discoverCursor = null;
    }
    return rows.length;
  }

  /** 单 project 只读漂移检测（幂等重入——desired=doc@pgSeq 现值 vs DB 面。漂移→dirty+入队）。 */
  async reconcileProject(projectId: string): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = {
      projectId, ok: false, skipped: null, scanned: 0, drift: { missing: 0, extra: 0, mismatch: 0 }, dirtyMarked: false,
    };
    // ① anchor（行缺=跳过——清理归 erasure/FK cascade）；I-2：dirty/lag 项目=rebuild 已在途/待跑，
    // 直接跳过（避免全量定代重放与假 drift 噪声；drift 只在 clean 项目计入）。
    const anchor = await this.repo.readRebuildAnchor(projectId);
    if (!anchor) return summary;
    if (anchor.bindingsDirty || anchor.pgSeq > anchor.mediaBindingSeq) {
      summary.skipped = anchor.bindingsDirty ? 'dirty' : 'lag';
      return summary;
    }
    const project = await this.prisma.canvasProject.findUnique({ where: { id: projectId }, select: { teamId: true } });
    if (!project) return summary;
    // ② 定代前缀重放 doc@pgSeq（禁活 doc；单源=collectRefsAt 与 rebuild 共用）
    let refs: MediaRef[];
    try {
      refs = await collectRefsAt(this.repo, projectId, { generation: anchor.generation, pgSeq: anchor.pgSeq });
    } catch (e) {
      // 扫描异常=本轮跳过（counted scan-failed——media_binding_reconcile_outcome_total 复用；
      // 头注：其余 label 已随写面退役）
      mediaBindingReconcileOutcomeTotal.inc({ outcome: 'scan-failed' });
      this.logger.warn(`reconcile 扫描失败 project=${projectId}（本轮跳过）: ${(e as Error).message}`);
      return summary;
    }
    summary.scanned = refs.length;
    summary.ok = true;
    // ③ 准入过滤（projector 同款）→desired 槽集
    const mediaIds = [...new Set(refs.map((r) => r.mediaId))];
    const mediaRows = mediaIds.length > 0
      ? await this.prisma.media.findMany({ where: { id: { in: mediaIds } }, select: { id: true, teamId: true, deletionState: true, deletedAt: true } })
      : [];
    const mediaById = new Map(mediaRows.map((m) => [m.id, m]));
    const desired = new Map<string, string>();
    for (const r of refs) {
      if (admitMediaRef(mediaById.get(r.mediaId), project.teamId) === 'admitted') {
        desired.set(mediaBindingSlotKey(r), r.mediaId);
      }
    }
    // ④ diff（只读读面）
    const existing = await this.prisma.mediaBinding.findMany({
      where: { projectId },
      select: { nodeId: true, role: true, targetField: true, targetItemId: true, mediaId: true },
    });
    const existingKeys = new Set<string>();
    for (const row of existing) {
      const key = mediaBindingSlotKey(row);
      existingKeys.add(key);
      const want = desired.get(key);
      if (want === undefined) summary.drift.extra += 1;
      else if (want !== row.mediaId) summary.drift.mismatch += 1;
    }
    for (const key of desired.keys()) if (!existingKeys.has(key)) summary.drift.missing += 1;
    // ⑤ 漂移→置 dirty+入队（唯一修复路径=rebuild；本服务零 MediaBinding 写）
    const total = summary.drift.missing + summary.drift.extra + summary.drift.mismatch;
    if (total === 0) return summary;
    if (summary.drift.missing > 0) mediaBindingDriftTotal.inc({ kind: 'missing' }, summary.drift.missing);
    if (summary.drift.extra > 0) mediaBindingDriftTotal.inc({ kind: 'extra' }, summary.drift.extra);
    if (summary.drift.mismatch > 0) mediaBindingDriftTotal.inc({ kind: 'mismatch' }, summary.drift.mismatch);
    // 单一写面：dirty 置位统一经 runner.markDirty（rebuild 内联/import 前置/reconcile 漂移同语义注释）
    await this.backfill.markDirty(projectId);
    this.backfill.enqueue(projectId);
    summary.dirtyMarked = true;
    this.logger.warn(`binding drift for ${projectId}（missing=${summary.drift.missing} extra=${summary.drift.extra} mismatch=${summary.drift.mismatch}——置 dirty+入队 rebuild，本服务零写）`);
    return summary;
  }
}
