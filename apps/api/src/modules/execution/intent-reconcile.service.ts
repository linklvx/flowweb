import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { GenerationIntent, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabWritePort } from '../collab/collab-write.port';
import { CollabDocWriterService } from '../collab/collab-doc-writer.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { TeamCreditService } from '../team/team-credit.service';
import { ArtifactCommitService } from '../artifact-core/artifact-commit.service';
import { isRetryableFinalizeError } from '../artifact-core/artifact-commit.service';
import { EXECUTION_QUEUE_NAME } from './execution.constants';
import { AI_IMAGE_EDIT_QUEUE_NAME } from '../ai-image-edit/ai-image-edit.constants';
import {
  reconcileMismatchTotal, strandedTotal, balanceDriftTotal, frozenDriftTotal,
  orphanReleaseTotal, orphanUnreleasableTotal,
  reconcileAutoConvergedTotal, reconcileManualRequiredTotal, reconcileInvariantViolation,
} from './intent-reconcile.metrics';
import { intentDeadlineExceededTotal, execProjectionDeferredTotal } from './exec.metrics';

/** RUNNING 孤儿判龄阈值（档一）——claim/rearm/外呼心跳都刷新 heartbeatAt，超龄即进程/调度异常嫌疑
 *  （Y0b-2 T4 判据单源：updatedAt→heartbeatAt——外呼 tick 不刷 updatedAt，旧判据会误收长任务）。 */
const STALE_MS = 15 * 60_000;
/** Y0b-2 T5（Z102）：终态悬留判龄宽限（具名常量）——正常链 complete→settle 秒级完成，
 *  超宽限仍冻结=崩溃窗悬留（"无活 worker 持有"的结构证明=rollbackStranded 判龄安全要件）。 */
export const SETTLE_STRANDED_GRACE_MS = 10 * 60_000;
/** Z84 waiting/delayed 升级宽限——deadline 到点后 job 仍 waiting 的宽限窗（迟归 job 仍可被调度；
 *  超窗即升级收敛：VOID+release，迟归 job 进 processor 时行已终态 ⇒ claim④ rearm 自愈）。 */
const WAITING_UPGRADE_GRACE_MS = 30 * 60_000;
/** 终态保留期（F1 保留策略）——SUCCEEDED/FAILED/VOIDED 行 7 天后清理；resultText 非空行 90 天
 *  （T13 保留矩阵——spec Z18''⑥：text 产物正文保留）。 */
const RETENTION_MS = 7 * 24 * 3600_000;
export const TEXT_RETENTION_MS = 90 * 24 * 3600_000;
/** T13 保留矩阵：ArtifactProjection 终态（projected=delivered 语义/orphaned/superseded/dead）30d；
 *  MediaFactOutbox published 7d（spec Z18''⑥）+dead-letter 告警。 */
export const PROJECTION_RETENTION_MS = 30 * 24 * 3600_000;
export const OUTBOX_RETENTION_MS = 7 * 24 * 3600_000;
/** Z56 每轮页宽 */
const SWEEP_PAGE = 100;
const TERMINAL = ['SUCCEEDED', 'FAILED', 'VOIDED'] as const;
/** T13 R3 护栏：每行有界尝试 3 次+jitter（spec Z18''⑥——毒行不冻结整轮）。 */
const R3_MAX_ATTEMPTS = 3;
const R3_JITTER_BASE_MS = 25;
/** T13 评审 Important#2：投影补建扫的锚龄窗——正常链投影行随 finalize 同事务落（缺行=竞态/崩溃窗，
 *  分钟级）；窗（=终态悬留判龄宽限同数量级 7d）外的「锚在无投影」=retention 30d 删投影行后的常态
 *  （int 行因锚守卫不删）——无龄守卫则 sweep↔retention 成复活循环（删→重建→审计/计数噪声+
 *  T15 后旧产物重写在档节点）。 */
export const PROJECTION_BACKFILL_MAX_AGE_MS = 7 * 24 * 3600_000;
/** T13 评审 Minor#5：窗② stage 重下的跨轮有界重试预算——下载/网络瞬态毒行机制（每轮 verifyActive
 *  一次尝试，预算耗尽 ⇒ 放弃重下走 charge 分支退款恰一次；禁单次瞬态失败永弃已付费产物）。 */
export const R3_STAGE_DOWNLOAD_MAX_ATTEMPTS = 3;
/** T13 评审 Minor#6：ReconcileAction 审计行保留（与 text 90d 对齐；dedupe 面下增长有界）。 */
export const RECONCILE_ACTION_RETENTION_MS = 90 * 24 * 3600_000;

