// apps/api/src/modules/collab/lifecycle-obligation.sweeper.ts
// Y1c T22（plan v1.7 Task 22——T26 裁定面落地）：LifecycleObligation 义务队列消费面（#11 定队列
// 的 sweeper——SKIP LOCKED 租约 claim+nextObligationQueueState 单源转移）。
//
// 消费分派（closed——kind 词表单源=lifecycle.ts OBLIGATION_KINDS）：
//  - **FEED_TOMBSTONE → node.deleted feed 事件投递**（RuntimeEvent 写入——客户端清 Runtime Store
//    投影；lifecycleSeq 自 NodeLifecycle 触发 walSeq 对应行取值；DONE 幂等：事件业务键
//    (nodeId,walSeq) 已在档=直达 DONE）。
//  - **NODE_DELETED → 三清扫面**（plan T26②卡主钉住范围）：
//    ①MediaBinding 帧级 effects 清扫=BindingReconcileService.requestReconcile（惰性对齐入队）；
//    ②ArtifactProjection 投递前拦截=该节点 pending/projecting 行置 orphaned（投递主拦截在
//      deliverArtifact fence——此处收尾在飞行，退款走 poller/R3 既有链非本 sweeper）；
//    ③VideoProject 级联=sourceNodeId 引用行删除（收编 web fire-and-forget
//      cascadeDeleteVideoProject 缺口——服务端权威清扫）。
//  - **EXEC_FINALIZE → RefundObligation 收口**（Y1c T23 接线——T22 期留 T23 位）：collect
//    （该节点在飞 RUNNING 意图逐行义务化——unique(intentRowId,execSeq) 幂等）+drain（pinned
//    代际命中=FAILED+release 精确逆转 exact reserve 行；迟到旧义务 pinned 对换代行 0 命中=让位
//    零资金动作——spec §6.3 退款 fencing；资金主体=TeamCreditService.collectExecFinalize/
//    drainRefundObligations，本 sweeper 只做义务出队与驱动）。
//
// 转移纪律：claim（PENDING→CLAIMED+租约）→执行→complete（DONE）/fail（attempts+1，≥5→DEAD
// fail-closed 人工面）——nextObligationQueueState 纯函数单源（shared execution-chain.ts §5）。
import { Inject, Injectable, Logger, OnApplicationShutdown, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { nextObligationQueueState, LIFECYCLE_OBLIGATION_LEASE } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RuntimeFeedService } from './runtime-feed.service';
import { BindingReconcileService } from '../media-delivery/binding-reconcile.service';
import { TeamCreditService } from '../team/team-credit.service';   // Y1c T23：EXEC_FINALIZE 退款主体（@Optional——直构测试无资金面）

/** sweeper tick 周期（义务面=秒级可见性足够——FEED_TOMBSTONE 投递延迟直接关系 UI 删除收敛）。 */
const OBLIGATION_SWEEP_INTERVAL_MS = 3_000;
/** 每轮 claim 批上限。 */
const OBLIGATION_BATCH = 32;
/** claim 租约时长（行级执行为轻量 PG 面——60s 充裕；到期回 PENDING 重派）。 */
const OBLIGATION_LEASE_MS = 60_000;

