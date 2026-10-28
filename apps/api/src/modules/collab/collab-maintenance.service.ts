// apps/api/src/modules/collab/collab-maintenance.service.ts
// Y1c T27（plan :354-361——spec §6.6 v5.4）：维护窗口+世代切换状态机（9 主段+2 终态——**单换代入口**）。
//
// ═══ 状态机（stage 单源=MaintenanceOperation；转移判定=shared canTransitionMaintenanceStage）═══
//   REQUESTED→FREEZING→DRAINING→DRAINED→EXPORTING→REBUILDING→SWITCHING→VERIFYING→COMPLETED
//                                     ↘FAILED（任意阶段：保持只读+告警+人工显式 resume——不自动恢复写）
//                                     ↘ABORTED（仅 SWITCHING 之前可 abort 解冻恢复）
//
// · REQUESTED=**同一 PG 事务**写 MaintenanceOperation+CanvasDoc.maintenanceId（行级关闸——UPDATE 拿
//   行锁 IS NULL 守卫；执行受理读 IS NULL 才放行〔rejectIfMaintenanceActiveInTx=受理落库事务内 FOR SHARE
//   复核——非 check-then-act〕；**先关入口再查/等 in-flight**：in-flight 判定范围=GenerationIntent/
//   ExecutionNodePlan+ExecutionOutbox/delivery·materialize 在飞/退款义务，drain 在 DRAINING 段等终态
//   或换代后 generation fence 显式拒绝〔v5.4⑯〕）。sensitive 操作同事务写 DocAuditEvent(kind='maintenance')。
// · FREEZING=进程内 freeze 面（isFrozen）+**4413 完整 close 投递**（附言①：stateless 载荷
//   {code:4413,reason:'maintenance-freeze',retryAfterMs}+hardClose 两段——T24 closeUpgradeTerminal 码
//   权威先例，禁只发 stateless 不关连接的半投递）。quota 冻结态先 thaw 回灌（beginVacuumEra ⓪ 段语义）。
// · DRAINING=等 spoolHeadSeq==pgSeq（actor flushThrough——freeze 拒**新连接帧**但 drain/维护帧通道照常：
//   准入链 ⓪ 冻结检查豁免 item.conn==null 帧〔红①〕）+in-flight drain（预算耗尽→FAILED 只读；vacuum
//   委托档 onDrainTimeout='abort'=SWITCHING 前显式 abort 解冻——中止恢复 P1-2 契约保持）+关空闲连接
//   （4413）+常驻释放（unload）。
// · EXPORTING=DocCodec canonical 导出（toReadModel records 真值）+exportRecordsHash 持久化
//   （DocAuditEvent.requestId=maintenanceId——重启后 VERIFYING 复核基准）+归档=一份 PG dump 回滚（运维
//   面操作说明落审计 payload）。
// · REBUILDING=fresh doc（新 clientID）重放 rebuild payload——canonical 模式=toReadModel→fillDoc；
//   vacuum 委托=调用方 buildRebuildPayload 回调（**T12 vacuumReplace 委托本状态机**：vacuum 只做 rebuild
//   payload〔红⑥〕；payload abort〔unsupported-root/equivalence-failed〕=SWITCHING 前净 abort）。
// · SWITCHING=**单 PG 事务只做 DB**：repo.vacuumReplace（lockProject+行集漂移守卫+锁内 generation 复核
//   +generation++〔跨代连续 seq——spoolHeadSeq/pgSeq 水位**保留不重置**〔T12 落定形态〕+purgeBelowSeq
//   清档+currentSnapshotRev 归 0 指针复位+插新代 Snapshot(g,rev0)〔快照基线=旧代 maxSeq 承接非归零〕
//   +旧代增量行同事务整删〕）+**同事务**写 stage=SWITCHING（inTx 钩——appendBatch 先例）。**提交成功后**
//   由本服务 close 4410（doc-vacuuming 换代通道载荷）+切 WAL namespace（spool.switchGeneration）+清进程
//   doc 态（close 失败无害：旧客户端重连被 generation auth 拒；**事务内禁 close**——网络关闭非事务性）。
//   崩溃窗：提交后未 close → 重启 stage=SWITCHING 已在档 → roll-forward（generation≥target 检出跳重切）。
// · VERIFYING=从 PG 重载新代 doc→toReadModel 与 exportRecordsHash 对比（等价复核）——失败=FAILED 只读
//   （已过提交点=只许 roll-forward：resume 重跑 VERIFYING）。
// · COMPLETED=单事务 {stage=COMPLETED+CanvasDoc.maintenanceId=NULL+audit}（解冻开放写）+feed 事件
//   doc.vacuumed{generation}（RuntimeFeedService @Optional——缺席跳过记日志）。
// · FAILED=**保持只读不超时自愈**（红③）：maintenanceId 不清+freeze 维持；resume=人工显式操作面动作
//   （post-SWITCHING FAILED→VERIFYING roll-forward 重开；pre-SWITCHING FAILED=新 operation 行）。
// · ABORTED=仅 SWITCHING 之前：单事务 {stage=ABORTED+maintenanceId=NULL}+解冻恢复。
// 每阶段幂等+attempt/leaseOwner/error 持久化（**重启从 PG stage 继续**——resumeActiveOnBoot 扫 ACTIVE
// 行重 freeze+续跑；freeze 进程内面随 boot 扫描重建，listen 前置位=窗口期新帧仍 4413）。空画布保头升代
// （头行在即升代——readModel 空集合法 rebuild payload）。
import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import * as Y from 'yjs';
import {
  CANVAS_DOC_SCHEMA_VERSION,
  CollabCloseCode,
  DOC_VACUUMING_TERMINAL_REASON,
  canTransitionMaintenanceStage,
  toReadModel,
  fillDoc,
  type MaintenanceStage,
} from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasDocUpdateRepository, type HydrationRow } from './canvas-doc-update.repository';
import { CollabProjectActorService } from './collab-project-actor.service';
import { CollabSpoolService } from './collab-spool.service';
import { RuntimeFeedService } from './runtime-feed.service';
import { createCanvasDoc } from './canvas-doc.factory';
import { readCanvasDocHead } from './canvas-doc-head';   // 契约 1 豁免读面（缺头三态——CanvasDoc 头行读不绕 repository 装载单源）
import { toDocLike } from './doc-like.util';
import { collabMaintenanceCloseTotal, collabMaintenanceRequestedTotal, collabMaintenanceStageAdvanceTotal } from './collab-maintenance.metrics';

