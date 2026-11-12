// apps/api/src/modules/collab/binding-rebuild.service.ts
// C3a-6（plan v3 Task C3a-6——spec 2026-11-11-foundation-batch-design.md §0 水位不变量/§3.2-3）：
// MediaBinding 全量 rebuild 服务——**唯一清 dirty+推 mediaBindingSeq 的面**（增量 CAS 仅在
// 非 dirty 连续前缀上推进——dirty 期间任何增量成功不得推进）。协议（spec §0「仅全量 rebuild」）：
//   ① 锁外读 anchor {generation G, pgSeq S, expectedBindingSeq} 快照；
//   ② rebuild 开始即置 dirty（修锁外分页写覆盖竞态——CAS 失败保持 dirty 下轮重试）；
//   ③ loadForHydrationAt(pid,{generation,pgSeq}) 定代重放 doc@S（第七轮 P0-5：vacuum 换代 pgSeq
//      不重置但内容变——固定代查询，换代行排除；**rebuild/漂移检测专用，禁 live doc**）；
//   ④ collectMediaRefs 聚合→全量 delta（doc 全节点终态快照）；
//   ⑤ 分页短事务经 projectBindings 写（写路径复用 C3a-5 投影器——C3a-7 静态白名单含本文件；
//      全量替换=差集收敛：desired upsert+非 desired 槽删+**doc 外节点现存行清**〔stale——增量
//      miss/命令面遗留〕——非「先删后写」：中间空窗会撤掉 GC 删除保护的引用证人）；
//   ⑥ CAS 四条件（第七轮补 generation）：`mediaBindingSeq=expected ∧ pgSeq=S ∧ generation=G ∧
//      dirty=true` 清 dirty+推 mediaBindingSeq=S；任一移动（并发 append/换代/他轮 rebuild 推进）
//      → 0 行=失败→dirty 保持（下轮重试）。
// 消费方=gateway 装载缝 boot 判定（needsBindingRebuild 三或——spec §3.2-3 恢复四路 boot/residency
// 腿：`replayed>0 ∨ mediaBindingSeq<pgSeq ∨ dirty`；C3a-8 BackfillRunner 枚举+reconcile 同消费）。
//
// 「持续 dirty」可观测（记录性注释——spec §3.2-7 指标清单无 binding_dirty 项）：分诊面=本文件
// cas-miss WARN 日志+needsBindingRebuild 选中谓词（恒在候选集）；gap_seq/watermark_lag 指标归
// C3a-8 落（§3.2-3 观测面），不在本卡重复发明。
//
// 【spec 措辞张力销案（C3a-6 评审遗留——本实现按操作性条款落地）】①spec §3.2-4「binding 权威写=
// appendBatch inTx 投影+**锁内** rebuild」与 §0/§3.2-3「**锁外**读 pgSeq 快照+分页写+短事务 CAS」
// 张力：按后者（操作性条款——第七轮裁定优先）落地为锁外分页写+四条件 CAS 协议；census ㉞ lockProject
// 恰 2 调用点（erasure 批/维护写）佐证 rebuild 不在锁内族。②stale-tail 清理（本文件尾腿）与并发
// append 的瞬时交错残留面：新节点 witness 行可能被暂删（append 未及落）→ dirty 由 append 侧置位/
// 水位不推兜底+下轮 rebuild 重建；并发窗口的最终保护=media-gc doc 扫描护栏（binding 非唯一证人）。
import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as Y from 'yjs';
import { collectMediaRefs } from '@flowweb/shared';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { projectBindings } from './media-binding-projector';
import type { MediaRef } from '@flowweb/shared';
import { createCanvasDoc } from './canvas-doc.factory';
import { toDocLike } from './doc-like.util';
import { clearMediaBindingGap, mediaBindingProjectionFailedTotal, mediaBindingWatermarkLag, recordMediaBindingProjection } from './media-binding.metrics';   // C3a-8：write/skip/projection_failed/gap/lag 观测面

