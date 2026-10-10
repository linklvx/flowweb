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
import { intentDeadlineExceededTotal, execProjectionDeferredTotal } from './exec.metrics';

/** RUNNING 孤儿判龄阈值（档一）——claim/rearm/外呼心跳都刷新 heartbeatAt，超龄即进程/调度异常嫌疑
 *  （Y0b-2 T4 判据单源：updatedAt→heartbeatAt——外呼 tick 不刷 updatedAt，旧判据会误收长任务）。 */
const STALE_MS = 15 * 60_000;
/** Y0b-2 T5（Z102）：settleStranded 判龄宽限（具名常量）——正常链 complete→settle 秒级完成，
 *  超宽限仍冻结=崩溃窗悬留（"无活 worker 持有"的结构证明=rollbackStranded 判龄安全要件）。 */
export const SETTLE_STRANDED_GRACE_MS = 10 * 60_000;
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
 *       ②已扣无产物 → rollbackRunning 单事务冲销（Y0b-2 T5/Z92：CAS 严格 RUNNING+判龄 heartbeatAt
 *         保持；两金额归零+按流水行分义冲销 settle→refund/reserve→release——refund 落行即回落
 *         monthlyUsed〔已派生〕无列回滚写点；count===0 ⇒ 已处理/并发已抢幂等）+终态投影分治
 *         （Z106/Z112——errorCode 两码分诊）
 *       ③未扣 → VOIDED 免费放行（守卫同款）
 *
 *  档二【全量三方对账，每日】：SUCCEEDED 行 creditsConsumed vs 消费流水数额差异 →
 *        reconcileMismatchTotal+WARN（资损前兆；批 7 接 collabDiagnostics）；终态 7 天清理；
 *        exec map 孤儿条目清理（F2 GC）；video-separate 陈旧任务对账+并发额度归还
 *        （自 video-separate.cron.ts 搬入——原 @Cron 死代码从未运行，该功能不被档一覆盖：
 *         VideoSeparateTask 表+Redis 计数器非意图表/积分域，故整体搬入本档保底）。
 *
 *  档一附属【资金闭环巡检，随 5min 同轮】（Y0b-1 §1.5）：settle 失败对账第四分支 settleStranded
 *        （Y0b-2 T5 收窄〔Z76/Z98/Z102〕：判据=TERMINAL∧reservedCredits>0∧判龄 SETTLE_STRANDED_GRACE_MS；
 *         三分支表——SUCCEEDED∧产物在⇒补 settle/SUCCEEDED∧无产物⇒rollbackStranded/FAILED|VOIDED⇒void_；
 *         产物探测走 ArtifactProbe 事务外+按 projectId 记忆化；consumed>0∧reserved=0 历史成功单永不进）
 *        + Z11 未闭合义务巡检 releaseOrphanedReserves（意图行灭失的孤儿 reserve——releaseOrphanReserve
 *        窄口幂等释放；意图行存在的一切情形归第四分支独占，E53）。
 *  档二附属【运行时不变量巡检】verifyLedgerInvariants：①池余额≡ΣbalanceDelta（两池分列+LEFT JOIN——
 *        检出"有钱包零流水"）②RUNNING ΣfrozenDelta≡reservedCredits ③ACTIVE 团队钱包在场
 *        ③'（Z102）VOIDED∧creditsConsumed>0∧无 refund 行=台账漂移 ④（Z102）FAILED/VOIDED⇒reservedCredits=0——
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
            return this.threeCheck(row, row.deadlineAt, 'INTENT_DEADLINE_EXCEEDED');
          }
          // failed → 三查裁决（同 stale 批 A 路径尾段；job 不存在同落）
        }
      }
    }
    // phase 分诊（Z83）：startedAt 非空=外呼期（call）/空=排队期（queue——claim 后未外呼即超时=调度积压信号）
    intentDeadlineExceededTotal.inc({ kind: row.kind, phase: row.startedAt ? 'call' : 'queue' });
    return this.threeCheck(row, row.deadlineAt, 'INTENT_DEADLINE_EXCEEDED');
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
    return this.threeCheck(row, cutoff, 'INTENT_STALE_REAPED');
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

  /** 三查裁决（批0.5-9 两阶段口径：isCharged=流水存在 reserve/settle 任一）。
   *  Y0b-2 T5（Z92/Z75）：②退款/解冻两腿收敛 rollbackRunning 单入口（CAS 严格 RUNNING+判龄 heartbeatAt
   *  保持——按流水分义冲销 settle→refund/reserve→release 在 doRollback 内完成；Z92 竞态封死=complete
   *  先行〔SUCCEEDED〕后迟归 reaper 在此零命中）；成功后终态投影分治（Z106/Z112——projectReaped）。
   *  Y0b-1（F1/Z6）：chargeRows anti-join（未被冲销行）+台账锚 intentRowId（禁 intentId）+
   *  teamId 过滤（F1 跨团队隔离）；row.teamId null 时空串=零命中兜底。
   *  errorCode 两码分诊（Z112）：deadline 批=INTENT_DEADLINE_EXCEEDED（provider p99 越界）/
   *  心跳 stale 批=INTENT_STALE_REAPED（进程/调度异常）——runbook 处置行分列。 */
  private async threeCheck(row: GenerationIntent, cutoff: Date, errorCode: 'INTENT_DEADLINE_EXCEEDED' | 'INTENT_STALE_REAPED'): Promise<void> {
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
      // ②已扣（settle/reserve 任一未冲销）→ rollbackRunning 单事务冲销（两金额归零+按行分义 refund/release）
      const rolled = await this.teamCredit.rollbackRunning(row.id, `reaper 收敛（${errorCode}）`, cutoff);
      if (rolled) {
        const total = chargeRows.reduce((s, r) => s + Math.abs(r.amount), 0);
        this.logger.warn(`[intent-reconcile] 意图 ${row.intentId} 已扣无产物（${errorCode}）——VOIDED+冲销 ${total}（两金额归零，重试照常扣费）`);
        await this.projectReaped(row, errorCode);
      }
      return;
    }
    // ③未扣 → VOIDED 免费放行（creditsConsumed 本就 0；守卫同款防 rearm 竞态——Y0b-2 T4 判据 heartbeatAt）
    await this.prisma.generationIntent.updateMany({
      where: { id: row.id, status: 'RUNNING', heartbeatAt: { lt: cutoff } },
      data: { status: 'VOIDED', creditsConsumed: 0, completedAt: new Date() },
    });
    this.logger.warn(`[intent-reconcile] 意图 ${row.intentId} 未扣超龄——VOIDED 免费放行`);
  }

  /** Y0b-2 T5（Z106/Z112）：reaper 终态投影分治——UX 投影不得成为装载源：doc 常驻（documents.has）
   *  才写 error 投影（errorCode+rearmable+attempts 同 patch——Z99 代次化后可写）；非常驻跳过+
   *  exec_projection_deferred_total 计数（用户重连时 alignExecFromIntents 对齐——T6 职责）。
   *  drain 503 best-effort 记 warn（不因投影失败回滚资金）。 */
  private async projectReaped(row: GenerationIntent, errorCode: 'INTENT_DEADLINE_EXCEEDED' | 'INTENT_STALE_REAPED'): Promise<void> {
    try {
      if (!this.collabDoc.isDocResident(row.projectId)) {
        execProjectionDeferredTotal.inc();
        return;
      }
      await this.collabDoc.writeExecStatus(row.projectId, row.nodeId, {
        status: 'error',
        errorCode,
        error: errorCode === 'INTENT_DEADLINE_EXCEEDED' ? '生成超时已被系统回收' : '生成心跳失联已被系统回收（进程/调度异常）',
        rearmable: row.attempts < 3,
        attempts: row.attempts,
      });
    } catch (e) {
      this.logger.warn(`[reaper-projection] 意图 ${row.intentId} 投影失败（drain/租约 503 best-effort——不回滚资金）: ${(e as Error).message}`);
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

  /** Y0b-1（§1.5/E25①/Z17）第四分支 + Y0b-2 T5 收窄（Z76/Z98/Z102 三分支表）：
   *  判据=TERMINAL ∧ reservedCredits>0 ∧ completedAt<now-SETTLE_STRANDED_GRACE_MS（具名常量——
   *  "无活 worker 持有"的结构证明；consumed>0∧reservedCredits=0 历史成功单永不进本分支=Z76 套利防回归）。
   *  三分支：SUCCEEDED∧有产物 ⇒ 补 settle（产物已交付账补齐）/ SUCCEEDED∧无产物 ⇒ rollbackStranded
   *  （Z102 第三入口——旧实现恒补 settle=无产物也核销的白扣洞）/ FAILED|VOIDED ⇒ void_（else 兜底保留）。
   *  产物探测=ArtifactProbe（Z98 端口反转：探针在 collab 侧，本文件零 readCanvas）——事务外先探后开事务
   *  （锁内不做慢 IO）+按 projectId 记忆化（take:100 行防 100 次直连）；探针失败（503/超时/未知）=本轮
   *  跳过该行**永不把"不知道"当"无产物"**；未知 kind 不裁决只计数告警；探针结果可能过期——CAS 才是权威
   *  （rollbackStranded 的 status/reservedCredits/completedAt 三重 CAS 在事务内重验）。逐行容错：
   *  毒行不冻结整轮（次轮重试）。 */
  private async settleStranded(): Promise<void> {
    const cutoff = new Date(Date.now() - SETTLE_STRANDED_GRACE_MS);
    const stranded = await this.prisma.generationIntent.findMany({
      where: { status: { in: [...TERMINAL] }, reservedCredits: { gt: 0 }, completedAt: { lt: cutoff } },
      orderBy: { completedAt: 'asc' },
      take: 100,   // 空预算：每轮 5min 最多 100 行（探针条数同界——Z112 有界装载）
    });
    // ArtifactProbe 事实收集（事务外）：SUCCEEDED 行按 projectId 记忆化批探测（一项目一装载）
    const artifact = new Map<string, boolean | null>();   // intentRowId → true/false=doc 事实；null=不裁决（探针失败/未知 kind）
    const byProject = new Map<string, GenerationIntent[]>();
    for (const row of stranded) {
      if (row.status !== 'SUCCEEDED') continue;
      const arr = byProject.get(row.projectId) ?? [];
      arr.push(row);
      byProject.set(row.projectId, arr);
    }
    for (const [projectId, rows] of byProject) {
      try {
        const facts = await this.collabDoc.probeArtifacts(projectId, rows.map((r) => ({ nodeId: r.nodeId, kind: r.kind })));
        // 按索引关联（probeArtifacts 保序）：同项目同 nodeId 多行悬留时 find(nodeId) 会把事实全落第一行
        // ——第二行误判"不可裁决"多等一轮（T5 审查 Minor#2）。
        for (let i = 0; i < facts.length; i++) {
          const row = rows[i];
          const f = facts[i];
          if (row) artifact.set(row.id, f.unknownKind ? null : f.found);
          if (f.unknownKind) this.logger.warn(`[intent-reconcile] 悬留 意图 kind=${f.kind} 不在产物键白名单——不裁决只计数`);
        }
      } catch (e) {
        this.logger.warn(`[intent-reconcile] 产物探针失败 project=${projectId}——本轮跳过 ${rows.length} 行（不知道≠无产物）: ${(e as Error).message}`);
      }
    }
    for (const row of stranded) {
      try {
        if (row.status === 'SUCCEEDED') {
          const found = artifact.get(row.id);
          if (found !== true && found !== false) {
            this.logger.warn(`[intent-reconcile] 悬留 意图 ${row.intentId} 产物不可裁决（探针失败/未知 kind）——本轮跳过`);
            continue;
          }
          if (found) {
            const r = await this.teamCredit.settle({ intentRowId: row.id });
            if (!r.success) this.logger.warn(`[intent-reconcile] 悬留补 settle 失败 意图 ${row.intentId}（次轮重试）`);
          } else {
            const rolled = await this.teamCredit.rollbackStranded(row.id, '悬留无产物回滚（settle 失败崩溃窗）', cutoff);
            if (rolled) this.logger.warn(`[intent-reconcile] 悬留无产物 意图 ${row.intentId}——rollbackStranded（release ${row.reservedCredits}，两金额归零）`);
          }
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
   *  四轮 B1：LEFT JOIN+COALESCE+两池分列——INNER JOIN 检不出"有钱包有余额但零流水"。
   *  Y0b-2 T5（Z102）：③' VOIDED∧creditsConsumed>0∧无 refund 行=退款链断裂漂移；④ FAILED/VOIDED⇒
   *  reservedCredits=0（"泛 TERMINAL"口子的结构性保险——命中=settleStranded 闭环失效信号）。
   *  不变量① ORDER BY 1（原 ORDER BY b."teamId" 在 UNION 结果集上引用失效别名——T5 红测暴露的既有缺陷）。 */
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
      ORDER BY 1 LIMIT 20`;   // ORDER BY=确定子集（与孤儿扫描同纪律——告警面稳定；UNION 臂按序号引用）
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
    // 不变量③'（Z102）：VOIDED∧creditsConsumed>0∧无 refund 行——正规回滚必写 refund 且归零 consumed
    const drift3 = await this.prisma.$queryRaw<{ id: string; teamId: string }[]>`
      SELECT gi.id, gi."teamId" FROM "GenerationIntent" gi
      WHERE gi.status = 'VOIDED' AND gi."creditsConsumed" > 0
        AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" t
                        WHERE t."referenceId" = 'intent:' || gi.id AND t.type = 'refund')
      ORDER BY gi.id LIMIT 20`;
    for (const d of drift3) { balanceDriftTotal.inc(); this.logger.warn(`[ledger-drift] 不变量③'漂移 intent=${d.id} teamId=${d.teamId}（VOIDED 已扣无 refund 行——退款链断裂）`); }
    // 不变量④（Z102）：FAILED/VOIDED ⇒ reservedCredits=0（settleStranded 闭环失效信号）
    const drift4 = await this.prisma.$queryRaw<{ id: string; teamId: string }[]>`
      SELECT gi.id, gi."teamId" FROM "GenerationIntent" gi
      WHERE gi.status IN ('FAILED', 'VOIDED') AND gi."reservedCredits" > 0
      ORDER BY gi.id LIMIT 20`;
    for (const d of drift4) { frozenDriftTotal.inc(); this.logger.warn(`[ledger-drift] 不变量④漂移 intent=${d.id} teamId=${d.teamId}（FAILED/VOIDED 冻结未清——第四分支失效）`); }
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
