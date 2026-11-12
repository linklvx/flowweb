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
// project scope run：claim+RUNNING+租约心跳（PENDING→RUNNING 的 liveness 证明）。**C4-c2 完整 saga
// 接线**：PURGING_DB（c1 执行体）→PURGING_OBJECTS（对象删除+版本化 capability detect）→PURGING_CACHE
// （purgeScope 首步+Redis 全前缀清）→VERIFYING（三重复验）→DONE（team 会合自动推进面）；per-run
// catch 升级 attempts≥N→FAILED（毒丸上界——spec P1-13：claim+attempts/backoff，重试间隔=租约窗
// 〔60s 常数退避〕，re-drive 清 attempts 重数）。dryRun run 不消费（完整 DRY_RUN 语义=执行体直调预览）。
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ProjectErasureRun } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithIncludeDeleted } from '../../prisma/read-path.filter';
import { MinioService } from '../minio/minio.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { ErasureContextService, lockScope, lockProject, fenceProject, fenceTeam } from './project-lock';
import { createErasureRun, ERASURE_ACTIVE_STATES, ERASURE_RUN_LEASE_MS, ERASURE_RUN_MAX_ATTEMPTS } from './project-erasure';
import { collectSpoolSegments, writeErasureManifest, collabSpoolDir, type ErasureManifestInputs } from './project-erasure.manifest';
import { executePurgingDbStage, httpMediaRefsCollector, type MediaRefsCollector } from './project-erasure.stages';
import { executePurgingObjectsStage, type ErasureObjectPort } from './project-erasure.objects';
import { executePurgingCacheStage, httpPurgeScope, type PurgeScopeClient, type RedisPurgePort } from './project-erasure.cache';
import { executeVerifyingStage } from './project-erasure.verifying';
import { erasurePendingAge, erasureRunsTotal } from './erasure.metrics';