/** rebuild 锚（锁外快照三元——CAS 四条件的期望侧；pgSeq/generation/expectedBindingSeq 任一
 *  在写面落定前被并发移动即 CAS 失败）。 */
export interface RebuildAnchor {
  generation: number;
  pgSeq: bigint;
  expectedBindingSeq: bigint;
}

export type RebuildOutcome =
  | { outcome: 'no-doc' }   // CanvasDoc 行缺（项目未建档/已级联删除）
  | { outcome: 'cleared'; pgSeq: bigint }   // CAS 落定：dirty 清+mediaBindingSeq=pgSeq
  | { outcome: 'cas-miss' };   // CAS 0 行：dirty 保持，下轮重试

/** boot 判定/backfill 选中条件（spec §3.2-3 恢复四路 boot：`replayed>0 ∨ mediaBindingSeq<pgSeq ∨
 *  dirty` 三或——replayed=装载期 spool 重放帧数〔boot 回灌帙经 replayAll catch-up 形恒不覆盖〕。
 *  C3a-8 BackfillRunner 枚举（`bindingsDirty ∨ mediaBindingSeq<pgSeq` SQL 面）与本谓词单源对齐）。 */
export function needsBindingRebuild(row: { replayed: number; mediaBindingSeq: bigint; pgSeq: bigint; bindingsDirty: boolean }): boolean {
  return row.replayed > 0 || row.mediaBindingSeq < row.pgSeq || row.bindingsDirty;
}

/** 分页写页大小（spec §0「分页写+短事务」——每页一轮独立短事务，页间并发 append 由 CAS 门收敛）。 */
const REBUILD_PAGE_NODES = 500;

@Injectable()
export class BindingRebuildService {
  private readonly logger = new Logger(BindingRebuildService.name);