/** 意图表对账与回收（F12 每日全量 + F13 活跃核验 5min）——R28 纪律：原生 setInterval+unref
 *  （@Cron 是死代码：ScheduleModule 全仓未导入）。
 *
 *  【T13 R3 重写（spec Z18''⑥ 裁决 :27④）——三后门已删，门禁式登记】：
 *   - backfillSucceeded（BullMQ completed→无条件置 SUCCEEDED+resultRef 回填——T12 P2-③：video
 *     URL 回填进 doc fileId 的谎言链）已删：其唯一合法场景（provider task completed 的 RUNNING
 *     收敛）由 R3 动作表「RUNNING∧stage 行在→finalize」承接——判据全量 PG，provider 不重调；
 *   - threeCheck resultRef 判族（①已扣+resultRef 非空→SUCCEEDED 回填——resultRef 非产物凭据）
 *     已删：剩余分支=已扣→rollbackRunning/未扣→VOIDED（charge 判定保留）；
 *   - settleStranded 的 doc 产物探测（probeArtifacts——「以 doc 探测为退款依据」违背 PG 权威）
 *     已删：终态悬留判定全量换 PG（NodeArtifact 锚行/Media stage 行/ArtifactProjection）。
 *   grep 三名零命中=门禁（本注释为登记面）。
 *
 *  档一【活跃核验，每 5min】= deadline 批 + 心跳 stale 批（Y0b-2 T4 双批）+ 终态悬留 R3 批：
 *
 *  批〇【deadline 批，先跑】RUNNING ∧ deadlineAt<now ∧ heartbeatAt<deadlineAt（心跳先于 deadline 停=外呼死）：
 *    A. 心跳新于 deadline ⇒ 轮询活着零动作；
 *    B. jobId 行查 BullMQ 真实状态：active ⇒ 长任务在跑零动作；waiting/delayed 超宽限 ⇒ 升级收敛
 *       （completed/failed/不存在=PG 动作表+charge 判定收敛——BullMQ 状态不再回填终态）；
 *    C. phase 分诊（Z83）：startedAt 非空=call/空=queue，intent_deadline_exceeded_total{kind,phase} 计数。
 *
 *  批一【心跳 stale 批】heartbeatAt 超龄 15min：jobId 路由查 BullMQ（active/waiting/delayed=合法在飞
 *    零动作；其余）→ convergeStale（R3 动作表+charge 剩余分支）。
 *
 *  批二【终态悬留 R3 批】TERMINAL ∧ reservedCredits>0 ∧ completedAt<now-宽限 → reconcileOneIntent
 *    （R3 动作表单入口=ArtifactCommitService.finalizeFromExistingMediaOrText——advisory lock+审计行）。
 *
 *  档二【全量三方对账，每日】：SUCCEEDED 行 creditsConsumed vs 消费流水数额差异 →
 *        reconcileMismatchTotal+WARN（资损前兆）；保留矩阵清理（7d/90d/30d/7d）+artifact 锚守护；
 *        exec map 孤儿条目清理（F2 GC）；video-separate 陈旧任务对账+并发额度归还。
 *
 *  附属【Z11 孤儿冻结巡检】（随 5min 同轮）：意图行灭失的孤儿 reserve——releaseOrphanReserve 窄口
 *        幂等释放（意图行存在的一切情形归 R3 批独占，E53）。
 *  附属【运行时不变量巡检】verifyLedgerInvariants：①池余额≡ΣbalanceDelta ②RUNNING ΣfrozenDelta≡
 *        reservedCredits ③ACTIVE 团队钱包在场 ③'VOIDED∧consumed>0∧无 refund=漂移 ④FAILED/VOIDED⇒
 *        reservedCredits=0——命中即 drift 指标+WARN（台账为真源）。 */
