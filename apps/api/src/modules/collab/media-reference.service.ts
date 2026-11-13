// apps/api/src/modules/collab/media-reference.service.ts
// C3b-3（plan v3 Task C3b-3——spec 2026-11-11-foundation-batch-design.md §3.4-4 :80/§3.4-6 :82）：
// **decision snapshot+isMediaReferenced**——删除保护引用并集的决策级读面。
//
// ① decideTeamReferenceSnapshot(teamId,{excludeProjectId?})——spec §3.4-4 :80 五步序的决策校验段：
//    枚举 team 内 CanvasDoc 项目读 pgSeq=S_i（**erasure 传 excludeProjectId=被擦项目——其自身引用
//    不算保护〔第七轮 P0-4，对齐旧 resolveMediaDisposition 的 projectId not pid〕；GC 不传=全计入
//    〔含其他 DELETING 项目——A 擦时 B 为 DELETING 仍计入保护〕）→逐项目决策级校验（header
//    COMPLETE∧verifiedSeq===S_i∧generation 同∧epoch 非陈旧∧binding 水位===pgSeq∧非 dirty）
//    →**扫描后 CAS 校验**（复读 pgSeq——枚举读后被并发 append 移动即 bail-out）。任一不满足
//    bail-out（消费方不删——保守方向）。校验通过后消费方在删除事务内 isMediaReferenced recheck。
// ② isMediaReferenced(db, mediaId, {teamId,excludeProjectId?,includeDeletedProjects?})——并集=
//    registry 全条目（media-referrer.registry 单源）∪ Binding 臂（MediaBinding.mediaId——投影证人）
//    ∪ Oracle 臂（CanvasReferenceOracle join header **决策级校验**：epoch+generation+verifiedSeq
//    +status——coverage 只认决策级证人，spec §3.4-2「coverage 只认 COMPLETE∧verifiedSeq===决策
//    pgSeq」；陈旧 header 的 oracle 行不作证人——单看本臂该方向是**漏保护（误删）向**，删除流的
//    安全由时序兜底：先 snapshot（陈旧即 bail-out）后 recheck，陈旧 header 流根本到不了本臂
//    〔spec §3.4-4 删除序〕）。任一命中→保留。
//
// 【epoch 校验语义裁定（卡文「header 非陈旧〔当前 worker epoch〕」——跨进程可观测化）】
//   worker epoch=OracleWorkerService 进程内 UUID，消费进程（api GC/worker erasure）不可读其内存。
//   裁定=**freshest-scannedAt header 的 epoch 即当前 epoch**（全局 canvasReferenceOracleScan 按
//   scannedAt DESC 取首行）：worker 重启=新 epoch+boot 首 tick 即重扫（tick 候选含全部 epoch 失配
//   项目）⇒ 重扫窗内任何新落 header 携新 epoch 成为 freshest，旧 epoch header 判陈旧→保守 bail-out
//   /oracle 证人不认（误保留方向安全）。重启后尚未落任何新 header 的窗=freshest 仍为旧 epoch
//   （全员一致不误判）——该窗内 verifiedSeq===pgSeq 仍钉内容新鲜度；epoch 腿=worker 代际语义升级
//   防线（新 worker 扫描语义变更后旧 header 不再被决策面信任）。
//
// 【includeDeletedProjects 默认值裁定】默认 true（全计入——含 DELETING 项目引用）：GC 候选=软删
//   media、擦除中项目（DELETING）doc 仍引用候选 media（media-gc I-2 同判——漏扫=引用图缺口误删）；
//   erasure 面 B 为 DELETING 照计入（卡文④形态3）。false=仅 ACTIVE 项目引用保护（读面诊断用）。
//
// 【与旧 resolveMediaDisposition 双轨处置】本卡只建新面（decision-grade 证人链）；消费面切换归
//   C3b-5（GC/erasure 并集单源改造+复核窗保留）——切换后旧面退役，避免本卡夹带退役面。
//
// registry↔schema 联动门=check-collab-census ㊴（mediaId 命名列未登记即红）；本文件零 raw
// CanvasProject 语句（枚举经 runWithIncludeDeleted+delegate——读过滤 Proxy 正面，非旁路面）。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithIncludeDeleted } from '../../prisma/read-path.filter';
import { MEDIA_REFERRERS, type MediaRefDb } from './media-referrer.registry';

/** snapshot verified 载荷（决策时点 pgSeq 锚——消费方删除事务 recheck 的基线）。 */
export interface TeamReferenceSnapshotProject {
  projectId: string;
  pgSeq: bigint;
}

