// apps/api/src/modules/collab/collab-replay-canary.poller.ts
// C2-2a（plan Task C2-2 捕获侧——生产就绪收尾批，spec v5 §3 C2）：replay canary DB poller
// （**api 进程**——CollabCompactPoller/RetentionSweeperPoller 同款「OnModuleInit+原生 setInterval unref」
// 形态；注册面=collab.module providers〔role api|all——worker 进程无活 doc/withFrozenPrefix 面〕）。
// 捕获面在 api 的根因：withFrozenPrefix 的冻结临界区以进程内活 doc 为载体（gateway documents 表）——
// 比对重放侧归 worker（C2-2b），捕获侧必须与 doc 同进程。
// 每 tick：
//  ①首步 isLeaseServing()（gateway collabState==='serving' 单源判定——V12：lease 未持有时不触
//    withFrozenPrefix，skip 计数零捕获面）；
//  ②TTL 过期清扫（每 tick 顺带——DELETE WHERE expiresAt<now；spec §3 C2「过期清扫」载体。
//    独立于 serving 判定：过期 pin 回收是卫生面非捕获面，非 serving tick 照扫）；
//  ③候选选择（lifecycleState='ACTIVE'∧CanvasDoc 行在场∧due〔游标 nextDueAt≤now∨无游标〕，
//    lastCheckedAt 最旧优先轮转——覆盖节奏 N=ceil(active×1.25/24) 排程归 C2-2b〔nextDueAt 重写〕，
//    本面=轮转捕获每 tick 至多 1 项目〔冻结预算 500ms/项目×低频——freeze 争用披露面〕）；
//  ④skip 判定链：lifecycleState 非 ACTIVE→skip；维护窗（CanvasDoc.maintenanceId 在∨maintenance
//    进程内 freeze 面）→skip；同 pid 未过期 pin 在场→skip（worker verify〔C2-2b〕承接，不重复捕获）；
//  ⑤捕获（collab-replay-canary.service 捕获协议五步——withFrozenPrefix fn 内）；
//  ⑥CollabCanaryCursor 写（lastCheckedAt/lastResult/generation——nextDueAt 占位归 C2-2b 重写）。
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
/** 每 tick 捕获上界（每项目一次 withFrozenPrefix 冻结临界区〔gate 预算 500ms〕——单 tick 低并发
 *  保真；全项目覆盖由轮转×间隔承载）。 */
const CANARY_POLL_BATCH = 1;

/** serving 判定最小接口（消费=gateway.isLeaseServing——collabState==='serving' 单源；结构注入面
 *  供 int 装置桩接，与 CollabGateway/CollabMaintenanceService 结构兼容）。 */
export interface CanaryServingProbe { isLeaseServing(): boolean }
/** 维护窗判定最小接口（消费=CollabMaintenanceService.isFrozen——进程内 freeze 面〔FREEZING 起〕；
 *  DB maintenanceId〔REQUESTED 起〕在候选行随读，两面并查=受理前→FREEZING 全窗覆盖）。 */
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
      // ③ 候选选择（ACTIVE∧doc 在场∧due——lastCheckedAt 最旧优先轮转；captureScope 测试隔离缝）
      const scopeSql = this.captureScope ? Prisma.sql` AND p.id = ANY(${this.captureScope}::text[])` : Prisma.empty;
      const candidates = await this.prisma.$queryRaw<Array<{ projectId: string; maintenanceId: string | null; generation: number; inactive: boolean }>>`
        SELECT p.id AS "projectId", d."maintenanceId", d.generation,
               (p."lifecycleState" IS DISTINCT FROM 'ACTIVE') AS "inactive"
        FROM "CanvasProject" p
        JOIN "CanvasDoc" d ON d."projectId" = p.id
        LEFT JOIN "CollabCanaryCursor" c ON c."projectId" = p.id
        WHERE COALESCE(c."nextDueAt", to_timestamp(0)) <= now()${scopeSql}
        ORDER BY c."lastCheckedAt" ASC NULLS FIRST, p.id ASC
        LIMIT ${CANARY_POLL_BATCH}`;
      for (const cand of candidates) {
        const pid = cand.projectId;
        // ④ skip 判定链
        if (cand.inactive) { collabCanaryPollTickTotal.inc({ result: 'skip-lifecycle' }); continue; }
        if (cand.maintenanceId != null || this.maintenance.isFrozen(pid)) {
          collabCanaryPollTickTotal.inc({ result: 'skip-maintenance' });
          continue;
        }
        const pin = await this.prisma.$queryRaw<{ x: number }[]>`
          SELECT 1 AS x FROM "CanaryPin" WHERE "projectId" = ${pid}::text AND "expiresAt" > now() LIMIT 1`;
        if (pin.length > 0) {
          collabCanaryPollTickTotal.inc({ result: 'skip-pin-active' });
          await writeCanaryCursor(this.prisma, pid, cand.generation, 'pin-active', CANARY_POLL_INTERVAL_MS / 1000).catch(() => undefined);
          continue;
        }
        // ⑤ 捕获（withFrozenPrefix fn 内五步协议）
        const r = await this.actor.withFrozenPrefix(pid, (ctx) =>
          captureCanaryPin(this.prisma, { projectId: pid, generation: ctx.generation ?? cand.generation, pgSeqAt: ctx.pgSeq, doc: ctx.doc }),
        );
        if (!r.ok) {
          // gate-timeout/flush-timeout=冻结临界区拒（回退 PG 重建档语义——下轮再试）；no-doc=活 doc 不在场
          collabCanaryPollTickTotal.inc({ result: r.reason === 'no-doc' ? 'skip-no-doc' : 'skip-freeze' });
          continue;
        }
        const cap = r.value;
        if (!cap.ok) {
          collabCanaryPollTickTotal.inc({ result: 'capture-failed' });
          await writeCanaryCursor(this.prisma, pid, cand.generation, `capture-failed:${cap.reason}`, CANARY_POLL_INTERVAL_MS / 1000).catch(() => undefined);
          continue;
        }
        collabCanaryPollTickTotal.inc({ result: cap.hashSkipped ? 'captured-hash-skipped' : 'captured' });
        // ⑥ 游标写（lastCheckedAt/lastResult/generation；nextDueAt 占位——N 公式归 C2-2b）
        await writeCanaryCursor(this.prisma, pid, cand.generation, cap.hashSkipped ? 'captured-hash-skipped' : 'captured', CANARY_POLL_INTERVAL_MS / 1000).catch((e) => {
          this.logger.warn(`canary cursor write failed for ${pid}: ${(e as Error).message}（捕获已落 pin——游标下轮补写）`);
        });
      }
    } catch (e) {
      collabCanaryPollTickTotal.inc({ result: 'error' });
      this.logger.error(`canary poll tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
