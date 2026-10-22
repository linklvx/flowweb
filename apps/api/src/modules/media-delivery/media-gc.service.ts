// apps/api/src/modules/media-delivery/media-gc.service.ts —— Y1a+Y1b T16
//（spec :25 裁决③「Media GC 加 doc 引用检查/grace period 护栏——防副本还在媒体被删」/:53 GC 引用图）：
// 软删 Media 的硬删决策=引用图判定——引用集 =
//   ①MediaBinding 行（mediaId 索引——惰性 reconcile 维护的 doc 引用索引）
//   ②NodeArtifact.mediaId（生成产物权威）
//   ③VideoWork.videoMediaId（已发布作品）
//   ④VideoProject.data JSON 深扫（剪辑 timeline clip.mediaId——shared VideoClip/ImageClip/AudioClip 词形）
//   ⑤doc 引用扫描（mediaRefsOf 词表=shared MEDIA_REF_TARGET_FIELDS 九键——**护栏权威面**：副本/copy
//     的引用可能尚未进 binding 索引〔离线 paste 后 reconcile 未触〕，binding∪NodeArtifact 只是
//     快速预判，doc 扫描是 GC 前的最终裁决——「副本还在媒体被删」的根防）
//   ∪ grace period（软删期：素材库 deleteFile 仅软删，deletedAt 过 MEDIA_GC_GRACE 才进 GC 候选）。
// 判定无引用 ⇒ MinIO 对象删除（404 容忍——幂等）+行删除（级联 MediaBinding）；
// 有引用/扫描源读失败/扫描源超安全阀 ⇒ guarded 计数保留（下轮重判——副本删除后自然放行；
// **读失败=保守保留**：doc 读 503（lease 失守/vacuum）或 VideoProject 扫描超阀时本轮全量
// 保留候选——少删=护栏安全方向）。
// 【跨 team 语义钉明（spec 评审 P2#7——与裁决③一致）】**跨 team 引用不受本 GC 保护**：裁决③
// 定案跨 team paste=客户端 strip+服务端不建 binding+读 ACL 403 兜底——他队 doc 引用本队 mediaId
// 是被拒形态（无 binding 行、读侧 403），本队软删+过 grace+队内无引用即可硬删；「跨队副本保图」
// 不在本 GC 承诺内（恶意/越权引用不得反向拖住资源回收）。
// 形态=pending-upload sweep/IntentReconcile 同族：原生 setInterval+unref+busy 防重入（R28）。
// 进程归属=api（media-delivery 模块——ExecutionDaemonModule.register role 门内；需 withSession
// doc 读，worker 面零实例化）。
import { Inject, Injectable, Logger, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { collectMediaRefs } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { MinioService } from '../minio/minio.service';
import { toDocLike } from '../collab/doc-like.util';
import { mediaGcOutcomeTotal } from './binding-reconcile.metrics';

/** 软删 grace（素材库删除后悔窗——副本护栏外的用户意图缓冲；spec :25「grace period」）。 */
export const MEDIA_GC_GRACE_MS = 7 * 24 * 3600_000;
/** GC 扫描周期（候选=软删+过 grace——量级低频；小时级即可，对齐 storage-quota/pending sweep 族）。 */
export const MEDIA_GC_SWEEP_INTERVAL_MS = 3600_000;
/** 每轮候选上界（积压按轮消化——同 SWEEP_PAGE 纪律）。 */
export const MEDIA_GC_PAGE = 50;
/** doc 扫描项目上界（安全阀——超量团队本轮全量保守保留〔guarded〕不删：少删=护栏安全方向，
 *  禁部分扫描〔漏扫项目的副本引用会被误删=「副本还在媒体被删」正中红测〕）。 */
export const MEDIA_GC_DOC_SCAN_PAGE = 500;
/** VideoProject timeline 扫描行上界（安全阀同 doc 扫描——超量=引用图不完整，全量保守保留）。 */
export const MEDIA_GC_TIMELINE_SCAN_PAGE = 500;

export interface MediaGcSweepSummary {
  candidates: number;
  deleted: number;
  guarded: number;
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

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(CollabDocumentService) private readonly docs: CollabDocumentService,
  ) {}

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

  /** 一轮 GC（busy 防重入；destroyed 后零动作）。测试直调入口。 */
  async sweep(): Promise<MediaGcSweepSummary> {
    const summary: MediaGcSweepSummary = { candidates: 0, deleted: 0, guarded: 0, objectDeleteFailed: 0 };
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
      const ids = candidates.map((c) => c.id);

      // ── 引用图（护栏权威序：PG 快判在前、doc 扫描终裁在后）──
      const referenced = new Set<string>();
      const fromBindings = await this.prisma.mediaBinding.findMany({
        where: { mediaId: { in: ids } }, select: { mediaId: true },
      });
      for (const b of fromBindings) referenced.add(b.mediaId);
      const fromArtifacts = await this.prisma.nodeArtifact.findMany({
        where: { mediaId: { in: ids } }, select: { mediaId: true },
      });
      for (const a of fromArtifacts) if (a.mediaId) referenced.add(a.mediaId);
      const fromWorks = await this.prisma.videoWork.findMany({
        where: { videoMediaId: { in: ids } }, select: { videoMediaId: true },
      });
      for (const w of fromWorks) if (w.videoMediaId) referenced.add(w.videoMediaId);
      const teamIds = [...new Set(candidates.map((c) => c.teamId))];
      const projects = await this.prisma.canvasProject.findMany({
        where: { teamId: { in: teamIds } },
        orderBy: { id: 'asc' },
        take: MEDIA_GC_DOC_SCAN_PAGE + 1,   // +1=超量探测（===PAGE+1 ⇒ 超阀——本轮全量保守保留）
        select: { id: true, teamId: true },
      });
      const scanOverflow = projects.length > MEDIA_GC_DOC_SCAN_PAGE;
      if (scanOverflow) {
        this.logger.warn(`mediaGc doc 扫描超安全阀（>${MEDIA_GC_DOC_SCAN_PAGE} 项目）——本轮全量保守保留 ${ids.length} 候选`);
      }
      const scannable = scanOverflow ? [] : projects;
      // VideoProject（剪辑 timeline——team 维度行集；JSON 深扫 mediaId 词形）；超阀=引用图不完整→保守保留
      const videoProjects = await this.prisma.videoProject.findMany({
        where: { teamId: { in: teamIds } },
        orderBy: { id: 'asc' },
        take: MEDIA_GC_TIMELINE_SCAN_PAGE + 1,   // +1=超量探测（同 doc 扫描安全阀）
        select: { data: true },
      });
      const timelineOverflow = videoProjects.length > MEDIA_GC_TIMELINE_SCAN_PAGE;
      if (timelineOverflow) {
        this.logger.warn(`mediaGc VideoProject 扫描超安全阀（>${MEDIA_GC_TIMELINE_SCAN_PAGE} 行）——本轮全量保守保留 ${ids.length} 候选`);
      }
      const timelineRefs = new Set<string>();
      if (!timelineOverflow) {
        for (const vp of videoProjects) collectJsonMediaIds(vp.data, timelineRefs);
        for (const id of ids) if (timelineRefs.has(id)) referenced.add(id);
      }
      // doc 引用扫描（终裁——副本/copy 引用未进 binding 索引的窗）：**读失败=保守保留**（P1#2——
      // 503/lease 失守/vacuum 窗本轮全量 guarded，下轮重试；禁「log 后照删」）。
      let scanFailed = false;
      for (const p of scannable) {
        try {
          const refs = await this.docs.withSession(p.id, (doc) => collectMediaRefs(toDocLike(doc)), { mode: 'read' });
          for (const r of refs) referenced.add(r.mediaId);
        } catch (e) {
          scanFailed = true;
          this.logger.warn(`mediaGc doc 扫描失败 project=${p.id}（本轮全量保守保留候选——下轮重试）: ${(e as Error).message}`);
        }
      }

      // ── 判定执行：无引用→对象删（404 容忍）+行删；有引用→guarded；阀 bail-out（超阀/读失败）→
      // valve-bailout 保留（T16 登记收口·T19：outcome 分桶区分「引用命中」vs「阀 bail-out」——
      // 前者=引用图真实命中（下轮仍会命中直至引用消失），后者=扫描面不完整/失败的保守保留
      // （下轮恢复即放行；持续 valve-bailout=扫描面异常信号非引用增长）──
      for (const c of candidates) {
        if (referenced.has(c.id)) {
          summary.guarded += 1;
          mediaGcOutcomeTotal.inc({ outcome: 'guarded' });
          continue;
        }
        if (scanOverflow || timelineOverflow || scanFailed) {
          summary.guarded += 1;
          mediaGcOutcomeTotal.inc({ outcome: 'valve-bailout' });
          continue;
        }
        try {
          await this.minio.delete(c.key);
        } catch (e) {
          const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
            ?? (e as { name?: string }).name;
          if (status !== 404 && status !== 'NoSuchKey') {
            // 对象删除失败（非灭失）——行保留待下轮（pending-upload sweep 同语义；MinIO 环境红非回归）
            summary.objectDeleteFailed += 1;
            mediaGcOutcomeTotal.inc({ outcome: 'object-delete-failed' });
            this.logger.warn(`mediaGc 对象删除失败（行保留待下轮）key=${c.key}: ${e}`);
            continue;
          }
        }
        await this.prisma.media.delete({ where: { id: c.id } });   // 级联 MediaBinding（残行随删）
        summary.deleted += 1;
        mediaGcOutcomeTotal.inc({ outcome: 'deleted' });
      }
      return summary;
    } finally {
      this.sweeping = false;
    }
  }
}