/** bail-out 原因（机器枚举——消费方分诊/日志面）。 */
export type TeamReferenceBailOutReason =
  | 'doc-missing'               // 项目无 CanvasDoc 行（coverage 不可证）
  | 'header-missing'            // 无 oracle scan header（从未扫/被清）
  | 'header-not-complete'       // status≠COMPLETE（VERIFYING 在途/FAILED）
  | 'header-stale-verified-seq' // verifiedSeq≠pgSeq（扫描后 doc 前进未重扫）
  | 'header-generation-mismatch'
  | 'header-epoch-stale'        // historyEpoch≠当前 epoch（worker 代际陈旧）
  | 'binding-watermark-lagging' // mediaBindingSeq≠pgSeq（binding 投影未收敛）
  | 'binding-dirty'             // bindingsDirty=true（投影缺口在途）
  | 'pgseq-moved';              // CAS 复读漂移（枚举读后被并发 append 移动）

export type TeamReferenceSnapshot =
  | { outcome: 'verified'; historyEpoch: string; projects: TeamReferenceSnapshotProject[] }
  | { outcome: 'bail-out'; reason: TeamReferenceBailOutReason; projectId?: string };

/** isMediaReferenced scope（spec §3.4-6 签名——teamId 必带，exclude/includeDeleted 可选）。 */
export interface IsMediaReferencedOpts {
  teamId: string;
  /** 被擦项目（其自身引用不算保护——第七轮 P0-4）。 */
  excludeProjectId?: string;
  /** 默认 true=全计入（含 DELETING 项目——GC/erasure 引用保护面）；false=仅 ACTIVE 项目。 */
  includeDeletedProjects?: boolean;
}

@Injectable()
export class MediaReferenceService {
  // 显式 @Inject：vitest esbuild 不生成设计时类型元数据（binding-rebuild 同模式）
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 当前 epoch（freshest-scannedAt header——裁定见头注；无任何 header=null=oracle 臂不认证人）。 */
  private async currentHistoryEpoch(db: MediaRefDb): Promise<string | null> {
    const h = await db.canvasReferenceOracleScan.findFirst({ orderBy: { scannedAt: 'desc' }, select: { historyEpoch: true } });
    return h?.historyEpoch ?? null;
  }

  /** decision snapshot（spec §3.4-4 :80——决策级校验链；纯读零写）。 */
  async decideTeamReferenceSnapshot(teamId: string, opts: { excludeProjectId?: string } = {}): Promise<TeamReferenceSnapshot> {
    // ① 枚举 team 项目（runWithIncludeDeleted——GC/erasure 全计入：其他 DELETING 项目入决策宇宙）
    const projects = await runWithIncludeDeleted(() =>
      this.prisma.canvasProject.findMany({ where: { teamId }, select: { id: true } }));
    const targets = projects.map((p) => p.id).filter((id) => id !== opts.excludeProjectId);
    // ② 决策级校验读面（doc+header 各一次批读）
    const docs = await this.prisma.canvasDoc.findMany({
      where: { projectId: { in: targets } },
      select: { projectId: true, pgSeq: true, generation: true, mediaBindingSeq: true, bindingsDirty: true },
    });
    const docOf = new Map(docs.map((d) => [d.projectId, d] as const));
    const headers = await this.prisma.canvasReferenceOracleScan.findMany({ where: { projectId: { in: targets } } });
    const headerOf = new Map(headers.map((h) => [h.projectId, h] as const));
    const epoch = await this.currentHistoryEpoch(this.prisma);
    for (const pid of [...targets].sort()) {
      const doc = docOf.get(pid);
      if (!doc) return { outcome: 'bail-out', reason: 'doc-missing', projectId: pid };
      const h = headerOf.get(pid);
      if (!h) return { outcome: 'bail-out', reason: 'header-missing', projectId: pid };
      if (h.status !== 'COMPLETE') return { outcome: 'bail-out', reason: 'header-not-complete', projectId: pid };
      if (h.verifiedSeq !== doc.pgSeq) return { outcome: 'bail-out', reason: 'header-stale-verified-seq', projectId: pid };
      if (h.generation !== doc.generation) return { outcome: 'bail-out', reason: 'header-generation-mismatch', projectId: pid };
      if (epoch == null || h.historyEpoch !== epoch) return { outcome: 'bail-out', reason: 'header-epoch-stale', projectId: pid };
      if (doc.mediaBindingSeq !== doc.pgSeq) return { outcome: 'bail-out', reason: 'binding-watermark-lagging', projectId: pid };
      if (doc.bindingsDirty) return { outcome: 'bail-out', reason: 'binding-dirty', projectId: pid };
    }
    // ③ 扫描后 CAS 校验（复读 pgSeq——spec :80「逐项目 oracle+扫描后 CAS 校验」的 JS 面等价：
    //    枚举读点后被并发 append 移动/项目行消失即 bail；遍历 targets 而非复读行集——缺行即失配，
    //    两读间并发删除的项目不得逃检。删除流 barrier（C3b-4a admission 封帧）后此窗闭合）
    const recheckOf = new Map((await this.prisma.canvasDoc.findMany({
      where: { projectId: { in: targets } },
      select: { projectId: true, pgSeq: true },
    })).map((r) => [r.projectId, r.pgSeq] as const));
    for (const pid of [...targets].sort()) {
      if (docOf.get(pid)?.pgSeq !== recheckOf.get(pid)) return { outcome: 'bail-out', reason: 'pgseq-moved', projectId: pid };
    }
    return { outcome: 'verified', historyEpoch: epoch ?? '', projects: [...targets].sort().map((projectId) => ({ projectId, pgSeq: docOf.get(projectId)!.pgSeq })) };
  }

