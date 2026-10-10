import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue, Job } from 'bullmq';
import type { GenerationIntent } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { TeamCreditService } from '../team/team-credit.service';
import { EXECUTION_QUEUE_NAME } from './execution.constants';
import { AI_IMAGE_EDIT_QUEUE_NAME } from '../ai-image-edit/ai-image-edit.constants';
import {
  reconcileMismatchTotal, strandedTotal, balanceDriftTotal, frozenDriftTotal,
  orphanReleaseTotal, orphanUnreleasableTotal,
} from './intent-reconcile.metrics';
import { intentDeadlineExceededTotal } from './exec.metrics';

/** RUNNING 孤儿判龄阈值（档一）——claim/rearm/外呼心跳都刷新 heartbeatAt，超龄即进程/调度异常嫌疑
 *  （Y0b-2 T4 判据单源：updatedAt→heartbeatAt——外呼 tick 不刷 updatedAt，旧判据会误收长任务）。 */
const STALE_MS = 15 * 60_000;
/** Z84 waiting/delayed 升级宽限——deadline 到点后 job 仍 waiting 的宽限窗（迟归 job 仍可被调度；
 *  超窗即升级收敛：VOID+release，迟归 job 进 processor 时行已终态 ⇒ claim④ rearm 自愈）。 */
const WAITING_UPGRADE_GRACE_MS = 30 * 60_000;
/** 终态保留期（F1 保留策略）——SUCCEEDED/FAILED/VOIDED 行 7 天后清理 */
const RETENTION_MS = 7 * 24 * 3600_000;
const TERMINAL = ['SUCCEEDED', 'FAILED', 'VOIDED'] as const;

/** 意图表对账与回收（F12 每日全量 + F13 活跃核验 5min）——R28 纪律：原生 setInterval+unref
 *  （@Cron 是死代码：ScheduleModule 全仓未导入）。
 *
 *  档一【活跃核验，每 5min】= deadline 批 + 心跳 stale 批（Y0b-2 T4 双批）：
 *
 *  批〇【deadline 批，先跑】RUNNING ∧ deadlineAt<now ∧ heartbeatAt<deadlineAt（心跳先于 deadline 停=外呼死）：
 *    A. 心跳新于 deadline（heartbeatAt>=deadlineAt）⇒ 轮询活着（onTick 每 tick 刷心跳）——不误杀；
 *    B. jobId 行查 BullMQ 真实状态（A 路径禁绕过）：active ⇒ 长任务在跑零动作；
 *       waiting/delayed 超宽限（deadline+WAITING_UPGRADE_GRACE_MS）⇒ Z84 升级档 VOID+release
 *       （worker 死亡 job 滞留 waiting=冻结永久悬挂；本次升级 attempts 不递增——非用户发起重试）；
 *       completed ⇒ 回填 SUCCEEDED；failed/不存在 ⇒ 三查；
 *    C. phase 分诊（Z83）：startedAt 非空=call（外呼期超时）/空=queue（排队期超时——调度积压信号），
 *       intent_deadline_exceeded_total{kind,phase} 计数；收敛走既有 threeCheck（cutoff=行自身 deadline——
 *       CAS 判龄守卫=心跳先于 deadline，并发心跳刷新即 CAS 失败幂等）。
 *
 *  批一【心跳 stale 批】heartbeatAt 超龄 15min（进程/调度异常——正常外呼有 onTick 心跳+deadline 批先收；
 *        partial unique 使同节点新意图被 RUNNING 孤儿 409 锁死——本档把锁死窗口从 24h 压到 ≤15min；
 *        Y0b-2 squash 已删 @@index([status, updatedAt])——判据切换后由 running_heartbeat/running_deadline
 *        两 partial 接管扫描）：
 *    A. 有 jobId → 按 kind 路由到所属队列查 BullMQ 真实状态（禁"job 不存在即判死"——removeOnComplete 清理歧义）：
 *       completed → 按产物回填 SUCCEEDED；failed/不存在 → 走 B 三查；
 *       active/waiting/delayed → 长任务合法在飞（意图行心跳不随外呼刷新时由 deadline 批兜底），零动作
 *    B. 三查（age 一律取 heartbeatAt；批0.5-9 两阶段口径 isCharged=流水存在 reserve/settle 任一）：
 *       ①已扣 && resultRef 非空 → SUCCEEDED 回填
 *       ②已扣无产物 → 按冻结态分义（批0.5-9）：
 *         已 settle/consume（终态账）→ 退款事务（四写单 $transaction：守卫 CAS 二次判龄+归零 → 两池拆分
 *           逆向记账（type=refund，读流水行各自拆分——禁拿 creditsConsumed 单值猜）；
 *           Y0b-2 T0：monthlyUsed 已派生——refund 落行即回落，无列回滚写点）；
 *           count===0 ⇒ 已处理/并发已抢（幂等，崩溃重扫不双退）
 *         reserve-only（冻结轨迹）→ 解冻事务（unfreeze：同款守卫 CAS+reservedCredits 归零+两池加回+
 *           反向 reserve 流水——约束②禁 refund 正向记账防双倍回滚）
 *       ③未扣 → VOIDED 免费放行（守卫同款）
 *
 *  档二【全量三方对账，每日】：SUCCEEDED 行 creditsConsumed vs 消费流水数额差异 →
 *        reconcileMismatchTotal+WARN（资损前兆；批 7 接 collabDiagnostics）；终态 7 天清理；
 *        exec map 孤儿条目清理（F2 GC）；video-separate 陈旧任务对账+并发额度归还
 *        （自 video-separate.cron.ts 搬入——原 @Cron 死代码从未运行，该功能不被档一覆盖：
 *         VideoSeparateTask 表+Redis 计数器非意图表/积分域，故整体搬入本档保底）。
 *
 *  档一附属【资金闭环巡检，随 5min 同轮】（Y0b-1 §1.5）：settle 失败对账第四分支 settleStranded
 *        （终态∧reservedCredits>0 悬留——判据=status：SUCCEEDED 补 settle/FAILED release；逐行容错）
 *        + Z11 未闭合义务巡检 releaseOrphanedReserves（意图行灭失的孤儿 reserve——releaseOrphanReserve
 *        窄口幂等释放；意图行存在的一切情形归第四分支独占，E53）。
 *  档二附属【运行时不变量巡检】verifyLedgerInvariants：①池余额≡ΣbalanceDelta（两池分列+LEFT JOIN——
 *        检出"有钱包零流水"）②RUNNING ΣfrozenDelta≡reservedCredits ③ACTIVE 团队钱包在场——
 *        命中即 drift 指标+WARN（台账为真源，钱包可据 Σ 重建）。 */
