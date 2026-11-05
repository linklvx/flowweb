// apps/api/src/modules/collab/collab-replay-canary.poller.ts
// C2-2a（plan Task C2-2 捕获侧——生产就绪收尾批，spec v5 §3 C2）：replay canary DB poller
// （**api 进程**——CollabCompactPoller/RetentionSweeperPoller 同款「OnModuleInit+原生 setInterval unref」
// 形态；注册面=collab.module providers〔role api|all——worker 进程无活 doc/withFrozenPrefix 面〕）。
// 捕获面在 api 的根因：withFrozenPrefix 的冻结临界区以进程内活 doc 为载体（gateway documents 表）——
// 比对重放侧归 worker（C2-2b collab-canary-verify.worker），捕获侧必须与 doc 同进程。
// 每 tick：
//  ①首步 isLeaseServing()（gateway collabState==='serving' 单源判定——V12：lease 未持有时不触
//    withFrozenPrefix，skip 计数零捕获面）；
//  ②TTL 过期清扫（每 tick 顺带——DELETE WHERE expiresAt<now；spec §3 C2「过期清扫」载体。
//    独立于 serving 判定：过期 pin 回收是卫生面非捕获面，非 serving tick 照扫）；
//  ③**覆盖 SLO 排程（C2-2b 重写——charter「每小时轮转 replay canary（全局每小时+每活跃项目 ≤24h）」）**：
//    active=CanvasDoc.updatedAt>now−7d∧lifecycleState='ACTIVE'（spec §3 C2 覆盖口径）；
//    N=ceil(active×1.25/24)=**每 tick 候选上界**（1.25 系数=24h SLO 的排程余量；稳态 due 率
//    ~active/19.2h ≪ N/tick——N 的真实作用=boot/停机后积压一轮清上限；单 tick 捕获 cap 8 保
//    冻结临界区 CPU 预算）；候选=due（游标 nextDueAt≤now∨无游标）∧ACTIVE∧maintenanceId 空∧
//    无未过期 pin（**永久 skip 态 SQL 前置排除——skip 档饥饿根除〔C2-2a 评审 P2〕：skip 档不写
//    游标+最旧优先排序=头部永久 skip 项目垄断每 tick 的形态根除**）lastCheckedAt 最旧优先轮转；
//  ④skip 判定链（SQL 排除后的竞态窗兜底）：进程内维护 freeze 面（maintenanceId DB 行 REQUESTED 起
//    vs isFrozen FREEZING 起两面并查的窄窗承接）；withFrozenPrefix 拒档分类：no-doc→skip-no-doc；
//    **flush-timeout→skip-lag**（C2-2b：spec §3 C2「skip_lag 连续 3→P0」分层兜底——flush 滞留
//    〔appliedSeq 未达 PG〕的 canary 盲区面，THRESHOLDS 承接）；gate-timeout→skip-freeze（freeze
//    mutex 争用/换代窗）；**每档均写游标+nextDueAt**（P2：skip 档推进轮转不滞留头部）；
//  ⑤捕获（collab-replay-canary.service 捕获协议五步——withFrozenPrefix fn 内；冻结临界区预算
//    500ms/项目〔gateBudgetMs 默认〕+每项目 ~19h 低频=排程天然——freeze 争用披露，runbook §14）；
//  ⑥CollabCanaryCursor 写（lastCheckedAt/lastResult/generation 随捕获真值覆写=换代游标重置；
//    **nextDueAt=now+ceil(active/N)h≈19.2h**〔24h/1.25 余量：tick 逃逸/维护窗吸收后仍 ≤24h〕；
//    瞬态失败档〔capture-failed/skip-no-doc/skip-lag/skip-freeze〕nextDueAt=+interval 快重试）。
// skip-pin-active 档（C2-2a 形态）已随候选 SQL 前置排除退役（P3-2：skip-pin-active 游标 generation
// 占位形态不复存在——pin 在场期候选不可见，worker verify〔C2-2b〕承接 pin 消费与游标换代重置）。
// 指标=collab-canary.metrics.ts 单源（source=api 3000）；计数挂动作后（失败回滚不虚计家族纪律）。
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabProjectActorService } from './collab-project-actor.service';
import { captureCanaryPin, writeCanaryCursor } from './collab-replay-canary.service';
import { collabCanaryPollTickTotal } from './collab-canary.metrics';

