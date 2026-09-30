import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue, Job } from 'bullmq';
import type { GenerationIntent, TeamCreditTransaction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { currentPeriod } from '../team/team-credit.service';
import { EXECUTION_QUEUE_NAME } from './execution.constants';
import { reconcileMismatchTotal } from './intent-reconcile.metrics';

/** RUNNING 孤儿判龄阈值（档一）——claim/rearm/CAS 扣费都刷新 updatedAt，超龄即同步路径内联崩溃嫌疑 */
const STALE_MS = 15 * 60_000;
/** 终态保留期（F1 保留策略）——SUCCEEDED/FAILED/VOIDED 行 7 天后清理 */
const RETENTION_MS = 7 * 24 * 3600_000;
const TERMINAL = ['SUCCEEDED', 'FAILED', 'VOIDED'] as const;

/** 意图表对账与回收（F12 每日全量 + F13 活跃核验 5min）——R28 纪律：原生 setInterval+unref
 *  （@Cron 是死代码：ScheduleModule 全仓未导入）。
 *
 *  档一【活跃核验，每 5min】（partial unique 使同节点新意图被 RUNNING 孤儿 409 锁死——
 *        本档把锁死窗口从 24h 压到 ≤15min；@@index([status, updatedAt]) 让扫描近乎免费）：
 *    A. 有 jobId → 查 BullMQ 真实状态（禁"job 不存在即判死"——removeOnComplete 清理歧义）：
 *       completed → 按产物回填 SUCCEEDED；failed/不存在 → 走 B 三查；
 *       active/waiting/delayed → 长任务合法在飞（意图行 updatedAt 不随外呼刷新），零动作
 *    B. 三查（age 一律取 updatedAt；isCharged=流水按 referenceId `intent:${intentId}` 精确查）：
 *       ①已扣 && resultRef 非空 → SUCCEEDED 回填
 *       ②已扣无产物 → 退款事务（四写单 $transaction：守卫 CAS 二次判龄+归零 → 两池拆分逆向
 *         记账（type=refund，读流水行各自拆分——禁拿 creditsConsumed 单值猜）→ monthlyUsed 回滚）；
 *         count===0 ⇒ 已处理/并发已抢（幂等，崩溃重扫不双退）
 *       ③未扣 → VOIDED 免费放行（守卫同款）
 *
 *  档二【全量三方对账，每日】：SUCCEEDED 行 creditsConsumed vs 消费流水数额差异 →
 *        reconcileMismatchTotal+WARN（资损前兆；批 7 接 collabDiagnostics）；终态 7 天清理；
 *        exec map 孤儿条目清理（F2 GC）；video-separate 陈旧任务对账+并发额度归还
 *        （自 video-separate.cron.ts 搬入——原 @Cron 死代码从未运行，该功能不被档一覆盖：
 *         VideoSeparateTask 表+Redis 计数器非意图表/积分域，故整体搬入本档保底）。 */
@Injectable()
export class IntentReconcileService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(IntentReconcileService.name);
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
    @InjectQueue(EXECUTION_QUEUE_NAME) private readonly executionQueue: Queue,
    @Inject('REDIS_CLIENT') private readonly redis: any,
  ) {}

  onModuleInit() {
    void this.verifyActive().catch((e) => this.logger.warn(`startup scan: ${e}`)); // 启动全量扫（覆盖"部署杀在飞任务"）
    const t1 = setInterval(() => void this.verifyActive().catch((e) => this.logger.warn(`verifyActive: ${e}`)), 5 * 60_000);
    const t2 = setInterval(() => void this.reconcileDaily().catch((e) => this.logger.warn(`reconcileDaily: ${e}`)), 24 * 3600_000);
    for (const t of [t1, t2]) t.unref?.();
    this.timers = [t1, t2];
  }

  onApplicationShutdown() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /** 档一：回收 RUNNING 孤儿（单条失败不阻塞整批——毒行不冻结全表扫描） */
  async verifyActive(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_MS);
    const stale = await this.prisma.generationIntent.findMany({
      where: { status: 'RUNNING', updatedAt: { lt: cutoff } },
    });
    for (const row of stale) {
      try {
        await this.reconcileIntent(row, cutoff);
      } catch (e) {
        this.logger.warn(`reconcile 意图 ${row.intentId} 失败: ${(e as Error).message}`);
      }
    }
  }

  private async reconcileIntent(row: GenerationIntent, cutoff: Date): Promise<void> {
    if (row.jobId) {
      const job = await this.executionQueue.getJob(row.jobId);
      if (job) {
        const state = await job.getState();
        if (state === 'completed') return this.backfillSucceeded(row, job);
        if (state !== 'failed') return; // active/waiting/delayed——长任务合法在飞，零动作
      }
      // failed 或 job 不存在（removeOnComplete 清理歧义）→ 三查裁决
    }
    return this.threeCheck(row, cutoff);
  }

  /** A 路径 completed 回填：resultRef 从 returnvalue.results 取本节点条目（text 无 URL 锚点按
   *  complete() 同款 'text:' 前缀摘要占位）；无锚点留 null+告警（产物完整性由调用方落地保证）。 */
  private async backfillSucceeded(row: GenerationIntent, job: Job<any, any>): Promise<void> {
    const entry = ((job.returnvalue as any)?.results ?? []).find((r: any) => r?.nodeId === row.nodeId);
    const resultRef = entry
      ? String(entry.resultUrl ?? (entry.content != null ? `text:${String(entry.content).slice(0, 100)}` : '')) || null
      : null;
    if (!resultRef) this.logger.warn(`意图 ${row.intentId} job completed 但无产物锚点——resultRef 留空`);
    await this.prisma.generationIntent.updateMany({
      where: { id: row.id, status: 'RUNNING' },
      data: { status: 'SUCCEEDED', resultRef, completedAt: new Date() },
    });
  }

  /** 三查裁决（isCharged=流水按 referenceId 精确查——0.5-9 切两阶段时只改 chargeRows 查询口） */
  private async threeCheck(row: GenerationIntent, cutoff: Date): Promise<void> {
    const chargeRows = await this.prisma.teamCreditTransaction.findMany({
      where: { referenceId: `intent:${row.intentId}`, type: 'consumption' },
    });
    if (chargeRows.length > 0 && row.resultRef) {
      // ①已扣+产物在（判据=resultRef）→ SUCCEEDED 回填
      await this.prisma.generationIntent.updateMany({
        where: { id: row.id, status: 'RUNNING' },
        data: { status: 'SUCCEEDED', completedAt: new Date() },
      });
      return;
    }
    if (chargeRows.length > 0) return this.refund(row, chargeRows, cutoff);
    // ③未扣 → VOIDED 免费放行（creditsConsumed 本就 0；守卫同款防 rearm 竞态）
    await this.prisma.generationIntent.updateMany({
      where: { id: row.id, status: 'RUNNING', updatedAt: { lt: cutoff } },
      data: { status: 'VOIDED', creditsConsumed: 0, completedAt: new Date() },
    });
    this.logger.warn(`[intent-reconcile] 意图 ${row.intentId} 未扣超龄——VOIDED 免费放行`);
  }

  /** 三查②退款事务（四写单 $transaction）——守卫 count===1 才在同一事务内回补；
   *  creditsConsumed 归零=consume CAS 门（where creditsConsumed:0）不变量修复——退款后重试照常扣费。 */
  private async refund(row: GenerationIntent, chargeRows: TeamCreditTransaction[], cutoff: Date): Promise<void> {
    const total = chargeRows.reduce((s, r) => s + Math.abs(r.amount), 0);
    const refunded = await this.prisma.$transaction(async (tx) => {
      const guard = await tx.generationIntent.updateMany({
        where: { id: row.id, status: 'RUNNING', updatedAt: { lt: cutoff } },
        data: { status: 'VOIDED', creditsConsumed: 0, completedAt: new Date() },
      });
      if (guard.count === 0) return false; // 已处理/并发已抢（幂等）
      for (const r of chargeRows) {
        const amt = Math.abs(r.amount); // 流水 amount 为负——逆向取正
        const isSub = r.creditType === 'subscription';
        await tx.teamBalance.update({
          where: { teamId: r.teamId! }, // 消费流水行恒有 teamId（schema String? 是外键 SetNull 语义）
          data: isSub ? { subscriptionCredits: { increment: amt } } : { credits: { increment: amt } },
        });
        const bal = await tx.teamBalance.findUnique({ where: { teamId: r.teamId! } });
        await tx.teamCreditTransaction.create({
          data: {
            teamId: r.teamId!,
            operatorUserId: row.userId,
            amount: amt,
            type: 'refund',
            creditType: r.creditType,
            referenceId: r.referenceId, // 同 intent: 维度——对账 join 键统一
            balanceAfter: isSub ? bal!.subscriptionCredits : bal!.credits,
          },
        });
      }
      await tx.teamMember.updateMany({
        where: { teamId: chargeRows[0].teamId!, userId: row.userId, monthlyPeriod: currentPeriod() }, // 仅当月回滚（月界翻转不污染新月）
        data: { monthlyUsed: { decrement: total } },
      });
      return true;
    });
    if (refunded) {
      this.logger.warn(`[intent-reconcile] 意图 ${row.intentId} 已扣无产物——VOIDED+退款 ${total}（creditsConsumed 归零，重试照常扣费）`);
    }
  }

  /** 档二：每日全量三方对账 + 保留策略清理 + exec GC + video-separate 陈旧回收 */
  async reconcileDaily(): Promise<void> {
    // ① 三方对账：SUCCEEDED creditsConsumed vs 消费流水（差异=资损前兆）
    const succeeded = await this.prisma.generationIntent.findMany({
      where: { status: 'SUCCEEDED', creditsConsumed: { gt: 0 } },
      select: { intentId: true, creditsConsumed: true },
    });
    for (const r of succeeded) {
      const rows = await this.prisma.teamCreditTransaction.findMany({
        where: { referenceId: `intent:${r.intentId}`, type: 'consumption' },
      });
      const charged = rows.reduce((s, t) => s + Math.abs(t.amount), 0);
      if (charged !== r.creditsConsumed) {
        reconcileMismatchTotal.inc();
        this.logger.warn(`[资损前兆] 意图 ${r.intentId} creditsConsumed=${r.creditsConsumed} vs 流水=${charged}`);
      }
    }
    // ② 终态 7 天清理（F1 保留策略）
    await this.prisma.generationIntent.deleteMany({
      where: { status: { in: [...TERMINAL] }, completedAt: { lt: new Date(Date.now() - RETENTION_MS) } },
    });
    // ③ exec map 孤儿清理（F2 GC）
    await this.sweepOrphanExec();
    // ④ video-separate 陈旧任务对账+并发额度归还（自 video-separate.cron.ts 搬入，注记见类头）
    await this.reconcileStaleVideoSeparateTasks();
  }

  /** nodes map 无该 nodeId 的 exec 条目删除（transact 产生 delete set → 经 update 监听持久化/广播） */
  private async sweepOrphanExec(): Promise<void> {
    const projects = await this.prisma.canvasProject.findMany({ select: { id: true } });
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
