// apps/api/src/modules/media-delivery/projection-outbox.poller.ts
// Y1a+Y1b T15（plan v11.2 片 S4 主交付卡；spec Z18''④/:91 v14+裁决 :53/:54）：ArtifactProjection
// 投影 poller——正式交付 owner（取代 T10-T13 过渡直写：execution.service deliver+done 批/
// collab-media 命令直写/worker written:false 即时 orphaned 标记全部收口，交付收敛单点=本循环）。
//
// 进程归属=api（spec 部署图 :280「API 进程：DocDelivery poller（唯一交付 owner）」——需 withSession
// doc 会话+residency 池；装配=MediaDeliveryModule←ExecutionDaemonModule.register() role 门 api|all，
// worker 面零实例化——MaterializeJob〔worker〕/IntentReconcile〔api〕同形态 DB poller：
// 原生 setInterval+unref+busy 防重入）。
//
// 循环全序（spec :91 Z18''④ 字面；v11.1① 全程同一所有权边界）：
//  claim（pending∧nextAttemptAt 到期∧lease 过期/NULL SKIP LOCKED 置 projecting+leaseUntil+runId
//   ——崩溃残留 projecting∧lease 过期同收；**捕获 CollabLease epoch，循环每步前比对**）
//  →逐行读 NodeArtifact：artifactRev≠rev ⇒ superseded（终态不重试）
//  →内容等值 fast path（裁决 :53：doc data.fileId==artifact.mediaId〔或 result 等值〕——非权威判据，
//   仅跳 apply 省写；权威=(sourceIntentRowId,execSeq,rev)）
//  →deliverArtifact 复合 op（collab-document.service：同 withSession(write) 事务写 data.{fileId|result}
//   +exec done〔exec 键集=EXEC_STATUS_KEYS 内——exec 域写面不变红线〕；written:false node-deleted
//   =「谁观察 node 删除」的权威观察点 ⇒ orphaned+幂等退款）
//  →批按 project 分组一次 flushDocument(projectId, capturedEpoch)（T14 typed 窄接口——投影推进
//   唯一凭据；boolean flush 推进水位=No-Go）
//  →逐行 recheck NodeArtifact.rev（一致才 projected；rev 又进 ⇒ superseded）
//  →mark（runId CAS——lease 过期被新代 reclaim 后 0 行放弃，不污染新代）。
//
// 失败分档（T14 FlushOutcome 语义承接+G58）：
//  - fenced（epoch 易主/失守/terminal,fenced）：行回 pending **不耗 attempts**——滚动部署/双开
//    （非 holder claim 后 withSession 503）不得耗尽重试预算；本轮停 claim 等租约（下轮 epoch 稳定）。
//  - retry/spooled：批磁盘安全（spool fsync）——不耗 attempts 无限重试，**永不判死**（G58：
//    spooled 档禁假失败；SPOOL_DEADLINE 只作用于 failed 档——见 FLUSH_FAILED_DEADLINE_MS 注）。
//  - retry/failed ∧ 真 apply 失败：耗 attempts（attempts+1）；dead 判据=attempts≥MAX_ATTEMPTS ∨
//    行龄超 failed 档 1h 兜底（spec :91「failed=耗 maxAttempts+spoolDeadline 1h」自洽落地——
//    spooled 档不进本判据）⇒ dead+Sentry 告警（dead 行 on-load reconcile/admin retry 重驱）。
//  - terminal/fk（项目已删）：orphaned+幂等退款（资金锚=NodeArtifact.sourceIntentRowId——
//    rollbackDeliveryFailed CAS 幂等重跑恰一次；抛错不阻断终态，收敛归 R3）。
//
// mark 后 lazy GET media-facts 补拉（spec :91）：server 侧=projected 后 facts 端点可查——
// media-facts REST 现状=全仓不存在（T16 建），本卡登记交接面（T16 pendingFacts 消费）。
import { Inject, Injectable, Logger, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { Prisma, type ArtifactProjection, type NodeArtifact } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabLeaseService } from '../collab/collab-lease.service';
import { CollabDocumentService, type ExecStatusPatch } from '../collab/collab-document.service';
import { SPOOL_DEADLINE_MS } from '../collab/collab-persistence.service';
import { TeamCreditService } from '../team/team-credit.service';
import { artifactProjectionOrphanRefundFailTotal, artifactProjectionOutcomeTotal, artifactProjectionPendingAgeSeconds } from './projection-outbox.metrics';
import { docDeliveryLagSeconds, docDeliveryAppliedUnpersisted } from './delivery-lag.metrics';
import { BindingReconcileService } from './binding-reconcile.service';