  /** 删除保护引用并集判定（spec §3.4-6——任一臂命中→true=保留；db 直供=删除事务内 recheck）。 */
  async isMediaReferenced(db: MediaRefDb, mediaId: string, opts: IsMediaReferencedOpts): Promise<boolean> {
    // ① 排除项目并集（excludeProjectId ∪ includeDeletedProjects=false 的非 ACTIVE 项目；默认空=零谓词）
    const excluded = await this.excludedProjectIds(db, opts);
    // ② media 键族（objectKey 臂 key→mediaId 映射载荷）
    const media = await db.media.findUnique({ where: { id: mediaId }, select: { key: true, objectKey: true } });
    const mediaKeys = media == null ? [] : media.objectKey != null ? [media.key, media.objectKey] : [media.key];
    // ③ registry 臂（structured/objectKey 全条目）
    const scope = { db, mediaId, mediaKeys, teamId: opts.teamId, excludedProjectIds: excluded };
    for (const referrer of MEDIA_REFERRERS) {
      if (await referrer.resolve(scope)) return true;
    }
    // ④ Binding 臂（投影证人——projectId 排除=被擦项目自身 binding 随 scope 批删/FK Cascade）
    const binding = await db.mediaBinding.findFirst({
      where: excluded.length > 0 ? { mediaId, projectId: { notIn: [...excluded] } } : { mediaId },
      select: { id: true },
    });
    if (binding != null) return true;
    // ⑤ Oracle 臂（PG 证人——join header 决策级校验：epoch+generation+verifiedSeq+status；陈旧 header
    //    行不作证人〔裁定见头注〕。o.verifiedSeq=h.verifiedSeq=行写入时锚——再钉 d.pgSeq 当前态）
    const epoch = await this.currentHistoryEpoch(db);
    if (epoch != null) {
      const rows = await db.$queryRaw<unknown[]>`
        SELECT 1 FROM "CanvasReferenceOracle" o
        JOIN "CanvasReferenceOracleScan" h ON h."projectId" = o."projectId"
        JOIN "CanvasDoc" d ON d."projectId" = o."projectId"
        WHERE o."mediaId" = ${mediaId}::text
          ${excluded.length > 0 ? Prisma.sql` AND o."projectId" <> ALL(${[...excluded]}::text[])` : Prisma.empty}
          AND h.status = 'COMPLETE'
          AND h."verifiedSeq" = o."verifiedSeq"
          AND h."verifiedSeq" = d."pgSeq"
          AND h.generation = d.generation
          AND h."historyEpoch" = ${epoch}::text
        LIMIT 1`;
      if (rows.length > 0) return true;
    }
    return false;
  }

  /** 排除项目并集：excludeProjectId ∪（**仅** includeDeletedProjects=false ⇒ 非 ACTIVE 项目——默认
   *  true 时 DELETING 项目照计入〔B 为 DELETING 仍保护，卡文④形态3〕）。runWithIncludeDeleted 包裹
   *  =读过滤 Proxy 正面读 DELETING 行。 */
  private async excludedProjectIds(db: MediaRefDb, opts: IsMediaReferencedOpts): Promise<string[]> {
    if (opts.includeDeletedProjects !== false) {
      return opts.excludeProjectId != null ? [opts.excludeProjectId] : [];
    }
    const projects = await runWithIncludeDeleted(() =>
      db.canvasProject.findMany({ where: { teamId: opts.teamId }, select: { id: true, lifecycleState: true } }));
    const excluded = projects.filter((p) => p.lifecycleState !== 'ACTIVE').map((p) => p.id);
    return opts.excludeProjectId != null && !excluded.includes(opts.excludeProjectId)
      ? [...excluded, opts.excludeProjectId]
      : excluded;
  }
}
