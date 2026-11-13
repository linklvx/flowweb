// apps/api/src/modules/collab/deletion-barrier.service.ts
// C3b-4a（plan v3 Task C3b-4a——spec 2026-11-11-foundation-batch-design.md §3.4-4 :75-80 第七轮重设计）：
// **DeletionBarrier 持久 fence+admission 编排**。设计裁定（spec :75 依据）：`lockProject`=xact advisory
// 锁事务结束即释放且持锁等 flush=自锁，不是 fence——barrier=DeletionBarrier 持久行（teamId @id，
// C3b-1 迁移已收编），**ACQUIRING/ACTIVE 两态分义承载「③flushThrough 至 appliedSeq==pgSeq 且 admission
// 已封」的可达成形态**：
//   · ACQUIRING（flush 窗）：gateway admission 已封（seal 落库即翻——无新 admitted 帧），appendBatch
//     照通——已 apply 未 flush 帧经本窗落 PG（否则 flush 与 appendBatch 同面互斥=不可收敛）；
//   · ACTIVE（删除窗）：appendBatch 事务首段拒（canvas-doc-update.repository assertNoDeletionBarrier
//     ——team 维）——决策宇宙冻结，decision snapshot 可证。
//
// ═══ 六步删除序（spec :78——本卡=编排骨架；DELETING 状态机/删除本体归 C3b-4，消费面切换归 C3b-5）═══
//   ①oracle 扫描在 barrier 前（低频可长不占 fence——scanProject 自带复用判定）；
//   ②CAS 取 barrier（INSERT..ON CONFLICT DO UPDATE WHERE 行缺∨FAILED∨已过期——双 GC worker 并发
//     一者零行 lost-race；**不持 lockProject**——自锁形态必红〔红⑤〕）+seal（team 项目集枚举入册）；
//   ③flushThrough 至 appliedSeq==pgSeq（逐项目预算——appliedSeq 复读稳定+pgSeq===appliedSeq 双判）；
//   ③' 陈旧 header 重扫（flush 落定移动 pgSeq 的项目——常态零项）→③'' ACQUIRING→ACTIVE（appendBatch
//     面封）→④decision snapshot 五步序（C3b-3 decideTeamReferenceSnapshot——决策级校验链+CAS 复读）
//     ——任一不满足整体 bail-out 释放+**返回 verified 前全程预算复检**（③'-④ 段同受总预算辖制——
//     P1-2：activate 时未过期≠返回时未过期，过期=围栏已漏）；⑤删除（对象先删→行删）=调用方在
//     prepare↔release 持有窗内执行（删除事务内 isMediaReferenced recheck 归 C3b-4 消费面）；
//     ⑥释放（删行+解封+gauge）。
//
// ═══ admission 三面（spec :77）═════════════════════════════════════════════════════════════════
//   面 1 gateway：SG authenticate/guardMessageFrame 读 **进程内 seal**（叶子模块 deletion-barrier.seal
//     registry——本服务 acquire 后置翻/release 清/惰性过期；每帧 DB 查禁入热路径——barrier 稀有事件，
//     恒 O(1) Map 查）——4413 族
//     拒（码复用+DELETION_BARRIER_REASON 分型：retry 档非终态，客户端 Retry-After 自愈——零新码零
//     客户端改动，裁定见 shared collab-close-code.ts）；
//   面 2 appendBatch 事务首段：ACTIVE 即拒（repo 单点——**覆盖全部 doc 写路径**：actor flush/
//     persistence 维护回退/spool replayAll 三调用点〔盘点结论——census 实证 appendBatch 调用面恰三，
//     无第四写者〕）；ACQUIRING 放行=③的 flush 通道；
//   面 3 维护/worker 写路径：与面 2 同查（同一 appendBatch 收敛点——维护帧〔submitMaintenance→
//     actor appliedQueue〕/回灌帧〔replayAll〕均经 repo.appendBatch；WAL 面照写=BOI 安全，barrier
//     释放后落定——「拒」仅指 PG 落定延迟，无帧丢失）。
//
// ═══ 生命周期裁定 ════════════════════════════════════════════════════════════════════════════
//   · seal=进程内（api 进程）：barrier 获取全部经 api 进程（GC=进程内 Direct；erasure worker=loopback
//     端点〔端点体在 api 进程执行〕）——seal 与 DB 行同进程翻/清，无跨进程失效面；
//   · 过期接管：expiresAt TTL——崩溃持有者留下的行被下一次 acquire 原位接管（DO UPDATE WHERE 已
//     过期）；appendBatch 拒与 seal 判定均带 expiresAt>now 门=过期行零阻塞；**无独立 TTL sweeper**
//     （行无主后不阻塞任何面，清扫=下一次 acquire 顺带——scope-column.registry『释放/TTL 清扫接线』
//     项按此形态兑现）；
//   · FAILED 态：CHECK 域成员但本卡不落 FAILED 终态行（bail-out 即删行——留 FAILED 行会挡后续 acquire
//     的 INSERT 冲突臂）；域值保留给 C3b-4 状态机扩展。
//   · RELEASING 态：无写者——释放=DELETE 行原位终态（单事务删行无两段式中间态需求）；域值预留
//     C3b-4 状态机/复核窗（拆窗单独立项）扩展。
//   · epoch 双实例面：本服务进程内 OracleWorkerService（直构——scanProject 原语，无 OnModuleInit
//     timer）与 worker 进程实例 epoch 不同——与 C3b-3 头注同裁定（freshest-scannedAt 单源判定，
//     交错窗保守 bail-out）。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithIncludeDeleted } from '../../prisma/read-path.filter';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabProjectActorService } from './collab-project-actor.service';
import { OracleWorkerService } from './oracle-worker.service';
import { MediaReferenceService, type TeamReferenceBailOutReason } from './media-reference.service';
import { sealAdmission, unsealAdmission } from './deletion-barrier.seal';
import { deletionBarrierActiveSeconds } from './deletion-barrier.metrics';

