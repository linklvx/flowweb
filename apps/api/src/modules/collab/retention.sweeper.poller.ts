// apps/api/src/modules/collab/retention.sweeper.poller.ts
// C1-1（plan Task C1-1——生产就绪收尾批，spec v5 §6.1/§7/R14）：retention sweeper DB poller
// （worker 进程——CollabCompactPoller/MediaProbePoller 同款「OnModuleInit+原生 setInterval unref」形态）。
// 每 tick 主体跑在**一个事务**内（Controller 裁定 1）：
//  ①首句 `pg_try_advisory_xact_lock(hashtext('flowweb:retention'))`——失败 ⇒ 双 worker 并发 tick 单飞
//    让位（红④：xact 域=事务结束释放 ⇒ 同事务内第二取锁者必然失败）→ skip+计数；
//  ②stuck 扫面（红②——只读计数+告警不删）→ ③request 扫面（红⑤：claim ≤50 FOR UPDATE SKIP LOCKED
//    +同事务 voidForExecutionRequestInTx）→ ④input 扫面（红①：loop-to-empty 批删）→ ⑤event 扫面
//    （红⑦：loop-to-empty+minRetainedSeq 推进+bytes 素材）。
// 多 tick 排空由本 poller 间隔驱动（红⑤ 1000 行积压≈20 tick）；连续失败 ≥3 ⇒ 退避窗跳过（红⑤后半）。
// 指标全挂 **tick 事务提交后**（回滚不虚计）；计数面=retention.metrics.ts 单源（source=worker 3002）。
// tick 词表注记：本 poller 不入 CollabJobCursor（shared COLLAB_JOB_CURSOR_JOBS——单飞走 advisory
// 锁无游标消费）。
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionRequestRetentionService, RETENTION_REQUEST_CLAIM_BATCH } from '../execution/execution-request.retention.service';
import { RuntimeFeedRetentionService } from './runtime-feed.retention.service';
import {
  retentionBacklogRows, retentionDeletedRowsTotal, retentionSweeperRunDuration,
  retentionSweeperTickTotal, retentionStuckRequestsTotal, retentionVoidTotal, runtimeFeedBytes,
} from './retention.metrics';

/** 扫描周期（时间门基线：stuck/过期面分钟级收敛即达——env 可调，COMPACT_POLL_INTERVAL_MS 同族
 *  形态：值经 dotenv 先行在位、Number()|| 默认缺省档、消费面=worker 轮询周期非部署档位）。 */
export const RETENTION_SWEEP_INTERVAL_MS = Number(process.env.RETENTION_SWEEP_INTERVAL_MS) || 60_000;
/** advisory 单飞键（红④——`flowweb:retention` 全局唯一：双 worker 并发 tick 第二实例 skip+计数）。 */
export const RETENTION_ADVISORY_KEY = 'flowweb:retention';
/** tick 事务上限（四扫面单事务——advisory xact 锁持有期界；loop-to-empty 面含批删循环）。 */
const TICK_TX_TIMEOUT_MS = 60_000;
/** 连续失败退避（红⑤后半）：≥3 次连续 tick 失败 ⇒ 退避窗（errors×interval，上限 15min）。 */
const CONSECUTIVE_FAIL_EXIT = 3;
const BACKOFF_CAP_MS = 15 * 60_000;

