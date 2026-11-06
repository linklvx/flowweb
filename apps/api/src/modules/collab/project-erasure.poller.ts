// apps/api/src/modules/collab/project-erasure.poller.ts
// C4-a（plan Task C4-1 红④⑤⑤-b worker 面——生产就绪收尾批·project-erasure）：erasure run 轮询
// worker 骨架（worker 进程装配——retention.sweeper.poller 同款「OnModuleInit+原生 setInterval
// unref」DB poller 形态；api 进程零注册——census ⑰ 闭包纯度=prisma/shared/credit-ledger 族）。
// **run 行=唯一唤醒源**（无 BullMQ kick 面：run 行轮询即兜底全量——红④「入队失败→轮询兜底」的
// 极简形态=不存在可失败的入队；间隔上界=轮询周期）。骨架三件（C4-c 扩完整 saga 态机
// PURGING_DB/OBJECTS/CACHE/VERIFYING+介质 manifest）：
//  ①claim：raw SQL CAS（本实例续租∨租约过期∨无主——kill -9 后租约到期自动重认领=红① run 恢复面；
//    claim 独立事务提交〔处理失败不丢 claim=租约恢复锚〕）；
//  ②team run 分批游标置 DELETING+子 run 置入（每 tick 一批〔id 序〕——批选择谓词 lifecycleState=
//    'ACTIVE' 即天然游标：已置行退出谓词集，多 tick 单调排空；FOR SHARE 批选+批 UPDATE=与并发写事务
//    自然互斥〔team 批 UPDATE 等全部 FOR SHARE 持有者——红⑤零复活〕）；
//  ③会合判定（WAITING_CHILDREN）：子 run 任一 FAILED→team run FAILED（不删 Team——红⑤-b）；子全
//    DONE→PURGING_TEAM（ledger 通行证——team.delete 级联 TeamBalance 触发 ledger_guard）→删 Team 行
//    →team run DONE。
// project scope run：claim+RUNNING+租约心跳（PENDING→RUNNING 的 liveness 证明——物理清除 saga 态机
// 归 C4-c；本骨架不推进物理删除=tombstone-only 承诺的 worker 半边在位）。dryRun run 不消费（C4-c）。
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import type { ProjectErasureRun } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithIncludeDeleted } from '../../prisma/read-path.filter';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { ErasureContextService, lockScope, lockProject, fenceProject, fenceTeam } from './project-lock';
import { createErasureRun, ERASURE_ACTIVE_STATES } from './project-erasure';
import { collectSpoolSegments, writeErasureManifest, type ErasureManifestInputs } from './project-erasure.manifest';

/** 轮询周期（时间门基线：run 行=唤醒源，间隔即红④兜底延迟上界；env 可调——RETENTION_SWEEP_INTERVAL_MS 同族形态）。 */
export const ERASURE_POLL_INTERVAL_MS = Number(process.env.ERASURE_POLL_INTERVAL_MS) || 5_000;
/** claim 租约（kill -9 恢复窗：租约到期即他实例/重启实例可重认领）。 */
const ERASURE_RUN_LEASE_MS = 60_000;
/** team 批置批量（O(N) 分批——每 tick 一批，多 tick 排空；retention claim 批 50 同族量级）。 */
const TEAM_TOMBSTONE_BATCH = 100;
/** 每 tick 处理 run 数上界（单 tick 事务预算界）。 */
const TICK_RUN_LIMIT = 20;
/** team run 处理事务上限（批选择+批置+会合判定单事务）。 */
const TEAM_TX_TIMEOUT_MS = 30_000;
/** C4-b：project run DRAINING 事务上限（排干等待在飞写者+采集单事务——上界含在飞批收尾时间）。 */
const PROJECT_TX_TIMEOUT_MS = 30_000;