/** tick 周期（env 可调——COMPACT_POLL_INTERVAL_MS 同族形态：值经 dotenv 先行在位、Number()|| 默认
 *  缺省档、消费面=api 轮询周期非部署档位；canary 每项目 ≤24h/全局每小时——分钟级轮转即达）。 */
export const CANARY_POLL_INTERVAL_MS = Number(process.env.CANARY_POLL_INTERVAL_MS) || 60_000;
/** 覆盖 SLO 排程常量（spec §3 C2：N=ceil(active×1.25/24)+「全局每小时+每活跃项目 ≤24h」双层 SLO）。 */
const CANARY_DUE_HEADROOM = 1.25;
const CANARY_DUE_SLO_HOURS = 24;
/** 每 tick 捕获硬上界（每项目一次 withFrozenPrefix 冻结临界区〔gate 预算 500ms〕——N 大 fleet 时
 *  的 CPU 预算护栏；稳态 due 率 ~active/19.2h ≪ 本界，仅 boot/停机积压清场生效）。 */
const CANARY_POLL_BATCH_CAP = 8;

/** serving 判定最小接口（消费=gateway.isLeaseServing——collabState==='serving' 单源；结构注入面
 *  供 int 装置桩接，与 CollabGateway/CollabMaintenanceService 结构兼容）。 */
export interface CanaryServingProbe { isLeaseServing(): boolean }
/** 维护窗判定最小接口（消费=CollabMaintenanceService.isFrozen——进程内 freeze 面〔FREEZING 起〕；
 *  DB maintenanceId〔REQUESTED 起〕在候选 SQL 前置排除，本面=两面并查的窄窗承接）。 */
export interface CanaryMaintenanceProbe { isFrozen(pid: string): boolean }
/** DI token（useExisting 转发既有 provider——gateway/maintenance 结构满足接口；token 面=测试
 *  直构不解析 DI 的同族惯例）。 */
export const CANARY_SERVING_PROBE = Symbol('CANARY_SERVING_PROBE');
export const CANARY_MAINTENANCE_PROBE = Symbol('CANARY_MAINTENANCE_PROBE');

