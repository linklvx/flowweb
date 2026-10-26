// apps/api/src/modules/collab/runtime-feed.service.ts
// Y1c T22（plan v1.7 Task 22——spec v5.4 §7 Runtime Feed 平面，G5 门主体）：RuntimeEvent 写入
// （feedSeq 分配=RuntimeFeedCursor upsert 行锁——分配序≡提交序）+HTTP 游标读面+首连快照折叠
// +心跳 latestFeedSeq+保留期清理 worker（7d/100k 先到为准+minRetainedSeq+runtime_feed_bytes）。
//
// 锁序冻结（v5.4⑮+修正批 #10）：**业务行→counter（counter 恒最后拿）**；CanvasDoc 读=plain SELECT
// **禁 FOR SHARE**（MVCC 快照读零阻塞——不与维护/快照互斥）。负控=静态锁序断言（本文件读 CanvasDoc
// 的唯一 SELECT 无 FOR SHARE 字样——G5 锁序 lint）+正常序压力（N 次无 40P01）+「去 counter」负控
// （期望重复/缺口——见 g5 语料）。
//
// 唯一交付=HTTP 游标（spec §7）：stateless 通知/心跳只带 {type:'feed-hint',latestFeedSeq} 不带事件体
// ——通知在业务事务提交后发（notifyProject——≤1 次/秒合并）；客户端单 reducer 拉取应用。
// ExecutionOutbox=工作队列维持（**禁作 feed 日志**——可变队列使游标出洞）。
import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Gauge } from 'prom-client';
import {
  EVENT_KINDS, RUNTIME_EVENT_PAYLOAD_MAX_BYTES,
  RUNTIME_EVENT_RETENTION_DAYS, RUNTIME_EVENT_RETENTION_MAX_PER_PROJECT,
  runtimeEventPayloadPiiViolations, mergeRuntimeProjection,
  type RuntimeEventKind, type RuntimeEventPayload,
  type RuntimeProjection, type RuntimeNodeProjectionEntry,
} from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { parseDocName } from './doc-name.util';
import { CollabGateway } from './collab.gateway';
import { CollabSessionGuardService } from './collab-session-guard.service';

/** feed-hint stateless 载荷（通知/心跳共用形态——不带事件体）。 */
export const feedHintPayload = (latestFeedSeq: bigint | string): string =>
  JSON.stringify({ type: 'feed-hint', latestFeedSeq: String(latestFeedSeq) });

/** 通知合并窗口（≤1 次/秒——spec §7「durable watermark 广播 ≤1 次/秒，仅辅助」）。 */
const NOTIFY_THROTTLE_MS = 1_000;
/** 保留期清理 worker 周期（小时级——非热路径）。 */
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const runtimeFeedBytes = new Gauge({
  name: 'runtime_feed_bytes',
  help: 'RuntimeEvent payload 存储字节（per-project gauge——保留期清理 worker 刷新；spec §7 runtime_feed_bytes）',
  labelNames: ['projectId'] as const,
});

/** 事件 wire 行（BigInt 一律 String——§5.2）。 */
export interface RuntimeEventWireRow {
  id: string;
  feedSeq: string;
  generation: number;
  kind: string;
  payload: RuntimeEventPayload;
  docSeq: string | null;
  createdAtMs: number;
}

/** 首连快照信封（spec §7：{snapshot,cursor,minRetainedSeq,historyId}——cursor 三元 wire string）。 */
export interface RuntimeFeedSnapshotEnvelope {
  snapshot: RuntimeProjection;
  cursor: { historyId: string; generation: number; feedSeq: string };
  minRetainedSeq: string;
  historyId: string;
}

@Injectable()
export class RuntimeFeedService {
  private readonly logger = new Logger(RuntimeFeedService.name);
  /** per-project 通知节流（进程内——合并窗；通知丢失无害：心跳/次事件再追平）。 */
  private readonly lastNotifyAt = new Map<string, number>();
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  /** 事务提交后通知回调（gateway 注入——sendStateless 广播；缺省 no-op 供测试/独立构造）。 */
  private notifySink: ((projectId: string, payload: string) => void) | null = null;