/** 4413 Retry-After（wire 载荷 retryAfterMs——T25 I-4 30s 档同口径）。 */
export const MAINTENANCE_FREEZE_RETRY_AFTER_MS = 30_000;
/** in-flight drain 默认预算（REST/CLI 面——vacuum 委托沿用 VACUUM_QUIESCE_TIMEOUT_MS 30s 量级）。 */
export const MAINTENANCE_DRAIN_DEFAULT_BUDGET_MS = 30_000;

/** 受理落库事务内行级关闸复核（非 check-then-act——⑧事务首句 FOR SHARE 行锁读：与 REQUESTED 的
 *  UPDATE 行锁在 CanvasDoc 同行互斥，先到先得；maintenanceId 在=typed throw→admit 503）。 */
export async function rejectIfMaintenanceActiveInTx(tx: Prisma.TransactionClient, projectId: string): Promise<void> {
  const head = await tx.$queryRaw<{ maintenanceId: string | null }[]>`
    SELECT "maintenanceId" FROM "CanvasDoc" WHERE "projectId" = ${projectId}::text FOR SHARE`;
  if (head[0]?.maintenanceId != null) {
    throw Object.assign(new Error(`MAINTENANCE_ACTIVE(maintenanceId=${head[0].maintenanceId})`), { maintenanceActive: true, maintenanceId: head[0].maintenanceId });
  }
}

/** host 最小接口（gateway 1 行转发族——bindHost 后置绑定先例；直构缺 host=无连接面维护〔CLI/离线形态〕）。 */
export interface CollabMaintenanceHost {
  readonly logger: Logger;
  /** 活 doc 连接快照（DR live doc connections——4413/4410 完整投递面；元素=库 Connection〔含 sendStateless〕）。 */
  docConnections(pid: string): unknown[];
  /** code 权威投递关闭（SG.hardClose——close 帧完整投递）。 */
  hardClose(conn: unknown, code: number, reason: string): void;
  /** quota 冻结 thaw+settle 等待（beginVacuumEra ⓪ 段语义——U-5 保命：冻结期客户端编辑 SyncStep1 回灌）。 */
  thawQuotaAndWait(pid: string): Promise<void>;
  isQuotaFrozen(pid: string): boolean;
  /** 进程 doc 态清理+常驻释放（DR.purgeDocState+tryRelease——旧代不跨换代窗）。 */
  releaseResidentDoc(pid: string): Promise<void>;
  /** WAL 段 namespace 切代（spool.switchGeneration——**事务提交后**；事务内禁切）。 */
  switchWalGeneration(pid: string, generation: number): Promise<void>;
}

/** rebuild payload 提供方（vacuum 委托=shrink 注入 rebuildVacuumDoc+equivalence；canonical=本服务内置）。 */
export type BuildRebuildPayload = (ctx: { hydrate: HydrationRow; sourceGeneration: number }) => Promise<
  | { ok: true; state: Buffer; updateRowCount: number }
  | { ok: false; reason: string }   // payload abort（unsupported-root/equivalence-failed）——SWITCHING 前净 abort
>;

export type MaintenanceRequestOutcome =
  | { ok: true; maintenanceId: string; stage: MaintenanceStage }
  | { ok: false; code: 'PROJECT_NOT_FOUND' | 'CANVAS_DOC_MISSING' | 'MAINTENANCE_ACTIVE' | 'IN_FLIGHT_EXECUTIONS' | 'IDEMPOTENCY_KEY_MISMATCH' | 'FAILED_RESUME_REQUIRED'; maintenanceId?: string };   // FAILED_RESUME_REQUIRED=T27 收口 I-1：post-SWITCHING FAILED 准确指引（resume roll-forward）

export type MaintenanceRunResult =
  | { result: 'completed'; generation: number }
  | { result: 'aborted'; stage: MaintenanceStage; detail?: string }
  | { result: 'failed'; stage: MaintenanceStage; error: string }
  | { result: 'not-found' };

/** in-flight 判定范围（v5.4⑯ 五面）——单 SQL 计数（真值 join；RefundObligation 无 projectId 经 intentRowId 锚项目）。 */
async function countInFlight(db: Prisma.TransactionClient | PrismaService, projectId: string): Promise<number> {
  const r = await db.$queryRaw<{ n: number }[]>`
    SELECT (
      (SELECT COUNT(*) FROM "GenerationIntent" gi WHERE gi."projectId" = ${projectId}::text AND gi.status IN ('RUNNING', 'UNKNOWN'))
      + (SELECT COUNT(*) FROM "ExecutionNodePlan" p JOIN "ExecutionRequest" r ON r.id = p."requestId"
          WHERE r."projectId" = ${projectId}::text AND r.state IN ('ADMITTED', 'EXECUTING') AND p.status IN ('PENDING', 'EXECUTING'))
      + (SELECT COUNT(*) FROM "ExecutionOutbox" o WHERE o."projectId" = ${projectId}::text AND o.state = 'PENDING')
      + (SELECT COUNT(*) FROM "MaterializeRun" m WHERE m."projectId" = ${projectId}::text AND m.state = 'RUNNING')
      + (SELECT COUNT(*) FROM "RefundObligation" ro WHERE ro.state = 'PENDING' AND ro."intentRowId" IN
          (SELECT id FROM "GenerationIntent" WHERE "projectId" = ${projectId}::text))
    )::int AS n`;
  return r[0]?.n ?? 0;
}

/** DocAuditEvent 快捷写（敏感操作审计——kind='maintenance' 单源词表）。 */
async function audit(tx: Prisma.TransactionClient, projectId: string, maintenanceId: string, userId: string, payload: Record<string, unknown>): Promise<void> {
  await tx.docAuditEvent.create({ data: { id: randomUUID(), projectId, kind: 'maintenance', userId, requestId: maintenanceId, payload: payload as never } });
}

