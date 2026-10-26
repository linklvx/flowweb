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
//  - **EXEC_FINALIZE→RefundObligation 收口=归 T23**（退款主体——本 sweeper 不 claim 该 kind，
//    行维持 PENDING 至 T23 接线；「本卡只接义务出队语义」）。
//
// 转移纪律：claim（PENDING→CLAIMED+租约）→执行→complete（DONE）/fail（attempts+1，≥5→DEAD
// fail-closed 人工面）——nextObligationQueueState 纯函数单源（shared execution-chain.ts §5）。
import { Inject, Injectable, Logger, OnApplicationShutdown, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { nextObligationQueueState, LIFECYCLE_OBLIGATION_LEASE } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RuntimeFeedService } from './runtime-feed.service';
import { BindingReconcileService } from '../media-delivery/binding-reconcile.service';

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

  /** 一轮：claim 批（T22 消费 kind 过滤——EXEC_FINALIZE 留 T23）→逐行执行→complete/fail。 */
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

  /** SKIP LOCKED 租约 claim（PENDING∧租约过期/NULL——MaterializeJob/投影 poller 同族纪律）。 */
  private async claim() {
    const owner = `obligation-${randomUUID().slice(0, 8)}`;
    const untilMs = BigInt(Date.now() + OBLIGATION_LEASE_MS);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; kind: string; nodeId: string; walSeq: bigint }[]>`
        SELECT "id", "kind", "nodeId", "walSeq" FROM "LifecycleObligation"
        WHERE "state" = 'PENDING' AND "kind" IN ('FEED_TOMBSTONE', 'NODE_DELETED')
          AND ("claimUntilMs" IS NULL OR "claimUntilMs" < ${Date.now()}::bigint)
        ORDER BY "createdAt"
        LIMIT ${OBLIGATION_BATCH}
        FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return [] as Array<{ id: string; kind: string; nodeId: string; walSeq: bigint; claimOwner: string }>;
      await tx.lifecycleObligation.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { state: 'CLAIMED', claimOwner: owner, claimUntilMs: untilMs },
      });
      return rows.map((r) => ({ ...r, claimOwner: owner }));
    });
  }

  /** 执行器（kind 分派——异常=fail 档交 transition 计 attempts）。 */
  private async execute(row: { id: string; kind: string; nodeId: string; walSeq: bigint }): Promise<boolean> {
    if (row.kind === 'FEED_TOMBSTONE') return this.executeFeedTombstone(row.nodeId, row.walSeq);
    if (row.kind === 'NODE_DELETED') return this.executeNodeDeletedCleanup(row.nodeId);
    return false;   // 结构性不可达（claim 已滤 kind）
  }

  /** FEED_TOMBSTONE：node.deleted 事件投递（幂等：同 (nodeId,walSeq) 已在档=直达 true）。 */
  private async executeFeedTombstone(nodeId: string, walSeq: bigint): Promise<boolean> {
    const pid = await this.projectIdOfObligation(nodeId);
    if (!pid) return true;   // 项目已删——义务随项目域消亡（DONE 免重试风暴）
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
  private async executeNodeDeletedCleanup(nodeId: string): Promise<boolean> {
    const pid = await this.projectIdOfObligation(nodeId);
    if (!pid) return true;
    // ②ArtifactProjection 在飞拦截：pending/projecting 行置 orphaned（投递主拦截=fence；退款归
    // poller orphaned 路径/R3 窗⑥——本处只收尾行态，零资金动作）
    await this.prisma.artifactProjection.updateMany({
      where: { projectId: pid, nodeId, state: { in: ['pending', 'projecting'] } },
      data: { state: 'orphaned', lastError: 'node-deleted:obligation-sweep' },
    });
    // ③VideoProject 级联（sourceNodeId 唯一行——服务端权威收编 web fire-and-forget cascade）
    await this.prisma.videoProject.deleteMany({ where: { sourceNodeId: nodeId } });
    // ①MediaBinding 帧级 effects 清扫=BindingReconcile 惰性入队（fire-and-forget——drain 周期收敛）
    this.reconciler?.requestReconcile(pid);
    return true;
  }

  private async projectIdOfObligation(nodeId: string): Promise<string | null> {
    const row = await this.prisma.lifecycleObligation.findFirst({
      where: { nodeId }, orderBy: { createdAt: 'desc' }, select: { projectId: true },
    });
    return row?.projectId ?? null;
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