@Injectable()
export class RetentionSweeperPoller implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RetentionSweeperPoller.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 单飞互斥（重入防叠跑——setInterval 漏tick 防抖）。 */
  private running = false;
  private consecutiveErrors = 0;
  private backoffUntil = 0;
  /** runtime_feed_bytes 计数器维护：boot 基线+累计删除（null=基线播种失败——维护面停用）。 */
  private feedBytesBaseline: number | null = null;
  private feedBytesDeleted = 0;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ExecutionRequestRetentionService) private readonly requestRetention: ExecutionRequestRetentionService,
    @Inject(RuntimeFeedRetentionService) private readonly feedRetention: RuntimeFeedRetentionService,
  ) {}

  async onModuleInit(): Promise<void> {
    // runtime_feed_bytes 基线播种（boot 一次全表 SUM——此后删除批累减；api 侧每轮 SUM 扫已废止）
    try {
      this.feedBytesBaseline = await this.feedRetention.bytesBaseline();
      runtimeFeedBytes.set(this.feedBytesBaseline);
    } catch (e) {
      this.logger.warn(`runtime_feed_bytes 基线播种失败（boot SUM 一次——维护面停用至 worker 重启）: ${(e as Error).message}`);
    }
    this.timer = setInterval(() => { void this.tick(); }, RETENTION_SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    if (this.backoffUntil > Date.now()) {
      retentionSweeperTickTotal.inc({ result: 'skip-backoff' });
      return;
    }
    this.running = true;
    const startedAt = Date.now();
    try {
      const stats = await this.prisma.$transaction(async (rawTx) => {
        // 红④ 单飞首句（同键第二取锁者必然失败——xact 域事务结束释放）
        const lock = await rawTx.$queryRaw<{ ok: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtext(${RETENTION_ADVISORY_KEY})) AS ok`;
        if (!lock[0]?.ok) return { skipped: true as const };
        // 红② stuck 扫面（只读计数——告警不删）
        const stuck = await this.requestRetention.countStuckInTx(rawTx);
        // 红⑤ request 扫面（claim ≤50+同事务 void）
        const request = await this.requestRetention.sweepExpiredInTx(rawTx);
        // 红① input 扫面（loop-to-empty 批删）
        const inputDeleted = await this.requestRetention.sweepExpiredInputsInTx(rawTx);
        // 红⑦ event 扫面（loop-to-empty+minRetainedSeq 推进+bytes 素材）
        const events = await this.feedRetention.sweepEventsInTx(rawTx);
        return { skipped: false as const, stuck, request, inputDeleted, events };
      }, { timeout: TICK_TX_TIMEOUT_MS, maxWait: 10_000 });
      if (stats.skipped) {
        retentionSweeperTickTotal.inc({ result: 'skip-singleflight' });
        return;
      }
      // 提交后计数（tx 回滚不虚计——计数面与删除面同生共死）
      retentionSweeperTickTotal.inc({ result: 'ok' });
      if (stats.request.voided > 0) retentionVoidTotal.inc(stats.request.voided);
      if (stats.inputDeleted > 0) retentionDeletedRowsTotal.inc({ table: 'execution_input' }, stats.inputDeleted);
      if (stats.events.deleted > 0) retentionDeletedRowsTotal.inc({ table: 'runtime_event' }, stats.events.deleted);
      if (stats.stuck.admitted > 0 || stats.stuck.executing > 0) {
        retentionStuckRequestsTotal.inc({ state: 'ADMITTED' }, stats.stuck.admitted);
        retentionStuckRequestsTotal.inc({ state: 'EXECUTING' }, stats.stuck.executing);
        this.logger.warn(`retention stuck：admitted=${stats.stuck.admitted}（过期未 claim——本 tick request 扫面 void 批）、executing=${stats.stuck.executing}（过 GenerationIntent deadline——告警不删，人工/收口链处置）`);
      }
      // backlog 按需 count（红⑤观测面）：claim 满批 ⇒ 积压可能未尽（count 回填真实余量）；
      // event 面 loop-to-empty 恒清零。
      retentionBacklogRows.set({ table: 'execution_request' }, stats.request.claimed >= RETENTION_REQUEST_CLAIM_BATCH
        ? await this.requestRetention.countExpiredAdmittedBacklog() : 0);
      retentionBacklogRows.set({ table: 'runtime_event' }, 0);
      // runtime_feed_bytes 计数器维护：基线−累计删除（gauge 低估方向漂移+重启重播种——metrics 注记）
      if (this.feedBytesBaseline !== null && stats.events.deletedBytes > 0) {
        this.feedBytesDeleted += stats.events.deletedBytes;
        runtimeFeedBytes.set(this.feedBytesBaseline - this.feedBytesDeleted);
      }
      this.consecutiveErrors = 0;
      this.backoffUntil = 0;
    } catch (e) {
      this.consecutiveErrors += 1;
      retentionSweeperTickTotal.inc({ result: 'error' });
      if (this.consecutiveErrors >= CONSECUTIVE_FAIL_EXIT) {
        this.backoffUntil = Date.now() + Math.min(this.consecutiveErrors * RETENTION_SWEEP_INTERVAL_MS, BACKOFF_CAP_MS);
        this.logger.error(`retention sweeper 连续 ${this.consecutiveErrors} 次失败——退避窗至 ${new Date(this.backoffUntil).toISOString()}（期内 tick=skip-backoff；poller 间隔驱动即红⑤排空退避面）`);
      } else {
        this.logger.warn(`retention sweeper tick 失败（连续 ${this.consecutiveErrors}/${CONSECUTIVE_FAIL_EXIT}——第 ${CONSECUTIVE_FAIL_EXIT} 次起退避）: ${(e as Error).message}`);
      }
    } finally {
      retentionSweeperRunDuration.observe((Date.now() - startedAt) / 1000);
      this.running = false;
    }
  }
}