@Injectable()
export class CollabMaintenanceService {
  private readonly defaultLogger = new Logger(CollabMaintenanceService.name);
  private host: CollabMaintenanceHost | null = null;
  /** freeze 进程内面（FREEZING 起、终态止；FAILED 维持——红③）。键=projectId。 */
  private readonly frozen = new Map<string, { maintenanceId: string; retryAfterMs: number }>();
  /** 单项目运行互斥（同 pid 并发 run 合并——REQUESTED 行级关闸已挡第二维护，此闸=run 重入防线）。 */
  private readonly running = new Map<string, Promise<MaintenanceRunResult>>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CanvasDocUpdateRepository) private readonly repo: CanvasDocUpdateRepository,
    @Optional() @Inject(CollabProjectActorService) private readonly actor?: CollabProjectActorService | null,
    @Optional() @Inject(CollabSpoolService) private readonly spool?: CollabSpoolService | null,
    @Optional() @Inject(RuntimeFeedService) private readonly feed?: RuntimeFeedService | null,
  ) {}

  bindHost(host: CollabMaintenanceHost): void { this.host = host; }

  /** SnapshotDocCache 失效晚绑（CollabDocumentService 经 gateway 构造=DI 环——shrink 构造器接线，
   *  其持 docs+maintenance 双面；旧代投影条目随换代失效——键含 g 自然 miss，本面=在飞旧 g 读防御）。 */
  private snapshotInvalidator: ((pid: string) => void) | null = null;
  attachSnapshotInvalidator(fn: (pid: string) => void): void { this.snapshotInvalidator = fn; }

  private get logger(): Logger { return this.host?.logger ?? this.defaultLogger; }

  // ═══ freeze 面（actor 准入链 ⓪ 消费——gateway 经 host 缝接线）═══

  isFrozen(pid: string): boolean { return this.frozen.has(pid); }
  freezeInfo(pid: string): { maintenanceId: string; retryAfterMs: number } | undefined { return this.frozen.get(pid); }

  /** 4413 完整 close 投递（附言①：stateless 载荷先行+hardClose 码权威——两段缺一=半投递红线）。 */
  private deliverFreezeClose(pid: string): void {
    const info = this.frozen.get(pid);
    if (!info || !this.host) return;
    for (const conn of this.host.docConnections(pid)) {
      try {
        (conn as { sendStateless?: (p: string) => void }).sendStateless?.(JSON.stringify({ code: CollabCloseCode.MAINTENANCE_FREEZE, reason: 'maintenance-freeze', retryAfterMs: info.retryAfterMs }));
      } catch { /* 已断——close 权威投递仍在 */ }
      try { this.host.hardClose(conn, CollabCloseCode.MAINTENANCE_FREEZE, 'maintenance-freeze'); } catch { /* 已断 */ }
      collabMaintenanceCloseTotal.inc({ code: String(CollabCloseCode.MAINTENANCE_FREEZE) });
    }
  }

  /** 4410 换代通道完整投递（SWITCHING 提交后——载荷 {generation,discardLocalCache:true}；close 失败无害：
   *  旧客户端重连被 generation auth 拒）。 */
  private deliverSwitchClose(pid: string, targetGeneration: number): void {
    if (!this.host) return;
    for (const conn of this.host.docConnections(pid)) {
      try {
        (conn as { sendStateless?: (p: string) => void }).sendStateless?.(JSON.stringify({ code: CollabCloseCode.GENERATION_SUPERSEDED, reason: DOC_VACUUMING_TERMINAL_REASON, generation: targetGeneration, discardLocalCache: true }));
      } catch { /* 已断 */ }
      try { this.host.hardClose(conn, CollabCloseCode.GENERATION_SUPERSEDED, DOC_VACUUMING_TERMINAL_REASON); } catch { /* 已断 */ }
      collabMaintenanceCloseTotal.inc({ code: String(CollabCloseCode.GENERATION_SUPERSEDED) });
    }
  }

  // ═══ REQUESTED（行级关闸——同一 PG 事务）═══

  async request(opts: {
    projectId: string; idempotencyKey: string; requestedBy: string; source: 'rest' | 'cli' | 'vacuum';
    /** 「无在飞执行」前置（v5.4⑲ 切代前置——vacuum 委托档传入：in-flight 在场=拒，不进状态机）。 */
    requireNoInFlight?: boolean;
    leaseOwner?: string;
  }): Promise<MaintenanceRequestOutcome> {
    const idem = await this.prisma.maintenanceOperation.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (idem) {
      // 幂等键回放：同 key 同项目=返回在档 op；同 key 异项目=误用拒
      if (idem.projectId === opts.projectId) {
        collabMaintenanceRequestedTotal.inc({ source: opts.source, result: 'idempotent-replay' });
        return { ok: true, maintenanceId: idem.maintenanceId, stage: idem.stage };
      }
      collabMaintenanceRequestedTotal.inc({ source: opts.source, result: 'idempotency-key-mismatch' });
      return { ok: false, code: 'IDEMPOTENCY_KEY_MISMATCH' };
    }
    if (opts.requireNoInFlight) {
      const n = await countInFlight(this.prisma, opts.projectId);
      if (n > 0) {
        collabMaintenanceRequestedTotal.inc({ source: opts.source, result: 'in-flight' });
        return { ok: false, code: 'IN_FLIGHT_EXECUTIONS' };
      }
    }
    const maintenanceId = `mt-${randomUUID()}`;
    const out = await this.prisma.$transaction(async (tx) => {
      // —— 行级关闸（先关入口）：UPDATE 拿 CanvasDoc 行锁，IS NULL 守卫=并发第二维护/与受理 FOR SHARE 互斥 ——
      const gated = await tx.$queryRaw<{ generation: number; pgSeq: bigint; schemaVersion: number | null }[]>`
        UPDATE "CanvasDoc" SET "maintenanceId" = ${maintenanceId}::text, "updatedAt" = now()
        WHERE "projectId" = ${opts.projectId}::text AND "maintenanceId" IS NULL
        RETURNING generation, "pgSeq", "schemaVersion"`;
      if (gated.length === 0) {
        const head = await readCanvasDocHead(tx, opts.projectId);
        if (head.status === 'missing') return { ok: false as const, code: 'CANVAS_DOC_MISSING' as const };
        const prevId = head.row.maintenanceId!;
        const prevOp = await tx.maintenanceOperation.findUnique({ where: { maintenanceId: prevId } });
        if (prevOp != null && prevOp.stage === 'FAILED') {
          // Y1c T27 收口 I-1（双员收敛）：FAILED 恢复出口——pre-SWITCHING FAILED=新 op 接管
          //（旧行 status=SUPERSEDED+闸换新 id，同事务原子——单点修 REST/CLI/vacuum 三路；修前
          // PROJECT_NOT_FOUND 误报=项目受理永久 503 唯手工 SQL）；post-SWITCHING FAILED=拒+准确指引
          //（resume roll-forward——禁新行跳过 VERIFYING）。
          if (head.row.generation >= prevOp.targetGeneration) {
            return { ok: false as const, code: 'FAILED_RESUME_REQUIRED' as const, maintenanceId: prevId };
          }
          await tx.maintenanceOperation.update({ where: { maintenanceId: prevId }, data: { status: 'SUPERSEDED' } });   // stage 恒 FAILED（11 值转移表冻结——终态无出边；SUPERSEDED=被接管标记，status 自由域）
          await tx.canvasDoc.updateMany({ where: { projectId: opts.projectId, maintenanceId: prevId }, data: { maintenanceId, updatedAt: new Date() } });
          await tx.maintenanceOperation.create({ data: {
            maintenanceId, projectId: opts.projectId, stage: 'REQUESTED', status: 'ACTIVE', attempt: 0,
            sourceGeneration: head.row.generation, targetGeneration: head.row.generation + 1,
            schemaVersion: head.row.schemaVersion ?? CANVAS_DOC_SCHEMA_VERSION, cutoffPgSeq: head.row.pgSeq,
            idempotencyKey: opts.idempotencyKey, leaseOwner: opts.leaseOwner ?? null,
          } });
          await audit(tx, opts.projectId, maintenanceId, opts.requestedBy, {
            stage: 'REQUESTED', source: opts.source, takeoverOf: prevId,
            sourceGeneration: head.row.generation, targetGeneration: head.row.generation + 1,
            cutoffPgSeq: String(head.row.pgSeq), note: 'FAILED 接管（I-1 收口——旧行 SUPERSEDED）',
          });
          return { ok: true as const, maintenanceId, generation: head.row.generation };
        }
        if (prevOp == null) return { ok: false as const, code: 'PROJECT_NOT_FOUND' as const };   // 孤儿闸（maintenanceId 指向不存在 op——数据损坏态保守拒；处置=人工核对）
        if (['COMPLETED', 'ABORTED'].includes(prevOp.stage)) return { ok: false as const, code: 'MAINTENANCE_ACTIVE' as const, maintenanceId: prevId };   // 终态行+闸在=终态清闸事务被绕过的损坏态——按关闸在拒
        return { ok: false as const, code: 'MAINTENANCE_ACTIVE' as const, maintenanceId: prevOp.maintenanceId };
      }
      const { generation, pgSeq, schemaVersion } = gated[0]!;
      await tx.maintenanceOperation.create({ data: {
        maintenanceId, projectId: opts.projectId, stage: 'REQUESTED', status: 'ACTIVE', attempt: 0,
        sourceGeneration: generation, targetGeneration: generation + 1,
        schemaVersion: schemaVersion ?? CANVAS_DOC_SCHEMA_VERSION, cutoffPgSeq: pgSeq,
        idempotencyKey: opts.idempotencyKey, leaseOwner: opts.leaseOwner ?? null,
      } });
      await audit(tx, opts.projectId, maintenanceId, opts.requestedBy, {
        stage: 'REQUESTED', source: opts.source, sourceGeneration: generation,
        targetGeneration: generation + 1, cutoffPgSeq: String(pgSeq),
        note: '归档=一份 PG dump 回滚（运维面：SWITCHING 前 pg_dump——spec §6.6）',
      });
      return { ok: true as const, maintenanceId, generation };
    }, { timeout: 10_000, maxWait: 5_000 });
    collabMaintenanceRequestedTotal.inc({ source: opts.source, result: out.ok ? 'ok' : out.code.toLowerCase() });
    return out.ok ? { ok: true, maintenanceId: out.maintenanceId, stage: 'REQUESTED' } : out;
  }

  // ═══ stage 推进原语（CAS——幂等续跑）═══

  private async readStage(maintenanceId: string): Promise<{ projectId: string; stage: MaintenanceStage; sourceGeneration: number; targetGeneration: number } | null> {
    const op = await this.prisma.maintenanceOperation.findUnique({ where: { maintenanceId }, select: { projectId: true, stage: true, sourceGeneration: true, targetGeneration: true } });
    return op ?? null;
  }

  /** CAS 推进（cur→to——cur 实时读取〔from 推导〕；0 行=他者已推进/终态→重读现值返回）。终态写入同事务
   *  清算（COMPLETED/ABORTED 清 maintenanceId；FAILED 持留=只读维持）。
   *  **SWITCHING 写入不在此**——换代 stage 写与 DB 族同事务（switchingStage inTx——事务回滚=stage 留
   *  REBUILDING 幂等重试；事务前 advance=回滚后 stage 已前移的错误形态）。 */
  private async advance(maintenanceId: string, to: MaintenanceStage, extra?: { drained?: boolean; detail?: Record<string, unknown> }): Promise<MaintenanceStage> {
    const cur = await this.readStage(maintenanceId);
    if (cur == null) return 'FAILED';
    if (!canTransitionMaintenanceStage(cur.stage, to)) {
      // 幂等重入（cur.stage===to=动作面重入）or 终态：返回现值（run 循环按现值分派）
      collabMaintenanceStageAdvanceTotal.inc({ to, result: 'cas-miss' });
      return cur.stage;
    }
    const from = cur.stage;
    if (to === 'COMPLETED' || to === 'ABORTED') {
      await this.prisma.$transaction(async (tx) => {
        const moved = await tx.maintenanceOperation.updateMany({ where: { maintenanceId, stage: from }, data: { stage: to, status: to } });
        if (moved.count === 0) return;
        await tx.canvasDoc.updateMany({ where: { projectId: cur.projectId, maintenanceId }, data: { maintenanceId: null } });
        await audit(tx, cur.projectId, maintenanceId, 'maintenance-service', { stage: to, ...(extra?.detail ?? {}) });
      });
    } else {
      const data: Record<string, unknown> = { stage: to, status: 'ACTIVE', attempt: { increment: 1 } };
      if (extra?.drained) data.drainedAt = new Date();
      await this.prisma.maintenanceOperation.updateMany({ where: { maintenanceId, stage: from }, data: data as never });
    }
    collabMaintenanceStageAdvanceTotal.inc({ to, result: 'ok' });
    const after = await this.readStage(maintenanceId);
    return after?.stage ?? to;
  }

  private async persistError(maintenanceId: string, stage: MaintenanceStage, error: string): Promise<void> {
    await this.prisma.maintenanceOperation.updateMany({
      where: { maintenanceId, stage: { in: ['REQUESTED', 'FREEZING', 'DRAINING', 'DRAINED', 'EXPORTING', 'REBUILDING', 'SWITCHING', 'VERIFYING'] } },
      data: { stage: 'FAILED', status: 'FAILED', error: `${stage}: ${error}`.slice(0, 500), attempt: { increment: 1 } },
    }).catch(() => {});
  }

  // ═══ 段动作 ═══

  /** FREEZING 段动作：freeze 置位+thaw 回灌+4413 完整投递（幂等——重入重投剩余连接）。 */
  async freezeForStage(maintenanceId: string): Promise<void> {
    const op = await this.readStage(maintenanceId);
    if (op == null) return;
    this.frozen.set(op.projectId, { maintenanceId, retryAfterMs: MAINTENANCE_FREEZE_RETRY_AFTER_MS });
    if (this.host?.isQuotaFrozen(op.projectId)) await this.host.thawQuotaAndWait(op.projectId);
    this.deliverFreezeClose(op.projectId);
  }

  /** DRAINING 段动作：spoolHeadSeq==pgSeq（actor flush——freeze 期照常）+in-flight drain+关空闲连接+常驻释放。 */
  private async drainStage(pid: string, budgetMs: number): Promise<{ ok: true } | { ok: false; reason: 'drain-timeout' }> {
    const deadline = Date.now() + budgetMs;
    for (;;) {
      // ① actor 帧落定（applied 前缀→PG；维护帧通道不 freeze——红① 契约）
      const target = this.actor?.appliedSeqOf(pid) ?? 0n;
      const flushed = this.actor ? await this.actor.flushThrough(pid, target, { maxWaitMs: 2_000 }) : undefined;
      const wm = this.spool?.watermark(pid);
      const settled = (!this.actor || (flushed?.targetReached ?? true)) && (wm == null || wm.spoolHeadSeq === wm.pgSeq);
      const inFlight = await countInFlight(this.prisma, pid);
      if (settled && inFlight === 0) break;
      if (Date.now() >= deadline) {
        return { ok: false, reason: 'drain-timeout' };
      }
      await new Promise((r) => setTimeout(r, Math.min(1_000, Math.max(20, deadline - Date.now()))));
    }
    // ② 关空闲连接（4413——freeze 面投递幂等）+常驻释放（unload：旧代 doc 不跨换代窗）
    this.deliverFreezeClose(pid);
    await this.host?.releaseResidentDoc(pid).catch(() => {});
    this.snapshotInvalidator?.(pid);
    return { ok: true };
  }

  /** EXPORTING 段动作：装载读→canonical records 真值+hash 持久化（audit requestId=maintenanceId）。 */
  private async exportStage(pid: string, maintenanceId: string, requestedBy: string): Promise<{ exportHash: string; hydrate: HydrationRow }> {
    const hydrate = await this.repo.loadForHydration(pid);
    const records = this.recordsOfHydration(hydrate);
    const exportHash = createHash('sha256').update(JSON.stringify(records)).digest('hex');
    await this.prisma.docAuditEvent.create({ data: {
      id: randomUUID(), projectId: pid, kind: 'maintenance', userId: requestedBy, requestId: maintenanceId,
      payload: { stage: 'EXPORTING', exportHash, nodeCount: records.nodes.length, edgeCount: records.edges.length, schemaVersion: CANVAS_DOC_SCHEMA_VERSION },
    } });
    return { exportHash, hydrate };
  }

  /** 装载行→records（EXPORTING/VERIFYING 共用——快照+增量尾重放后 toReadModel）。 */
  private recordsOfHydration(hydrate: HydrationRow): { nodes: unknown[]; edges: unknown[] } {
    const doc = createCanvasDoc();
    try {
      if (hydrate.state) Y.applyUpdate(doc, new Uint8Array(hydrate.state));
      for (const u of hydrate.updates) Y.applyUpdate(doc, new Uint8Array(u));
      const records = toReadModel(doc);
      return { nodes: records.nodes as unknown[], edges: records.edges as unknown[] };
    } finally { doc.destroy(); }
  }

  /** REBUILDING 段动作（canonical 内置模式）：fresh doc（新 clientID）+fillDoc records 真值重放。 */
  private rebuildCanonical(hydrate: HydrationRow): { state: Buffer; updateRowCount: number } {
    const oldDoc = createCanvasDoc();
    try {
      if (hydrate.state) Y.applyUpdate(oldDoc, new Uint8Array(hydrate.state));
      for (const u of hydrate.updates) Y.applyUpdate(oldDoc, new Uint8Array(u));
      const records = toReadModel(oldDoc);
      const fresh = createCanvasDoc();
      try {
        fillDoc(toDocLike(fresh), records.nodes, records.edges);
        return { state: Buffer.from(Y.encodeStateAsUpdate(fresh)), updateRowCount: hydrate.updates.length };
      } finally { fresh.destroy(); }
    } finally { oldDoc.destroy(); }
  }

  /** SWITCHING 段动作：单 PG 事务（vacuumReplace DB 族+同事务 stage 写）→提交后 close 4410+切 WAL+清进程态。
   *  幂等：generation≥target=前次提交已落 → 跳重切只做事务后动作。 */
  private async switchingStage(pid: string, maintenanceId: string, sourceGeneration: number, targetGeneration: number, payload: { state: Buffer; updateRowCount: number }): Promise<{ ok: true } | { ok: false; reason: 'generation-drift' }> {
    const live = await readCanvasDocHead(this.prisma, pid);
    if (live.status === 'found' && live.row.generation >= targetGeneration) {
      // 前次 SWITCHING 已提交（崩溃窗 roll-forward）——只补事务后动作
      // T27 收口 M-5(spec)：4410 载荷 generation=DB 真值（spec R3 口径——非 target 投影；并发更高代时载荷如实）
      await this.postSwitchActions(pid, live.row.generation);
      return { ok: true };
    }
    const replaced = await this.repo.vacuumReplace(pid, payload.state, payload.updateRowCount, sourceGeneration, async (tx) => {
      // 同事务 stage 写（SWITCHING=唯一不可回退点在档——崩溃后重启 roll-forward 判据）
      await tx.maintenanceOperation.updateMany({ where: { maintenanceId, stage: 'REBUILDING' }, data: { stage: 'SWITCHING', status: 'ACTIVE', attempt: { increment: 1 } } });
    }).catch((err: { vacuumRowsDrifted?: boolean; dbGeneration?: number }) => {
      // T27 收口 M-1(quality)：透传 drift throw 附着的锁内实读 dbGeneration（roll-forward 判据真值——
      // 修前回填 sourceGeneration=恒假死分支）
      if (err?.vacuumRowsDrifted) return { aborted: 'rows-drifted' as const, dbGeneration: err.dbGeneration ?? sourceGeneration };
      throw err;
    });
    if ('aborted' in replaced) {
      // 锁内 generation 复核漂移（跨进程 CLI 换代竞态窗）——pre-SWITCHING 净 abort 档
      if (replaced.dbGeneration >= targetGeneration) {
        await this.postSwitchActions(pid, replaced.dbGeneration);   // M-5(spec)：4410 载荷=DB 真值
        return { ok: true };
      }
      return { ok: false, reason: 'generation-drift' };
    }
    collabMaintenanceStageAdvanceTotal.inc({ to: 'SWITCHING', result: 'ok' });
    await this.postSwitchActions(pid, targetGeneration);
    return { ok: true };
  }

  /** SWITCHING 事务提交后动作（事务内禁 close/禁切 WAL——网络与文件系统非事务性）：close 4410+namespace
   *  切代+进程 doc 态清理（generation 真值随下代装载/播种重建）。 */
  private async postSwitchActions(pid: string, targetGeneration: number): Promise<void> {
    this.deliverSwitchClose(pid, targetGeneration);
    await this.host?.switchWalGeneration(pid, targetGeneration).catch((e) => {
      this.logger.warn(`maintenance switchWalGeneration failed for ${pid}: ${(e as Error).message}（namespace 未切——新代帧仍落旧段文件名，正确性由段头 generation 承载；重跑本段幂等）`);
    });
    await this.host?.releaseResidentDoc(pid).catch(() => {});
    this.snapshotInvalidator?.(pid);
  }

  /** VERIFYING 段动作：PG 重载新代→records hash 对比 EXPORTING 基准（audit 行）。 */
  private async verifyingStage(pid: string, maintenanceId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const auditRow = await this.prisma.docAuditEvent.findFirst({
      where: { requestId: maintenanceId, kind: 'maintenance' },
      orderBy: { createdAt: 'desc' }, select: { payload: true },
    });
    const expected = (auditRow?.payload as { stage?: string; exportHash?: string } | null);
    const hydrate = await this.repo.loadForHydration(pid);
    const actual = createHash('sha256').update(JSON.stringify(this.recordsOfHydration(hydrate))).digest('hex');
    if (hydrate.schemaVersion != null && hydrate.schemaVersion !== CANVAS_DOC_SCHEMA_VERSION) {
      return { ok: false, reason: `schemaVersion mismatch: ${hydrate.schemaVersion}` };
    }
    if (expected?.stage === 'EXPORTING' && expected.exportHash != null && expected.exportHash !== actual) {
      return { ok: false, reason: `export hash mismatch: expected ${expected.exportHash} got ${actual}` };
    }
    return { ok: true };
  }

  // ═══ 运行循环（幂等续跑——重启从 PG stage 继续）═══

  /** 驱动到终态。opts.onDrainTimeout='abort'=vacuum 委托档（drain 超时净 abort 解冻——P1-2 中止恢复）；
   *  缺省 'fail'=FAILED 只读（人工 resume）。 */
  async run(maintenanceId: string, opts?: {
    drainBudgetMs?: number; onDrainTimeout?: 'fail' | 'abort'; buildRebuildPayload?: BuildRebuildPayload;
  }): Promise<MaintenanceRunResult> {
    const op = await this.prisma.maintenanceOperation.findUnique({ where: { maintenanceId } });
    if (!op) return { result: 'not-found' };
    const pid = op.projectId;
    const drainBudget = opts?.drainBudgetMs ?? MAINTENANCE_DRAIN_DEFAULT_BUDGET_MS;
    const onDrainTimeout = opts?.onDrainTimeout ?? 'fail';
    // 单项目运行互斥（重入合并）
    const inFlightRun = this.running.get(pid);
    if (inFlightRun) return inFlightRun;
    const p = (async (): Promise<MaintenanceRunResult> => {
      let stage = (await this.readStage(maintenanceId))?.stage ?? 'FAILED';
      let payload: { state: Buffer; updateRowCount: number } | undefined;
      try {
        for (;;) {
          if (stage === 'COMPLETED') {
            this.frozen.delete(pid);
            return { result: 'completed', generation: op.targetGeneration };
          }
          if (stage === 'ABORTED') {
            this.frozen.delete(pid);
            return { result: 'aborted', stage };
          }
          if (stage === 'FAILED') {
            // FAILED=只读维持（红③）——不自动恢复；resume=人工显式（resume()）
            return { result: 'failed', stage, error: op.error ?? 'unknown' };
          }
          switch (stage) {
            case 'REQUESTED': {
              stage = await this.advance(maintenanceId, 'FREEZING');
              break;
            }
            case 'FREEZING': {
              await this.freezeForStage(maintenanceId);
              stage = await this.advance(maintenanceId, 'DRAINING');
              break;
            }
            case 'DRAINING': {
              this.frozen.set(pid, { maintenanceId, retryAfterMs: MAINTENANCE_FREEZE_RETRY_AFTER_MS });   // 续跑重 freeze（boot 扫描外兜底）
              const drained = await this.drainStage(pid, drainBudget);
              if (!drained.ok) {
                if (onDrainTimeout === 'abort') {
                  stage = await this.advance(maintenanceId, 'ABORTED', { detail: { reason: 'drain-timeout' } });
                  this.frozen.delete(pid);
                  return { result: 'aborted', stage, detail: 'drain-timeout' };
                }
                await this.persistError(maintenanceId, 'DRAINING', 'drain-timeout（in-flight/spool 未收敛——预算耗尽，保持只读人工 resume）');
                return { result: 'failed', stage: 'FAILED', error: 'drain-timeout' };
              }
              stage = await this.advance(maintenanceId, 'DRAINED', { drained: true });
              break;
            }
            case 'DRAINED': {
              const pending = await countInFlight(this.prisma, pid);
              if (pending > 0) {
                await this.persistError(maintenanceId, 'DRAINED', `pending=${pending}（DRAINED 校验失败）`);
                return { result: 'failed', stage: 'FAILED', error: `pending=${pending}` };
              }
              stage = await this.advance(maintenanceId, 'EXPORTING');
              break;
            }
            case 'EXPORTING': {
              await this.exportStage(pid, maintenanceId, 'maintenance-service');
              stage = await this.advance(maintenanceId, 'REBUILDING');
              break;
            }
            case 'REBUILDING': {
              const hydrate = await this.repo.loadForHydration(pid);
              if (opts?.buildRebuildPayload) {
                const built = await opts.buildRebuildPayload({ hydrate, sourceGeneration: op.sourceGeneration });
                if (!built.ok) {
                  // payload abort（vacuum：unsupported-root/equivalence-failed）——SWITCHING 前净 abort
                  stage = await this.advance(maintenanceId, 'ABORTED', { detail: { reason: built.reason } });
                  this.frozen.delete(pid);
                  return { result: 'aborted', stage, detail: built.reason };
                }
                payload = { state: built.state, updateRowCount: built.updateRowCount };
              } else {
                payload = this.rebuildCanonical(hydrate);
              }
              // **SWITCHING 不经 advance**——stage 写与换代 DB 族同事务（vacuumReplace inTx：
              // 事务回滚=stage 留 REBUILDING 幂等重试；事务前写=回滚后 stage 已前移的错误形态）
              const built = payload;
              const sw = await this.switchingStage(pid, maintenanceId, op.sourceGeneration, op.targetGeneration, built);
              if (!sw.ok) {
                stage = await this.advance(maintenanceId, 'ABORTED', { detail: { reason: sw.reason } });
                this.frozen.delete(pid);
                return { result: 'aborted', stage, detail: sw.reason };
              }
              await this.advance(maintenanceId, 'SWITCHING');   // inTx 已写则自环 no-op；缺写（不可达防御）单步补
              stage = await this.advance(maintenanceId, 'VERIFYING');
              break;
            }
            case 'SWITCHING': {
              // 在档=前次提交已落（vacuumReplace inTx 同事务写）→ roll-forward 事务后动作+VERIFYING；
              // 进程内 payload 丢失（重启窗）→ derivePayloadForResume 重建（generation≥target=roll-forward）
              const built = payload ?? await this.derivePayloadForResume(pid, maintenanceId, opts);
              const sw = await this.switchingStage(pid, maintenanceId, op.sourceGeneration, op.targetGeneration, built);
              if (!sw.ok) {
                stage = await this.advance(maintenanceId, 'ABORTED', { detail: { reason: sw.reason } });
                this.frozen.delete(pid);
                return { result: 'aborted', stage, detail: sw.reason };
              }
              await this.advance(maintenanceId, 'SWITCHING');   // inTx 已写则自环 no-op；缺写（不可达防御）单步补
              stage = await this.advance(maintenanceId, 'VERIFYING');
              break;
            }
            case 'VERIFYING': {
              const v = await this.verifyingStage(pid, maintenanceId);
              if (!v.ok) {
                await this.persistError(maintenanceId, 'VERIFYING', v.reason);
                return { result: 'failed', stage: 'FAILED', error: v.reason };
              }
              stage = await this.advance(maintenanceId, 'COMPLETED', { detail: { generation: op.targetGeneration } });
              this.frozen.delete(pid);
              // COMPLETED 段动作：feed 事件 doc.vacuumed{generation}（解冻开放写后）
              this.emitVacuumedFeedEvent(pid, op.targetGeneration);
              return { result: 'completed', generation: op.targetGeneration };
            }
            default: {
              const exhaust: never = stage;
              return { result: 'failed', stage: 'FAILED', error: `unreachable stage ${String(exhaust)}` };
            }
          }
        }
      } catch (err) {
        const msg = (err as Error).message;
        await this.persistError(maintenanceId, stage, msg);
        this.logger.error(`maintenance run failed at ${stage} for ${pid}: ${msg}`);
        return { result: 'failed', stage: 'FAILED', error: msg };
      } finally {
        this.running.delete(pid);
      }
    })();
    this.running.set(pid, p);
    return p;
  }

  /** SWITCHING 续跑（stage=SWITCHING 在档但进程内 payload 丢失——重启窗）：canonical 内置重建。
   *  vacuum 委托档不可达（vacuum 续跑经 shrink 重新委托+幂等 replay：generation≥target 直接 roll-forward）。 */
  private async derivePayloadForResume(pid: string, maintenanceId: string, opts?: { buildRebuildPayload?: BuildRebuildPayload }): Promise<{ state: Buffer; updateRowCount: number }> {
    const live = await readCanvasDocHead(this.prisma, pid);
    const op = await this.readStage(maintenanceId);
    if (live.status === 'found' && op != null && live.row.generation >= op.targetGeneration) {
      return { state: Buffer.alloc(0), updateRowCount: 0 };   // 已提交——switchingStage 走 roll-forward 分支不消费 payload
    }
    const hydrate = await this.repo.loadForHydration(pid);
    if (opts?.buildRebuildPayload) {
      const built = await opts.buildRebuildPayload({ hydrate, sourceGeneration: op?.sourceGeneration ?? 0 });
      if (built.ok) return { state: built.state, updateRowCount: built.updateRowCount };
    }
    return this.rebuildCanonical(hydrate);
  }

  private emitVacuumedFeedEvent(pid: string, generation: number): void {
    if (!this.feed) {
      this.logger.log(`maintenance COMPLETED for ${pid} g=${generation}（feed 缺席——doc.vacuumed 事件跳过）`);
      return;
    }
    void this.feed.appendEvent(pid, 'doc.vacuumed', () => ({ v: 1, generation })).catch((e) => {
      this.logger.warn(`doc.vacuumed feed event failed for ${pid}: ${(e as Error).message}`);
    });
  }

  // ═══ 操作面（REST/CLI）═══

  /** abort：仅 SWITCHING 之前（解冻恢复）；SWITCHING 起=NOT_ABORTABLE（唯一不可回退点）。 */
  async abort(maintenanceId: string): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND' | 'NOT_ABORTABLE' }> {
    const op = await this.prisma.maintenanceOperation.findUnique({ where: { maintenanceId }, select: { projectId: true, stage: true } });
    if (!op) return { ok: false, code: 'NOT_FOUND' };
    if (!canTransitionMaintenanceStage(op.stage, 'ABORTED')) return { ok: false, code: 'NOT_ABORTABLE' };
    await this.advance(maintenanceId, 'ABORTED');
    this.frozen.delete(op.projectId);
    return { ok: true };
  }

  /** 人工显式 resume（FAILED 出口——操作面动作非转移表边）：post-SWITCHING FAILED（已过提交点）=
   *  roll-forward 重开（FAILED→VERIFYING 重跑）；pre-SWITCHING FAILED=新 operation 行（返回指引）。 */
  async resume(maintenanceId: string): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND' | 'NEW_OPERATION_REQUIRED' | 'SUPERSEDED' }> {
    const op = await this.prisma.maintenanceOperation.findUnique({ where: { maintenanceId } });
    if (!op) return { ok: false, code: 'NOT_FOUND' };
    if (op.status === 'SUPERSEDED') return { ok: false, code: 'SUPERSEDED' };   // 被接管旧行（I-1——接管行承载续跑，旧行无面）
    if (op.stage !== 'FAILED') return { ok: false, code: 'NEW_OPERATION_REQUIRED' };   // 非 FAILED 无 resume 面（运行中/终态）
    const live = await readCanvasDocHead(this.prisma, op.projectId);
    if (live.status === 'found' && live.row.generation >= op.targetGeneration) {
      // 已过 SWITCHING 提交点：roll-forward——FAILED→VERIFYING（转移表外操作面动作：spec「resume=重开 attempt」）
      await this.prisma.maintenanceOperation.update({ where: { maintenanceId }, data: { stage: 'VERIFYING', status: 'ACTIVE', attempt: { increment: 1 }, error: null } });
      return { ok: true };
    }
    return { ok: false, code: 'NEW_OPERATION_REQUIRED' };
  }

  /** 项目活跃/末次维护读面（REST GET）。 */
  async operationOf(projectId: string): Promise<{ maintenanceId: string; stage: MaintenanceStage; status: string; error: string | null; attempt: number; sourceGeneration: number; targetGeneration: number; cutoffPgSeq: string; drainedAt: Date | null; createdAt: Date; updatedAt: Date } | null> {
    const op = await this.prisma.maintenanceOperation.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' } });
    if (!op) return null;
    return {
      maintenanceId: op.maintenanceId, stage: op.stage, status: op.status, error: op.error, attempt: op.attempt,
      sourceGeneration: op.sourceGeneration, targetGeneration: op.targetGeneration, cutoffPgSeq: String(op.cutoffPgSeq),
      drainedAt: op.drainedAt, createdAt: op.createdAt, updatedAt: op.updatedAt,
    };
  }

  /** boot 恢复（gateway startCollabAfterLease init 消费——**重启从 PG stage 继续**）：非终态行重 freeze
   *  +续跑（listen 前置位=freeze 窗口新帧 4413——重启空窗不放进新写）。
   *  Y1c T27 收口 I-2(spec)：**FAILED 行纳入重 freeze（只维持只读不续跑）**——修前排除 FAILED=重启后
   *  frozen 进程面空+doc 帧写静默恢复（违 spec「不自动恢复写」）；FAILED 终态无续跑面（等人工接管：
   *  request 新行〔I-1 出口——接管时 frozen 键随新 op 重置〕∨ resume roll-forward）。SUPERSEDED 行
   *  （被接管旧 FAILED）排除——freeze/run 均归接管行。 */
  async resumeActiveOnBoot(): Promise<number> {
    const pending = await this.prisma.maintenanceOperation.findMany({
      where: { stage: { notIn: ['COMPLETED', 'ABORTED'] }, status: { not: 'SUPERSEDED' } },
      select: { maintenanceId: true, projectId: true, stage: true },
    });
    for (const op of pending) {
      this.frozen.set(op.projectId, { maintenanceId: op.maintenanceId, retryAfterMs: MAINTENANCE_FREEZE_RETRY_AFTER_MS });
      if (op.stage === 'FAILED') continue;   // 只读维持不续跑（无自动恢复写）
      void this.run(op.maintenanceId).catch((e) => this.logger.error(`boot resume failed for ${op.projectId}: ${(e as Error).message}`));
    }
    return pending.length;
  }

  /** 测试面：freeze 台账清（beforeEach 布景复位）。 */
  clearFrozenForTest(): void { this.frozen.clear(); }
}