/** barrier 总预算（spec :79「如 10s」——acquire 起全六步序上界；超时整体 bail-out 释放）。 */
export const DELETION_BARRIER_BUDGET_MS = 10_000;
/** 逐项目 flush 预算（③——多项目 team 内单项目不得吃尽总预算；覆盖面=opts.perProjectFlushBudgetMs）。 */
export const DELETION_BARRIER_PROJECT_FLUSH_BUDGET_MS = 5_000;

/** bail-out 原因（机器枚举——lost/timeout/expired/scan 四本地腿+C3b-3 snapshot 校验链九腿）。 */
export type DeletionBarrierBailOutReason = 'lost-race' | 'flush-timeout' | 'barrier-expired' | 'scan-failed' | TeamReferenceBailOutReason;

// ── 进程内 admission seal（面 1 消费=SG 热路径）——注册表本体在叶子模块 deletion-barrier.seal.ts
//    （独立文件根因见彼处头注：SG 不得 import 本服务=防 gateway 求值中段提前拉入 document.service
//    的 @Inject(CollabGateway) 空值环）。本服务=seal 的唯一写者（acquire 后置翻/release 清）。

/** prepare 结果（loopback 端点 wire 契约同形——port/controller 消费）。 */
export type DeletionBarrierPrepareResult =
  | { outcome: 'verified'; barrierId: string; projects: { projectId: string; pgSeq: bigint }[] }
  | { outcome: 'bail-out'; reason: DeletionBarrierBailOutReason };

@Injectable()
export class DeletionBarrierService {
  private readonly logger = new Logger(DeletionBarrierService.name);
  /** 进程内 oracle 扫描原语（直构——scanProject/复用判定；无 OnModuleInit timer=worker 进程职责）。 */
  private readonly oracleScan: OracleWorkerService;
  private readonly mediaRef: MediaReferenceService;
  /** P1-2 测试缝：④ snapshot 前注入（慢 snapshot 形态红测——oracleScan.scanScope 同族「公有可写缝」
   *  体例；生产恒 undefined=零行为面）。 */
  snapshotGate?: () => Promise<void>;