@Injectable()
export class ProjectErasureRunPoller implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ProjectErasureRunPoller.name);
  /** claim 主标识（进程内唯一：pid+随机后缀——多 worker 实例互斥经 CAS 谓词）。 */
  private readonly claimOwner = `erasure-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 单飞互斥（setInterval 漏 tick 防抖——retention poller 同款）。 */
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CreditLedgerService) private readonly ledger: CreditLedgerService,
    @Inject(ErasureContextService) private readonly erasureCtx: ErasureContextService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.tick(); }, ERASURE_POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const candidates = await this.prisma.projectErasureRun.findMany({
        where: {
          dryRun: false,
          OR: [
            { scopeType: 'team', state: { in: ['PENDING', 'RUNNING', 'WAITING_CHILDREN'] } },
            // C4-b：project 含 DRAINING（kill -9 于 ①置 DRAINING 与 ③PURGING_DB 之间=重跑幂等收敛）
            { scopeType: 'project', state: { in: ['PENDING', 'RUNNING', 'DRAINING'] } },
          ],
        },
        select: { erasureId: true, scopeType: true },
        orderBy: { updatedAt: 'asc' },
        take: TICK_RUN_LIMIT,
      });
      for (const c of candidates) {
        const run = await this.claim(c.erasureId);
        if (!run) continue;
        if (c.scopeType === 'team') await this.processTeamRun(run);
        // C4-b：project scope run=DRAINING stage（同键锁排干+manifest 唯一采集面先行→PURGING_DB
        // 前置位停——介质批删 saga 归 C4-c）
        else await this.processProjectRun(run);
      }
    } catch (e) {
      this.logger.warn(`erasure poller tick 失败（下一 tick 重试）: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** CAS claim（独立事务提交——处理失败不丢 claim：租约到期即恢复锚）。PENDING→RUNNING 仅升不降
   *  （WAITING_CHILDREN 会合态保持）；谓词=无主∨租约过期∨本实例续租（多 worker 互斥）。 */
  private async claim(erasureId: string): Promise<ProjectErasureRun | null> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + ERASURE_RUN_LEASE_MS);
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.$executeRaw`
        UPDATE "ProjectErasureRun"
        SET "claimOwner" = ${this.claimOwner}, "leaseUntil" = ${leaseUntil}, "heartbeatAt" = ${now},
            state = CASE WHEN state = 'PENDING' THEN 'RUNNING' ELSE state END
        WHERE "erasureId" = ${erasureId}
          AND ("claimOwner" IS NULL OR "leaseUntil" < ${now} OR "claimOwner" = ${this.claimOwner})`;
      if (res === 0) return null;
      return tx.projectErasureRun.findUniqueOrThrow({ where: { erasureId } });
    });
  }

  /** team run 处理：分批置 DELETING+子 run 置入（批未尽=RUNNING 续批；批尽=会合判定）。
   *  ErasureContext 包裹=DISBANDING 写豁免（worker=唯一合法擦除态写者）+includeDeleted（DELETING
   *  行是工作对象）；锁序=lockScope①→fenceTeam②→批选择 FOR SHARE③。 */
  private async processTeamRun(run: ProjectErasureRun): Promise<void> {
    const teamId = run.teamId ?? run.scopeId;
    await this.erasureCtx.withErasure(run.erasureId, () => runWithIncludeDeleted(() =>
      this.prisma.$transaction(async (tx) => {
        await lockScope(tx, 'team', run.scopeId);
        await fenceTeam(tx, run.scopeId);   // DISBANDING∧ErasureContext→豁免放行（行缺失折 ACTIVE）
        // 分批游标：谓词 lifecycleState='ACTIVE'（已置行退出谓词集——多 tick 单调排空）；id 序批选择
        // （确定性扫描）+FOR SHARE（与并发写事务互斥——批 UPDATE 等全部 FOR SHARE 持有者=红⑤零复活）。
        const batch = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "CanvasProject"
          WHERE "teamId" = ${run.scopeId}::text AND "lifecycleState" = 'ACTIVE'
          ORDER BY id LIMIT ${TEAM_TOMBSTONE_BATCH}
          FOR SHARE`;
        const now = new Date();
        if (batch.length > 0) {
          for (const p of batch) {
            await createErasureRun(tx, {
              scopeType: 'project', scopeId: p.id, requestedBy: run.requestedBy,
              parentRunId: run.erasureId, teamId,
            });
          }
          await tx.$executeRaw(Prisma.sql`
            UPDATE "CanvasProject" SET "lifecycleState" = 'DELETING'
            WHERE id IN (${Prisma.join(batch.map((p) => p.id))})`);
          const drained = batch.length < TEAM_TOMBSTONE_BATCH;
          await tx.projectErasureRun.update({
            where: { erasureId: run.erasureId },
            data: {
              ...(drained ? { state: 'WAITING_CHILDREN' as const } : {}),
              heartbeatAt: now, leaseUntil: new Date(now.getTime() + ERASURE_RUN_LEASE_MS),
            },
          });
          return;
        }
        // 会合判定（批尽）：子 run 任一 FAILED→team run FAILED（不删 Team）；子全 DONE（含零子=空团队
        // 直达）→PURGING_TEAM（ledger 通行证——team.delete 级联 TeamBalance 触发 ledger_guard）→删
        // Team 行→DONE；仍有活跃子→WAITING_CHILDREN+心跳。
        const children = await tx.projectErasureRun.findMany({
          where: { parentRunId: run.erasureId }, select: { state: true },
        });
        const failed = children.filter((c) => c.state === 'FAILED').length;
        const active = children.filter((c) => (ERASURE_ACTIVE_STATES as readonly string[]).includes(c.state)).length;
        if (failed > 0) {
          await tx.projectErasureRun.update({
            where: { erasureId: run.erasureId },
            data: { state: 'FAILED', error: `子擦除 run 失败（${failed}/${children.length}）——Team 行保留`, completedAt: now, claimOwner: null, leaseUntil: null },
          });
          this.logger.warn(`erasure team run ${run.erasureId} FAILED：子 run 失败 ${failed}/${children.length}（Team ${teamId} 保留——re-drive 归 C4-c ops 面）`);
          return;
        }
        if (active === 0) {
          // 子全 DONE（含用户先删的项目子 run 由其自身 run 承载不入本 parentRunId 集——已删项目行级联无面）
          await this.ledger.ledgerTx(tx);   // 通行证：team.delete 级联 TeamBalance 触发 ledger_guard（Z89 同款）
          try {
            await tx.team.delete({ where: { id: teamId } });
          } catch (e) {
            // 评审 P2-1（C4-a spec 评审 2026-11-06）：Team 行已缺失（out-of-band 删/PITR 形态）——目标态
            // 已达成（Team 不在），P2025 折幂等成功置 DONE；裸抛=整事务回滚 run 永悬 WAITING_CHILDREN
            // 每 tick WARN 无限重试（毒丸）。其他错误照抛（租约恢复面下一 tick 重试）。
            if ((e as { code?: string })?.code !== 'P2025') throw e;
          }
          await tx.projectErasureRun.update({
            where: { erasureId: run.erasureId },
            data: { state: 'DONE', stage: 'PURGING_TEAM', completedAt: now, claimOwner: null, leaseUntil: null },
          });
          return;
        }
        await tx.projectErasureRun.update({
          where: { erasureId: run.erasureId },
          data: { state: 'WAITING_CHILDREN', heartbeatAt: now, leaseUntil: new Date(now.getTime() + ERASURE_RUN_LEASE_MS) },
        });
      }, { timeout: TEAM_TX_TIMEOUT_MS, maxWait: 10_000 }),
    )).catch((e: unknown) => {
      this.logger.warn(`erasure team run ${run.erasureId} 处理失败（租约到期重认领——下一 tick 重试）: ${(e as Error).message}`);
    });
  }

  /** C4-b（plan Task C4-2——project run DRAINING stage）：三步（R15/R16）：
   *  ①排干：单事务 lockProject（同键 advisory——**等待**在飞写事务〔appendBatch/vacuumReplace/admit/
   *    claim 同键〕排空；fence 已拒新写者=排干后行集冻结）+fenceProject（ErasureContext 内 DELETING
   *    豁免——worker=唯一合法 DELETING 写者）+行集采集（media/work——DELETING 行是工作对象经
   *    runWithIncludeDeleted）+置 state=DRAINING；
   *  ②manifest 落盘（事务外——temp→fsync→rename→fsync dir；**唯一采集面**：kill -9 于 ①后②前=
   *    重跑幂等覆盖〔行集已冻结〕，于②后③前=DB 无索引但文件在=下一 tick 重写收敛）；
   *  ③DB 索引+前置位：manifestPath/manifestSha256 落 run 行+state=PURGING_DB **即停**（介质批删
   *    saga/状态机续跑归 C4-c）。幂等档：state=PURGING_DB∧manifestPath 在=已前置位 skip。 */
  private async processProjectRun(run: ProjectErasureRun): Promise<void> {
    const pid = run.scopeId;
    await this.erasureCtx.withErasure(run.erasureId, () => runWithIncludeDeleted(async () => {
      if (run.state === 'PURGING_DB' && run.manifestPath) return;   // 前置位已达成（C4-c 续）
      // ①排干+采集+置 DRAINING（单事务——advisory 等待即「DRAINING 只持锁排干在飞」的执法点）
      const inputs = await this.prisma.$transaction(async (tx) => {
        await lockProject(tx, pid);   // 同键锁等待排干（在飞写者持锁期间本事务阻塞）
        await fenceProject(tx, pid);  // DELETING∧ErasureContext→豁免（行缺失折 ACTIVE——FK 域）
        const [mediaRows, workRows] = await Promise.all([
          tx.$queryRaw<ErasureManifestInputs['mediaRows']>`
            SELECT id, bucket, key, "thumbnailKey", "objectKey", size FROM "Media"
            WHERE "projectId" = ${pid}::text ORDER BY id`,
          tx.$queryRaw<ErasureManifestInputs['workRows']>`
            SELECT id, "canvasProjectId", "videoKey", "coverKey" FROM "VideoWork"
            WHERE "canvasProjectId" = ${pid}::text ORDER BY id`,
        ]);
        await tx.projectErasureRun.update({
          where: { erasureId: run.erasureId },
          data: {
            state: 'DRAINING',
            heartbeatAt: new Date(), leaseUntil: new Date(Date.now() + ERASURE_RUN_LEASE_MS),
          },
        });
        return { mediaRows, workRows };
      }, { timeout: PROJECT_TX_TIMEOUT_MS, maxWait: 10_000 });
      // ②manifest 落盘（spool 段=共享盘面 dir 扫描——worker/api 同机部署形态）
      const spoolDir = process.env.COLLAB_SPOOL_DIR ?? join(process.cwd(), '.data', 'collab-spool');
      const manifestInputs: ErasureManifestInputs = {
        erasureId: run.erasureId, scopeType: 'project', scopeId: pid, projectIds: [pid],
        requestedAt: run.requestedAt, mediaRows: inputs.mediaRows, workRows: inputs.workRows,
        spoolSegs: await collectSpoolSegments(spoolDir, [pid]),
      };
      const manifest = await writeErasureManifest(manifestInputs);
      // ③DB 索引+前置位（PURGING_DB 即停——C4-c 续介质 saga）
      await this.prisma.projectErasureRun.update({
        where: { erasureId: run.erasureId },
        data: {
          state: 'PURGING_DB', stage: 'DRAINING',
          manifestPath: manifest.manifestPath, manifestSha256: manifest.manifestSha256,
          heartbeatAt: new Date(), leaseUntil: new Date(Date.now() + ERASURE_RUN_LEASE_MS),
        },
      });
      this.logger.log(JSON.stringify({
        event: 'erasure_manifest_written', erasureId: run.erasureId, projectId: pid,
        rows: manifest.rows, manifestPath: manifest.manifestPath,
        note: 'PURGING_DB 前置位（介质 saga 归 C4-c）',
      }));
    })).catch((e: unknown) => {
      this.logger.warn(`erasure project run ${run.erasureId} DRAINING 失败（租约到期重认领——下一 tick 重试）: ${(e as Error).message}`);
    });
  }
}
