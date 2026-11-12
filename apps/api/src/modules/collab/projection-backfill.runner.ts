// apps/api/src/modules/collab/projection-backfill.runner.ts
// C3a-8（plan v3 Task C3a-8——spec 2026-11-11-foundation-batch-design.md §3.2-3 恢复四路/
// §3.2-7 backfill_remaining）：MediaBinding 全量回填 runner——**恢复五消费点（boot/replay/
// import/vacuum/drift）统一入队**+首次启动全表枚举（不阻塞服务启动）。
//
// 形态（spec §3.2-3「枚举 CanvasDoc 分页/限速/可恢复/backfillEpoch；未完成期 GC/erasure bail-out；
// 不阻塞服务启动」）：
//   · 候选谓词单源=needsBindingRebuild 的 SQL 面 `bindingsDirty=true OR mediaBindingSeq<pgSeq`
//     （C3a-6 谓词去掉 replayed 腿——replayed 只在装载内存态存在，入队由 boot 判定回调承载）。
//   · 分页：游标轮转 `projectId > cursor ORDER BY projectId LIMIT BACKFILL_ENUM_PAGE`——页尽回卷
//     （行随回填离开候选集，轮转=幂等非进度承诺；重启 cursor 归 null 重头枚举=断点续跑的持久面
//     在 CanvasDoc 候选集本身+ProjectionBackfillState 行）。
//   · 限速（不惊群）：每 tick 至多 BACKFILL_PROJECTS_PER_TICK 个项目 + **单项目串行**（drain 内
//     顺序 await；enqueue 只入内存 Set 去重）——并发事务恒 1。
//   · 持久状态行：每项目 upsert ProjectionBackfillState{PENDING→RUNNING→DONE|FAILED, verifiedSeq,
//     backfillEpoch}——backfillEpoch=runner 实例启动生成 UUID（行上可追踪轮次）；FAILED/cas-miss
//     保持 dirty 可续跑（下轮重试，退避 BACKFILL_RETRY_BACKOFF_MS）；状态行**跨进程可查**
//     （GC/erasure 经 projectionBackfillState 读面）。
//   · 不阻塞启动：OnModuleInit 以 setTimeout(0).unref() 起首拍+unref interval 后台循环。
//
// 修复唯一路径=BindingRebuildService.rebuildProjectBindings（rebuild 只读 PG 定代前缀；本 runner
// 零 MediaBinding 写——静态单写者门禁白名单不含本文件）。
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { BindingRebuildService, type RebuildOutcome } from './binding-rebuild.service';
import { mediaBindingBackfillRemaining, mediaBindingWatermarkLag } from './media-binding.metrics';

/** 候选枚举页大小（CanvasDoc 全表游标分页——每枚举拍一页入队）。 */
export const BACKFILL_ENUM_PAGE = 32;
/** 每 tick 处理项目上界（限速/不惊群——drain 单项目串行，事务并发恒 1）。 */
export const BACKFILL_PROJECTS_PER_TICK = 8;
/** 后台拍周期（enqueue 会额外触发即时排水——本周期=首次启动全表枚举+失败退避重试驱动）。 */
export const BACKFILL_TICK_INTERVAL_MS = 5_000;
/** 失败退避基数（指数：30s→60s→…cap 10min，±20% jitter——I-4 防惊群；成功/no-doc 重置）。 */
export const BACKFILL_BACKOFF_BASE_MS = 30_000;
/** 失败退避上限（cap 10min）。 */
export const BACKFILL_BACKOFF_MAX_MS = 600_000;
/** 非 ACTIVE（bailed）固定复查间隔（5min——擦除收口后自然离开候选）。 */
export const BACKFILL_BAILOUT_RECHECK_MS = 300_000;

/** I-4：失败退避纯函数（确定性可测）——attempts=该项目连续失败次数（0 起）；base×2^attempts
 *  封顶 MAX，±20% jitter（rand 注入=测试确定性；生产 Math.random）。 */
export function backfillBackoffMs(attempts: number, rand: () => number = Math.random): number {
  const n = Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 0;
  const base = Math.min(BACKFILL_BACKOFF_BASE_MS * 2 ** Math.min(n, 16), BACKFILL_BACKOFF_MAX_MS);
  const jitter = 0.8 + 0.4 * Math.min(1, Math.max(0, rand()));
  return Math.round(base * jitter);
}

/** 持久状态行 state 值（schema 无 enum——代码内闭集，DB CHECK 四态约束同源）。 */
export type ProjectionBackfillStateValue = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

/** 单项目回填结果（测试/日志面）。bailed=项目非 ACTIVE（ERASING 等）——本轮不写 DONE，dirty 保持。 */
export type BackfillRunOutcome = 'done' | 'no-doc' | 'cas-miss' | 'failed' | 'bailed';