@Injectable()
export class IntentReconcileService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(IntentReconcileService.name);
  private timers: ReturnType<typeof setInterval>[] = [];
  private verifyActiveRunning = false;
  /** Y0c T11（Z56）：sweepOrphanExec 进程内游标——重启回起点无害（轮转非进度承诺，每轮 100 有界全量轮转）。 */
  private orphanSweepCursor: string | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CollabWritePort) private readonly collabDoc: CollabWritePort,
    @Inject(CollabDocWriterService) private readonly collabWriter: CollabDocWriterService,   // Y0c T12：exec-GC 直写收编改道 writeBatch（deleteExecOrphans op 单点）
    @Inject(CreditLedgerService) private readonly ledger: CreditLedgerService,
    @InjectQueue(EXECUTION_QUEUE_NAME) private readonly executionQueue: Queue,
    @InjectQueue(AI_IMAGE_EDIT_QUEUE_NAME) private readonly imageEditQueue: Queue,
    @Inject('REDIS_CLIENT') private readonly redis: any,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
    @Inject(ArtifactCommitService) private readonly artifactCommit: ArtifactCommitService,   // T13 R3：动作表单入口（finalizeFromExistingMediaOrText/finalizeFromStage）
  ) {}

  onModuleInit() {
    void this.verifyActive().catch((e) => this.logger.warn(`startup scan: ${e}`)); // 启动全量扫（覆盖"部署杀在飞任务"）
    // 在飞守卫（T5 质量审 I-1）：R3 批+孤儿释放并入后单轮最坏可达分钟级≫5min tick——
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

  /** 档一：deadline 批+心跳 stale 批回收 RUNNING + 终态悬留 R3 批（单条失败不阻塞整批——毒行不冻结全表扫描）
   *  + 资金闭环巡检同轮（Z11 孤儿释放——顺序固定：先意图侧清账再台账侧孤儿） */
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
    // ── 批一 心跳 stale 批（heartbeatAt 超龄=进程/调度异常——rollbackRunning 接管收敛）
    const cutoff = new Date(Date.now() - STALE_MS);
    const stale = await this.prisma.generationIntent.findMany({
      where: { status: 'RUNNING', heartbeatAt: { lt: cutoff } },
    });
    for (const row of stale) {
      try {
        await this.convergeViaQueueOrStale(row, cutoff);
      } catch (e) {
        this.logger.warn(`reconcile 意图 ${row.intentId} 失败: ${(e as Error).message}`);
      }
    }
    await this.reconcileStranded();
    await this.sweepProjectionBackfill();
    await this.sweepOrphanedRefund();
    await this.releaseOrphanedReserves();
  }

  /** T13 R3 窗③（投影缺失）专用扫：SUCCEEDED∧已核销行不进终态悬留批（reserved=0 谓词）——锚行在
   *  而投影行缺（finalize 投影 createMany 竞态/崩溃窗残余）由本扫兜底补建（判据=PG 反连接；
   *  有界 50 行/轮——正常链投影行随 finalize 同事务落，命中≈0 属不变量回归信号）。
   *  评审 Important#2 龄守卫：仅扫 7d 内新锚——retention 30d 删终态投影行后「锚在无投影」是常态
   *  （intent 行因锚守卫不物理删），无龄窗则 sweep↔retention 成复活循环（删→重建循环+审计噪声+
   *  T15 后旧产物重写在档节点）。 */
  private async sweepProjectionBackfill(): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ id: string; seq: bigint }[]>`
      SELECT na."sourceIntentRowId" AS id, na."sourceExecSeq" AS seq
      FROM "NodeArtifact" na
      LEFT JOIN "ArtifactProjection" ap ON ap."artifactId" = na.id AND ap."artifactRev" = na.rev
      WHERE na."sourceIntentRowId" IS NOT NULL AND na."sourceExecSeq" IS NOT NULL
        AND ap.id IS NULL
        AND na."updatedAt" > ((now() AT TIME ZONE 'utc') - (${PROJECTION_BACKFILL_MAX_AGE_MS} * interval '1 millisecond'))
      ORDER BY na."updatedAt"
      LIMIT 50`;
    for (const r of rows) {
      try {
        await this.reconcileOneIntent(r.id, BigInt(r.seq));
      } catch (e) {
        this.logger.warn(`[R3] 投影补建单行失败 意图行 ${r.id}: ${(e as Error).message}`);
      }
    }
  }

  /** T15 质评 Important#1 根治：orphaned 退款悬置收敛扫——SUCCEEDED 行（已核销 reserved=0，不进
   *  终态悬留批）∧当前代投影 orphaned（poller 标记 node-deleted/project-gone 后 refundOrphaned
   *  抛错的悬置窗）⇒ reconcileOneIntent（决策表窗⑥ orphaned-refund——rollbackDeliveryFailed
   *  锁外 CAS 幂等，与 poller 路径互斥恰一次；退款后行 VOIDED 自然离开本扫描=零循环）。
   *  龄窗同 Important#2（7d——窗外陈旧行归 admin retry 面）；有界 20 行/轮。 */
  private async sweepOrphanedRefund(): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ id: string; seq: bigint }[]>`
      SELECT na."sourceIntentRowId" AS id, na."sourceExecSeq" AS seq
      FROM "ArtifactProjection" ap
      JOIN "NodeArtifact" na ON na."id" = ap."artifactId" AND na."rev" = ap."artifactRev"
      JOIN "GenerationIntent" gi ON gi."id" = na."sourceIntentRowId"
      WHERE ap."state" = 'orphaned' AND gi."status" = 'SUCCEEDED'
        AND na."sourceIntentRowId" IS NOT NULL AND na."sourceExecSeq" IS NOT NULL
        AND na."updatedAt" > ((now() AT TIME ZONE 'utc') - (${PROJECTION_BACKFILL_MAX_AGE_MS} * interval '1 millisecond'))
      ORDER BY na."updatedAt"
      LIMIT 20`;
    for (const r of rows) {
      try {
        await this.reconcileOneIntent(r.id, BigInt(r.seq));
      } catch (e) {
        this.logger.warn(`[R3] orphaned 退款收敛单行失败 意图行 ${r.id}: ${(e as Error).message}`);
      }
    }
  }

  /** 批〇单行：deadline 到点的 RUNNING 收敛（cutoff=行自身 deadline：判龄守卫语义=心跳先于 deadline
   *  停，外呼死才收敛；并发心跳刷新 ⇒ CAS 失败幂等）。 */
  private async reapDeadline(row: GenerationIntent, now: Date): Promise<void> {
    if (row.heartbeatAt.getTime() >= row.deadlineAt.getTime()) return; // 轮询活着（onTick 刷心跳）——不误杀
    if (row.jobId) {
      const queue = this.queueForKind(row.kind);
      if (!queue) {
        this.logger.warn(`[deadline-reaper] 意图 ${row.intentId} kind=${row.kind} 不在 A 路径路由表——落 PG 收敛裁决`);
      } else {
        const job = await queue.getJob(row.jobId);
        if (job) {
          const state = await job.getState();
          if (state === 'active') return; // 长任务在跑——A 路径禁绕过（防误杀）
          if (state === 'waiting' || state === 'delayed') {
            // Z84 升级档：超宽限期才收敛（宽限内迟归 job 仍可被调度——A 路径禁绕过）。
            if (now.getTime() <= row.deadlineAt.getTime() + WAITING_UPGRADE_GRACE_MS) return;
            intentDeadlineExceededTotal.inc({ kind: row.kind, phase: 'waiting' });
            this.logger.warn(`[deadline-reaper] 意图 ${row.intentId} job=${row.jobId} waiting/delayed 超宽限 ${WAITING_UPGRADE_GRACE_MS}ms——升级收敛（迟归 job 走 claim④ rearm 自愈）`);
            return this.convergeStale(row, row.deadlineAt, 'INTENT_DEADLINE_EXCEEDED');
          }
          // completed/failed——T13：BullMQ 状态不再回填终态（谎言链根修），统一走 PG 动作表收敛
          // （job completed 而 intent 未收敛=finalize 崩溃窗——stage 行在即 finalize 补达，provider 不重调）。
        }
      }
    }
    // phase 分诊（Z83）：startedAt 非空=外呼期（call）/空=排队期（queue——claim 后未外呼即超时=调度积压信号）
    intentDeadlineExceededTotal.inc({ kind: row.kind, phase: row.startedAt ? 'call' : 'queue' });
    return this.convergeStale(row, row.deadlineAt, 'INTENT_DEADLINE_EXCEEDED');
  }

  /** A 路径 kind→队列路由（attachJob 盲区另一半）——jobId 属于哪个队列由 claim 发起链决定：
   *  text/video/image 走 execution 队列；outpaint/erase/redraw/lighting 走 ai-image-edit 队列。
   *  未知 kind 不猜队列：告警+直接落 PG 收敛（退款有 CAS 判龄守卫、金额 correctness 优先）。 */
  private queueForKind(kind: string): Queue | null {
    if (kind === 'text' || kind === 'video' || kind === 'image') return this.executionQueue;
    if (kind === 'outpaint' || kind === 'erase' || kind === 'redraw' || kind === 'lighting') return this.imageEditQueue;
    return null;
  }

  /** 批一单行：stale RUNNING 收敛——jobId 查 BullMQ 真实状态（active/waiting/delayed=合法在飞零动作；
   *  completed/failed/不存在=removeOnComplete 清理歧义族）→ convergeStale（PG 动作表+charge 判定）。 */
  private async convergeViaQueueOrStale(row: GenerationIntent, cutoff: Date): Promise<void> {
    if (row.jobId) {
      const queue = this.queueForKind(row.kind);
      if (!queue) {
        this.logger.warn(`[intent-reconcile] 意图 ${row.intentId} kind=${row.kind} 不在 A 路径路由表——落 PG 收敛裁决`);
      } else {
        const job = await queue.getJob(row.jobId);
        if (job) {
          const state = await job.getState();
          if (state !== 'failed' && state !== 'completed') return; // active/waiting/delayed——长任务合法在飞，零动作
        }
        // failed/completed/job 不存在——T13：不再从 returnvalue 回填（谎言链根修），PG 动作表裁决
      }
    }
    return this.convergeStale(row, cutoff, 'INTENT_STALE_REAPED');
  }

  /** T13 R3：stale RUNNING 收敛（两段）——①R3 动作表（stage 行在→重下 finalize：provider 不重调；
   *  终态幂等动作）②charge 剩余分支（resultRef 判族已删——已扣→rollbackRunning 单事务冲销/
   *  未扣→VOIDED 免费放行）。返回前每分支落 ReconcileAction 审计行（R3 动作）+投影分治。 */
  private async convergeStale(row: GenerationIntent, cutoff: Date, errorCode: 'INTENT_DEADLINE_EXCEEDED' | 'INTENT_STALE_REAPED'): Promise<void> {
    const converged = await this.reconcileOneIntent(row.id, row.execSeq);
    if (converged) return;   // R3 动作已收敛（finalize-from-stage/终态动作/审计告警面）——不进 charge 分支
    const chargeRows = await this.prisma.$queryRaw<any[]>`
      SELECT r.* FROM "TeamCreditTransaction" r
      WHERE r."teamId" = ${row.teamId ?? ''} AND r."referenceId" = ${'intent:' + row.id}
        AND r.type IN ('reserve', 'settle') AND r.amount < 0
        AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)`;
    if (chargeRows.length > 0) {
      // 已扣（settle/reserve 任一未冲销）→ rollbackRunning 单事务冲销（两金额归零+按行分义 refund/release）
      const rolled = await this.teamCredit.rollbackRunning(row.id, `reaper 收敛（${errorCode}）`, cutoff);
      if (rolled) {
        const total = chargeRows.reduce((s, r) => s + Math.abs(r.amount), 0);
        this.logger.warn(`[intent-reconcile] 意图 ${row.intentId} 已扣无产物（${errorCode}）——VOIDED+冲销 ${total}（两金额归零，重试照常扣费）`);
        await this.projectReaped(row, errorCode);
      }
      return;
    }
    // 未扣 → VOIDED 免费放行（creditsConsumed 本就 0；守卫同款防 rearm 竞态——判据 heartbeatAt）
    await this.prisma.generationIntent.updateMany({
      where: { id: row.id, status: 'RUNNING', heartbeatAt: { lt: cutoff } },
      data: { status: 'VOIDED', creditsConsumed: 0, completedAt: new Date() },
    });
    this.logger.warn(`[intent-reconcile] 意图 ${row.intentId} 未扣超龄——VOIDED 免费放行`);
  }

  /** T13 R3 动作表执行器（护栏：pg_advisory_xact_lock(hashtext(intentRowId))+每行有界尝试 3 次
   *  jitter+审计行 ReconcileAction——spec Z18''⑥ 字面）。决策+InTx 资金动作（settle-backfill/
   *  void-terminal）在 advisory 锁事务内原子；锁外执行面=rollback-stranded（rollbackStranded 自带
   *  判龄 CAS——恰一次）与 finalize-from-stage（IO 禁入锁事务——commitImage 幂等）。
   *  返回 true=本轮已有 R3 动作（含 manual-required 审计告警面）；false=无可收敛态（not-recoverable/
   *  noop/并发败者——调用方进后续分支）。 */
  private async reconcileOneIntent(intentRowId: string, execSeq: bigint): Promise<boolean> {
    for (let attempt = 0; attempt < R3_MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, R3_JITTER_BASE_MS + Math.floor(Math.random() * R3_JITTER_BASE_MS * 2)));
      try {
        const decision = await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${intentRowId}))`;
          const before = await tx.generationIntent.findUnique({
            where: { id: intentRowId },
            select: { id: true, intentId: true, status: true, execSeq: true, reservedCredits: true, creditsConsumed: true, creditCost: true, traceId: true },
          });
          if (!before || before.execSeq !== execSeq) return null;
          const d = await this.artifactCommit.finalizeFromExistingMediaOrText(tx, intentRowId, execSeq);
          if (d.action === 'settle-backfill') {
            if (!d.acted) return { d: null };   // 并发已抢/幂等未达（settled:false）——零审计零计数
            await this.auditInTx(tx, before, 'settle-backfill');
            return { d };
          }
          if (d.action === 'projection-backfill') {
            // 评审 Important#2：审计去重（并发双跑/重复裁决面——投影行重建后判据自愈 noop，本去重
            // 防锁内竞态窗的重复审计行）
            const dup = await tx.reconcileAction.findFirst({ where: { intentRowId, action: 'projection-backfill' }, select: { id: true } });
            if (dup) return { d: null };
            await this.auditInTx(tx, before, 'projection-backfill');
            return { d };
          }
          if (d.action === 'manual-required') {
            // 去重：manual-required 行态永不自愈（不动钱）——每轮重复裁决会刷审计行/计数（观测噪声）。
            // advisory 锁内查既存审计行——已登记即跳过（首次登记后告警面归日志/计数 rate）。
            const dup = await tx.reconcileAction.findFirst({ where: { intentRowId, action: 'manual-required' }, select: { id: true } });
            if (dup) return { d: null };
            await this.auditInTx(tx, before, 'manual-required', d.reason);
            return { d };
          }
          if (d.action === 'void-terminal') {
            // 幂等 release 锁内原子（voidInTx CAS——双 reconcile 恰一次；双跑第二轮判据 noop）
            await this.teamCredit.voidInTx(tx, { intentRowId, execSeq });
            await this.auditInTx(tx, before, 'void-terminal');
            return { d };
          }
          return { d };   // rollback-stranded/finalize-from-stage/not-recoverable/noop → 锁外分派
        }, { timeout: 15_000, maxWait: 5_000 });
        if (!decision) return false;
        const d = decision.d;
        if (!d || d.action === 'noop' || d.action === 'not-recoverable') return false;
        if (d.action === 'settle-backfill' || d.action === 'projection-backfill' || d.action === 'void-terminal') {
          reconcileAutoConvergedTotal.inc({ action: d.action });
          this.logger.warn(`[R3] 意图行 ${intentRowId} 自动收敛 ${d.action}（判据=PG：NodeArtifact/Media/ArtifactProjection——审计行已落）`);
          return true;
        }
        if (d.action === 'manual-required') {
          reconcileManualRequiredTotal.inc({ action: 'manual-required' });
          reconcileInvariantViolation.inc();   // T19（v11.2 ③）：资金-产物不一致巡检专项（同事件并列）
          this.logger.warn(`[R3] 意图行 ${intentRowId} 歧义态交人工（不动钱——裁决 :27④）: ${d.reason}`);
          return true;
        }
        if (d.action === 'rollback-stranded') {
          const rolled = await this.teamCredit.rollbackStranded(intentRowId, '悬留无产物回滚（settle 失败崩溃窗——PG 判据：无锚行无 stage 行）', new Date(Date.now() - SETTLE_STRANDED_GRACE_MS));
          if (rolled) {
            await this.auditAfter(intentRowId, 'rollback-stranded');
            reconcileAutoConvergedTotal.inc({ action: 'rollback-stranded' });
            this.logger.warn(`[R3] 意图行 ${intentRowId} 悬留无产物——rollbackStranded（两金额归零）`);
          }
          return true;
        }
        if (d.action === 'orphaned-refund') {
          // 窗⑥（T15 质评 Important#1 根治）：SUCCEEDED∧当前代投影 orphaned——poller 退款抛错悬置窗
          // 的收敛退款（rollbackDeliveryFailed CAS SUCCEEDED→VOIDED+refund；与 poller 路径互斥恰一次
          // ——false=已退/不适用）。抛错=次轮重扫（SUCCEEDED 态不变——收敛重试不丢）。
          try {
            const refunded = await this.teamCredit.rollbackDeliveryFailed(intentRowId, '交付终态失败回滚（投影 orphaned——poller 退款悬置窗收敛）');
            if (refunded) {
              await this.auditAfter(intentRowId, 'orphaned-refund');
              reconcileAutoConvergedTotal.inc({ action: 'orphaned-refund' });
              this.logger.warn(`[R3] 意图行 ${intentRowId} orphaned 悬置退款收敛——rollbackDeliveryFailed（退款后行 VOIDED 离开扫描=零循环）`);
            }
            return true;
          } catch (e) {
            this.logger.warn(`[R3] 意图行 ${intentRowId} orphaned 退款抛错（次轮重扫收敛）: ${(e as Error).message}`);
            return true;   // 已有动作尝试——毒行不冻结整轮
          }
        }
        if (d.action === 'finalize-from-stage') {
          // 评审 Minor#5：下载/网络瞬态=跨轮有界重试（毒行机制——每轮一次尝试；预算耗尽 ⇒ 本轮返回
          // false 落 convergeStale charge 分支=退款恰一次〔release/refund CAS〕；禁单次瞬态失败永弃已付费产物）。
          // 失败计数载体=审计行 action='finalize-from-stage-failed'（每败一行——reconcileDaily 90d 清理）。
          const fails = await this.prisma.reconcileAction.count({ where: { intentRowId, action: 'finalize-from-stage-failed' } });
          if (fails >= R3_STAGE_DOWNLOAD_MAX_ATTEMPTS) {
            this.logger.warn(`[R3] 意图行 ${intentRowId} stage 重下预算耗尽（${R3_STAGE_DOWNLOAD_MAX_ATTEMPTS} 次）——放弃重下走退款（宁退勿吞；行终态后不再进扫描）`);
            return false;
          }
          try {
            const out = await this.artifactCommit.finalizeFromStage(d.stage);
            if (out.outcome !== 'intent-stale') {
              await this.auditAfter(intentRowId, 'finalize-from-stage');
              reconcileAutoConvergedTotal.inc({ action: 'finalize-from-stage' });
              this.logger.warn(`[R3] 意图行 ${intentRowId} stage 行重下 finalize（provider 不重调）——outcome=${out.outcome}`);
            }
            return true;
          } catch (e) {
            await this.prisma.reconcileAction.create({
              data: { intentRowId, action: 'finalize-from-stage-failed', after: { attempt: fails + 1, error: String((e as Error).message).slice(0, 200) } },
            }).catch(() => undefined);
            this.logger.warn(`[R3] 意图行 ${intentRowId} stage 重下第 ${fails + 1}/${R3_STAGE_DOWNLOAD_MAX_ATTEMPTS} 次失败（下载/网络瞬态——次轮重试，未耗尽禁退款）: ${(e as Error).message}`);
            if (fails + 1 >= R3_STAGE_DOWNLOAD_MAX_ATTEMPTS) return false;   // 耗尽——本轮即落退款分支
            return true;
          }
        }
        return false;
      } catch (e) {
        if (!isRetryableFinalizeError(e) || attempt >= R3_MAX_ATTEMPTS - 1) {
          this.logger.warn(`[R3] 意图行 ${intentRowId} 收敛失败（毒行不冻结整轮——次轮重试）: ${(e as Error).message}`);
          return false;
        }
      }
    }
    return false;
  }

  /** 审计行（锁内事务形态——与动作原子）。before=决策前快照（调用方持）；after=动作后行重读（同事务）。 */
  private async auditInTx(tx: Prisma.TransactionClient, before: { id: string; traceId: string | null; status: string; reservedCredits: number; creditsConsumed: number }, action: string, reason?: string): Promise<void> {
    const after = await tx.generationIntent.findUnique({
      where: { id: before.id },
      select: { status: true, reservedCredits: true, creditsConsumed: true },
    });
    await tx.reconcileAction.create({
      data: {
        intentRowId: before.id,
        action,
        before: { status: before.status, reservedCredits: before.reservedCredits, creditsConsumed: before.creditsConsumed },
        after: after
          ? { status: after.status, reservedCredits: after.reservedCredits, creditsConsumed: after.creditsConsumed, ...(reason ? { reason } : {}) }
          : { reason },
        traceId: before.traceId,
      },
    });
  }

  /** 锁外动作审计（rollback-stranded/finalize-from-stage——动作在独立事务，审计 after 事实）。
   *  finalize-from-stage 双跑去重：advisory 锁内查既存审计行（双下载无害——finalize 幂等；审计恰一行）。 */
  private async auditAfter(intentRowId: string, action: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${intentRowId}))`;
      const dup = await tx.reconcileAction.findFirst({ where: { intentRowId, action }, select: { id: true } });
      if (dup) return;
      const row = await tx.generationIntent.findUnique({
        where: { id: intentRowId },
        select: { id: true, status: true, reservedCredits: true, creditsConsumed: true, traceId: true },
      });
      await tx.reconcileAction.create({
        data: {
          intentRowId,
          action,
          before: row ? { status: 'pre-action', note: '锁外动作——before 快照不在手' } : undefined,
          after: row ? { status: row.status, reservedCredits: row.reservedCredits, creditsConsumed: row.creditsConsumed } : undefined,
          traceId: row?.traceId ?? null,
        },
      });
    }).catch((e) => this.logger.warn(`[R3] 意图行 ${intentRowId} 审计行落账失败（动作已执行——审计 best-effort）: ${e}`));
  }

  /** Y0b-2 T5（Z106/Z112）→Y0c T20（Z105）：reaper 终态投影分治——UX 投影不得成为装载源：
   *  isDocResident=hasActiveWsConnection 才写 error 投影；无人看跳过+exec_projection_deferred_total
   *  计数。drain 503 best-effort 记 warn（不因投影失败回滚资金）。 */
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


  /** 档二：每日全量三方对账 + 保留矩阵清理 + exec GC（限量） + video-separate 陈旧回收 + 不变量巡检 */
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
    // ② 保留矩阵清理（T13：7d/90d/锚守护 + projection 30d/outbox 7d/dead-letter 告警 + 审计行 90d）
    await this.cleanTerminalIntents();
    await this.cleanProjectionAndOutbox();
    // ③ exec map 孤儿清理（F2 GC——Y0c T11 Z56 有界全量轮转；Z4 守卫已止新孤儿，此项消化存量）
    await this.sweepOrphanExec();
    // ④ video-separate 陈旧任务对账+并发额度归还（自 video-separate.cron.ts 搬入，注记见类头）
    await this.reconcileStaleVideoSeparateTasks();
    // ⑤ 三不变量运行时巡检（Z11——drift 指标+WARN，台账为真源）
    await this.verifyLedgerInvariants();
  }

  /** F7+T13 保留矩阵：终态行清理——冻结未销禁删（stranded 计数告警）；resultText 非空行 90d
   *  （text 产物正文）；有 NodeArtifact 锚行的 intent 不物理删（Media.sourceIntentRowId 悬空锚
   *  根修——spec Z18''⑥）；默认 7d。NOT EXISTS 判定=raw DELETE（Prisma deleteMany 无反连接）。 */
  private async cleanTerminalIntents(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    const stuck = await this.prisma.generationIntent.count({
      where: { status: { in: [...TERMINAL] }, reservedCredits: { gt: 0 }, completedAt: { lt: cutoff } },
    });
    if (stuck > 0) strandedTotal.inc(stuck);
    await this.prisma.$executeRaw`
      DELETE FROM "GenerationIntent" gi
      WHERE gi.status IN ('SUCCEEDED', 'FAILED', 'VOIDED')
        AND gi."reservedCredits" = 0
        AND gi."completedAt" < ((now() AT TIME ZONE 'utc') - (${RETENTION_MS} * interval '1 millisecond'))
        AND (
          gi."resultText" IS NULL
          OR gi."resultText" IS NOT NULL AND gi."completedAt" < ((now() AT TIME ZONE 'utc') - (${TEXT_RETENTION_MS} * interval '1 millisecond'))
        )
        AND NOT EXISTS (SELECT 1 FROM "NodeArtifact" na WHERE na."sourceIntentRowId" = gi.id)`;
  }

  /** T13 保留矩阵：ArtifactProjection 终态（projected=delivered 语义/orphaned/superseded/dead）30d
   *  清理 + MediaFactOutbox published 7d 清理 + dead-letter 告警（dead 行保留——人工处置面，计数观测）。 */
  private async cleanProjectionAndOutbox(): Promise<void> {
    await this.prisma.artifactProjection.deleteMany({
      where: { state: { in: ['projected', 'orphaned', 'superseded', 'dead'] }, createdAt: { lt: new Date(Date.now() - PROJECTION_RETENTION_MS) } },
    });
    await this.prisma.mediaFactOutbox.deleteMany({
      where: { state: 'published', publishedAt: { lt: new Date(Date.now() - OUTBOX_RETENTION_MS) } },
    });
    const dead = await this.prisma.mediaFactOutbox.count({ where: { state: 'dead' } });
    if (dead > 0) {
      reconcileManualRequiredTotal.inc({ action: 'outbox-dead-letter' });
      this.logger.warn(`[R3] MediaFactOutbox dead-letter ${dead} 行（投递终态失败——人工处置面，行保留告警不自动删）`);
    }
    // 评审 Minor#6：ReconcileAction 审计行 90d 清理（与 text 产物保留对齐；Important#2 去重面下增长有界——
    // 'finalize-from-stage-failed' 失败计数除外〔每败一行〕，90d 滚动清理防预算计数跨窗残留误伤）。
    await this.prisma.reconcileAction.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RECONCILE_ACTION_RETENTION_MS) } } });
  }

  /** Y0b-1（§1.5/E25①/Z17）第四分支（T13 R3 重写：doc 探测删除——判据全量 PG）：
   *  判据=TERMINAL ∧ reservedCredits>0 ∧ completedAt<now-SETTLE_STRANDED_GRACE_MS（"无活 worker
   *  持有"的结构证明；consumed>0∧reservedCredits=0 历史成功单永不进本分支=Z76 套利防回归）。
   *  逐行动作=reconcileOneIntent（R3 动作表：settle-backfill〔锚行在〕/rollback-stranded〔无锚无
   *  stage〕/void-terminal〔FAILED/VOIDED∧无 artifact 无 delivered〕/manual-required〔有交付凭据
   *  的失败态〕——advisory lock+审计行+auto_converged/manual_required 分计数）。
   *  有界：每轮 5min 最多 100 行；逐行容错（毒行不冻结整轮，次轮重试）。 */
  private async reconcileStranded(): Promise<void> {
    const cutoff = new Date(Date.now() - SETTLE_STRANDED_GRACE_MS);
    const stranded = await this.prisma.generationIntent.findMany({
      where: { status: { in: [...TERMINAL] }, reservedCredits: { gt: 0 }, completedAt: { lt: cutoff } },
      orderBy: { completedAt: 'asc' },
      take: 100,
    });
    for (const row of stranded) {
      try {
        await this.reconcileOneIntent(row.id, row.execSeq);
      } catch (e) {
        this.logger.warn(`[R3] 终态悬留单行失败 意图 ${row.intentId}: ${(e as Error).message}`);   // 毒行不冻结整轮
      }
    }
  }

  /** Y0b-1（Z11/Z25+四轮 Z38）：台账侧孤儿冻结——reserve 行未被冲销 ∧ **意图行真丢失**（gi.id IS NULL）∧ 超 15min
   *  ⇒ 经 releaseOrphanReserve 窄口（skipIntentCheck）幂等释放。
   *  四轮收窄：意图行**存在**的一切情形归 R3/void 批全权处理（monthlyUsed 已派生〔Y0b-2 T0〕——窄口跳过=quota 永久占用的旧患随列退役消失）；
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
   *  reservedCredits=0（"泛 TERMINAL"口子的结构性保险——命中=R3 闭环失效信号）。
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
    // 不变量④（Z102）：FAILED/VOIDED ⇒ reservedCredits=0（R3 闭环失效信号）
    const drift4 = await this.prisma.$queryRaw<{ id: string; teamId: string }[]>`
      SELECT gi.id, gi."teamId" FROM "GenerationIntent" gi
      WHERE gi.status IN ('FAILED', 'VOIDED') AND gi."reservedCredits" > 0
      ORDER BY gi.id LIMIT 20`;
    for (const d of drift4) { frozenDriftTotal.inc(); this.logger.warn(`[ledger-drift] 不变量④漂移 intent=${d.id} teamId=${d.teamId}（FAILED/VOIDED 冻结未清——R3 闭环失效）`); }
  }

  /** nodes map 无该 nodeId 的 exec 条目删除
   *  Y0b-1 限量 → Y0c T11 Z56 有界全量轮转：orderBy id asc+进程内游标每轮 100。
   *  Y0c T12 直写收编（裁决 1）：直写段整体改道 collabWriter.writeBatch([{op:deleteExecOrphans}])
   *  ——零孤儿=合法 no-op written:true（守卫/计数/schema 门与组批写同源单点）；503 等基础设施
   *  失败按原样单项目 try/catch 捕获（不阻塞整批）。
   *  T13 注记：本 poller 装配于 ExecutionDaemonModule（role=api|all）——进程内直写（非 HTTP），
   *  write-batch 端点收窄（worker 通道白名单拒 deleteExecOrphans）不影响本调用面。 */
  private async sweepOrphanExec(): Promise<void> {
    const cursor = this.orphanSweepCursor;
    const projects = await this.prisma.canvasProject.findMany({
      ...(cursor ? { where: { id: { gt: cursor } } } : {}),
      select: { id: true },
      orderBy: { id: 'asc' },
      take: SWEEP_PAGE,
    });
    for (const p of projects) {
      try {
        const results = await this.collabWriter.writeBatch(p.id, [{ op: 'deleteExecOrphans' }]);
        if (!results[0]?.written) {
          // deleteExecOrphans 无守卫域——written:false 属意外（结构防线信号，非日常路径）
          this.logger.warn(`exec-GC 项目 ${p.id} writeBatch 结果异常: ${JSON.stringify(results[0])}`);
        }
      } catch (e) {
        this.logger.warn(`exec-GC 项目 ${p.id} 失败: ${(e as Error).message}`);
      }
    }
    this.orphanSweepCursor = projects.length < SWEEP_PAGE ? null : projects[projects.length - 1].id;
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
