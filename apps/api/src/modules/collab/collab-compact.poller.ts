// apps/api/src/modules/collab/collab-compact.poller.ts
// Y1c T11（plan Task 11——COLLAB_ROLE worker 调度）：compact 轮询 DB poller（worker 进程）。
// 职责三件（MediaProbePoller/MaterializeJob 同款「OnModuleInit+原生 setInterval unref」形态——
// @Cron 全仓未导入纪律；装配=worker.module 平铺 provider，API 进程不注册〔compact 触发面在 api
// 侧经 maybeCompact 原位承接不断链；本 poller 是「无人断连也收敛」的兜底扫描+启动续跑载体〕）：
//  ①启动续跑：resumePendingPurges——kill 在指针发布后/分批删完成前的清理义务不丢（purgeBelowSeq
//    已随发布事务持久，重启续删；红组②验收锚）；首步=schemaVersion⇒generation 启动断言（M1——
//    worker 启动面 fail-closed，违例拒启周期零 CanvasDoc 触碰）；
//  ②周期扫描：CanvasDoc ∃ 增量行 seq≤pgSeq（可折前缀在场）的 doc → COMPACT_INTERVAL_MS 时间门
//    （api 侧 maybeCompact 同源常量）→ repo.compact（重放+发布+分批删全管线——重放在 worker 进程）；
//  ③观测：tick 结果计数（candidate/skipped/compacted/miss/empty/abandoned——worker 3002 侧可读）。
// compact 授权=行锁+generation/pgSeq CAS（不拿租约——本进程零 CollabLease 交互）；并发败者=
// {compacted:false,reason:'miss'} 正常折返（计数不告警）。
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Counter, register } from 'prom-client';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { COMPACT_INTERVAL_MS } from './collab-persistence.service';

/** 扫描周期（时间门基线：候选集变化由写入方驱动，分钟级扫描即达；env 可调——运维脚本同族惯例）。 */
export const COMPACT_POLL_INTERVAL_MS = Number(process.env.COMPACT_POLL_INTERVAL_MS) || 60_000;
/** 单 tick 候选上界（长库全扫有界化——剩余下轮续扫）。 */
const COMPACT_POLL_BATCH = 50;

export const compactPollTickTotal = new Counter({
  name: 'collab_compact_poll_tick_total',
  help: 'Y1c T11 compact 轮询 poller tick 计数（result=compacted 发布成功/miss 授权 CAS 败/empty 无前缀/abandoned pendingStructs/candidate 进批/skipped-gate 时间门跳过/error 意外——worker 进程触发面）',
  labelNames: ['result'],
  registers: [register],
});

@Injectable()
export class CollabCompactPoller implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CollabCompactPoller.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** 时间门台账（projectId→上次 compact 成功时点——maybeCompact.lastCompactAt 同义；进程内态）。 */
  private readonly lastCompactAt = new Map<string, number>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CanvasDocUpdateRepository) private readonly repo: CanvasDocUpdateRepository,
  ) {}

  /** 启动续跑先行（清理义务先于新扫描——kill 窗残留即刻收敛），随后武装周期 tick。
   *  M1（T12 双评审）：首步=schemaVersion⇒generation 启动断言（api 面 startCollabAfterLease 同源
   *  fail-closed——worker 进程原本不经断言：poller 是 worker 唯一 CanvasDoc 触碰面）。违例=拒启
   *  poller 周期+ERROR（不阻进程退出——与 api 面 throw=start-failed 语义可不同）+零 CanvasDoc
   *  触碰（resumePurges/compact/tick 武装全不达）。 */
  async onModuleInit(): Promise<void> {
    try {
      await this.repo.assertSchemaGenerationDiscipline();
    } catch (e) {
      this.logger.error(`compact poller 拒启（schemaVersion⇒generation 启动断言违反——零 CanvasDoc 触碰；deploy 纪律=换代或 reset-collab 清行）: ${(e as Error).message}`);
      return;
    }
    try {
      const resumed = await this.repo.resumePurges();
      if (resumed > 0) this.logger.log(`T11 启动续跑：${resumed} doc 的 purgeBelowSeq 清理义务已收敛`);
    } catch (e) {
      // 续跑失败不阻启动（tick 首步兜底重跑——Q-M2 复核 round-2：tick 扫描面只命中「seq≤pgSeq 在场」
      // doc，kill 窗残留行已删+快照已覆盖的纯清理义务不在其列，compact empty 早退于 ④ 不续删）
      this.logger.error(`T11 启动续跑失败（tick 首步兜底）: ${(e as Error).message}`);
    }
    this.timer = setInterval(() => { void this.tick(); }, COMPACT_POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** 周期 tick：扫描可折前缀在场的 doc → 时间门 → compact 全管线。单飞互斥（重放吃内存——防 tick 叠跑）。
   *  首步=清理义务兜底续跑（Q-M2 复核 round-2：boot resumePurges 单项目抛错即中断全部续跑〔无
   *  per-project try/catch〕，且 compact empty 分支早退于 ④——义务只能等重启；tick 首步重跑使
   *  purgeBelowSeq 持久义务的最长滞留=一个 tick 周期。失败仅 WARN 不阻 compact 主面）。 */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      try {
        await this.repo.resumePurges();
      } catch (e) {
        this.logger.warn(`T11 tick 清理义务续跑失败（义务由 purgeBelowSeq 持久承载——下轮 tick 再试）: ${(e as Error).message}`);
      }
      const candidates = await this.prisma.$queryRaw<{ projectId: string }[]>`
        SELECT d."projectId" FROM "CanvasDoc" d
        WHERE EXISTS (
          SELECT 1 FROM "CanvasDocUpdate" u
          WHERE u."projectId" = d."projectId" AND u.generation = d.generation AND u.seq <= d."pgSeq"
          LIMIT 1
        )
        ORDER BY d."projectId" ASC
        LIMIT ${COMPACT_POLL_BATCH}`;
      for (const c of candidates) {
        const last = this.lastCompactAt.get(c.projectId);
        if (last !== undefined && Date.now() - last < COMPACT_INTERVAL_MS) {
          compactPollTickTotal.inc({ result: 'skipped-gate' });
          continue;
        }
        compactPollTickTotal.inc({ result: 'candidate' });
        try {
          const r = await this.repo.compact(c.projectId);
          if (r.compacted) {
            this.lastCompactAt.set(c.projectId, Date.now());   // 仅成功开新窗（maybeCompact 同义：miss/empty/abandoned 不开）
            compactPollTickTotal.inc({ result: 'compacted' });
          } else {
            compactPollTickTotal.inc({ result: r.reason ?? 'empty' });
          }
        } catch (e) {
          compactPollTickTotal.inc({ result: 'error' });
          this.logger.warn(`compact poll failed for ${c.projectId}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      compactPollTickTotal.inc({ result: 'error' });
      this.logger.error(`compact poll scan failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