@Injectable()
export class LifecycleObligationSweeper implements OnApplicationShutdown {
  private readonly logger = new Logger(LifecycleObligationSweeper.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private destroyed = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RuntimeFeedService) private readonly feed: RuntimeFeedService,
    /** ①清扫面注入（media-delivery 模块——collab 模块跨模块引用经 @Optional 解耦直构测试）。 */
    @Optional() private readonly reconciler?: BindingReconcileService | null,
    /** Y1c T23：EXEC_FINALIZE 退款主体（team 模块——@Optional 同款解耦：直构测试〔t22-g5 三参
     *  形态〕无资金面时该 kind 执行 false 转 fail 档重试，生产装配恒注入）。 */
    @Optional() private readonly teamCredit?: TeamCreditService | null,
  ) {}

  onModuleInit(): void {
    const t = setInterval(() => {
      void this.tick().catch((e) => this.logger.warn(`obligation sweep: ${(e as Error).message}`));
    }, OBLIGATION_SWEEP_INTERVAL_MS);
    t.unref?.();
    this.timer = t;
  }

  onApplicationShutdown(): void {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 一轮：claim 批（T23 起 EXEC_FINALIZE 入消费域）→逐行执行→complete/fail。 */
  async tick(): Promise<{ claimed: number; done: number; failed: number }> {
    if (this.destroyed || this.busy) return { claimed: 0, done: 0, failed: 0 };
    this.busy = true;
    const summary = { claimed: 0, done: 0, failed: 0 };
    try {
      const rows = await this.claim();
      summary.claimed = rows.length;
      for (const row of rows) {
        const ok = await this.execute(row).catch((e) => {
          this.logger.warn(`[obligation] 执行失败 kind=${row.kind} node=${row.nodeId}: ${(e as Error).message}`);
          return false;
        });
        if (ok) {
          await this.transition(row.id, { type: 'complete' });
          summary.done += 1;
        } else {
          await this.transition(row.id, { type: 'fail' });
          summary.failed += 1;
        }
      }
      return summary;
    } finally {
      this.busy = false;
    }
  }

  /** SKIP LOCKED 租约 claim（PENDING∨〔CLAIMED∧租约过期〕——MaterializeJob/投影 poller 同族纪律）。
   *  T22 收口批 I-5：原谓词只 state='PENDING'（PENDING 行 claimUntilMs 恒 NULL——租约形同虚设；
   *  CLAIMED∧租约过期行崩溃后永久卡死）。修=谓词扩 lease-expired 档+重派按 shared
   *  nextObligationQueueState lease-expired 分支计 attempts（CLAIMED 过期=attempts+1；
   *  ≥maxAttempts=DEAD fail-closed 不再重派）。
   *  Y1c T23：EXEC_FINALIZE 入 claim 域（消费面=collect+drain——T22 期「留 T23」兑现）。 */
  private async claim() {
    const owner = `obligation-${randomUUID().slice(0, 8)}`;
    const untilMs = BigInt(Date.now() + OBLIGATION_LEASE_MS);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; kind: string; projectId: string; nodeId: string; walSeq: bigint; state: string; attempts: number }[]
      >`
        SELECT "id", "kind", "projectId", "nodeId", "walSeq", "state", "attempts" FROM "LifecycleObligation"
        WHERE ("state" = 'PENDING' OR ("state" = 'CLAIMED' AND "claimUntilMs" IS NOT NULL AND "claimUntilMs" < ${Date.now()}::bigint))
          AND "kind" IN ('FEED_TOMBSTONE', 'NODE_DELETED', 'EXEC_FINALIZE')
        ORDER BY "createdAt"
        LIMIT ${OBLIGATION_BATCH}
        FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return [] as Array<{ id: string; kind: string; projectId: string; nodeId: string; walSeq: bigint; claimOwner: string }>;
      // I-5：lease-expired 重派结算（shared 单源语义——CLAIMED 过期=attempts+1；≥max → DEAD）
      const expired = rows.filter((r) => r.state === 'CLAIMED');
      const maxAttempts = LIFECYCLE_OBLIGATION_LEASE.maxAttempts;
      const dead = expired.filter((r) => r.attempts + 1 >= maxAttempts);
      const rearm = expired.filter((r) => r.attempts + 1 < maxAttempts);
      const fresh = rows.filter((r) => r.state === 'PENDING');
      if (dead.length > 0) {
        await tx.lifecycleObligation.updateMany({
          where: { id: { in: dead.map((r) => r.id) } },
          data: { state: 'DEAD', attempts: { increment: 1 }, claimOwner: null, claimUntilMs: null },
        });
        for (const r of dead) this.logger.error(`[obligation] 租约过期且 attempts 达上限 DEAD（人工面）id=${r.id} node=${r.nodeId}`);
      }
      const claimable = [...fresh, ...rearm];
      await tx.lifecycleObligation.updateMany({
        where: { id: { in: claimable.map((r) => r.id) } },
        data: {
          state: 'CLAIMED',
          claimOwner: owner,
          claimUntilMs: untilMs,
        },
      });
      // 重派行 attempts+1（lease-expired 计一次尝试——与 fresh 行分语句：PENDING claim 不加 attempts）
      if (rearm.length > 0) {
        await tx.lifecycleObligation.updateMany({
          where: { id: { in: rearm.map((r) => r.id) } },
          data: { attempts: { increment: 1 } },
        });
      }
      return claimable.map((r) => ({ id: r.id, kind: r.kind, projectId: r.projectId, nodeId: r.nodeId, walSeq: r.walSeq, claimOwner: owner }));
    });
  }

  /** 执行器（kind 分派——异常=fail 档交 transition 计 attempts）。projectId 自 claim 行值直用
   *  （I-9：原按 nodeId 全库 findFirst 反查——两项目同 nodeId 时作用于错误项目）。 */
  private async execute(row: { id: string; kind: string; projectId: string; nodeId: string; walSeq: bigint }): Promise<boolean> {
    if (row.kind === 'FEED_TOMBSTONE') return this.executeFeedTombstone(row.projectId, row.nodeId, row.walSeq);
    if (row.kind === 'NODE_DELETED') return this.executeNodeDeletedCleanup(row.projectId, row.nodeId);
    if (row.kind === 'EXEC_FINALIZE') return this.executeExecFinalize(row.projectId, row.nodeId);
    return false;   // 结构性不可达（claim 已滤 kind）
  }

  /** EXEC_FINALIZE（Y1c T23）：在飞意图义务化（collect）+退款收口（drain）——资金主体=TeamCreditService
   *  （pinned execSeq fencing：命中=FAILED+release 逆转 exact reserve 行/迟到旧义务=让位零资金动作）。
   *  @Optional 缺席（直构测试三参形态）=false 转 fail 档（生产装配恒注入——collab.module imports TeamModule）。 */
  private async executeExecFinalize(pid: string, nodeId: string): Promise<boolean> {
    if (!pid) return true;
    if (!this.teamCredit) return false;
    const created = await this.teamCredit.collectExecFinalize(pid, nodeId);
    const drained = await this.teamCredit.drainRefundObligations();
    this.logger.log(`[obligation] EXEC_FINALIZE node=${nodeId}：collect ${created} 行义务化，drain settled=${drained.settled} collected=${drained.collected}`);
    return true;
  }

  /** FEED_TOMBSTONE：node.deleted 事件投递（幂等：同 (nodeId,walSeq) 已在档=直达 true）。 */
  private async executeFeedTombstone(pid: string, nodeId: string, walSeq: bigint): Promise<boolean> {
    // 项目已删判定：义务自身行在=项目域存在（claim 行值直用——I-9 删全库反查）；项目真删时
    // 义务行随项目级联清除，此处行恒有项目——保留原「无项目=DONE 免重试风暴」防御形态经行值判空
    if (!pid) return true;
    const dup = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "RuntimeEvent"
      WHERE "projectId" = ${pid}::text AND "kind" = 'node.deleted'
        AND payload->>'nodeId' = ${nodeId}::text
      LIMIT 1`;
    if (dup.length > 0) return true;   // 幂等（崩溃窗：事件已落义务未 DONE）
    // lifecycleSeq=触发 walSeq 对应生命周期行（帧↔义务原子——同 walSeq 行必在）
    const lifecycleRow = await this.prisma.nodeLifecycle.findFirst({
      where: { projectId: pid, nodeId, walSeq },
      select: { lifecycleSeq: true },
    });
    const lifecycleSeq = (lifecycleRow?.lifecycleSeq ?? 0n).toString();
    await this.feed.appendEvent(pid, 'node.deleted', () => ({ nodeId, lifecycleSeq }));
    this.feed.notifyProject(pid);
    return true;
  }

  /** NODE_DELETED 三清扫：MediaBinding 惰性 reconcile 入队+ArtifactProjection 在飞行收尾+VideoProject 级联。 */
  private async executeNodeDeletedCleanup(pid: string, nodeId: string): Promise<boolean> {
    if (!pid) return true;
    // ②ArtifactProjection 在飞拦截：pending/projecting 行置 orphaned（投递主拦截=fence；退款归
    // poller orphaned 路径/R3 窗⑥——本处只收尾行态，零资金动作）
    await this.prisma.artifactProjection.updateMany({
      where: { projectId: pid, nodeId, state: { in: ['pending', 'projecting'] } },
      data: { state: 'orphaned', lastError: 'node-deleted:obligation-sweep' },
    });
    // ③VideoProject 级联（sourceNodeId 唯一行——服务端权威收编 web fire-and-forget cascade；
    // I-9：workflowId=pid 过滤——两项目同 nodeId 时不得误删他项目行）
    await this.prisma.videoProject.deleteMany({ where: { workflowId: pid, sourceNodeId: nodeId } });
    // ①MediaBinding 帧级 effects 清扫=BindingReconcile 惰性入队（fire-and-forget——drain 周期收敛）
    this.reconciler?.requestReconcile(pid);
    return true;
  }

  /** 状态转移（nextObligationQueueState 单源——CLAIMED 行 claimOwner CAS）。 */
  private async transition(id: string, ev: { type: 'complete' | 'fail' }): Promise<void> {
    const row = await this.prisma.lifecycleObligation.findUnique({ where: { id }, select: { state: true, attempts: true } });
    if (!row) return;
    const next = nextObligationQueueState({ state: row.state as 'PENDING' | 'CLAIMED' | 'DONE' | 'DEAD', attempts: row.attempts }, ev);
    if (next === null) return;
    await this.prisma.lifecycleObligation.updateMany({
      where: { id, state: row.state },
      data: {
        state: next.state,
        attempts: next.attempts,
        ...(next.state === 'CLAIMED' ? { claimOwner: next.claimOwner ?? undefined, claimUntilMs: next.claimUntilMs ?? undefined } : { claimOwner: null, claimUntilMs: null }),
      },
    }).catch((e) => this.logger.warn(`[obligation] 转移失败 id=${id}: ${(e as Error).message}`));
    if (next.state === 'DEAD') {
      this.logger.error(`[obligation] 义务行 DEAD（人工面）id=${id}`);
    }
  }
}
