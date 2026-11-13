// apps/api/src/modules/collab/oracle-worker.service.ts
// C3b-2（plan v3 Task C3b-2——spec 2026-11-11-foundation-batch-design.md §3.4-1/§3.4-3）：PG oracle
// 证人 worker——从 CanvasDocSnapshot+CanvasDocUpdate 在 pgSeq 重建 doc（same-seq、无 residency/lease
// 依赖、分页〔loadForHydrationAt 既有原语〕）做**候选无关** UUID 叶扫描，写 CanvasReferenceOracle
// （当前态证人）+CanvasReferenceOracleScan（coverage header）。**worker 进程 DB poller**（canary
// verify 同族「OnModuleInit+原生 setInterval unref」形态——api 进程零注册）。
//
// 协议（spec §3.4-3 短事务纪律）：
//   ① 锚读（readRebuildAnchor——锁外快照 {generation G, pgSeq S, bindingsDirty}）+header 复用判定；
//   ② header 置 VERIFYING（在途可观测——崩溃窗不认 coverage；coverage 只认 COMPLETE）；
//   ③ RR 短读：loadForHydrationAt(pid,{G,S}) 单 RR 事务读「指针快照+增量尾」（既有原语——重建/漂移
//      检测专用定代定水位装载，分页 PAGE_ROWS）；**扫描（重放+遍历）在事务外**，单 doc 预算超时
//      bail-out（typed error→header FAILED+error 落档，不写行——下轮重试）；
//   ④ 另起事务：FOR UPDATE 行锁 CAS 校验 CanvasDoc {pgSeq=S ∧ generation=G} 未变（并发扫描/append
//      串行化——错序交错不可能以旧行集配新 header 落库）→ oracle 行按 project **原子替换**
//      （DELETE 全量+INSERT..SELECT unnest JOIN "Media" ON id∧teamId 过滤——nodeId/edgeId 自然滤除
//      防表膨胀〔第七轮 P1-1：nodes 根键不入扫描面，UUID 形态键亦不采〕；软删/DELETING 媒体照采=
//      删除中止证人；未知字段 media UUID 仍捕获——候选无关）→ header COMPLETE（零引用 refCount=0
//      也写——spec §3.4-2）。
//   复用条件（增量跳过）=`historyEpoch+generation+verifiedSeq` 全同 ∧ status=COMPLETE ∧
//   CanvasDoc.bindingsDirty=false——historyEpoch=worker 实例启动 UUID（ProjectionBackfillState.
//   backfillEpoch 同体例）。CAS miss/失败=header 不认 COMPLETE，下轮重扫。
// 扫描域=nodes+edges 两根（canonicalDocView 同族根单源——新增可写根必须同步扩 SCAN_ROOTS）。
// 指标=oracle-worker.metrics.ts 单源（coverage_ratio/scan_age——低基数）。
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { createCanvasDoc } from './canvas-doc.factory';
import { oracleCoverageRatio, oracleScanAgeSeconds } from './oracle-worker.metrics';

/** 单 doc 扫描预算（重放+遍历共用 deadline——CANARY_VERIFY_BUDGET_MS=10s 同族先例：全 doc 重放
 *  CPU 密集，单 doc 不阻塞 tick；超时 bail-out 下轮重试）。 */
export const ORACLE_SCAN_BUDGET_MS = 10_000;
/** tick 周期（env 可调——CANARY_VERIFY_INTERVAL_MS 同族形态：dotenv 先行在位、Number()||缺省档）。 */
export const ORACLE_SCAN_INTERVAL_MS = Number(process.env.ORACLE_SCAN_INTERVAL_MS) || 60_000;
/** 每 tick 扫描上界（全 doc 重放 CPU 密集——canary 批 8 的保守半档，单飞互斥下 tick 有界）。 */
const ORACLE_SCAN_BATCH = 4;
/** 遍历深度上限（嵌套容器护栏——C3a-9 oracle 递归同款）。 */
const SCAN_MAX_DEPTH = 32;

/** UUID 形态（小写 canonical——randomUUID/Media.id @default(uuid()) 同形态，collab-sentry 断言同款
 *  正则；整串匹配=spec「string 叶子值保留 UUID 形态」字面口径，长文本内嵌子串不采）。 */
export const UUID_LEAF_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 扫描域根（nodes+edges 两根——canonicalDocView 根单源同族；新增可写根必须同步扩本列表）。 */
const SCAN_ROOTS = ['nodes', 'edges'] as const;