@Injectable()
export class IntentReconcileService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(IntentReconcileService.name);
  private timers: ReturnType<typeof setInterval>[] = [];
  private verifyActiveRunning = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
    @Inject(CreditLedgerService) private readonly ledger: CreditLedgerService,
    @InjectQueue(EXECUTION_QUEUE_NAME) private readonly executionQueue: Queue,
    @InjectQueue(AI_IMAGE_EDIT_QUEUE_NAME) private readonly imageEditQueue: Queue,
    @Inject('REDIS_CLIENT') private readonly redis: any,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
  ) {}

  onModuleInit() {
    void this.verifyActive().catch((e) => this.logger.warn(`startup scan: ${e}`)); // 启动全量扫（覆盖"部署杀在飞任务"）
    // 在飞守卫（T5 质量审 I-1）：第四分支+孤儿释放并入后单轮最坏可达分钟级≫5min tick——
    // 无守卫叠轮会在同一批 TeamBalance 锁上自我放大竞争；幂等性本就由 CAS/reversesId 唯一保证，跳轮无损
    const t1 = setInterval(() => {
      if (this.verifyActiveRunning) return;
      this.verifyActiveRunning = true;
      void this.verifyActive()
        .catch((e) => this.logger.warn(`verifyActive: ${e}`))
        .finally(() => { this.verifyActiveRunning = false; });
    }, 5 * 60_000);
    const t2 = setInterval(() => void this.reconcileDaily().catch((e) => this.logger.warn(`reconcileDaily: ${e}`)), 24 * 3600_000);
    for (const t of [t1, t2]) t.unref?.();
    this.timers = [t1, t2];
  }

  onApplicationShutdown() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /** 档一：deadline 批+心跳 stale 批回收 RUNNING（单条失败不阻塞整批——毒行不冻结全表扫描）
   *  + 资金闭环巡检同轮（第四分支 settleStranded → Z11 孤儿释放 releaseOrphanedReserves——
   *  顺序固定：先意图侧清账再台账侧孤儿） */
  async verifyActive(): Promise<void> {
    // ── 批〇 deadline 批（Y0b-2 T4/Z68/Z83/Z84）——先跑（行收敛终态后 stale 批不再命中同轮重复处理）
    const now = new Date();
    const overdue = await this.prisma.generationIntent.findMany({
      where: { status: 'RUNNING', deadlineAt: { lt: now } },
    });
    for (const row of overdue) {
      try {
        await this.reapDeadline(row, now);
      } catch (e) {
        this.logger.warn(`deadline-reaper 意图 ${row.intentId} 失败: ${(e as Error).message}`);
      }
    }
    // ── 批一 心跳 stale 批（heartbeatAt 超龄=进程/调度异常——T5 的 rollbackRunning 接管收敛）
    const cutoff = new Date(Date.now() - STALE_MS);
    const stale = await this.prisma.generationIntent.findMany({
      where: { status: 'RUNNING', heartbeatAt: { lt: cutoff } },
    });
    for (const row of stale) {
      try {
        await this.reconcileIntent(row, cutoff);
      } catch (e) {
        this.logger.warn(`reconcile 意图 ${row.intentId} 失败: ${(e as Error).message}`);
      }
    }
    await this.settleStranded();
    await this.releaseOrphanedReserves();
  }

  /** 批〇单行：deadline 到点的 RUNNING 收敛（threeCheck 复用——cutoff=行自身 deadline：
   *  判龄守卫语义=心跳先于 deadline 停，外呼死才收敛；并发心跳刷新 ⇒ CAS 失败幂等）。 */
  private async reapDeadline(row: GenerationIntent, now: Date): Promise<void> {
    if (row.heartbeatAt.getTime() >= row.deadlineAt.getTime()) return; // 轮询活着（onTick 刷心跳）——不误杀
    if (row.jobId) {
      const queue = this.queueForKind(row.kind);
      if (!queue) {
        this.logger.warn(`[deadline-reaper] 意图 ${row.intentId} kind=${row.kind} 不在 A 路径路由表——落三查裁决`);
      } else {
        const job = await queue.getJob(row.jobId);
        if (job) {
          const state = await job.getState();
          if (state === 'completed') return this.backfillSucceeded(row, job);
          if (state === 'active') return; // 长任务在跑——A 路径禁绕过（防误杀）
          if (state === 'waiting' || state === 'delayed') {
            // Z84 升级档：超宽限期才收敛（宽限内迟归 job 仍可被调度——A 路径禁绕过）。
            // 本次升级 attempts 不递增（非用户发起重试——runbook 处置行注明，更新归 T9）
            if (now.getTime() <= row.deadlineAt.getTime() + WAITING_UPGRADE_GRACE_MS) return;
            intentDeadlineExceededTotal.inc({ kind: row.kind, phase: 'waiting' });
            this.logger.warn(`[deadline-reaper] 意图 ${row.intentId} job=${row.jobId} waiting/delayed 超宽限 ${WAITING_UPGRADE_GRACE_MS}ms——升级收敛（迟归 job 走 claim④ rearm 自愈）`);
            return this.threeCheck(row, row.deadlineAt);
          }
          // failed → 三查裁决（同 stale 批 A 路径尾段；job 不存在同落）
        }
      }
    }
    // phase 分诊（Z83）：startedAt 非空=外呼期（call）/空=排队期（queue——claim 后未外呼即超时=调度积压信号）
    intentDeadlineExceededTotal.inc({ kind: row.kind, phase: row.startedAt ? 'call' : 'queue' });
    return this.threeCheck(row, row.deadlineAt);
  }

  /** A 路径 kind→队列路由（attachJob 盲区另一半）——jobId 属于哪个队列由 claim 发起链决定：
   *  text/video/image 走 execution 队列；outpaint/erase/redraw/lighting 走 ai-image-edit 队列
   *  （lighting 与三编辑同队列共 consumer——lighting.service.ts 同款注入）。查错队列 getJob 得
   *  null → 误落三查 → 20min lighting 长任务第 15min 被 VOIDED+退款（F13 要防的资损形态）。
   *  未知 kind 不猜队列：告警+直接落三查（三查退款有 CAS 判龄守卫、金额 correctness 优先；
   *  新 kind 接入意图表时须同步登记本路由表）。 */
  private queueForKind(kind: string): Queue | null {
    if (kind === 'text' || kind === 'video' || kind === 'image') return this.executionQueue;
    if (kind === 'outpaint' || kind === 'erase' || kind === 'redraw' || kind === 'lighting') return this.imageEditQueue;
    return null;
  }

  private async reconcileIntent(row: GenerationIntent, cutoff: Date): Promise<void> {
    if (row.jobId) {
      const queue = this.queueForKind(row.kind);
      if (!queue) {
        this.logger.warn(`[intent-reconcile] 意图 ${row.intentId} kind=${row.kind} 不在 A 路径路由表——落三查裁决`);
      } else {
        const job = await queue.getJob(row.jobId);
        if (job) {
          const state = await job.getState();
          if (state === 'completed') return this.backfillSucceeded(row, job);
          if (state !== 'failed') return; // active/waiting/delayed——长任务合法在飞，零动作
        }
        // failed 或 job 不存在（removeOnComplete 清理歧义）→ 三查裁决
      }
    }
    return this.threeCheck(row, cutoff);
  }

  /** A 路径 completed 回填：resultRef 从 returnvalue.results 取本节点条目（text 无 URL 锚点按
   *  complete() 同款 'text:' 前缀摘要占位）；ai-image-edit/lighting 产物形状 { status, fileId }
   *  无 results 数组——取 fileId；无锚点留 null+告警（产物完整性由调用方落地保证）。 */
  private async backfillSucceeded(row: GenerationIntent, job: Job<any, any>): Promise<void> {
    const rv = job.returnvalue as any;
    const entry = (rv?.results ?? []).find((r: any) => r?.nodeId === row.nodeId);
    const resultRef = entry
      ? String(entry.resultUrl ?? (entry.content != null ? `text:${String(entry.content).slice(0, 100)}` : '')) || null
      : typeof rv?.fileId === 'string'
        ? rv.fileId
        : null;
    if (!resultRef) this.logger.warn(`意图 ${row.intentId} job completed 但无产物锚点——resultRef 留空`);
    await this.prisma.generationIntent.updateMany({
      where: { id: row.id, status: 'RUNNING' },
      data: { status: 'SUCCEEDED', resultRef, completedAt: new Date() },
    });
  }

  /** 三查裁决（批0.5-9 两阶段口径：isCharged=流水存在 reserve/settle 任一；
   *  ②按冻结态分义——reserve-only → 解冻（unfreeze），已 settle → 退款（refund 正向记账））。
   *  Y0b-1（F1/Z6）：chargeRows 改 anti-join（未被冲销行）+台账锚 intentRowId（禁 intentId）+
   *  teamId 过滤（F1 跨团队隔离）；row.teamId null 时空串=零命中兜底。 */
  private async threeCheck(row: GenerationIntent, cutoff: Date): Promise<void> {
    const chargeRows = await this.prisma.$queryRaw<any[]>`
      SELECT r.* FROM "TeamCreditTransaction" r
      WHERE r."teamId" = ${row.teamId ?? ''} AND r."referenceId" = ${'intent:' + row.id}
        AND r.type IN ('reserve', 'settle') AND r.amount < 0
        AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)`;
    if (chargeRows.length > 0 && row.resultRef) {
      // ①已扣+产物在（判据=resultRef）→ SUCCEEDED 回填
      await this.prisma.generationIntent.updateMany({
        where: { id: row.id, status: 'RUNNING' },
        data: { status: 'SUCCEEDED', completedAt: new Date() },
      });
      return;
    }
    if (chargeRows.length > 0) {
      // ②分义：settle=终态账（无产物 → refund 正向记账）；
      // reserve-only=冻结轨迹（→ 解冻 release 冲销，禁 refund——约束②防双倍回滚）
      const finalRows = chargeRows.filter((r) => r.type === 'settle');
      if (finalRows.length > 0) return this.refund(row, cutoff);
      return this.unfreeze(row, chargeRows, cutoff);
    }
    // ③未扣 → VOIDED 免费放行（creditsConsumed 本就 0；守卫同款防 rearm 竞态——Y0b-2 T4 判据 heartbeatAt）
    await this.prisma.generationIntent.updateMany({
      where: { id: row.id, status: 'RUNNING', heartbeatAt: { lt: cutoff } },
      data: { status: 'VOIDED', creditsConsumed: 0, completedAt: new Date() },
    });
    this.logger.warn(`[intent-reconcile] 意图 ${row.intentId} 未扣超龄——VOIDED 免费放行`);
  }

  /** 三查② reserve-only 解冻事务——Y0b-1（Z13/Z6）：锁序①lockBalance 先于 intent CAS（原首句 CAS 是无序根源）；
   *  CAS 补 reservedCredits>0（rearm 二次退款窗口关闭）；冲销走 release（真值表 (+c,−c)+reversesId——
   *  约束②禁 refund 正向记账防双倍回滚；reversesId @unique=双释放结构拒绝）；quota 回滚 Σ|release 行|。 */
  private async unfreeze(row: GenerationIntent, reserveRows: any[], cutoff: Date): Promise<void> {
    const total = reserveRows.reduce((s, r) => s + Math.abs(r.amount), 0);
    const done = await this.prisma.$transaction(async (raw) => {
      const tx = await this.ledger.ledgerTx(raw);   // Z89：首句取通行证（lock_timeout+app.ledger_tx 双 SET LOCAL）
      await this.ledger.lockBalance(tx, row.teamId!);   // 锁序①（契约 20 全序——原首句 intent CAS 是无序根源）
      const guard = await tx.generationIntent.updateMany({
        where: { id: row.id, status: 'RUNNING', heartbeatAt: { lt: cutoff }, reservedCredits: { gt: 0 } },   // CAS 补 reservedCredits>0（Y0b-2 T4 判据 heartbeatAt）
        data: { status: 'VOIDED', reservedCredits: 0, completedAt: new Date() },
      });
      if (guard.count === 0) return false; // 已处理/并发已抢（幂等）
      for (const r of reserveRows) {
        const amt = Math.abs(r.amount); // reserve 流水 amount 为负——逆向取正
        await this.ledger.mutate(tx, {
          teamId: r.teamId, operatorUserId: row.userId, type: 'release', creditType: r.creditType,
          balanceDelta: amt, frozenDelta: -amt, referenceId: r.referenceId, reversesId: r.id,
        });
      }
      return true;
    }, { timeout: 15_000, maxWait: 5_000 });
    if (done) {
      this.logger.warn(`[intent-reconcile] 意图 ${row.intentId} reserve-only 无产物——VOIDED+解冻 ${total}（reservedCredits 归零，重试照常冻结）`);
    }
  }

  /** 三查②退款事务——Y0b-1（Z13/Z6）：锁序①+CAS 补 creditsConsumed>0 语义条件+事务内重读 settle 行
   *  （防 threeCheck 事务外旧读）；逐 settle 行 refund（(+c,0)+reversesId——reversesId @unique=双退结构拒绝）；
   *  creditsConsumed 归零=consume CAS 门修复——退款后重试照常扣费；quota 回滚 Σ|refund 行|。 */
  private async refund(row: GenerationIntent, cutoff: Date): Promise<void> {
    let total = 0;
    const refunded = await this.prisma.$transaction(async (raw) => {
      const tx = await this.ledger.ledgerTx(raw);   // Z89：首句取通行证（lock_timeout+app.ledger_tx 双 SET LOCAL）
      await this.ledger.lockBalance(tx, row.teamId!);   // 锁序①（契约 20 全序）
      const guard = await tx.generationIntent.updateMany({
        where: { id: row.id, status: 'RUNNING', heartbeatAt: { lt: cutoff }, creditsConsumed: { gt: 0 } },
        data: { status: 'VOIDED', creditsConsumed: 0, completedAt: new Date() },
      });
      if (guard.count === 0) return false; // 已处理/并发已抢（幂等）
      // 事务内重读（anti-join 未被冲销的 settle 行）
      const settleRows = await tx.$queryRaw<any[]>`
        SELECT r.* FROM "TeamCreditTransaction" r
        WHERE r."teamId" = ${row.teamId} AND r."referenceId" = ${'intent:' + row.id}
          AND r.type = 'settle' AND r.amount < 0
          AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)
        FOR UPDATE OF r`;
      for (const r of settleRows) {
        const amt = Math.abs(r.amount); // settle 流水 amount 为负——逆向取正
        total += amt;
        await this.ledger.mutate(tx, {
          teamId: r.teamId, operatorUserId: row.userId, type: 'refund', creditType: r.creditType,
          balanceDelta: amt, frozenDelta: 0, referenceId: r.referenceId, reversesId: r.id,
        });
      }
      return true;
    }, { timeout: 15_000, maxWait: 5_000 });
    if (refunded) {
      this.logger.warn(`[intent-reconcile] 意图 ${row.intentId} 已扣无产物——VOIDED+退款 ${total}（creditsConsumed 归零，重试照常扣费）`);
    }
  }

  /** 档二：每日全量三方对账 + 保留策略清理（F7 守卫） + exec GC（限量） + video-separate 陈旧回收 + 不变量巡检 */
  async reconcileDaily(): Promise<void> {
    // ① 三方对账：SUCCEEDED creditsConsumed vs 终态消费流水（批0.5-9：settle 计入，
    //    reserve 行是冻结轨迹不计——防 2 倍差异误报）；差异=资损前兆
    const succeeded = await this.prisma.generationIntent.findMany({
      where: { status: 'SUCCEEDED', creditsConsumed: { gt: 0 } },
      select: { id: true, intentId: true, creditsConsumed: true, teamId: true },
    });
    for (const r of succeeded) {
      const rows = await this.prisma.teamCreditTransaction.findMany({
        // 契约 4（F1 跨团队隔离）：台账查询自带键 teamId——intent 行固化 teamId 直传（Y0b-1 扫描锚⑥）
        // 台账锚=intentRowId（Y0b-1 ①锚切换：referenceId 写入端是 intent:<rowId>——禁 intentId 业务键）
        where: { teamId: r.teamId, referenceId: `intent:${r.id}`, type: { in: ['settle'] } },
      });
      const charged = rows.reduce((s, t) => s + Math.abs(t.amount), 0);
      if (charged !== r.creditsConsumed) {
        reconcileMismatchTotal.inc();
        this.logger.warn(`[资损前兆] 意图 ${r.intentId} creditsConsumed=${r.creditsConsumed} vs 流水=${charged}`);
      }
    }
    // ② 终态 7 天清理（F1 保留策略+F7 守卫：冻结未销禁删）
    await this.cleanTerminalIntents();
    // ③ exec map 孤儿清理（F2 GC——限量：每轮最多 10 个最新项目）
    await this.sweepOrphanExec();
    // ④ video-separate 陈旧任务对账+并发额度归还（自 video-separate.cron.ts 搬入，注记见类头）
    await this.reconcileStaleVideoSeparateTasks();
    // ⑤ 三不变量运行时巡检（Z11——drift 指标+WARN，台账为真源）
    await this.verifyLedgerInvariants();
  }

  /** F7（Y0b-1 §1.5）：终态保留清理——冻结未清的行禁删（stranded 计数告警）；第四分支清账后次轮自然可删。 */
  private async cleanTerminalIntents(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    const stuck = await this.prisma.generationIntent.count({
      where: { status: { in: [...TERMINAL] }, reservedCredits: { gt: 0 }, completedAt: { lt: cutoff } },
    });
    if (stuck > 0) strandedTotal.inc(stuck);
    await this.prisma.generationIntent.deleteMany({
      where: { status: { in: [...TERMINAL] }, reservedCredits: 0, completedAt: { lt: cutoff } },
    });
  }

  /** Y0b-1（§1.5/E25①/Z17）第四分支：终态∧reservedCredits>0 悬留行（settle 失败崩溃窗——三查只扫 RUNNING）。
   *  SUCCEEDED ⇒ 补 settle（幂等 CAS）；FAILED/VOIDED ⇒ release（void_ 既有幂等链）。产物已照发（E53），
   *  账由本分支闭环。逐行容错：毒行不冻结整轮（次轮重试）。 */
  private async settleStranded(): Promise<void> {
    const stranded = await this.prisma.generationIntent.findMany({
      where: { status: { in: [...TERMINAL] }, reservedCredits: { gt: 0 } },
      orderBy: { completedAt: 'asc' },
      take: 100,   // 空预算：每轮 5min 最多 100 行
    });
    for (const row of stranded) {
      try {
        if (row.status === 'SUCCEEDED') {
          const r = await this.teamCredit.settle({ intentRowId: row.id });
          if (!r.success) this.logger.warn(`[intent-reconcile] 悬留补 settle 失败 意图 ${row.intentId}（次轮重试）`);
        } else {
          await this.teamCredit.void_({ intentRowId: row.id });   // FAILED/VOIDED 残留冻结——release 归零
          this.logger.warn(`[intent-reconcile] 悬留未交付 意图 ${row.intentId}——release ${row.reservedCredits}`);
        }
      } catch (e) {
        this.logger.warn(`[intent-reconcile] settleStranded 单行失败 意图 ${row.intentId}: ${(e as Error).message}`);   // 毒行不冻结整轮
      }
    }
  }

  /** Y0b-1（Z11/Z25+四轮 Z38）：台账侧孤儿冻结——reserve 行未被冲销 ∧ **意图行真丢失**（gi.id IS NULL）∧ 超 15min
   *  ⇒ 经 releaseOrphanReserve 窄口（skipIntentCheck）幂等释放。
   *  四轮收窄：意图行**存在**的一切情形归 void_/settleStranded 全权处理（monthlyUsed 已派生〔Y0b-2 T0〕——窄口跳过=quota 永久占用的旧患随列退役消失）；
   *  孤儿=行已灭失（quota 无法归因——登记残余），窄口只为此类存在。
   *  钱包存在前置（解散后钱包已级联删——不可释放者计数排除，不每轮刷屏占 LIMIT 槽）。 */
  private async releaseOrphanedReserves(): Promise<number> {
    const orphans = await this.prisma.$queryRaw<{ id: string; teamId: string; creditType: string; amount: number; referenceId: string }[]>`
      SELECT r.id, r."teamId", r."creditType", r.amount, r."referenceId"
      FROM "TeamCreditTransaction" r
      LEFT JOIN "GenerationIntent" gi ON r."referenceId" = 'intent:' || gi.id
      WHERE r.type = 'reserve' AND r."referenceId" LIKE 'intent:%'
        AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)
        AND r."createdAt" < now() - interval '15 minutes'
        AND gi.id IS NULL   -- 四轮 Z38：意图行存在（任何 status）一律不在此释放
        AND EXISTS (SELECT 1 FROM "TeamBalance" b WHERE b."teamId" = r."teamId")
      ORDER BY r."createdAt"   -- 确定性（LIMIT 无 ORDER BY=不确定子集）
      LIMIT 100`;
    // 钱包已消失的未冲销 reserve 行（解散销毁）——每轮观测计数语义（T5 质量审 I-2 更正：这批行永不冲销，
    // 同一批每轮都会重复计入 counter——读法看 rate/突增而非累计值；龄过滤只是排除新近解散的暂态行）
    await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM "TeamCreditTransaction" r
      WHERE r.type = 'reserve' AND r."referenceId" LIKE 'intent:%'
        AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)
        AND NOT EXISTS (SELECT 1 FROM "TeamBalance" b WHERE b."teamId" = r."teamId")
        AND r."createdAt" < now() - interval '15 minutes'
      ORDER BY r."createdAt" LIMIT 50`.then((rows) => { if (rows.length) orphanUnreleasableTotal.inc(rows.length); });
    let released = 0;
    for (const r of orphans) {
      try {
        await this.prisma.$transaction(async (raw) => {
          const tx = await this.ledger.ledgerTx(raw);   // Z89：首句取通行证（lock_timeout+app.ledger_tx 双 SET LOCAL）
          await this.ledger.lockBalance(tx, r.teamId);
          await this.ledger.releaseOrphanReserve(tx, {
            teamId: r.teamId, creditType: r.creditType as any, referenceId: r.referenceId,
            reversesId: r.id, amount: r.amount,
          });
        }, { timeout: 15_000, maxWait: 5_000 });
        released++;
        orphanReleaseTotal.inc();
        this.logger.warn(`[intent-reconcile] 孤儿冻结释放 reserve=${r.id} ref=${r.referenceId}`);
      } catch (e) {
        this.logger.warn(`[intent-reconcile] 孤儿释放单行失败 ${r.id}: ${(e as Error).message}`);
      }
    }
    return released;
  }

  /** Y0b-1（Z11）：运行时不变量巡检——聚合 SQL 命中即 drift 指标+WARN（台账为真源，钱包可据 Σ 重建）。
   *  四轮 B1：LEFT JOIN+COALESCE+两池分列——INNER JOIN 检不出"有钱包有余额但零流水"。 */
  private async verifyLedgerInvariants(): Promise<void> {
    const drift1 = await this.prisma.$queryRaw<{ teamId: string }[]>`
      SELECT b."teamId" FROM "TeamBalance" b
      LEFT JOIN (SELECT "teamId", "creditType", SUM("balanceDelta") s FROM "TeamCreditTransaction" GROUP BY 1,2) t
        ON t."teamId" = b."teamId" AND t."creditType" = 'regular'
      WHERE COALESCE(t.s, 0) <> b.credits
      UNION
      SELECT b."teamId" FROM "TeamBalance" b
      LEFT JOIN (SELECT "teamId", "creditType", SUM("balanceDelta") s FROM "TeamCreditTransaction" GROUP BY 1,2) t
        ON t."teamId" = b."teamId" AND t."creditType" = 'subscription'
      WHERE COALESCE(t.s, 0) <> b."subscriptionCredits"
      ORDER BY b."teamId" LIMIT 20`;   // ORDER BY=确定子集（与孤儿扫描同纪律——告警面稳定）
    for (const d of drift1) { balanceDriftTotal.inc(); this.logger.warn(`[ledger-drift] 不变量①漂移 teamId=${d.teamId}`); }
    const drift2 = await this.prisma.$queryRaw<{ id: string; teamId: string }[]>`
      SELECT gi.id, gi."teamId" FROM "GenerationIntent" gi
      JOIN (SELECT "referenceId", SUM("frozenDelta") s FROM "TeamCreditTransaction" WHERE "referenceId" LIKE 'intent:%' GROUP BY 1) t
        ON t."referenceId" = 'intent:' || gi.id
      WHERE t.s <> gi."reservedCredits" AND gi.status = 'RUNNING' ORDER BY gi.id LIMIT 20`;
    for (const d of drift2) { frozenDriftTotal.inc(); this.logger.warn(`[ledger-drift] 不变量②漂移 intent=${d.id} teamId=${d.teamId}`); }
    // 钱包体检——ACTIVE 团队无钱包行=0（ensureBalance 收口后的回归检查）
    const noWallet = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT t.id FROM "Team" t LEFT JOIN "TeamBalance" b ON b."teamId" = t.id
      WHERE t.status = 'ACTIVE' AND b."teamId" IS NULL ORDER BY t.id LIMIT 20`;
    for (const d of noWallet) { balanceDriftTotal.inc(); this.logger.warn(`[ledger-drift] ACTIVE 团队无钱包 teamId=${d.id}（ensureBalance 缺收口）`); }
  }

  /** nodes map 无该 nodeId 的 exec 条目删除（transact 产生 delete set → 经 update 监听持久化/广播）
   *  Y0b-1 限量：orderBy updatedAt desc + take 10——每日全量扫全项目在 withDoc 逐个拿锁，量大时挤占 lease。 */
  private async sweepOrphanExec(): Promise<void> {
    const projects = await this.prisma.canvasProject.findMany({ select: { id: true }, orderBy: { updatedAt: 'desc' }, take: 10 });
    for (const p of projects) {
      try {
        await this.collabDoc.withDoc(p.id, (doc) => {
          const exec = doc.getMap('exec');
          const nodes = doc.getMap('nodes');
          const orphans = [...exec.keys()].filter((nodeId) => !nodes.has(nodeId));
          if (orphans.length) {
            doc.transact(() => {
              for (const id of orphans) exec.delete(id);
            });
            this.logger.warn(`[exec-GC] 项目 ${p.id} 清理孤儿 exec 条目 ${orphans.length} 个`);
          }
        });
      } catch (e) {
        this.logger.warn(`exec-GC 项目 ${p.id} 失败: ${(e as Error).message}`);
      }
    }
  }

  /** 陈旧 videoSeparateTask 判死 + Redis 并发计数器归还（DECR 前查存在防负数，负则重置 0） */
  private async reconcileStaleVideoSeparateTasks(): Promise<void> {
    const staleTasks = await this.prisma.videoSeparateTask.findMany({
      where: { status: { in: ['queued', 'processing'] }, createdAt: { lt: new Date(Date.now() - 3600_000) } },
      select: { id: true, userId: true },
    });
    for (const task of staleTasks) {
      try {
        await this.prisma.videoSeparateTask.update({
          where: { id: task.id },
          data: { status: 'error', errorMsg: '任务超时，系统自动取消', errorType: 'TASK_TIMEOUT', finishedAt: new Date() },
        });
        const counterKey = `user:video-separate:${task.userId}`;
        const exists = await this.redis.exists(counterKey);
        if (exists) {
          const newVal = await this.redis.decr(counterKey);
          if (newVal < 0) await this.redis.set(counterKey, '0', 'EX', 86400);
        }
        this.logger.warn(`Stale task ${task.id} auto-failed for user ${task.userId}`);
      } catch (e) {
        this.logger.error(`Failed to reconcile stale task ${task.id}: ${(e as Error).message}`);
      }
    }
  }
}