/** 轮询周期（时间门基线：run 行=唤醒源，间隔即红④兜底延迟上界；env 可调——RETENTION_SWEEP_INTERVAL_MS 同族形态）。 */
export const ERASURE_POLL_INTERVAL_MS = Number(process.env.ERASURE_POLL_INTERVAL_MS) || 5_000;
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
    /** C4-c1：未 reconcile 引用采集器（PURGING_DB 独占判别 doc 扫描——api 内部端点客户端）。
     *  缺省=构造期惰性解析 httpMediaRefsCollector；int 测试注入 stub。 */
    @Optional() private readonly mediaRefs?: MediaRefsCollector,
    /** C4-c2：对象删除端口（PURGING_OBJECTS/VERIFYING——worker.module MinioModule @Global 注入；
     *  int 测试注入 MinioService（temp bucket 绑定）或 stub）。 */
    @Optional() @Inject(MinioService) private readonly objects?: ErasureObjectPort,
    /** C4-c2：Redis 清除端口（PURGING_CACHE/VERIFYING——worker.module REDIS_CLIENT 注入；ioredis
     *  结构子集三面可赋）。 */
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: RedisPurgePort,
    /** C4-c2：purgeScope 客户端（PURGING_CACHE 首步——api 内部端点；缺省 httpPurgeScope）。 */
    @Optional() private readonly purgeScope?: PurgeScopeClient,
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
      // C4-c2：erasure_pending_age gauge 维护（每 tick 重算——max(now-requestedAt) over active 态
      // ∧非 dryRun；worker 3002 出口，THRESHOLDS P0@1h 消费）
      await this.refreshPendingAge().catch(() => undefined);
      const candidates = await this.prisma.projectErasureRun.findMany({
        where: {
          dryRun: false,
          OR: [
            { scopeType: 'team', state: { in: ['PENDING', 'RUNNING', 'WAITING_CHILDREN'] } },
          // C4-b：project 含 DRAINING（kill -9 于 ①置 DRAINING 与 ③PURGING_DB 之间=重跑幂等收敛）
          // C4-c1：含 PURGING_DB（DB 介质批删 saga——project-erasure.stages 执行体）
          // C4-c2：含 PURGING_OBJECTS/PURGING_CACHE/VERIFYING（对象/Redis/复验 saga——stages/objects/
          //  cache/verifying 执行体；红⑪ 完整锚：kill -9 各 stage→tick 重认领续跑至 DONE）
          { scopeType: 'project', state: { in: ['PENDING', 'RUNNING', 'DRAINING', 'PURGING_DB', 'PURGING_OBJECTS', 'PURGING_CACHE', 'VERIFYING'] } },
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
        // C4-b/C4-c1/C4-c2：project scope run saga 态机路由（DRAINING→PURGING_DB→PURGING_OBJECTS→
        // PURGING_CACHE→VERIFYING→DONE——每态执行体独立文件）
        else await this.processProjectRun(run);
      }
    } catch (e) {
      this.logger.warn(`erasure poller tick 失败（下一 tick 重试）: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** erasure_pending_age gauge 重算（active 态∧非 dryRun 的最老 requestedAt 年龄毫秒；无活跃 run=0）。 */
  private async refreshPendingAge(): Promise<void> {
    const oldest = await this.prisma.projectErasureRun.findFirst({
      where: { dryRun: false, state: { in: [...ERASURE_ACTIVE_STATES] } },
      orderBy: { requestedAt: 'asc' },
      select: { requestedAt: true },
    });
    erasurePendingAge.set(oldest ? Date.now() - oldest.requestedAt.getTime() : 0);
  }

  /**
   * P2-2 骑手（毒丸 run FAILED 上界——spec P1-13 claim+attempts/backoff）：per-run catch 升级——
   * 处理失败 attempts+1；连续失败达 ERASURE_RUN_MAX_ATTEMPTS→FAILED+error 置档（终态：claim/lease
   * 清空，partial unique 释放——re-drive 面）；未达界=租约窗（60s 常数）到期重认领=退避。
   * pending-review/pending-api 类**非失败** outcome（执行体内部 state 续租）不经本面。
   */
  private async noteRunFailure(run: ProjectErasureRun, stage: string, e: unknown): Promise<void> {
    const attempts = run.attempts + 1;
    const message = `${stage} 失败: ${(e as Error).message}`.slice(0, 500);
    if (attempts >= ERASURE_RUN_MAX_ATTEMPTS) {
      await this.prisma.projectErasureRun.update({
        where: { erasureId: run.erasureId },
        data: { state: 'FAILED', error: message, attempts, completedAt: new Date(), claimOwner: null, leaseUntil: null },
      }).catch(() => undefined);
      erasureRunsTotal.inc({ state: 'FAILED' });
      this.logger.error(`erasure run ${run.erasureId} 连续失败 ${attempts} 次→FAILED（毒丸上界——re-drive 面人工处置）: ${message}`);
      return;
    }
    await this.prisma.projectErasureRun.update({
      where: { erasureId: run.erasureId },
      // P2-1 真退避：leaseUntil 刷 now+60s（=ERASURE_RUN_LEASE_MS）——claim 谓词 attempts>0 分支
      // 须待该窗过期才重认领（同实例 5s tick 连发重试根修——「重试间隔=租约窗」注释与实现不符的兑现）
      data: { attempts, leaseUntil: new Date(Date.now() + ERASURE_RUN_LEASE_MS) },
    }).catch(() => undefined);
    this.logger.warn(`erasure run ${run.erasureId} ${stage} 失败（attempts ${attempts}/${ERASURE_RUN_MAX_ATTEMPTS}——退避窗 ${ERASURE_RUN_LEASE_MS / 1000}s 后租约到期重认领）: ${message}`);
  }

  /** CAS claim（独立事务提交——处理失败不丢 claim：租约到期即恢复锚）。PENDING→RUNNING 仅升不降
   *  （WAITING_CHILDREN 会合态保持）；谓词三分（多 worker 互斥+**P2-1 真退避**）：
   *   ①租约过期（任意实例可认领——kill -9 恢复/他实例接管）∨ ②无主（首认领）∨ ③本实例∧attempts=0
   *   （健康在飞 saga 无缝续接——**attempts>0 时本实例亦须待租约过期**：noteRunFailure 已把
   *   leaseUntil 刷为 now+60s=退避窗，同实例 5s tick 不再连发重试烧满上界——瞬时故障误杀根修）。
   *  attempts 于成功推进位清零（stages/objects/cache/verifying+poller〔project 双推进位+team 批置/
   *  WAITING_CHILDREN/DONE——C4-c2 质量 M4〕——「连续失败」计数语义；一次瞬时失败后的健康 saga
   *  不吃逐 stage 60s 停顿、不跨成功累计达界）。 */
  private async claim(erasureId: string): Promise<ProjectErasureRun | null> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + ERASURE_RUN_LEASE_MS);
    return this.prisma.$transaction(async (tx) => {
      // ★时区基准（C1 rebaseline 终态）：leaseUntil/heartbeatAt 列=timestamptz(3)——raw 绑定 Date 与
      // 列同族直接比较/赋值=瞬时语义，会话时区无关（naive 列时代的补偿式时区转换已随 C1 拆除；
      // 彼时 naive 列按会话时区重解释曾致「leaseUntil < now」恒 TRUE 的潜伏 bug）。
      const res = await tx.$executeRaw`
        UPDATE "ProjectErasureRun"
        SET "claimOwner" = ${this.claimOwner}, "leaseUntil" = ${leaseUntil}, "heartbeatAt" = ${now},
            state = CASE WHEN state = 'PENDING' THEN 'RUNNING' ELSE state END
        WHERE "erasureId" = ${erasureId}
          AND ("leaseUntil" < ${now}
               OR "claimOwner" IS NULL
               OR ("claimOwner" = ${this.claimOwner} AND "attempts" = 0))`;
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
              attempts: 0,   // P2-1（C4-c2 质量 M4）：成功推进清零——team run 瞬时失败后不吃逐窗停顿/跨成功累计
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
          erasureRunsTotal.inc({ state: 'FAILED' });
          this.logger.warn(`erasure team run ${run.erasureId} FAILED：子 run 失败 ${failed}/${children.length}（Team ${teamId} 保留——re-drive 归 ops 面）`);
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
            data: { state: 'DONE', stage: 'PURGING_TEAM', completedAt: now, claimOwner: null, leaseUntil: null, attempts: 0 },
          });
          erasureRunsTotal.inc({ state: 'DONE' });
          return;
        }
        await tx.projectErasureRun.update({
          where: { erasureId: run.erasureId },
          data: { state: 'WAITING_CHILDREN', heartbeatAt: now, leaseUntil: new Date(now.getTime() + ERASURE_RUN_LEASE_MS), attempts: 0 },
        });
      }, { timeout: TEAM_TX_TIMEOUT_MS, maxWait: 10_000 }),
    )).catch((e: unknown) => {
      void this.noteRunFailure(run, 'TEAM', e);
    });
  }

  /** C4-b（plan Task C4-2——project run DRAINING stage）+C4-c1（plan Task C4-3——PURGING_DB 执行体
   *  接线）：DRAINING 三步（R15/R16）：
   *  ①排干：单事务 lockProject（同键 advisory——**等待**在飞写事务〔appendBatch/vacuumReplace/admit/
   *    claim 同键〕排空；fence 已拒新写者=排干后行集冻结）+fenceProject（ErasureContext 内 DELETING
   *    豁免——worker=唯一合法 DELETING 写者）+行集采集（media/work——DELETING 行是工作对象经
   *    runWithIncludeDeleted）+置 state=DRAINING；
   *  ②manifest 落盘（事务外——temp→fsync→rename→fsync dir；**唯一采集面**：kill -9 于 ①后②前=
   *    重跑幂等覆盖〔行集已冻结〕，于②后③前=DB 无索引但文件在=下一 tick 重写收敛）；
   *  ③DB 索引+前置位：manifestPath/manifestSha256 落 run 行+state=PURGING_DB（**下一 tick** 进
   *    执行体——C4-c1 PURGING_DB saga：二扫并集→Media 三档/批删/scrub/detach→列级断言→
   *    PURGING_OBJECTS 即停）。幂等档：state=PURGING_DB∧manifestPath 在=执行体承接（二扫并集
   *    契约已由 project-erasure.stages 兑现——本函数只剩骨架流转）。
   *  **C4-c 契约（spec 评审 P1，C4-c1 已兑现）**：PURGING_DB 首步=**二扫并集**——Media/VideoWork 在飞
   *  finalize（claim 先于 tombstone；registerInTx artifact-commit :288/:312）与 coverKey 换绑可在
   *  DRAINING 采集后落新行/新 S3 键（Canvas 族无此窗——fence 拒其全部写者）⇒ 进批删前重扫取并集
   *  （executePurgingDbStage ②）——「DRAINING 前等待在飞 intent 清算」备选不采（定形依据见 spec）。
   *  mediaRefs 采集器：构造期注入缺省 httpMediaRefsCollector（api 内部端点客户端）。 */
  private async processProjectRun(run: ProjectErasureRun): Promise<void> {
    const pid = run.scopeId;
    // C4-c1：PURGING_DB 前置位=执行体承接（DB 介质批删+scrub+detach+两阶段复核+列级断言）。
    // per-run catch（DRAINING/team 面同律）：单 run 毒丸〔manifest 损坏/断言红〕不吞本 tick 其余
    // 候选——C4-c2 升级 attempts 计数（noteRunFailure：连续失败 N 次→FAILED 毒丸上界）。
    if (run.state === 'PURGING_DB' && run.manifestPath) {
      await executePurgingDbStage({
        prisma: this.prisma, run,
        collectMediaRefs: this.mediaRefs ?? httpMediaRefsCollector(),
        spoolDir: collabSpoolDir(),
      }).catch(async (e: unknown) => { await this.noteRunFailure(run, 'PURGING_DB', e); });
      return;
    }
    // C4-c2：PURGING_OBJECTS（对象删除+版本化 capability detect+multipart 残件——project-erasure.objects）。
    // 端口缺席（裸构造测试面）=per-run 失败走 attempts 计数（禁裸抛吞本 tick 其余候选——单 run 隔离律）。
    if (run.state === 'PURGING_OBJECTS' && run.manifestPath) {
      if (!this.objects) { await this.noteRunFailure(run, 'PURGING_OBJECTS', new Error('缺少对象删除端口（MinioService——worker.module 装配）')); return; }
      await executePurgingObjectsStage({ prisma: this.prisma, run, objects: this.objects })
        .catch(async (e: unknown) => { await this.noteRunFailure(run, 'PURGING_OBJECTS', e); });
      return;
    }
    // C4-c2：PURGING_CACHE（purgeScope 首步 fail-closed+Redis 全前缀清——project-erasure.cache）
    if (run.state === 'PURGING_CACHE' && run.manifestPath) {
      if (!this.redis) { await this.noteRunFailure(run, 'PURGING_CACHE', new Error('缺少 Redis 端口（REDIS_CLIENT——worker.module 装配）')); return; }
      await executePurgingCacheStage({ prisma: this.prisma, run, redis: this.redis, purgeScope: this.purgeScope ?? httpPurgeScope() })
        .catch(async (e: unknown) => { await this.noteRunFailure(run, 'PURGING_CACHE', e); });
      return;
    }
    // C4-c2：VERIFYING（三重复验→DONE——project-erasure.verifying；team run WAITING_CHILDREN 会合
    // 判定由此自动推进：子 run DONE 链在 processTeamRun 每 tick 重判）
    if (run.state === 'VERIFYING' && run.manifestPath) {
      if (!this.objects || !this.redis) { await this.noteRunFailure(run, 'VERIFYING', new Error('缺少对象+Redis 端口（worker.module 装配）')); return; }
      await executeVerifyingStage({ prisma: this.prisma, run, objects: this.objects, redis: this.redis })
        .catch(async (e: unknown) => { await this.noteRunFailure(run, 'VERIFYING', e); });
      return;
    }
    await this.erasureCtx.withErasure(run.erasureId, () => runWithIncludeDeleted(async () => {
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
            attempts: 0,   // P2-1：成功推进清零连续失败计数（claim attempts=0 分支=健康无缝续接）
          },
        });
        erasureRunsTotal.inc({ state: 'DRAINING' });
        return { mediaRows, workRows };
      }, { timeout: PROJECT_TX_TIMEOUT_MS, maxWait: 10_000 });
      // ②manifest 落盘（spool 段=共享盘面 dir 扫描——worker/api 同机部署形态）
      const spoolDir = collabSpoolDir();
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
          attempts: 0,
        },
      });
      erasureRunsTotal.inc({ state: 'PURGING_DB' });
      this.logger.log(JSON.stringify({
        event: 'erasure_manifest_written', erasureId: run.erasureId, projectId: pid,
        rows: manifest.rows, manifestPath: manifest.manifestPath,
        note: 'PURGING_DB 前置位（下一 tick 进执行体——stages 承接介质 saga）',
      }));
    })).catch((e: unknown) => {
      void this.noteRunFailure(run, 'DRAINING', e);
    });
  }
}