/** 扫描预算超时 typed error（bail-out——header FAILED 落 error 文案）。 */
export class OracleScanBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OracleScanBudgetError';
  }
}

/** 扫描锚（锁外快照三元——CAS 期望侧；pgSeq/generation 任一在写面落定前被并发移动即 CAS miss）。 */
export interface OracleScanAnchor {
  generation: number;
  pgSeq: bigint;
  bindingsDirty: boolean;
}

export type OracleScanOutcome =
  | { outcome: 'no-doc' }   // CanvasDoc/CanvasProject 行缺（未建档/已级联删除）
  | { outcome: 'reused' }   // 复用条件全同——本轮跳过（零扫描零写）
  | { outcome: 'complete'; verifiedSeq: bigint; refCount: number }
  | { outcome: 'cas-miss' }   // 写前 CAS 失败（pgSeq/generation 被并发移动）——header 保持 VERIFYING
  | { outcome: 'failed'; error: string };   // 扫描失败（预算超时/装载异常）——header FAILED+error

function throwBudget(budgetMs: number, where: string): never {
  throw new OracleScanBudgetError(`oracle scan budget exceeded (${budgetMs}ms at ${where})`);
}

/** 重建 doc+遍历全容器 string 叶→UUID 形态集（事务外扫描本体）。全容器覆盖：Y.Map/Y.Array/Y.Text
 *  （含 XmlText 子类——文本内容本身=叶子串）/Y.XmlElement（属性值+子树）/Y.XmlFragment/plain JSON
 *  容器；环/深嵌套护栏（WeakSet+深度上限）。预算：重放每 64 帧查+遍历每 256 访问查+入口首查。 */
export function scanUuidLeaves(state: Buffer | null, updates: readonly Buffer[], budgetMs: number): string[] {
  const deadline = Date.now() + budgetMs;
  if (Date.now() >= deadline) throwBudget(budgetMs, 'replay start');
  const doc = createCanvasDoc();
  const found = new Set<string>();
  try {
    if (state != null) Y.applyUpdate(doc, new Uint8Array(state));
    for (let i = 0; i < updates.length; i++) {
      Y.applyUpdate(doc, new Uint8Array(updates[i]));
      if ((i & 63) === 63 && Date.now() >= deadline) throwBudget(budgetMs, `replay row ${i + 1}/${updates.length}`);
    }
    const seen = new WeakSet<object>();
    let visits = 0;
    const walk = (value: unknown, depth: number): void => {
      if (++visits >= 256) {
        visits = 0;
        if (Date.now() >= deadline) throwBudget(budgetMs, 'traverse');
      }
      if (value === null || typeof value !== 'object') {
        if (typeof value === 'string' && UUID_LEAF_RE.test(value)) found.add(value);   // 标量叶：UUID 形态保留
        return;
      }
      if (depth > SCAN_MAX_DEPTH) return;
      const v = value as object;
      if (seen.has(v)) return;
      seen.add(v);
      if (v instanceof Y.Map) {
        for (const x of v.values()) walk(x, depth + 1);
        return;
      }
      if (v instanceof Y.Array) {
        for (const x of v.toArray()) walk(x, depth + 1);
        return;
      }
      if (v instanceof Y.Text) {   // 文本叶（Y.XmlText 同为 Text 子类）——内容本身=叶子串
        const s = v.toString();
        if (UUID_LEAF_RE.test(s)) found.add(s);
        return;
      }
      if (v instanceof Y.XmlElement) {
        for (const a of Object.values(v.getAttributes())) walk(a, depth + 1);   // 属性值=string 叶
        for (const child of v.toArray()) walk(child, depth + 1);
        return;
      }
      if (v instanceof Y.XmlFragment) {
        for (const child of v.toArray()) walk(child, depth + 1);
        return;
      }
      if (Array.isArray(v)) {
        for (const x of v) walk(x, depth + 1);
        return;
      }
      for (const x of Object.values(v)) walk(x, depth + 1);   // plain JSON 容器
    };
    for (const root of SCAN_ROOTS) walk(doc.getMap(root), 0);
    return [...found];
  } finally {
    doc.destroy();
  }
}