@Injectable()
export class CollabReplayCanaryPoller implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CollabReplayCanaryPoller.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 单飞互斥（setInterval 漏 tick 防叠跑——捕获持冻结临界区，防重入）。 */
  private running = false;
  /** 项目宇宙测试隔离缝（C1-1 auditScope 同族可测性注入——int 套件串行文件共享 dev 库：候选
   *  选择断言域内化；生产不设=全域零行为变化）。 */
  captureScope: readonly string[] | undefined;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CollabProjectActorService) private readonly actor: CollabProjectActorService,
    @Inject(CANARY_SERVING_PROBE) private readonly serving: CanaryServingProbe,
    @Inject(CANARY_MAINTENANCE_PROBE) private readonly maintenance: CanaryMaintenanceProbe,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.tick(); }, CANARY_POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** 游标写统一口（C2-2a 评审 Minor#5：skip 路径静默 vs captured warn 的不对齐根除——全档 warn）。 */
  private async writeCursor(pid: string, generation: number, lastResult: string, nextDueInSec: number): Promise<void> {
    await writeCanaryCursor(this.prisma, pid, generation, lastResult, nextDueInSec).catch((e) => {
      this.logger.warn(`canary cursor write failed for ${pid}: ${(e as Error).message}（游标下轮补写）`);
    });
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // ② TTL 过期清扫（卫生面——非 serving 也扫：先于 serving 判定，过期 pin 不滞留到下次持租）
      await this.prisma.$executeRaw`DELETE FROM "CanaryPin" WHERE "expiresAt" < now()`;
      // ① 首步 isLeaseServing（V12 单源判据——非 serving 不触 withFrozenPrefix）
      if (!this.serving.isLeaseServing()) {
        collabCanaryPollTickTotal.inc({ result: 'skip-not-serving' });
        return;
      }
      // ③ 覆盖 SLO 排程：active→N=ceil(active×1.25/24)→候选批=min(N, cap)
      const scopeSql = this.captureScope ? Prisma.sql` AND p.id = ANY(${this.captureScope}::text[])` : Prisma.empty;
      const activeRows = await this.prisma.$queryRaw<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM "CanvasProject" p
        JOIN "CanvasDoc" d ON d."projectId" = p.id
        WHERE p."lifecycleState" = 'ACTIVE' AND d."updatedAt" > now() - interval '7 days'${scopeSql}`;
      const active = activeRows[0]?.n ?? 0;
      const n = Math.max(1, Math.ceil((active * CANARY_DUE_HEADROOM) / CANARY_DUE_SLO_HOURS));
      const batch = Math.min(n, CANARY_POLL_BATCH_CAP);
      // 捕获成功/skip 档共用的 nextDue：ceil(active/N)h≈19.2h（24h/1.25 余量——charter ≤24h SLO）
      const dueInSec = Math.max(CANARY_POLL_INTERVAL_MS / 1000, Math.round((active / n) * 3600));
      // 候选选择（永久 skip 态 SQL 前置排除+最旧优先轮转——skip 档饥饿根除）
      const candidates = await this.prisma.$queryRaw<Array<{ projectId: string; maintenanceId: string | null; generation: number }>>`
        SELECT p.id AS "projectId", d."maintenanceId", d.generation
        FROM "CanvasProject" p
        JOIN "CanvasDoc" d ON d."projectId" = p.id
        LEFT JOIN "CollabCanaryCursor" c ON c."projectId" = p.id
        WHERE p."lifecycleState" = 'ACTIVE' AND d."maintenanceId" IS NULL
          AND NOT EXISTS (SELECT 1 FROM "CanaryPin" pin WHERE pin."projectId" = p.id AND pin."expiresAt" > now())
          AND COALESCE(c."nextDueAt", to_timestamp(0)) <= now()${scopeSql}
        ORDER BY c."lastCheckedAt" ASC NULLS FIRST, p.id ASC
        LIMIT ${batch}`;
      for (const cand of candidates) {
        const pid = cand.projectId;
        // ④ skip 判定链（SQL 排除后的竞态窗兜底——maintenanceId 选后落 DB〔REQUESTED 起〕∨进程内
        //    freeze 面〔FREEZING 起〕两面并查）
        if (cand.maintenanceId != null || this.maintenance.isFrozen(pid)) {
          collabCanaryPollTickTotal.inc({ result: 'skip-maintenance' });
          await this.writeCursor(pid, cand.generation, 'skip-maintenance', CANARY_POLL_INTERVAL_MS / 1000);
          continue;
        }
        // ⑤ 捕获（withFrozenPrefix fn 内五步协议）
        const r = await this.actor.withFrozenPrefix(pid, (ctx) =>
          captureCanaryPin(this.prisma, { projectId: pid, generation: ctx.generation ?? cand.generation, pgSeqAt: ctx.pgSeq, doc: ctx.doc }),
        );
        if (!r.ok) {
          // no-doc=活 doc 不在场；flush-timeout=**skip-lag**（spec §3 C2「skip_lag 连续 3→P0」分层
          // 兜底第一层——appliedSeq 未达 PG 的 canary 盲区）；gate-timeout=freeze mutex 争用/换代窗
          const result = r.reason === 'no-doc' ? 'skip-no-doc' : r.reason === 'flush-timeout' ? 'skip-lag' : 'skip-freeze';
          collabCanaryPollTickTotal.inc({ result });
          await this.writeCursor(pid, cand.generation, result, CANARY_POLL_INTERVAL_MS / 1000);
          continue;
        }
        const cap = r.value;
        if (!cap.ok) {
          collabCanaryPollTickTotal.inc({ result: 'capture-failed' });
          this.logger.warn(`canary capture failed for ${pid}: ${cap.reason}${cap.detail ? `（${cap.detail}）` : ''}`);   // Minor#1：error 档 detail 透出（service 返回类型化结果、调用方记日志）
          await this.writeCursor(pid, cand.generation, `capture-failed:${cap.reason}`, CANARY_POLL_INTERVAL_MS / 1000);
          continue;
        }
        collabCanaryPollTickTotal.inc({ result: cap.hashSkipped ? 'captured-hash-skipped' : 'captured' });
        // ⑥ 游标写（nextDueAt=+ceil(active/N)h——覆盖 SLO 排程；generation 随捕获真值覆写）
        await this.writeCursor(pid, cand.generation, cap.hashSkipped ? 'captured-hash-skipped' : 'captured', dueInSec);
      }
    } catch (e) {
      collabCanaryPollTickTotal.inc({ result: 'error' });
      this.logger.error(`canary poll tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