  // 显式 @Inject：vitest esbuild 不生成设计时类型元数据（media-reference 同模式）
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CanvasDocUpdateRepository) repo: CanvasDocUpdateRepository,
    @Inject(CollabProjectActorService) private readonly actor: CollabProjectActorService,
  ) {
    this.oracleScan = new OracleWorkerService(prisma, repo);
    this.mediaRef = new MediaReferenceService(prisma);
  }

  /** ②CAS 取 barrier：行缺∨FAILED∨已过期→原位接管（新 barrierId）；活行在库=零行 lost-race。
   *  **不持 lockProject**（红⑤自锁锚——acquire 短事务独立，appendBatch 的 advisory 面不被占）。 */
  async acquire(teamId: string, opts?: { budgetMs?: number }): Promise<{ ok: true; barrierId: string; expiresAt: Date } | { ok: false; reason: 'lost-race' }> {
    const barrierId = randomUUID();
    const expiresAt = new Date(Date.now() + (opts?.budgetMs ?? DELETION_BARRIER_BUDGET_MS));
    const rows = await this.prisma.$queryRaw<{ barrierId: string }[]>`
      INSERT INTO "DeletionBarrier" ("teamId", "barrierId", "state", "expiresAt")
      VALUES (${teamId}::text, ${barrierId}::text, 'ACQUIRING', ${expiresAt})
      ON CONFLICT ("teamId") DO UPDATE SET "barrierId" = ${barrierId}::text, "state" = 'ACQUIRING', "expiresAt" = ${expiresAt}
      WHERE "DeletionBarrier"."state" = 'FAILED' OR "DeletionBarrier"."expiresAt" < now()
      RETURNING "barrierId"`;
    if (rows.length === 0) return { ok: false, reason: 'lost-race' };
    return { ok: true, barrierId, expiresAt };
  }

  /** ③''ACQUIRING→ACTIVE（appendBatch 面封——barrierId 自校验+expiresAt 门，0 行=过期/被接管）。 */
  async activate(teamId: string, barrierId: string): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      UPDATE "DeletionBarrier" SET "state" = 'ACTIVE'
      WHERE "teamId" = ${teamId}::text AND "barrierId" = ${barrierId}::text
        AND "state" = 'ACQUIRING' AND "expiresAt" > now()`;
    return n === 1;
  }

  /** ⑥释放：删行（barrierId 守卫——stale release 零行）+解封+gauge 置值。 */
  async release(teamId: string, barrierId: string): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      DELETE FROM "DeletionBarrier" WHERE "teamId" = ${teamId}::text AND "barrierId" = ${barrierId}::text`;
    const seal = unsealAdmission(teamId, barrierId);
    if (seal) deletionBarrierActiveSeconds.set(seal.heldSeconds);
    return n === 1;
  }

  /** 编排入口（六步序 ①-④+⑥前置持有——⑤删除本体=调用方在返回↔release 窗内执行）。 */
  async prepare(teamId: string, opts: { excludeProjectId?: string; budgetMs?: number; perProjectFlushBudgetMs?: number } = {}): Promise<DeletionBarrierPrepareResult> {
    const t0 = Date.now();
    const budgetMs = opts.budgetMs ?? DELETION_BARRIER_BUDGET_MS;
    const perProjectMs = opts.perProjectFlushBudgetMs ?? DELETION_BARRIER_PROJECT_FLUSH_BUDGET_MS;
    // ①oracle 扫描在 barrier 前（低频可长——不占 fence 时长；复用判定在 scanProject 内）
    const pids = await this.teamProjectIds(teamId, opts.excludeProjectId);
    for (const pid of pids) await this.oracleScan.scanProject(pid).catch((e) => this.logger.warn(`pre-scan ${pid}: ${(e as Error).message}`));
    // ②CAS acquire+seal（gateway admission 自此封——无新 admitted 帧）
    const acq = await this.acquire(teamId, { budgetMs });
    if (!acq.ok) return { outcome: 'bail-out', reason: 'lost-race' };
    sealAdmission(teamId, acq.barrierId, pids, acq.expiresAt.getTime());
    try {
      // ③flushThrough 至 appliedSeq==pgSeq（ACQUIRING=flush 窗；逐项目预算，总预算余量收口）
      for (const pid of pids) {
        const remain = Math.min(perProjectMs, budgetMs - (Date.now() - t0));
        if (remain <= 0 || !(await this.flushProjectConverged(pid, remain))) {
          return await this.bailOut(teamId, acq.barrierId, 'flush-timeout');
        }
      }
      // ③'陈旧 header 重扫（flush 落定移动 pgSeq 的项目——常态零项）——ACTIVE 前完成=删除窗最小化
      for (const pid of pids) await this.oracleScan.scanProject(pid).catch((e) => this.logger.warn(`rescan ${pid}: ${(e as Error).message}`));
      // ③''ACTIVATE：appendBatch 面封——决策宇宙冻结（activate 自带 expiresAt>now 门——过期/被接管 0 行）
      if (!(await this.activate(teamId, acq.barrierId))) {
        return await this.bailOut(teamId, acq.barrierId, 'barrier-expired');
      }
      // ④decision snapshot 五步序（C3b-3——决策级校验链+扫描后 CAS 复读；任一不满足 bail-out）
      if (this.snapshotGate) await this.snapshotGate();   // P1-2 测试缝：④ 前注入慢 snapshot 形态（生产恒 undefined）
      const snap = await this.mediaRef.decideTeamReferenceSnapshot(teamId, { excludeProjectId: opts.excludeProjectId });
      if (snap.outcome !== 'verified') {
        return await this.bailOut(teamId, acq.barrierId, snap.reason);
      }
      // C3b-4a spec 评审 P1-2（spec :79「超时整体 bail-out」全程性）：返回 verified 前全程预算复检——
      // ③'重扫+④snapshot 段无 deadline 检查时，flush 快+大 team 快照慢可在 expiresAt 过后返回 verified
      //（activate 时未过期≠返回时未过期）⇒ seal 惰性过期+appendBatch expiresAt 门放行=围栏已漏而调用
      // 方以为持有。过期即整体释放 bail-out（与 activate 同 reason——「持有已失效」单一语义档）。
      if (Date.now() >= acq.expiresAt.getTime()) {
        return await this.bailOut(teamId, acq.barrierId, 'barrier-expired');
      }
      return { outcome: 'verified', barrierId: acq.barrierId, projects: snap.projects };
    } catch (err) {
      this.logger.warn(`prepare ${teamId} 异常 bail-out: ${(err as Error).message}`);
      return await this.bailOut(teamId, acq.barrierId, 'scan-failed');
    }
  }

  /** bail-out 单点：释放（删行+解封+gauge）+typed reason 上抛。 */
  private async bailOut(teamId: string, barrierId: string, reason: DeletionBarrierBailOutReason): Promise<DeletionBarrierPrepareResult> {
    await this.release(teamId, barrierId);
    return { outcome: 'bail-out', reason };
  }

  /** ③收敛判定：flushThrough(target=appliedSeq) 落定（pgSeq≥applied 即达——pgSeq 可**超前** applied：
   *  repo 直供/replayAll catch-up 落定的行非本 actor applied 前缀，等值断言会把该形态误判不收敛）
   *  ∧ appliedSeq 复读稳定（两次一致=无新 apply 在途——admission 已封下 appliedSeq 单调收敛，
   *  稳定复读=收敛充分判据）。 */
  private async flushProjectConverged(pid: string, budgetMs: number): Promise<boolean> {
    const deadline = Date.now() + Math.max(1, budgetMs);
    for (;;) {
      const applied = this.actor.appliedSeqOf(pid);
      const r = await this.actor.flushThrough(pid, applied, { maxWaitMs: Math.max(1, deadline - Date.now()) });
      if (r.targetReached && r.pgSeq >= applied && this.actor.appliedSeqOf(pid) === applied) return true;
      if (Date.now() >= deadline) return false;
    }
  }

  /** team 项目集（runWithIncludeDeleted——GC/erasure 全计入含 DELETING；exclude=erasure 被擦项目）。 */
  private async teamProjectIds(teamId: string, excludeProjectId?: string): Promise<string[]> {
    const projects = await runWithIncludeDeleted(() =>
      this.prisma.canvasProject.findMany({ where: { teamId }, select: { id: true } }));
    return projects.map((p) => p.id).filter((id) => id !== excludeProjectId).sort();
  }
}