  /** 心跳增补快照（进程内 lastKnown——本进程写入过的项目最新 feedSeq；同步读供心跳 enricher，
   *  心跳=追平兜底「仅辅助」故陈旧可接受：空=未写过→心跳纯形态，客户端周期拉取兜底）。 */
  private readonly lastKnown = new Map<string, bigint>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    /** T22 通知/心跳接线（同模块——@Optional 供直构测试）。 */
    @Optional() @Inject(CollabGateway) private readonly gateway?: CollabGateway | null,
    @Optional() @Inject(CollabSessionGuardService) private readonly sessionGuard?: CollabSessionGuardService | null,
  ) {}

  /** gateway 通知缝（sendStateless 广播注入——运行时接线；测试可覆写）。 */
  setNotifySink(sink: (projectId: string, payload: string) => void): void { this.notifySink = sink; }

  /** 进程内 lastKnown 读面（心跳 enricher 同步快照——null=本进程未写过）。 */
  peekLatestFeedSeq(projectId: string): bigint | null { return this.lastKnown.get(projectId) ?? null; }

  /** T22 接线：通知 sink（gateway stateless 扇出）+心跳 latestFeedSeq 增补（SG enricher）。 */
  onModuleInit(): void {
    if (this.gateway) {
      this.setNotifySink((projectId, payload) => {
        try { this.gateway!.broadcastStatelessToProject(projectId, payload); } catch { /* 广播失败无害——心跳/次事件再追平 */ }
      });
    }
    this.sessionGuard?.setHeartbeatEnricher((conn) => {
      const pid = conn.document?.name ? parseDocName(conn.document.name)?.projectId : undefined;
      if (!pid) return null;
      const seq = this.lastKnown.get(pid);
      return seq === undefined ? null : { latestFeedSeq: String(seq) };
    });
    this.startRetentionWorker();
  }

  onApplicationShutdown(): void { this.stopRetentionWorker(); }

  // ═══ 写入（业务事务内——counter 恒最后拿）════════════════════════════════════════════

  /**
   * 事件写入（业务事务内原子——执行状态变更与 RuntimeEvent 同一 PG 事务，spec §7）。
   * 顺序=锁序契约：①CanvasDoc plain SELECT（generation/docSeq 快照读——**禁 FOR SHARE**）
   * ②counter upsert（RUNTIME_FEED_CURSOR_UPSERT_SQL——行锁持有至提交，分配序≡提交序；空项目
   * 首事件 upsert 自建行）③payload 构造（nodeVersion=自身 feedSeq——单名单义）④校验
   * （kind∈EVENT_KINDS 闭表+PII 扫描+payload≤64KB 超限拒写=业务 bug 非截断）⑤INSERT。
   * payloadFactory 收 feedSeq——调用方禁自带 nodeVersion（单源=本方法）。
   */
  async appendEventInTx(
    tx: Prisma.TransactionClient,
    projectId: string,
    kind: RuntimeEventKind,
    payloadFactory: (feedSeq: bigint) => Record<string, unknown>,
  ): Promise<{ feedSeq: bigint; generation: number; docSeq: bigint }> {
    if (!(EVENT_KINDS as readonly string[]).includes(kind)) {
      throw new Error(`RUNTIME_EVENT_KIND_UNKNOWN: ${kind}（closed registry——EVENT_KINDS 外禁写）`);
    }
    // ①业务行读（plain SELECT——锁序第一步；禁 FOR SHARE 见类头注）
    const docRows = await tx.$queryRaw<{ generation: number; pgSeq: bigint }[]>`
      SELECT "generation", "pgSeq" FROM "CanvasDoc" WHERE "projectId" = ${projectId}::text`;
    const generation = docRows[0]?.generation ?? 0;
    const docSeq = docRows[0]?.pgSeq ?? 0n;
    // ②counter（最后拿——行锁至提交；upsert 空项目首事件自建行=genesis 同源形态）
    const cursorRows = await tx.$queryRaw<{ lastSeq: bigint }[]>`
      INSERT INTO "RuntimeFeedCursor" ("projectId", "lastSeq", "minRetainedSeq") VALUES (${projectId}::text, 1, 0)
      ON CONFLICT ("projectId") DO UPDATE SET "lastSeq" = "RuntimeFeedCursor"."lastSeq" + 1
      RETURNING "lastSeq"`;
    const feedSeq = cursorRows[0]!.lastSeq;
    // ③payload（nodeVersion=自身 feedSeq 单源铸造）
    const raw = { ...(payloadFactory(feedSeq) as Record<string, unknown>), v: 1, kind } as unknown as RuntimeEventPayload;
    (raw as { nodeVersion?: string }).nodeVersion = String(feedSeq);
    // ④校验：PII 扫描+payload≤64KB（超限拒写——业务 bug 非截断）
    const violations = runtimeEventPayloadPiiViolations(raw);
    if (violations.length > 0) {
      throw new Error(`RUNTIME_EVENT_PII_FORBIDDEN: payload 键 ${violations.join(',')} 命中禁写模式（禁 prompt/正文/URL 原文）`);
    }
    const bytes = Buffer.byteLength(JSON.stringify(raw), 'utf8');
    if (bytes > RUNTIME_EVENT_PAYLOAD_MAX_BYTES) {
      throw new Error(`RUNTIME_EVENT_PAYLOAD_TOO_LARGE: ${bytes}>${RUNTIME_EVENT_PAYLOAD_MAX_BYTES}（拒写——resultText 大文本放 NodeArtifact 事件只带引用）`);
    }
    // ⑤INSERT（与业务行同事务提交）
    await tx.runtimeEvent.create({ data: { projectId, generation, feedSeq, kind, payload: raw as unknown as Prisma.InputJsonValue, docSeq } });
    return { feedSeq, generation, docSeq };
  }

  /** 便捷写入（无业务事务上下文——自开事务；语义同 appendEventInTx）。 */
  async appendEvent(
    projectId: string,
    kind: RuntimeEventKind,
    payloadFactory: (feedSeq: bigint) => Record<string, unknown>,
  ): Promise<{ feedSeq: bigint; generation: number; docSeq: bigint }> {
    const r = await this.prisma.$transaction((tx) => this.appendEventInTx(tx, projectId, kind, payloadFactory), { timeout: 10_000, maxWait: 5_000 });
    this.lastKnown.set(projectId, r.feedSeq);   // 心跳快照（提交后值）
    return r;
  }

  /**
   * 业务事务包装（T22 deliverArtifact 消费面）：调用方在 body 内先做业务判定（fence 等——
   * 业务行锁序在前），再经 append 闭包写事件（counter 恒最后拿）。返回 body 的返回值；
   * 通知（notifyProject）由调用方在返回后触发（事务提交后——spec §7）。
   */
  async appendEventTransaction<T>(
    projectId: string,
    body: (
      tx: Prisma.TransactionClient,
      append: (kind: RuntimeEventKind, payloadFactory: (feedSeq: bigint) => Record<string, unknown>) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    const r = await this.prisma.$transaction(async (tx) => {
      const append = async (kind: RuntimeEventKind, payloadFactory: (feedSeq: bigint) => Record<string, unknown>) => {
        await this.appendEventInTx(tx, projectId, kind, payloadFactory).then((e) => { this.lastKnown.set(projectId, e.feedSeq); });
      };
      return body(tx, append);
    }, { timeout: 10_000, maxWait: 5_000 });
    return r;
  }

  /** 交付幂等前置（deliverArtifact）：同 (nodeId, artifactRev) exec.artifact 事件在档 ⇒ true
   *  （poller 重投/ambiguous commit 安全——事件唯一性按业务键非 feedSeq）。 */
  async hasArtifactEvent(projectId: string, nodeId: string, artifactRev: number): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "RuntimeEvent"
      WHERE "projectId" = ${projectId}::text AND "kind" = 'exec.artifact'
        AND payload->>'nodeId' = ${nodeId}::text
        AND (payload->>'artifactRev')::int = ${artifactRev}::int
      LIMIT 1`;
    return rows.length > 0;
  }

  /** 业务事务提交后通知（spec §7「通知在业务事务提交后发」——调用方在 tx 提交后调；节流 ≤1/s/project）。 */
  notifyProject(projectId: string): void {
    const now = Date.now();
    const last = this.lastNotifyAt.get(projectId) ?? 0;
    if (now - last < NOTIFY_THROTTLE_MS) return;
    this.lastNotifyAt.set(projectId, now);
    try {
      void this.latestFeedSeq(projectId).then((s) => {
        if (this.notifySink && s > 0n) this.notifySink(projectId, feedHintPayload(s));
      }).catch(() => undefined);
    } catch { /* 通知失败无害——心跳/次事件再追平 */ }
  }

  // ═══ 读面（HTTP 游标——升序 limit≤200）══════════════════════════════════════════════

  /** cursor 之后事件（feedSeq 升序 LIMIT≤200——缺口判定归客户端 reducer：返回不连续=从 cursor 重取）。 */
  async readAfter(projectId: string, after: bigint, limit: number): Promise<RuntimeEventWireRow[]> {
    const capped = Math.max(1, Math.min(200, Math.floor(limit) || 50));
    const rows = await this.prisma.runtimeEvent.findMany({
      where: { projectId, feedSeq: { gt: after } },
      orderBy: { feedSeq: 'asc' },
      take: capped,
    });
    return rows.map(toWire);
  }

  async latestFeedSeq(projectId: string): Promise<bigint> {
    const r = await this.prisma.runtimeFeedCursor.findUnique({ where: { projectId } });
    return r?.lastSeq ?? 0n;
  }

  async minRetainedSeq(projectId: string): Promise<bigint> {
    const r = await this.prisma.runtimeFeedCursor.findUnique({ where: { projectId } });
    return r?.minRetainedSeq ?? 0n;
  }

  /** 服务端当前 historyId（首连快照信封与 cursor 比对基准——SystemHistory 缺席 fail-closed）。 */
  async currentHistoryId(): Promise<string> {
    const row = await this.prisma.systemHistory.findUnique({ where: { id: 1 }, select: { historyId: true } });
    if (!row) throw new Error('SYSTEM_HISTORY_MISSING: SystemHistory 权威行缺失（feed 快照 fail-closed）');
    return row.historyId;
  }

  /**
   * 首连 RR 快照（spec §7：{snapshot,cursor,minRetainedSeq,historyId}——snapshot=全量替换+统一
   * cursor：保留事件全折叠成 RuntimeProjection；#10 换代必须全量 snapshot 的服务端半链）。
   * 折叠纯函数=foldEventsToProjection（shared merge 单源消费——本服务不持第二套 merge）。
   */
  async snapshotEnvelope(projectId: string): Promise<RuntimeFeedSnapshotEnvelope> {
    const historyId = await this.currentHistoryId();
    return this.prisma.$transaction(async (tx) => {
      const events = await tx.runtimeEvent.findMany({ where: { projectId }, orderBy: { feedSeq: 'asc' } });
      const cursorRow = await tx.runtimeFeedCursor.findUnique({ where: { projectId } });
      const docRows = await tx.$queryRaw<{ generation: number; pgSeq: bigint }[]>`
        SELECT "generation", "pgSeq" FROM "CanvasDoc" WHERE "projectId" = ${projectId}::text`;
      const generation = docRows[0]?.generation ?? 0;
      const pgSeq = docRows[0]?.pgSeq ?? 0n;
      const lastSeq = cursorRow?.lastSeq ?? 0n;
      const projection = foldEventsToSnapshot(projectId, generation, events.map(toWire), pgSeq, lastSeq);
      return {
        snapshot: projection,
        cursor: { historyId, generation, feedSeq: lastSeq.toString() },
        minRetainedSeq: (cursorRow?.minRetainedSeq ?? 0n).toString(),
        historyId,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  // ═══ 保留期清理 worker（7d/100k 先到为准+minRetainedSeq+runtime_feed_bytes）════════════

  startRetentionWorker(): void {
    if (this.retentionTimer) return;
    this.retentionTimer = setInterval(() => {
      void this.sweepRetention().catch((e) => this.logger.warn(`runtime-feed retention sweep: ${(e as Error).message}`));
    }, RETENTION_SWEEP_INTERVAL_MS);
    this.retentionTimer.unref?.();
  }

  stopRetentionWorker(): void {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = null;
  }

  /** 单轮清理：per-project 删 7d 前且超出 100k 尾部的行+推进 minRetainedSeq+刷新字节 gauge。 */
  async sweepRetention(): Promise<{ projects: number; deleted: number }> {
    const cutoff = new Date(Date.now() - RUNTIME_EVENT_RETENTION_DAYS * 24 * 3600_000);
    const projects = await this.prisma.runtimeFeedCursor.findMany({ select: { projectId: true } });
    let deleted = 0;
    let touched = 0;
    for (const p of projects) {
      const pid = p.projectId;
      const r = await this.prisma.$transaction(async (tx) => {
        // 数基线（保留窗内计数——超 100k 部分按 feedSeq 升序删尾）
        const total = await tx.runtimeEvent.count({ where: { projectId: pid } });
        let delWhere: Prisma.RuntimeEventWhereInput;
        if (total > RUNTIME_EVENT_RETENTION_MAX_PER_PROJECT) {
          const excess = total - RUNTIME_EVENT_RETENTION_MAX_PER_PROJECT;
          const kth = await tx.runtimeEvent.findMany({ where: { projectId: pid }, orderBy: { feedSeq: 'asc' }, skip: excess - 1, take: 1, select: { feedSeq: true } });
          const kthSeq = kth[0]?.feedSeq ?? 0n;
          delWhere = { projectId: pid, OR: [{ createdAt: { lt: cutoff } }, { feedSeq: { lte: kthSeq } }] };
        } else {
          delWhere = { projectId: pid, createdAt: { lt: cutoff } };
        }
        const d = await tx.runtimeEvent.deleteMany({ where: delWhere });
        // minRetainedSeq=现存最小 feedSeq-1（全删空=lastSeq——快照档）
        const minRow = await tx.runtimeEvent.findFirst({ where: { projectId: pid }, orderBy: { feedSeq: 'asc' }, select: { feedSeq: true } });
        const cursor = await tx.runtimeFeedCursor.findUnique({ where: { projectId: pid } });
        const minRetained = minRow ? minRow.feedSeq - 1n : (cursor?.lastSeq ?? 0n);
        if ((cursor?.minRetainedSeq ?? 0n) !== minRetained) {
          await tx.runtimeFeedCursor.updateMany({ where: { projectId: pid }, data: { minRetainedSeq: minRetained } });
        }
        return d.count;
      });
      if (r > 0) touched += 1;
      deleted += r;
      const sizeRow = await this.prisma.$queryRaw<{ bytes: bigint | null }[]>`
        SELECT COALESCE(SUM(octet_length(payload::text)), 0) AS bytes FROM "RuntimeEvent" WHERE "projectId" = ${pid}::text`;
      runtimeFeedBytes.set({ projectId: pid }, Number(sizeRow[0]?.bytes ?? 0n));
    }
    return { projects: touched, deleted };
  }
}

// ── 纯函数（可测面）────────────────────────────────────────────────────────────────────

/** 行 → wire（BigInt 一律 String）。 */
export function toWire(r: { id: string; feedSeq: bigint; generation: number; kind: string; payload: unknown; docSeq: bigint | null; createdAt: Date }): RuntimeEventWireRow {
  return {
    id: r.id, feedSeq: r.feedSeq.toString(), generation: r.generation, kind: r.kind,
    payload: r.payload as RuntimeEventPayload,
    docSeq: r.docSeq === null ? null : r.docSeq.toString(),
    createdAtMs: r.createdAt.getTime(),
  };
}

/**
 * 保留事件全折叠 → 快照投影（服务端发布时 join 面+首连快照共用）：
 * 逐事件升序投影成节点槽（merge 语义由 shared mergeRuntimeProjection 单源承载——本函数只做
 * event→slot 的形状转换，逐事件构造 delta 走 merge；快照统一 cursor=lastSeq/pgSeq=CanvasDoc 水位）。
 */
export function foldEventsToSnapshot(projectId: string, generation: number, events: readonly RuntimeEventWireRow[], pgSeq: bigint, lastSeq: bigint): RuntimeProjection {
  let current: RuntimeProjection = { projectId, generation, feedSeq: '0', pgSeq: pgSeq.toString(), nodes: {} };
  for (const e of events) {
    if (e.generation !== generation) continue;   // 旧代隔离（feedSeq 跨代不重置——按 generation 过滤）
    const slot = slotOfEvent(e.payload);
    if (slot === null) continue;   // unknown kind 忽略（服务端折叠面——客户端同规则+计数）
    const [nodeId, entry] = slot;
    current = mergeDelta(current, { [nodeId]: entry }, e.feedSeq);
  }
  current = { ...current, feedSeq: lastSeq.toString(), pgSeq: pgSeq.toString() };
  return current;
}

function mergeDelta(current: RuntimeProjection, nodes: Record<string, RuntimeNodeProjectionEntry>, feedSeq: string): RuntimeProjection {
  // shared merge 单源（fullSnapshot=false 同代增量——单事件 delta 形态）
  return mergeRuntimeProjection(current, {
    projection: { projectId: current.projectId, generation: current.generation, feedSeq, pgSeq: current.pgSeq, nodes },
    fullSnapshot: false,
  });
}

/** payload → 单节点槽（unknown/非节点事件=null）。 */
export function slotOfEvent(p: RuntimeEventPayload): [string, RuntimeNodeProjectionEntry] | null {
  if (p.kind === 'exec.status') {
    return [p.nodeId, {
      execStatus: { status: p.status, errorCode: p.errorCode, attempts: p.attempts, artifactRev: p.artifactRev, nodeVersion: p.nodeVersion },
    }];
  }
  if (p.kind === 'exec.artifact') {
    return [p.nodeId, { artifact: { mediaId: p.mediaId, resultRef: p.resultRef, artifactRev: p.artifactRev, nodeVersion: p.nodeVersion } }];
  }
  if (p.kind === 'node.deleted') {
    return [p.nodeId, { deletedAt: { lifecycleSeq: p.lifecycleSeq, nodeVersion: p.nodeVersion } }];
  }
  if (p.kind === 'node.restored') {
    // 复活槽：restored.nodeVersion ≥ deletedAt.nodeVersion ⇒ 墓碑失活（undo 重建回渲染面）
    return [p.nodeId, { restored: { lifecycleSeq: p.lifecycleSeq, nodeVersion: p.nodeVersion } }];
  }
  return null;   // doc.vacuumed=换代通知（非节点槽——换代走全量快照）
}