@Injectable()
export class ProjectionBackfillRunner implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ProjectionBackfillRunner.name);
  /** 本轮 runner 启动纪元（每次进程启动/UUID——持久行上可追踪回填轮次）。 */
  readonly backfillEpoch = randomUUID();
  /** 待排水队列（Set 去重——同项目并发入队恰一次；单项目串行由 drain 顺序执行保证）。 */
  private readonly queue = new Set<string>();
  /** 失败退避（projectId→notBefore 毫秒时间戳）。 */
  private readonly notBefore = new Map<string, number>();
  /** I-4：连续失败次数（指数退避输入；成功/no-doc 重置）。 */
  private readonly attempts = new Map<string, number>();
  /** 枚举游标（null=从头；页尽回卷）。 */
  private cursor: string | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private draining = false;
  private destroyed = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BindingRebuildService) private readonly rebuild: BindingRebuildService,
  ) {}

  onModuleInit(): void {
    // 首次启动：不阻塞服务启动（unref 后台拍——枚举一页+排水一拍，interval 续跑）
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      void this.tick().catch((e) => this.logger.warn(`backfill boot tick: ${(e as Error).message}`));
    }, 0);
    this.bootTimer.unref?.();
    this.tickTimer = setInterval(() => {
      void this.tick().catch((e) => this.logger.warn(`backfill tick: ${(e as Error).message}`));
    }, BACKFILL_TICK_INTERVAL_MS);
    this.tickTimer.unref?.();
  }

  onApplicationShutdown(): void {
    this.destroyed = true;
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.bootTimer = null;
    this.tickTimer = null;
    this.queue.clear();
    this.notBefore.clear();
  }

  /** 恢复消费点统一入口（boot/replay/import/vacuum/drift——fire-and-forget 即时排水一拍）。 */
  enqueue(projectId: string): void {
    if (this.destroyed) return;
    this.queue.add(projectId);
    // 即时排水（不阻塞调用方——unref：不阻进程退出；draining 守卫=并发 enqueue 合并一拍）
    const t = setTimeout(() => {
      void this.drain().catch((e) => this.logger.warn(`backfill drain: ${(e as Error).message}`));
    }, 0);
    t.unref?.();
  }

  /** 前置置 dirty（恢复四路「消费前 dirty 已持久」的独立 PG 写面——replayAll/import 在 apply/append
   *  之前调用；脏门阻断增量 binding 水位推进）。行缺=0 行 no-op（懒建档由 append 侧同判兜底）。 */
  async markDirty(projectId: string): Promise<void> {
    await this.prisma.canvasDoc.updateMany({ where: { projectId }, data: { bindingsDirty: true } });
  }

  /** 一拍：枚举一页候选入队 + 排水（每 tick 项目上界=限速；返回值=测试/日志面）。
   *  I-3：backfill_remaining 仅在本拍有枚举或处理时刷新（空转保留上次值——禁每 tick 全表 COUNT）。 */
  async tick(): Promise<{ enumerated: number; processed: number }> {
    const enumerated = await this.enumeratePage();
    const processed = await this.drain();
    if (enumerated === 0 && processed > 0) mediaBindingBackfillRemaining.set(await this.countCandidates());
    return { enumerated, processed };
  }

  /** 排水一轮（单项目串行——事务并发恒 1；上界 BACKFILL_PROJECTS_PER_TICK）。测试直调入口。 */
  async drain(): Promise<number> {
    if (this.draining || this.destroyed) return 0;
    this.draining = true;
    let processed = 0;
    try {
      for (const projectId of [...this.queue]) {
        if (processed >= BACKFILL_PROJECTS_PER_TICK || this.destroyed) break;
        if ((this.notBefore.get(projectId) ?? 0) > Date.now()) continue;   // 退避期——保留在队列
        this.queue.delete(projectId);
        const outcome = await this.runProject(projectId).catch((e) => {
          this.logger.warn(`backfill project=${projectId} 失败（dirty 保持，退避后续跑）: ${(e as Error).message}`);
          return 'failed' as const;
        });
        processed += 1;
        const now = Date.now();
        if (outcome === 'done' || outcome === 'no-doc') {
          this.notBefore.delete(projectId);
          this.attempts.delete(projectId);   // I-4：成功/no-doc 重置指数退避
        } else if (outcome === 'bailed') {
          this.notBefore.set(projectId, now + BACKFILL_BAILOUT_RECHECK_MS);   // 非 ACTIVE：固定 5min 复查
        } else {
          const a = this.attempts.get(projectId) ?? 0;
          this.attempts.set(projectId, a + 1);
          this.notBefore.set(projectId, now + backfillBackoffMs(a));   // 30s→60s→…cap 10min ±20%
        }
      }
      return processed;
    } finally {
      this.draining = false;
    }
  }

  /** 单项目回填（持久行 RUNNING→DONE|FAILED；cleared 才 DONE+verifiedSeq=anchor.pgSeq）。
   *  C3a-8 修复批 I2：首步 raw 读 CanvasProject.lifecycleState（绕读过滤——非 ACTIVE 项目行对
   *  delegate 读不可见）——非 'ACTIVE'/行缺=**bail-out**（不写 DONE、dirty 保持、退避下轮再看；
   *  ERASING 项目由擦除收口，禁以 teamId=null 假清 dirty）。
   *  质量收口 Minor：PENDING→RUNNING 两次 upsert 合并为单次 RUNNING（PENDING 无消费者）。 */
  async runProject(projectId: string): Promise<BackfillRunOutcome> {
    if ((await this.readLifecycleState(projectId)) !== 'ACTIVE') return 'bailed';
    await this.setState(projectId, 'RUNNING');
    const anchor = await this.rebuild.snapshotAnchor(projectId);
    if (anchor) mediaBindingWatermarkLag.set(Number(anchor.pgSeq - anchor.expectedBindingSeq));   // 观测点：候选 lag
    let outcome: RebuildOutcome;
    try {
      outcome = await this.rebuild.rebuildProjectBindings(projectId);
    } catch (err) {
      await this.setState(projectId, 'FAILED');
      throw err;
    }
    if (outcome.outcome === 'cleared') {
      await this.setState(projectId, 'DONE', outcome.pgSeq);
      return 'done';
    }
    // cas-miss=写点后有并发移动（dirty 保持）；no-doc=行缺（并发删/清理归 erasure）——均 FAILED
    // （可查可续跑：候选谓词仍选中 cas-miss；no-doc 无行不再枚举）。
    await this.setState(projectId, 'FAILED');
    return outcome.outcome === 'no-doc' ? 'no-doc' : 'cas-miss';
  }

  /** 持久状态行查询面（跨进程 GC/erasure 可查——本进程写/他进程读同表）。 */
  async stateOf(projectId: string): Promise<{ backfillEpoch: string; state: ProjectionBackfillStateValue; verifiedSeq: bigint } | null> {
    const row = await this.prisma.projectionBackfillState.findUnique({ where: { projectId } });
    if (!row) return null;
    return { backfillEpoch: row.backfillEpoch, state: row.state as ProjectionBackfillStateValue, verifiedSeq: row.verifiedSeq };
  }

  /** 候选剩余数读面已删除（质量收口 I-3：零消费——spec 指标由 backfill_remaining gauge 承载；
   *  跨进程查询面=stateOf/持久行）。 */

  private async enumeratePage(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ projectId: string }[]>`
      SELECT "projectId" FROM "CanvasDoc"
      WHERE ("bindingsDirty" = true OR "mediaBindingSeq" < "pgSeq")
        AND "projectId" > ${this.cursor ?? ''}
      ORDER BY "projectId" LIMIT ${BACKFILL_ENUM_PAGE}`;
    if (rows.length > 0) {
      this.cursor = rows[rows.length - 1].projectId;
      if (rows.length < BACKFILL_ENUM_PAGE) this.cursor = null;   // 页尽回卷
      for (const r of rows) this.queue.add(r.projectId);
      mediaBindingBackfillRemaining.set(await this.countCandidates());   // I-3：仅枚举到候选时刷新
    } else {
      this.cursor = null;
    }
    return rows.length;
  }

  private async countCandidates(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM "CanvasDoc"
      WHERE "bindingsDirty" = true OR "mediaBindingSeq" < "pgSeq"`;
    return Number(rows[0]?.n ?? 0n);
  }

  /** I2：lifecycleState 无过滤 raw 读（读过滤 Proxy 只辖 delegate 读——非 ACTIVE 行对 findUnique
   *  不可见；行缺失同判非 ACTIVE）。 */
  private async readLifecycleState(projectId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ lifecycleState: string | null }[]>`
      SELECT "lifecycleState" FROM "CanvasProject" WHERE "id" = ${projectId}::text LIMIT 1`;
    return rows[0]?.lifecycleState ?? null;
  }

  private async setState(projectId: string, state: ProjectionBackfillStateValue, verifiedSeq?: bigint): Promise<void> {
    const now = new Date();
    await this.prisma.projectionBackfillState.upsert({
      where: { projectId },
      create: { projectId, backfillEpoch: this.backfillEpoch, state, verifiedSeq: verifiedSeq ?? 0n, updatedAt: now },
      update: {
        backfillEpoch: this.backfillEpoch,
        state,
        updatedAt: now,
        ...(verifiedSeq != null ? { verifiedSeq } : {}),
      },
    });
  }
}