// ── poller/claim 参数（MaterializeJob/IntentReconcile 同族纪律：常数不进 env——热循环红线非立即重投） ──
/** tick 周期：交付延迟直连 UX（finalize→fileId 可见）——秒级收口（IntentReconcile 5min 是资金面节奏）。 */
export const PROJECTION_POLL_INTERVAL_MS = 3_000;
/** 每轮 claim 批上限（同 project 分组一次 flush——跨 project 各自 flush）。 */
export const PROJECTION_BATCH = 64;
/** 行 lease=doc 装载+apply+flush 收尾余量（写回 CAS 按 runId 非 lease 新鲜度——过期未接管仍可完成）。 */
export const PROJECTION_LEASE_MS = 60_000;
/** 真 apply 失败重试上界（耗尽 ⇒ dead+告警；spooled/fenced 不进本计数）。 */
export const PROJECTION_MAX_ATTEMPTS = 5;
/** 退避基数 2s×2^(n-1) 封顶 5min，抖幅 ×[0.5,1.5]（materialize/probe 同族参数）。 */
export const PROJECTION_BACKOFF_BASE_MS = 2_000;
export const PROJECTION_BACKOFF_MAX_MS = 300_000;
/** dead 行 on-load reconcile：启动重驱窗（窗外=运维放弃的陈旧行——重建即复活循环）+批量上界。 */
export const PROJECTION_DEAD_REQUEUE_WINDOW_MS = 7 * 24 * 3600_000;
export const PROJECTION_DEAD_REQUEUE_LIMIT = 100;
/** onModuleDestroy 等在飞有界（spec :91「停 claim/等在飞」——busy 翻转即完成，上界=单轮 lease 余量）。 */
const SHUTDOWN_WAIT_MS = PROJECTION_LEASE_MS + 10_000;

/** T14 命名陷阱收口（T14 评审 Minor：SPOOL_DEADLINE_MS 在消费点的语义=**failed 档**行级兜底
 *  deadline——spooled 档〔磁盘安全帧〕永不判死〔G58〕，本常量不作用于 spooled 档）。窄面=消费点
 *  本地别名（T14 契约值单源不改名——spec/单测锚 SPOOL_DEADLINE_MS 逐字保持）。 */
const FLUSH_FAILED_DEADLINE_MS = SPOOL_DEADLINE_MS;

/** 退避（抖幅 ×[0.5,1.5]——materialize computeMaterializeBackoffMs 同形）。 */
export function computeProjectionBackoffMs(attempts: number): number {
  const base = Math.min(PROJECTION_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), PROJECTION_BACKOFF_MAX_MS);
  return Math.round(base * (0.5 + Math.random()));
}

/** dead 判据（**仅 failed 档/真 apply 失败消费**——G58：spooled 档永不判死由调用面保证不进本函数）：
 *  attempts≥MAX_ATTEMPTS ∨ 行龄超 SPOOL_DEADLINE_MS（1h——「批滞留内存连 spool 都未落」的 failed
 *  档兜底；spec :91「failed=耗 maxAttempts+spoolDeadline 1h」）。
 *  登记偏差（T15 质评#7，有单测钉值+on-load/admin retry 兜底）：行龄=createdAt（行自创建起算）非
 *  「首次 failed 时点」——长期 pending 后才首失败的行会被 createdAt 龄提前判死；语义偏差接受
 *  （dead 非终局——重驱面在案），收紧需加列（lastFailedAt）非本卡面。 */
export function isProjectionDead(p: { attempts: number; createdAtMs: number; nowMs: number }): boolean {
  return p.attempts >= PROJECTION_MAX_ATTEMPTS || p.nowMs - p.createdAtMs > FLUSH_FAILED_DEADLINE_MS;
}

/** 错误分类（fencing 红锚的判定单源——T15 质评 Minor#4：epoch 易主=决定性证据，先于错误形态判）：
 *  ① currentEpoch≠capturedEpoch（含失守 null）⇒ fenced（不耗 attempts——滚动部署/双开；与错误
 *  形态无关，任何错误在 epoch 已动窗内一律按失守处置）；② epoch 未动的 503 族 ⇒ fenced（drain/
 *  真空窗/受理门等租约档——重试无意义且非本代真失败）；其余 ⇒ transient（真失败——耗 attempts，
 *  如 degraded spool 503∧epoch 恒定）。 */
export function classifyApplyError(err: unknown, capturedEpoch: bigint | null, currentEpoch: bigint | null): 'fenced' | 'transient' {
  if (currentEpoch !== capturedEpoch) return 'fenced';   // epoch 易主——决定性证据先判
  const status = (err as { status?: unknown })?.status;
  if (typeof status === 'number' && status >= 500) return 'fenced';
  return 'transient';
}

