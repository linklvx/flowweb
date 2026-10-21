// apps/api/src/modules/media-delivery/binding-reconcile.service.ts —— Y1a+Y1b T16
//（spec :25 裁决③「binding 服务端惰性 reconcile」/:80 Z7''-v14「current-state upsert——create-only
// 废止」/:91 Z18''「MediaBinding current-state upsert+finalize 同步 upsert」）：
// MediaBinding=doc 引用纯索引（降级纯索引——T2 已无状态机列），本服务=该索引的唯一惰性维护者：
//
//   mediaRefsOf(doc) 七键扫描（shared collectMediaRefs 单源——fileId/referenceImage/images[].id/
//   allImages/trimmedFileId/videoFileId/audioFileId）
//   →逐引用：Media 行存在性+Media.teamId===project.teamId 校验（跨 team 拒+计数+不建行——读侧
//   ACL 403 兜底已由 content 单门承载，binding 只管索引不执法）
//   →current-state upsert（ON CONFLICT 槽位键 DO UPDATE mediaId——同槽位换 media 即改行；
//   v10.1 create-only「当前槽位靠 createdAt 猜」废止）
//   →stale 清扫（doc 无引用但 binding 行在→删行——删除节点/清槽位自然收敛；项目灭失→全行清）。
//
// 触发形态（裁决③「零客户端调用/零新端点/离线 paste 天然覆盖」——本服务自持双 timer）：
//   ①post-apply 触发：投影 poller mark projected 后 requestReconcile(projectId)（T15 交接面——
//     生成交付落 doc 即刻对齐索引；fire-and-forget 不阻塞投影循环）；
//   ②周期触发：候选发现轮（MediaBinding.projectId ∪ NodeArtifact.projectId 去重游标轮转——
//     离线 paste/上传引用等无投影路径的兜底收敛）。
// 形态纪律=MaterializeJob/IntentReconcile/pending-upload sweep 同族：原生 setInterval+unref+
// busy 防重入（R28——@Cron 全仓未导入是死代码）；doc 读=withSession(read)（lease 失守/vacuum
// 503 ⇒ scan-failed 计数本轮跳过，幂等重入下轮收敛——惰性语义不承诺即时）。
// finalize 同步 upsert（source=generated 主槽位）已由 T10 bindInTx 承载（artifact-commit
// finalizeInTx cas.won 分支+T11 collab-media replace 命令——本服务不再重复写，只负责兜底收敛）。
import { Inject, Injectable, Logger, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { collectMediaRefs, type MediaRef } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { toDocLike } from '../collab/doc-like.util';
import { mediaBindingReconcileOutcomeTotal } from './binding-reconcile.metrics';

// ── reconcile 参数（同族纪律：常数不进 env——热循环红线非立即重投） ──
/** 触发队列排水周期（post-apply 请求的收敛延迟上界——投影 projected 后索引对齐节奏）。 */
export const RECONCILE_DRAIN_INTERVAL_MS = 5_000;
/** 周期候选发现轮（离线 paste/上传引用兜底——无投影路径的引用最长滞后窗）。 */
export const RECONCILE_DISCOVER_INTERVAL_MS = 5 * 60_000;
/** 每 drain tick 排水上界（单 doc 读成本摊薄——积压按轮消化）。 */
export const RECONCILE_DRAIN_BUDGET = 8;
/** 周期发现每轮候选上界（游标轮转——sweepOrphanExec 同款全量轮转非进度承诺）。 */
export const RECONCILE_DISCOVER_PAGE = 64;

/** 单轮 reconcile 摘要（测试/观测面——计数即指标 label 域）。 */
export interface ReconcileSummary {
  projectId: string;
  /** doc 读成功（false=本轮跳过——scan-failed 已计数，下轮触发重扫）。 */
  ok: boolean;
  scanned: number;
  upserted: number;
  deleted: number;
  crossTeamRejected: number;
  /** doc 引用的 mediaId 无 Media 行（行灭失——FK 防线拒建，GC/doc 清理后自然消失）。 */
  missingMedia: number;
}

export type ReconcileOutcome = 'upserted' | 'deleted' | 'cross-team-rejected' | 'missing-media' | 'scan-failed';

function inc(outcome: ReconcileOutcome, n = 1): void {
  mediaBindingReconcileOutcomeTotal.inc({ outcome }, n);
}

/** 槽位键（MediaBinding @@unique([projectId,nodeId,role,targetField,targetItemId]) 的应用层形态）。
 *  七键引用 role 恒 primary——MediaRef 无 role 字段即此义。 */
function slotKeyOf(r: { nodeId: string; targetField: string; targetItemId: string }): string {
  return `${r.nodeId}\u0000${r.targetField}\u0000${r.targetItemId}`;
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
    @Inject(CollabDocumentService) private readonly docs: CollabDocumentService,
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
        const s = await this.reconcileProject(projectId).catch((e) => {
          this.logger.warn(`reconcile project=${projectId} 失败（下轮触发重扫）: ${(e as Error).message}`);
          inc('scan-failed');
          return null;
        });
        if (s) processed += 1;
      }
      return processed;
    } finally {
      this.draining = false;
    }
  }

  /** 周期候选发现（MediaBinding.projectId ∪ NodeArtifact.projectId——覆盖「行在需清扫」与
   *  「artifact 在可能有引用」两域；游标轮转分页）。纯新增引用无行无 artifact 的项目由
   *  投影 post-apply 触达（生成链）——上传引用键（referenceImage 等）落 binding 的首驱=
   *  上传所在项目的任一投影/finalize（bindInTx 主槽先行，其余键随本轮收敛）。 */
  async discover(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ projectId: string }[]>(Prisma.sql`
      SELECT DISTINCT "projectId" FROM (
        SELECT "projectId" FROM "MediaBinding" WHERE "projectId" > ${this.discoverCursor ?? ''}
        UNION
        SELECT "projectId" FROM "NodeArtifact" WHERE "projectId" > ${this.discoverCursor ?? ''}
      ) t ORDER BY "projectId" LIMIT ${RECONCILE_DISCOVER_PAGE}`);
    if (rows.length > 0) {
      this.discoverCursor = rows[rows.length - 1].projectId;
      if (rows.length < RECONCILE_DISCOVER_PAGE) this.discoverCursor = null;   // 轮尽回卷
      for (const r of rows) this.requestReconcile(r.projectId);
    } else {
      this.discoverCursor = null;
    }
    return rows.length;
  }

  /** 单 project 全量 reconcile（幂等重入收敛——desired=doc 现值，DB 面=desired 恰好）。 */
  async reconcileProject(projectId: string): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = {
      projectId, ok: false, scanned: 0, upserted: 0, deleted: 0, crossTeamRejected: 0, missingMedia: 0,
    };
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
      select: { teamId: true },
    });
    if (!project) {
      // 项目灭失：doc 无从扫——全行清（stale 兜底；引用图随项目级联语义消亡）。
      const { count } = await this.prisma.mediaBinding.deleteMany({ where: { projectId } });
      summary.deleted = count;
      inc('deleted', count);
      summary.ok = true;
      return summary;
    }
    let refs: MediaRef[];
    try {
      refs = await this.docs.withSession(projectId, (doc) => collectMediaRefs(toDocLike(doc)), { mode: 'read' });
    } catch (e) {
      // lease 失守/vacuum/结构缺失——惰性语义本轮跳过（计数观测，下轮触发重扫）。
      this.logger.warn(`reconcile doc 读失败 project=${projectId}（跳过本轮）: ${(e as Error).message}`);
      inc('scan-failed');
      return summary;
    }
    summary.scanned = refs.length;
    return this.applyRefs(projectId, project.teamId, refs);
  }

  /** desired 引用集 → DB 面（current-state upsert+跨 team 拒+stale 清扫；单事务）。测试直调入口
   *  （refs 可由测试直接构造——doc 读面经 reconcileProject 覆盖）。 */
  async applyRefs(projectId: string, teamId: string, refs: readonly MediaRef[]): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = {
      projectId, ok: true, scanned: refs.length, upserted: 0, deleted: 0, crossTeamRejected: 0, missingMedia: 0,
    };
    // ①引用 media 行存在性+team 校验（一次 IN 读——mediaId 去重）。
    const mediaIds = [...new Set(refs.map((r) => r.mediaId))];
    const mediaRows = mediaIds.length > 0
      ? await this.prisma.media.findMany({ where: { id: { in: mediaIds } }, select: { id: true, teamId: true } })
      : [];
    const teamById = new Map(mediaRows.map((m) => [m.id, m.teamId]));
    const admitted: MediaRef[] = [];
    for (const r of refs) {
      const mediaTeam = teamById.get(r.mediaId);
      if (mediaTeam === undefined) {
        summary.missingMedia += 1;
        inc('missing-media');
        continue;   // 行灭失——FK 防线拒建（doc 陈旧引用，GC/清槽后自然消失）
      }
      if (mediaTeam !== teamId) {
        summary.crossTeamRejected += 1;
        inc('cross-team-rejected');
        continue;   // 跨 team 拒+不建行（读侧 ACL 403 兜底在 content 单门——裁决③）
      }
      admitted.push(r);
    }

    // ②单事务：净变更分类（P2#6——幂等重扫零虚高：unchanged 槽跳写）+upsert 净变更集
    //    （ON CONFLICT 槽位键 DO UPDATE mediaId——current-state）+删 stale（本项目槽位不在
    //    desired 集的行）。upserted=create+update 净计数（同 doc 重扫第二轮回零）。
    const desiredByKey = new Map<string, MediaRef>();
    for (const r of admitted) desiredByKey.set(slotKeyOf(r), r);
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.mediaBinding.findMany({
        where: { projectId },
        select: { id: true, nodeId: true, targetField: true, targetItemId: true, mediaId: true },
      });
      const existingByKey = new Map(existing.map((row) => [slotKeyOf(row), row]));
      let netUpserts = 0;
      for (const [key, r] of desiredByKey) {
        const prior = existingByKey.get(key);
        if (prior && prior.mediaId === r.mediaId) continue;   // unchanged——跳写（幂等重扫零动作）
        await tx.mediaBinding.upsert({
          where: {
            projectId_nodeId_role_targetField_targetItemId: {
              projectId, nodeId: r.nodeId, role: 'primary',
              targetField: r.targetField, targetItemId: r.targetItemId,
            },
          },
          create: {
            mediaId: r.mediaId, projectId, nodeId: r.nodeId, teamId,
            role: 'primary', targetField: r.targetField, targetItemId: r.targetItemId,
          },
          update: { mediaId: r.mediaId },   // current-state：同槽位换 media 即改行（create-only 废止）
        });
        netUpserts += 1;
      }
      const staleIds = existing
        .filter((row) => !desiredByKey.has(slotKeyOf(row)))
        .map((row) => row.id);
      if (staleIds.length > 0) {
        await tx.mediaBinding.deleteMany({ where: { id: { in: staleIds } } });
      }
      summary.upserted = netUpserts;
      summary.deleted = staleIds.length;
    });
    inc('upserted', summary.upserted);
    inc('deleted', summary.deleted);
    return summary;
  }
}

/** 便利类型（GC 引用图复用 MediaRef——doc 扫描出口）。 */
export type { MediaRef };