  // 显式 @Inject：vitest esbuild 不生成设计时类型元数据（canvas-doc-update.repository 同模式）
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CanvasDocUpdateRepository) private readonly repo: CanvasDocUpdateRepository,
  ) {}

  /** ① 锁外读 anchor（行缺=null——调用方 no-op；CanvasDoc 读面经 repository readRebuildAnchor
   *  ——契约 1 装载单源，service 不直查 CanvasDoc）。 */
  async snapshotAnchor(projectId: string): Promise<RebuildAnchor | null> {
    const row = await this.repo.readRebuildAnchor(projectId);
    if (!row) return null;
    return { generation: row.generation, pgSeq: row.pgSeq, expectedBindingSeq: row.mediaBindingSeq };
  }

  /** ②-⑤ 置 dirty+定代重放+全量分页写（CAS 前置段——分段暴露供交错红测锚定竞窗）。 */
  async writeBindingsAt(projectId: string, anchor: RebuildAnchor): Promise<void> {
    // ② rebuild 开始即置 dirty（幂等；updateMany——行缺布景下 0 行不炸，C3a-4 闭包同判）
    await this.prisma.canvasDoc.updateMany({ where: { projectId }, data: { bindingsDirty: true } });
    // ③ 定代重放 doc@S（固定 G——换代行排除）
    const { state, updates } = await this.repo.loadForHydrationAt(projectId, { generation: anchor.generation, pgSeq: anchor.pgSeq });
    const doc = createCanvasDoc();
    try {
      if (state) Y.applyUpdate(doc, new Uint8Array(state));
      for (const u of updates) Y.applyUpdate(doc, new Uint8Array(u));
      // ④ 全量 delta（doc 全节点——collectMediaRefs 聚合单源，帧级 collectMediaRefsForNode 同族）
      const delta = new Map<string, MediaRef[]>();
      for (const r of collectMediaRefs(toDocLike(doc))) {
        const list = delta.get(r.nodeId);
        if (list) list.push(r);
        else delta.set(r.nodeId, [r]);
      }
      const teamId = (await this.prisma.canvasProject.findUnique({ where: { id: projectId }, select: { teamId: true } }))?.teamId;
      if (teamId == null) return;   // 项目行缺（FK Cascade 已随删 binding 行）——写面 no-op，CAS 自证 cas-miss
      // ⑤ 分页短事务写（每页原子：desired upsert+非 desired 槽删——projector diff 语义）
      const entries = [...delta.entries()];
      for (let i = 0; i < entries.length; i += REBUILD_PAGE_NODES) {
        const chunk = new Map(entries.slice(i, i + REBUILD_PAGE_NODES));
        try {
          const stats = await this.prisma.$transaction((tx) => projectBindings(tx, projectId, teamId, chunk), { timeout: 5_000, maxWait: 1_000 });
          recordMediaBindingProjection('rebuild', stats);   // C3a-8：页事务提交成功后计数（回滚不计数）
        } catch (err) {
          mediaBindingProjectionFailedTotal.inc({ reason: 'rebuild-page' });
          throw err;
        }
      }
      // 全量替换尾腿：doc 外节点的现存行清（stale 行——不在 delta 域=增量投影永不触达）
      const existingNodeIds = await this.prisma.$queryRaw<{ nodeId: string }[]>`
        SELECT DISTINCT "nodeId" FROM "MediaBinding" WHERE "projectId" = ${projectId}::text`;
      const stale = existingNodeIds.map((r) => r.nodeId).filter((id) => !delta.has(id));
      if (stale.length > 0) {
        await this.prisma.$executeRaw`DELETE FROM "MediaBinding" WHERE "projectId" = ${projectId}::text AND "nodeId" = ANY(${stale}::text[])`;
      }
    } finally {
      doc.destroy();
    }
  }

  /** ⑥ CAS 四条件（spec §0——第七轮补 generation）：1 行=cleared（清 dirty+推 S）；0 行=cas-miss
   *  （dirty 保持——② 已置位；增量/换代/并发 append 任意移动即失效）。 */
  async commitByCas(projectId: string, anchor: RebuildAnchor): Promise<{ outcome: 'cleared'; pgSeq: bigint } | { outcome: 'cas-miss' }> {
    const n = await this.prisma.$executeRaw`
      UPDATE "CanvasDoc" SET "mediaBindingSeq" = ${anchor.pgSeq}::bigint, "bindingsDirty" = false
      WHERE "projectId" = ${projectId}::text
        AND "mediaBindingSeq" = ${anchor.expectedBindingSeq}::bigint
        AND "pgSeq" = ${anchor.pgSeq}::bigint
        AND generation = ${anchor.generation}::int
        AND "bindingsDirty" = true`;
    if (n === 1) {
      // C3a-8（spec §3.2-7）：gap 闭合（首现 gap 序号归 0）+ 水位 lag=0（本观测点后该投影域连续）
      clearMediaBindingGap();
      mediaBindingWatermarkLag.set(0);
      return { outcome: 'cleared', pgSeq: anchor.pgSeq };
    }
    return { outcome: 'cas-miss' };
  }

  /** 组合入口（生产消费面——C3a-8 起经 ProjectionBackfillRunner 队列串行（enqueue 单项目单飞）；
   *  方法本身可直调（测试/维护面）——队列去重归 runner，本服务零 inFlight 守卫）。 */
  async rebuildProjectBindings(projectId: string): Promise<RebuildOutcome> {
    const anchor = await this.snapshotAnchor(projectId);
    if (!anchor) return { outcome: 'no-doc' };
    await this.writeBindingsAt(projectId, anchor);
    const r = await this.commitByCas(projectId, anchor);
    if (r.outcome === 'cas-miss') {
      // 持续 dirty 分诊面（§3.2-7 无 binding_dirty 指标——头注记录性注释）：miss=写面读点后
      // 有并发移动（append/换代），dirty 保持由下轮装载/backfill 重试收敛
      this.logger.warn(`binding rebuild CAS miss for ${projectId}（写面读点后有并发 append/换代——dirty 保持，下轮重试；anchor g=${anchor.generation} S=${anchor.pgSeq} expected=${anchor.expectedBindingSeq}）`);
    }
    return r;
  }
}