@Injectable()
export class OracleWorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OracleWorkerService.name);
  /** 本轮 worker 启动纪元（backfillEpoch 同体例——复用条件腿之一：进程重启全量重扫一轮）。 */
  readonly historyEpoch = randomUUID();
  /** 项目宇宙测试隔离缝（canary verifyScope 同族——int 套件串行文件共享 dev 库）。 */
  scanScope: readonly string[] | undefined;
  /** 单 doc 扫描预算（测试缝——生产默认 ORACLE_SCAN_BUDGET_MS）。 */
  scanBudgetMs = ORACLE_SCAN_BUDGET_MS;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 单飞互斥（setInterval 漏 tick 防叠跑——canary 同款）。 */
  private running = false;

  // 显式 @Inject：vitest esbuild 不生成设计时类型元数据（binding-rebuild 同模式）
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CanvasDocUpdateRepository) private readonly repo: CanvasDocUpdateRepository,
  ) {}

  /** boot 即跑首 tick（canary 同款）；失败不阻启动。 */
  async onModuleInit(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => { void this.tick(); }, ORACLE_SCAN_INTERVAL_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** 一拍：枚举复用不命中项目（批上界）逐项目扫描+指标刷新（返回值=测试/日志面；枚举面异常
   *  计数不抛——boot 首 tick 不因瞬时 DB 故障炸 worker 引导，canary tick 同族）。 */
  async tick(): Promise<{ scanned: number }> {
    if (this.running) return { scanned: 0 };
    this.running = true;
    try {
      const scopeSql = this.scanScope ? Prisma.sql` AND d."projectId" = ANY(${this.scanScope}::text[])` : Prisma.empty;
      const rows = await this.prisma.$queryRaw<{ projectId: string }[]>`
        SELECT d."projectId" FROM "CanvasDoc" d
        JOIN "CanvasProject" p ON p.id = d."projectId" AND p."lifecycleState" = 'ACTIVE'
        LEFT JOIN "CanvasReferenceOracleScan" h ON h."projectId" = d."projectId"
        WHERE (h."projectId" IS NULL OR h.status <> 'COMPLETE'
            OR h."historyEpoch" <> ${this.historyEpoch}::text
            OR h.generation <> d.generation
            OR h."verifiedSeq" <> d."pgSeq"
            OR d."bindingsDirty" = true)${scopeSql}
        ORDER BY h."scannedAt" ASC NULLS FIRST, d."projectId" ASC
        LIMIT ${ORACLE_SCAN_BATCH}`;
      let scanned = 0;
      for (const r of rows) {
        scanned += 1;
        await this.scanProject(r.projectId).catch((e) => {
          this.logger.warn(`oracle scan 失败 project=${r.projectId}（下轮重试）: ${(e as Error).message}`);
        });
      }
      await this.refreshMetrics().catch(() => undefined);   // 维护面每 tick（失败保持最后值）
      return { scanned };
    } catch (e) {
      this.logger.error(`oracle scan tick 失败: ${(e as Error).message}`);
      return { scanned: 0 };
    } finally {
      this.running = false;
    }
  }

  /** ① 锚读（readRebuildAnchor 装载单源——service 不直查 CanvasDoc）。 */
  async snapshotScanAnchor(projectId: string): Promise<OracleScanAnchor | null> {
    const row = await this.repo.readRebuildAnchor(projectId);
    return row ? { generation: row.generation, pgSeq: row.pgSeq, bindingsDirty: row.bindingsDirty } : null;
  }

  /** 组合入口：锚读+复用判定+扫描（交错红测经 snapshotScanAnchor/scanProjectAt 分段锚定竞窗——
   *  binding-rebuild 三段暴露同族）。 */
  async scanProject(projectId: string): Promise<OracleScanOutcome> {
    const anchor = await this.snapshotScanAnchor(projectId);
    if (!anchor) return { outcome: 'no-doc' };
    const h = await this.prisma.canvasReferenceOracleScan.findUnique({ where: { projectId } });
    if (
      h != null && h.status === 'COMPLETE' && h.historyEpoch === this.historyEpoch
      && h.generation === anchor.generation && h.verifiedSeq === anchor.pgSeq && !anchor.bindingsDirty
    ) {
      return { outcome: 'reused' };
    }
    return this.scanProjectAt(projectId, anchor);
  }

  /** ②③锚定扫描：VERIFYING 置位→RR 短读装载→事务外扫描（预算）→④另事务 CAS 写。 */
  async scanProjectAt(projectId: string, anchor: OracleScanAnchor): Promise<OracleScanOutcome> {
    await this.prisma.canvasReferenceOracleScan.upsert({
      where: { projectId },
      create: { projectId, historyEpoch: this.historyEpoch, generation: anchor.generation, verifiedSeq: anchor.pgSeq, status: 'VERIFYING', refCount: 0, scannedAt: new Date() },
      update: { historyEpoch: this.historyEpoch, generation: anchor.generation, verifiedSeq: anchor.pgSeq, status: 'VERIFYING', scannedAt: new Date(), error: null },
    });
    let uuids: string[];
    try {
      const at = await this.repo.loadForHydrationAt(projectId, { generation: anchor.generation, pgSeq: anchor.pgSeq });
      uuids = scanUuidLeaves(at.state, at.updates, this.scanBudgetMs);
    } catch (err) {
      const msg = `${(err as Error).name}: ${(err as Error).message}`.slice(0, 512);
      await this.prisma.canvasReferenceOracleScan.update({ where: { projectId }, data: { status: 'FAILED', error: msg, scannedAt: new Date() } });
      return { outcome: 'failed', error: msg };
    }
    return this.commitScan(projectId, anchor, uuids);
  }

  /** ④另起事务：FOR UPDATE CAS（pgSeq/generation 未变——行锁串行化并发扫描/append 错序）→行按
   *  project 原子替换（DELETE 全量+unnest JOIN Media id∧teamId 过滤 INSERT）→header COMPLETE。 */
  private async commitScan(projectId: string, anchor: OracleScanAnchor, uuids: string[]): Promise<OracleScanOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.$queryRaw<{ pgSeq: bigint; generation: number }[]>`
        SELECT "pgSeq", generation FROM "CanvasDoc" WHERE "projectId" = ${projectId}::text FOR UPDATE`;
      const d = doc[0];
      if (d == null || d.pgSeq !== anchor.pgSeq || d.generation !== anchor.generation) return { outcome: 'cas-miss' } as const;
      const team = await tx.$queryRaw<{ teamId: string }[]>`
        SELECT "teamId" FROM "CanvasProject" WHERE "id" = ${projectId}::text LIMIT 1`;
      const teamId = team[0]?.teamId;
      if (teamId == null) return { outcome: 'no-doc' } as const;   // 并发删项目——FK 链收尾归 erasure
      await tx.$executeRaw`DELETE FROM "CanvasReferenceOracle" WHERE "projectId" = ${projectId}::text`;
      let refCount = 0;
      if (uuids.length > 0) {
        refCount = await tx.$executeRaw`
          INSERT INTO "CanvasReferenceOracle" ("projectId", "mediaId", "verifiedSeq")
          SELECT ${projectId}::text, u.value, ${anchor.pgSeq}::bigint
          FROM unnest(${uuids}::text[]) AS u(value)
          JOIN "Media" m ON m.id = u.value AND m."teamId" = ${teamId}::text`;
      }
      await tx.canvasReferenceOracleScan.update({
        where: { projectId },
        data: { status: 'COMPLETE', refCount, scannedAt: new Date(), error: null, verifiedSeq: anchor.pgSeq, generation: anchor.generation, historyEpoch: this.historyEpoch },
      });
      return { outcome: 'complete' as const, verifiedSeq: anchor.pgSeq, refCount };
    }, { timeout: 8_000, maxWait: 2_000 });
  }

  /** coverage_ratio+scan_age（scope 缝过滤——canary refreshLastCheckAge 同族：ACTIVE 宇宙、
   *  COALESCE(scannedAt, doc.updatedAt) 起算〔未扫项目不虚高〕；EXTRACT(EPOCH) 瞬时豁免面）。 */
  async refreshMetrics(): Promise<void> {
    const scopeSql = this.scanScope ? Prisma.sql` AND d."projectId" = ANY(${this.scanScope}::text[])` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ total: number; covered: number; age: number | null }[]>`
      SELECT COUNT(*)::float8 AS total,
             (COUNT(*) FILTER (WHERE x.status = 'COMPLETE' AND x."verifiedSeq" = x."pgSeq"))::float8 AS covered,
             EXTRACT(EPOCH FROM (now() - MIN(x.t)))::float8 AS age
      FROM (
        SELECT d."pgSeq" AS "pgSeq", h.status AS status, h."verifiedSeq" AS "verifiedSeq",
               LEAST(COALESCE(h."scannedAt", d."updatedAt"), now()) AS t
        FROM "CanvasDoc" d
        JOIN "CanvasProject" p ON p.id = d."projectId" AND p."lifecycleState" = 'ACTIVE'
        LEFT JOIN "CanvasReferenceOracleScan" h ON h."projectId" = d."projectId"
        WHERE true${scopeSql}
      ) x`;
    const r = rows[0];
    oracleCoverageRatio.set(r != null && r.total > 0 ? r.covered / r.total : 1);
    if (r != null && r.age != null) oracleScanAgeSeconds.set(r.age);
  }
}