/** tick 摘要（测试/观测面——outcomes=本轮逐行转移分档计数）。 */
export interface ProjectionTickSummary {
  claimed: number;
  /** 本轮遇 fenced（epoch 易主——停 claim 等租约；非 holder 首行早退同置位）。 */
  fenced: boolean;
  outcomes: Partial<Record<string, number>>;
}

type OutcomeLabel = 'projected' | 'fast-path' | 'superseded' | 'orphaned' | 'dead' | 'retry-spooled' | 'retry-failed' | 'fenced';

@Injectable()
export class ProjectionOutboxPoller implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ProjectionOutboxPoller.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private destroyed = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CollabLeaseService) private readonly lease: CollabLeaseService,
    @Inject(CollabDocumentService) private readonly docs: CollabDocumentService,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
    /** T16 交接面：projected/orphaned 后 post-apply 触发该 project 的 MediaBinding 惰性 reconcile
     *  （requestReconcile 仅入队 fire-and-forget——零阻塞投影循环；spec :25 裁决③「poller mark 后 lazy」）。 */
    @Inject(BindingReconcileService) private readonly reconciler: BindingReconcileService,
  ) {}

  /** dead 行 on-load reconcile（spec :91「dead 行加 on-load reconcile/admin retry 重驱」——启动
   *  limited requeue：近期窗内有界重驱，admin retry 面管单行精细重开）。 */
  onModuleInit(): void {
    void this.requeueDeadOnLoad().then(
      (n) => { if (n > 0) this.logger.warn(`[projection] on-load dead 重驱 ${n} 行（limited requeue）`); },
      (e) => this.logger.warn(`[projection] on-load dead 重驱失败: ${(e as Error).message}`),
    );
    const t = setInterval(() => {
      void this.tick().catch((e) => this.logger.warn(`projection tick: ${(e as Error).message}`));
    }, PROJECTION_POLL_INTERVAL_MS);
    t.unref?.();
    this.timer = t;
  }

  /** 停 claim+等在飞有界（spec :91——busy 翻转即完成；上界 SHUTDOWN_WAIT_MS 不吊进程退出）。 */
  async onApplicationShutdown(): Promise<void> {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const t0 = Date.now();
    while (this.busy && Date.now() - t0 < SHUTDOWN_WAIT_MS) {
      await new Promise((r) => { const t = setTimeout(r, 50); t.unref?.(); });
    }
  }

  /** 一轮：claim 批（跨 project）→按 project 分组逐组处理；busy 防重入；destroyed 后零 claim。
   *  非 lease holder（epoch null）首行早退——「停 claim 等租约」（claim 事务本身无租约语义，
   *  SKIP LOCKED 只防双 claim 不防非 holder 写 doc——写面围栏=withSession/flushDocument epoch 校验）。 */
  async tick(): Promise<ProjectionTickSummary> {
    const summary: ProjectionTickSummary = { claimed: 0, fenced: false, outcomes: {} };
    if (this.destroyed) return summary;
    // Important#2（T15 质评）：lag 刷新在一切早退（fenced 零持有/busy 重入/空 claim）之前——每 tick
    // 刷新（无 pending=归零），防 gauge 冻结在陈旧正值违约 metrics help「每 tick 刷新」自述。
    // T19 质评 Important#1：applied_unpersisted 同纪律 tick 头清零（空轮/fenced 早退不刷新滞留的
    // 根修）——非 persisted 组行数在循环内累加、循环后一次 set（跨 project last-writer-wins 消除）。
    docDeliveryAppliedUnpersisted.set(0);
    void this.observeLag().catch(() => {});
    const epoch = this.lease.currentEpoch();
    if (epoch === null) return { ...summary, fenced: true };   // 非 holder——零 claim（等租约）
    if (this.busy) return summary;                             // 防重入（长轮不叠）
    this.busy = true;
    let unpersisted = 0;
    try {
      const rows = await this.claim();
      summary.claimed = rows.length;
      if (rows.length === 0) return summary;
      const byProject = new Map<string, ArtifactProjection[]>();
      for (const row of rows) {
        const list = byProject.get(row.projectId) ?? [];
        list.push(row);
        byProject.set(row.projectId, list);
      }
      for (const [projectId, prows] of byProject) {
        if (this.destroyed) break;
        const r = await this.processProject(projectId, prows, epoch);
        unpersisted += r.appliedUnpersisted;   // Important#1：跨 project 累计（各非 persisted 组）
        for (const [k, v] of Object.entries(r.outcomes)) summary.outcomes[k] = (summary.outcomes[k] ?? 0) + (v ?? 0);
        if (r.fenced) { summary.fenced = true; break; }   // fenced 停 claim 等租约——余组本轮放弃
      }
      return summary;
    } finally {
      docDeliveryAppliedUnpersisted.set(unpersisted);   // 循环后一次 set（含 fenced break 形态——累计至今）
      this.busy = false;
    }
  }

  /** 两段式事务 claim（MaterializeJob.claim 同形态）：SELECT FOR UPDATE SKIP LOCKED（并发双 poller
   *  恰一）→同事务置 projecting+leaseUntil+runId。候选=pending ∧ nextAttemptAt 到期 ∧ lease
   *  过期/NULL；**projecting∧lease 过期同收**（崩溃残留行自愈——不收则永滞 projecting）。
   *  时区纪律（materialize claim 头注同源）：Prisma 写 naive=UTC 墙钟——一律 (now() AT TIME ZONE 'utc')。 */
  async claim(): Promise<ArtifactProjection[]> {
    const runId = randomUUID();
    const leaseUntil = new Date(Date.now() + PROJECTION_LEASE_MS);
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "ArtifactProjection"
        WHERE "state" IN ('pending', 'projecting')
          AND "nextAttemptAt" <= (now() AT TIME ZONE 'utc')
          AND ("leaseUntil" IS NULL OR "leaseUntil" < (now() AT TIME ZONE 'utc'))
        ORDER BY "nextAttemptAt", "createdAt"
        LIMIT ${PROJECTION_BATCH}
        FOR UPDATE SKIP LOCKED`);
      if (candidates.length === 0) return [];
      const ids = candidates.map((c) => c.id);
      const { count } = await tx.artifactProjection.updateMany({
        where: { id: { in: ids } },
        data: { state: 'projecting', leaseUntil, runId },
      });
      if (count !== ids.length) {
        // SKIP LOCKED+行锁保持至 commit——结构性不可达；防御分日志（不中断：findMany 回读真值）
        this.logger.warn(`[projection] claim 写回 ${count}/${ids.length}（防御日志——SKIP LOCKED 行锁下应恰等）`);
      }
      return tx.artifactProjection.findMany({ where: { id: { in: ids } } });
    });
  }

  /** 单 project 一组：全序见类头注。返回 outcomes 逐档计数+fenced（本轮放弃信号）+
   *  appliedUnpersisted（T19 Important#1：本组 doc 已 apply 而 flush 未 persisted 的行数——
   *  persisted ⇒ 0；retry spooled/failed ⇒ deliverable 行数；terminal fk/早退 ⇒ 0〔行已终态化
   *  或未 apply——无待持久语义〕；累加归 tick 全局）。 */
  private async processProject(
    projectId: string,
    rows: ArtifactProjection[],
    capturedEpoch: bigint,
  ): Promise<{ outcomes: Partial<Record<string, number>>; fenced: boolean; appliedUnpersisted: number }> {
    const outcomes: Partial<Record<string, number>> = {};
    const inc = (k: OutcomeLabel) => { outcomes[k] = (outcomes[k] ?? 0) + 1; artifactProjectionOutcomeTotal.inc({ outcome: k }); };
    const fencedNow = () => this.lease.currentEpoch() !== capturedEpoch;   // v11.1①：每步前比对

    // ① fence 前置（claim→apply 段）：epoch 已动 ⇒ fencedBail 全量释放（不耗 attempts）
    if (fencedNow()) { await this.fencedBail(rows, inc); return { outcomes, fenced: true, appliedUnpersisted: 0 }; }

    // ② 读 NodeArtifact：rev≠投影锚 ⇒ superseded（终态不重试零 doc 写）
    const artifacts = await this.prisma.nodeArtifact.findMany({
      where: { id: { in: rows.map((r) => r.artifactId) } },
    });
    const byId = new Map<string, NodeArtifact>(artifacts.map((a) => [a.id, a]));
    const survivors: Array<{ row: ArtifactProjection; artifact: NodeArtifact }> = [];
    for (const row of rows) {
      const artifact = byId.get(row.artifactId);
      if (!artifact) {
        // 权威行灭失（保留矩阵守护下结构性不可达——防御终态：不重试不死循环）
        await this.mark(row, { state: 'orphaned', lastError: 'artifact-missing' });
        inc('orphaned');
        continue;
      }
      if (artifact.rev !== row.artifactRev) {
        await this.mark(row, { state: 'superseded' });
        inc('superseded');
        continue;
      }
      survivors.push({ row, artifact });
    }
    if (survivors.length === 0) return { outcomes, fenced: false, appliedUnpersisted: 0 };

    // ③ 内容等值 fast path 判定（裁决 :53：doc 当前值等值=跳 apply 省写——非权威判据）：
    //    withSession(read) 单次读全部存活行的 doc 当前值。null 等值同判（clear 行复投/已 null
    //    预置=null 值交付的 fast path——readNodeDataValue 缺键=undefined≠null：缺键仍走 apply 补写）。
    let equalFlags: boolean[];
    try {
      equalFlags = await this.docs.withSession(projectId, (doc) => survivors.map(({ row, artifact }) =>
        readNodeDataValue(doc, row.nodeId, keyOf(row)) === valueOf(artifact, row),
      ), { mode: 'read' });
    } catch (err) {
      if (classifyApplyError(err, capturedEpoch, this.lease.currentEpoch()) === 'fenced') {
        await this.fencedBail(survivors.map((s) => s.row), inc);
        return { outcomes, fenced: true, appliedUnpersisted: 0 };
      }
      // Minor#5（T15 质评）：读失败降级全走 apply（equalFlags 全 false）——真失败计数由逐行 apply
      // 承担（哪行 apply 成功哪行耗尽各归各），不整组预支 attempts。
      this.logger.warn(`[projection] fast path 读失败降级全走 apply（逐行承担失败计数）project=${projectId}: ${(err as Error).message}`);
      equalFlags = survivors.map(() => false);
    }

    // ④ deliverArtifact 复合 op（非等值行）：data.{fileId|result}+exec done 同 withSession(write) 事务。
    //    written:false node-deleted =「谁观察 node 删除」权威观察点 ⇒ orphaned+幂等退款。
    const deliverable: Array<{ row: ArtifactProjection; artifact: NodeArtifact }> = [];   // flush 后 recheck 集
    const fastPath: Array<{ row: ArtifactProjection; artifact: NodeArtifact }> = [];
    for (let i = 0; i < survivors.length; i += 1) {
      const s = survivors[i];
      if (equalFlags[i]) { fastPath.push(s); continue; }   // fast path——跳写（flush 后 mark）
      try {
        const r = await this.docs.deliverArtifact(projectId, {
          nodeId: s.row.nodeId,
          targetField: keyOf(s.row),
          // mediaId=null=clearMedia 语义：钉 null 写（P2-⑥ 裁定——web 消费面 null≡缺失等值；
          // 旧链 deleteNodeDataKeys 删键随直写收口退役）；null≠undefined 不触发 Z5 fail-fast
          value: valueOf(s.artifact, s.row),
          exec: await this.execDonePatch(s.artifact),
        });
        if (!r.data.written) {
          const unwrittenReason = r.data.reason ?? 'unwritten';
          // Y1c T15 收口 B②（Q-M-3）：written:false 按 reason 分档——只有真删族（node-deleted/
          // no-node-map=节点不存在/非 map 壳）走 orphaned 权威观察点；活节点结构缺（no-data-map）
          // /域键拒（text-domain-protected）≠node-deleted——误判 orphaned 会错终态+误退款+MediaBinding
          // 误删（reconcile 触发），改走真失败档（耗 attempts 退避重试）+Sentry 告警（结构缺=bug 面）。
          if (unwrittenReason === 'node-deleted' || unwrittenReason === 'no-node-map') {
            await this.mark(s.row, { state: 'orphaned', lastError: `node-deleted:${unwrittenReason}` });
            inc('orphaned');
            await this.refundOrphaned(s.artifact);
            // T16：node 删除=MediaBinding stale 清扫的权威观察点——触发该 project reconcile（删行）。
            this.reconciler.requestReconcile(projectId);
            continue;
          }
          const structErr = new Error(`deliverArtifact data unwritten reason=${unwrittenReason}（非 node-deleted 档——活节点结构缺/域键拒，T15 收口 B② 分档）`);
          Sentry.captureException(structErr);
          inc(await this.failRow(s.row, structErr) ? 'dead' : 'retry-failed');   // 真失败档——耗 attempts
          continue;
        }
        deliverable.push(s);
      } catch (err) {
        if (classifyApplyError(err, capturedEpoch, this.lease.currentEpoch()) === 'fenced') {
          // fenced：本行+未处理行+已 apply/快道未 mark 行全数释放（fencedBail）——本轮放弃
          await this.fencedBail([s.row, ...survivors.slice(i + 1).map((x) => x.row), ...fastPath.map((x) => x.row), ...deliverable.map((x) => x.row)], inc);
          return { outcomes, fenced: true, appliedUnpersisted: 0 };
        }
        inc(await this.failRow(s.row, err) ? 'dead' : 'retry-failed');   // 真失败——耗 attempts
      }
    }
    if (deliverable.length === 0 && fastPath.length === 0) return { outcomes, fenced: false, appliedUnpersisted: 0 };

    // ⑤ 批尾一次 flush（T14 窄接口——投影推进唯一凭据；capturedEpoch 提交前校验在彼①段）
    let flush: Awaited<ReturnType<CollabDocumentService['flushDocument']>>;
    try {
      flush = await this.docs.flushDocument(projectId, capturedEpoch);
    } catch (err) {
      // flushDocument 契约 3 不 throw——防御档：按 failed 耗 attempts（infra 异常非 fenced 语义）
      flush = { kind: 'retry', reason: 'failed' };
      this.logger.warn(`[projection] flushDocument 意外抛错（防御档=failed）project=${projectId}: ${(err as Error).message}`);
    }
    // T19（spec :518·质评 Important#1 改道）：本组 applied_unpersisted 改返回值（tick 全局累计
    // 一次 set——原组内直 set 的跨 project last-writer-wins 缺口根修）。persisted ⇒ 0；
    // spooled/failed（apply 已做未持久）⇒ deliverable 行数（fast path 行未 apply——不计）；
    // terminal fk ⇒ 0（行已终态化无待持久语义）；稳态目标=0，spool 回灌后下轮归零。
    const appliedUnpersisted
      = flush.kind === 'persisted' || (flush.kind === 'terminal' && flush.reason === 'fk')
        ? 0
        : deliverable.length;

    // ⑥ 逐行 recheck+mark（fast path 同判定——等值是内存态判定，projected 需 flush persisted 背书）
    const flushLoop = [...deliverable, ...fastPath];
    for (let fi = 0; fi < flushLoop.length; fi += 1) {
      const s = flushLoop[fi];
      if (flush.kind === 'terminal' && flush.reason === 'fk') {
        await this.mark(s.row, { state: 'orphaned', lastError: 'project-gone' });
        inc('orphaned');
        await this.refundOrphaned(s.artifact);
        continue;
      }
      if (flush.kind === 'terminal' && flush.reason === 'fenced') {
        // Minor#3：flush 段 fenced 出口=当前行+余行全量释放（原仅当前行——余行滞 projecting
        // 等 lease 过期 60s 才可复投，组内语义不一致）——停 claim 等租约
        await this.fencedBail(flushLoop.slice(fi).map((x) => x.row), inc);
        return { outcomes, fenced: true, appliedUnpersisted: 0 };
      }
      if (flush.kind === 'retry' && flush.reason === 'spooled') {
        await this.releaseRows([s.row], { backoffMs: PROJECTION_BACKOFF_BASE_MS });   // G58：不耗 attempts 无限重试
        inc('retry-spooled');
        continue;
      }
      if (flush.kind === 'retry' && flush.reason === 'failed') {
        inc(await this.failRow(s.row, new Error('flush retry/failed（批滞留内存队列）')) ? 'dead' : 'retry-failed');
        continue;
      }
      // persisted → recheck rev（一致才 projected；rev 又进 ⇒ superseded——用户 replace 竞态）
      const current = await this.prisma.nodeArtifact.findUnique({
        where: { id: s.artifact.id },
        select: { rev: true },
      });
      if (!current || current.rev !== s.row.artifactRev) {
        await this.mark(s.row, { state: 'superseded' });
        inc('superseded');
        continue;
      }
      await this.mark(s.row, { state: 'projected', projectedAt: new Date() });
      inc(deliverable.includes(s) ? 'projected' : 'fast-path');
      // T16 post-apply 触发：fileId/result 落 doc ⇒ MediaBinding 索引对齐（fire-and-forget 入队——
      // drain 周期收敛，不阻塞本循环）。
      this.reconciler.requestReconcile(projectId);
    }
    return { outcomes, fenced: false, appliedUnpersisted };
  }

  /** 行级 mark（runId CAS——lease 过期被新代 reclaim 后 0 行放弃，不污染新代状态机）。
   *  登记口径（T15 质评#7 组）：CAS 0 行（已被新代接管）仍计 outcomes/指标——观测口径=「本代处理
   *  动作」非「行终态归属」（新代接管后本代计数不回冲；漂移仅出现在 60s lease 过期接管窗，可忽略）。 */
  private async mark(
    row: ArtifactProjection,
    data: Partial<{ state: 'projected' | 'superseded' | 'orphaned' | 'dead' | 'pending'; lastError: string; attempts: number; projectedAt: Date; nextAttemptAt: Date }>,
  ): Promise<void> {
    await this.prisma.artifactProjection.updateMany({
      where: { id: row.id, ...(row.runId ? { runId: row.runId } : {}) },
      data: {
        ...data,
        leaseUntil: null,   // 一切 mark=claim 归属终结（projecting 态只在 claim 瞬间存在）
        runId: null,
      },
    }).catch((e) => this.logger.warn(`[projection] mark ${data.state} 失败 row=${row.id}: ${(e as Error).message}`));
  }

  /** fenced 统一出口（T15 质评 Minor#3）：入参行全数回 pending（不耗 attempts）+逐行 fenced 计数
   *  +返回本轮放弃信号（调用方停 claim 等租约）——四处 fenced 出口（前置①/fast path 读/apply
   *  catch/flush 段）单源；组间放弃由 tick 的 r.fenced break 承担（余组行未被本出口触达——保持
   *  projecting+leaseUntil=claim 置位值，claim 在租约到期前有 lease 阻塞、≤PROJECTION_LEASE_MS 自愈）。 */
  private async fencedBail(rows: ArtifactProjection[], inc: (k: OutcomeLabel) => void): Promise<{ fenced: boolean }> {
    await this.releaseRows(rows, { backoffMs: PROJECTION_POLL_INTERVAL_MS });
    for (let i = 0; i < rows.length; i += 1) inc('fenced');
    return { fenced: true };
  }

  /** 行回 pending（fenced/spooled 档——**不耗 attempts**；nextAttemptAt=退避后的重驱点）。 */
  private async releaseRows(rows: ArtifactProjection[], opts: { backoffMs: number }): Promise<void> {
    if (rows.length === 0) return;
    const nextAttemptAt = new Date(Date.now() + opts.backoffMs);
    await this.prisma.artifactProjection.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, runId: { in: rows.map((r) => r.runId).filter((v): v is string => v !== null) } },
      data: { state: 'pending', leaseUntil: null, runId: null, nextAttemptAt },
    }).catch((e) => this.logger.warn(`[projection] release ${rows.length} 行失败: ${(e as Error).message}`));
  }

  /** 真失败计数（apply/flush failed 档）：attempts+1+退避；dead 判据命中 ⇒ dead+告警（Sentry+
   *  outcome 计数——admin retry/on-load 重驱面）。spooled/fenced 不进本函数（G58/滚动部署不耗预算）。
   *  返回 true=本轮判死（调用方 outcomes 分档 dead/retry-failed）。 */
  private async failRow(row: ArtifactProjection, err: unknown): Promise<boolean> {
    const attempts = row.attempts + 1;
    const message = `${(err as Error)?.message ?? String(err)}`.slice(0, 500);
    if (isProjectionDead({ attempts, createdAtMs: row.createdAt.getTime(), nowMs: Date.now() })) {
      await this.mark(row, { state: 'dead', attempts, lastError: message });
      Sentry.captureException(new Error(`projection dead row=${row.id} artifact=${row.artifactId} attempts=${attempts}: ${message}`));
      this.logger.error(`[projection] 投影行耗尽判死 row=${row.id} artifact=${row.artifactId} attempts=${attempts}: ${message}（on-load reconcile/admin retry 重驱面）`);
      return true;
    }
    await this.mark(row, { state: 'pending', attempts, lastError: message, nextAttemptAt: new Date(Date.now() + computeProjectionBackoffMs(attempts)) });
    this.logger.warn(`[projection] 投影失败第 ${attempts}/${PROJECTION_MAX_ATTEMPTS} 次 row=${row.id}: ${message}`);
    return false;
  }

  /** orphaned 幂等退款（spec R3「delivery failed（node 删/project gone）→orphaned+幂等退款」）：
   *  资金锚=NodeArtifact.sourceIntentRowId（generated 源——replace 命令无资金锚天然跳过）；
   *  rollbackDeliveryFailed CAS 幂等重跑恰一次。抛错不阻断终态（orphaned 已落）——Important#1
   *  （T15 质评）：catch=Sentry+专用计数（artifact_projection_orphan_refund_fail_total）；根治收敛
   *  =R3 决策表窗⑥（IntentReconcileService.sweepOrphanedRefund 扫「SUCCEEDED∧当前代投影 orphaned」
   *  →rollbackDeliveryFailed——CAS 与本路径互斥恰一次；旧注「收敛归 R3」泛指已更正为此具体窗口）。 */
  private async refundOrphaned(artifact: NodeArtifact): Promise<void> {
    if (!artifact.sourceIntentRowId || artifact.source !== 'generated') return;
    try {
      const refunded = await this.teamCredit.rollbackDeliveryFailed(
        artifact.sourceIntentRowId,
        'projection orphaned: node-deleted（节点已删——产物未投递）',
      );
      if (refunded) this.logger.warn(`[projection] orphaned 退款完成 intent=${artifact.sourceIntentRowId}`);
    } catch (e) {
      artifactProjectionOrphanRefundFailTotal.inc();
      Sentry.captureException(new Error(`projection orphaned refund failed intent=${artifact.sourceIntentRowId}: ${(e as Error).message}（R3 sweepOrphanedRefund 窗⑥下轮收敛）`));
      this.logger.warn(`[projection] orphaned 退款失败（终态已落——R3 sweepOrphanedRefund 窗⑥下轮收敛）intent=${artifact.sourceIntentRowId}: ${(e as Error).message}`);
    }
  }

  /** exec done patch（exec 降 cache——spec Z18''⑤ done=投影 poller 专写）：键集 EXEC_STATUS_KEYS 内
   *  （status/attempts/intentId/execSeq/fileId）；attempts=intent 行现值（Z111 代次守卫所需——
   *  行灭失（保留矩阵守护下不可达）退 0，守卫按 older-attempts 丢弃=UI cache 面无害）。
   *  登记（T15 评审 P2-⑤）：jobId 不随投影 done 写（web 零消费面 grep 实证——jobId 仅 loading 期
   *  UI 关联用；投影 done 到达时 job 已完成无关联对象）。 */
  private async execDonePatch(artifact: NodeArtifact): Promise<ExecStatusPatch> {
    const intent = artifact.sourceIntentRowId
      ? await this.prisma.generationIntent.findUnique({
          where: { id: artifact.sourceIntentRowId },
          select: { attempts: true, intentId: true },
        })
      : null;
    return {
      status: 'done',
      attempts: typeof intent?.attempts === 'number' ? intent.attempts : 0,
      ...(intent?.intentId ? { intentId: intent.intentId } : {}),
      ...(artifact.sourceExecSeq != null ? { execSeq: artifact.sourceExecSeq.toString() } : {}),
      ...(artifact.mediaId ? { fileId: artifact.mediaId } : {}),
    };
  }

  /** dead 行 on-load reconcile（limited requeue）：近期窗内有界重驱（attempts 清零——dead 判据
   *  已耗尽过一轮，重启=运维语义上的一次性再给预算；窗外陈旧行不复活——重建即复活循环）。 */
  async requeueDeadOnLoad(): Promise<number> {
    const r = await this.prisma.$executeRaw`
      UPDATE "ArtifactProjection" SET state = 'pending', attempts = 0, "leaseUntil" = NULL,
        "runId" = NULL, "nextAttemptAt" = (now() AT TIME ZONE 'utc'), "lastError" = NULL
      WHERE "id" IN (
        SELECT "id" FROM "ArtifactProjection"
        WHERE "state" = 'dead'
          AND "createdAt" > (now() AT TIME ZONE 'utc') - make_interval(days => (${PROJECTION_DEAD_REQUEUE_WINDOW_MS / 86_400_000})::int)
        ORDER BY "createdAt"
        LIMIT ${PROJECTION_DEAD_REQUEUE_LIMIT}
      )`;
    return r;
  }

  /** admin retry：终态行（orphaned/dead）re-open→pending（undo 恢复节点/admin 人工重驱最小入口——
   *  superseded 不重开〔槽位已换代，重开必再 superseded〕）。 */
  async retryProjection(id: string): Promise<{ requeued: boolean; state: string }> {
    const row = await this.prisma.artifactProjection.findUnique({ where: { id }, select: { id: true, state: true } });
    if (!row) return { requeued: false, state: 'missing' };
    if (row.state !== 'orphaned' && row.state !== 'dead') return { requeued: false, state: row.state };
    await this.prisma.artifactProjection.updateMany({
      where: { id, state: row.state },
      data: { state: 'pending', attempts: 0, leaseUntil: null, runId: null, nextAttemptAt: new Date(), lastError: null },
    });
    this.logger.warn(`[projection] admin retry 重开 row=${id} ${row.state}→pending`);
    return { requeued: true, state: 'pending' };
  }

  /** poller lag 观测：最老非终态行龄（gauge——无 pending=0）。 */
  private async observeLag(): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ oldest: Date | null }[]>(Prisma.sql`
      SELECT min("createdAt") AS "oldest" FROM "ArtifactProjection" WHERE "state" IN ('pending', 'projecting')`);
    const oldest = rows[0]?.oldest;
    const seconds = oldest ? (Date.now() - oldest.getTime()) / 1000 : 0;
    artifactProjectionPendingAgeSeconds.set(seconds);
    docDeliveryLagSeconds.set(seconds);   // T19（spec :518 钉名面）——同查询同值（help 互注）
  }
}

// ── 纯读 helper（fast path 判定/doc 值读取——Y 结构守卫读，非 Y.Map 一律 undefined=不等值） ──

function keyOf(row: Pick<ArtifactProjection, 'targetField'>): 'fileId' | 'result' {
  return row.targetField === 'result' ? 'result' : 'fileId';
}

function valueOf(artifact: NodeArtifact, row: Pick<ArtifactProjection, 'targetField'>): string | null {
  return row.targetField === 'result' ? artifact.resultText : artifact.mediaId;
}

function readNodeDataValue(doc: Y.Doc, nodeId: string, key: string): unknown {
  const entry = doc.getMap('nodes').get(nodeId);
  if (!(entry instanceof Y.Map)) return undefined;
  const data = entry.get('data');
  if (!(data instanceof Y.Map)) return undefined;
  return data.get(key);
}
