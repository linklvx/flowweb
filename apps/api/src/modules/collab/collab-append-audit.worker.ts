// apps/api/src/modules/collab/collab-append-audit.worker.ts
// C3-1（plan Task C3-1——doc-append-gap-alert 生产就绪收尾批·红先行）：SQL 聚合审计 DB poller
// （worker 进程——RetentionSweeperPoller/CollabCompactPoller 同款「OnModuleInit+原生 setInterval unref」形态；
// api 进程零注册〔worker.module 平铺〕）。每 5min tick 单事务四步（advisory xact 单飞首句——审计只读+游标行
// 无业务写面，单飞防双实例重复告警/边沿双计〔COLLAB_JOB_CURSOR_JOBS 词表注释口径：本 tick 消费游标故入表〕）：
//  ①轮转游标读（CollabJobCursor job='doc-append-gap-audit'：lastKey 按 projectId 轮转——尾部项目饿死根除；
//    lastGap=(project,generation) gapActive 边沿态+purge 义务年龄窗）；
//  ②项目批选择（每 tick 项目数预算分批——全项目单聚合=全表扫废止；无 CanvasDoc 行∨lifecycleState!='ACTIVE'
//    →skip 计数不审计【红③：擦除/删除中项目零触碰假阳性根除】）；
//  ③单条 SQL CTE 审计 =ANY($ids) 批内聚合（红① 三断言+CanvasDocCoalesced 两端豁免；聚合只取指针快照水位之上行（红② purge
//    延迟窗旧行不参与零假阳性，不 skip））；
//  ④游标回写（lastKey 轮转推进+lastGap 合并持久）+purge 义务年龄告警（红②——独立告警通道，不被审计吞掉）。
// 新 gap 边沿 inc：gapActive false→true 才 doc_append_gap_total.inc（charter 阈值 increase([5m])>0——
// 持续 gap 不每 tick 重发、worker 重启不重基线〔lastGap 持久判重〕）+collab_doc_append_gap_current gauge
// 每 tick 重算+即时 captureCollabException+结构化日志（失败输出 {projectId,generation,指针水位,pgSeq,
// 断言违例,缺失区间}——runbook §6 分诊）。两指标语义注记分工作 runbook §6。
// 热路径 walSeq tripwire（appendBatch C1② fail-closed 数据丢失级拒收）维持不降格——本文件零触碰。
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DOC_APPEND_GAP_AUDIT_JOB } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { captureCollabException } from '../../utils/sentry-scrub';
import { projectDocName } from './doc-name.util';
import { CanvasDocUpdateRepository, type AppendAuditViolation } from './canvas-doc-update.repository';
import {
  collabAppendAuditLastRunUnixSeconds, collabAppendAuditPurgeStaleTotal, collabAppendAuditTickTotal,
  collabDocAppendGapCurrent, docAppendGapTotal,
} from './collab-append-audit.metrics';

/** tick 周期（每 5min——gap 检出延迟粒度；env 可调，COMPACT_POLL_INTERVAL_MS 同族形态：值经 dotenv 先行
 *  在位、Number()|| 默认缺省档、消费面=worker 轮询周期非部署档位）。 */
export const DOC_APPEND_AUDIT_INTERVAL_MS = Number(process.env.DOC_APPEND_AUDIT_INTERVAL_MS) || 300_000;
/** advisory 单飞键（xact 域——事务结束释放；双 worker 第二实例 skip+计数）。 */
export const APPEND_AUDIT_ADVISORY_KEY = 'flowweb:doc-append-gap-audit';
/** 每 tick 项目数预算（分批轮转——轮转游标保证全项目周期覆盖）。 */
export const APPEND_AUDIT_PROJECT_BATCH = 200;
/** tick 事务上限（游标读+批选择+审计 CTE+游标回写单事务）。 */
const TICK_TX_TIMEOUT_MS = 30_000;
/** purge 义务年龄阈值（红②：purgeBelowSeq 持续非空>30min=compact resumePurges 收敛链卡死独立告警）。 */
export const PURGE_OBLIGATION_STALE_MS = 30 * 60_000;
/** 缺失区间样本上界（per 对/边界——generate_series 惰性 LIMIT；missing_count 全量计数走索引区间扫）。 */
const MISSING_SAMPLE_CAP = 20;

/** lastGap 持久态条目：(project) → { g=generation, gap=三断言违例在否, purgeSince=义务年龄观察起点,
 *  purgeStale=年龄告警已发边沿标记〔防每 tick 重发〕 }。 */
interface GapEdgeEntry { g: number; gap: boolean; purgeSince: number | null; purgeStale?: boolean }
type LastGapState = Record<string, GapEdgeEntry>;

/** 坏 JSON 容错解析（游标行被外部触碰/旧版本形态——折空态重播即重建）。 */
function parseGapState(v: unknown): LastGapState {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: LastGapState = {};
  for (const [k, e] of Object.entries(v as Record<string, unknown>)) {
    if (typeof e !== 'object' || e == null || Array.isArray(e)) continue;
    const g = (e as { g?: unknown }).g, gap = (e as { gap?: unknown }).gap;
    if (typeof g !== 'number' || typeof gap !== 'boolean') continue;
    const purgeSince = (e as { purgeSince?: unknown }).purgeSince;
    const purgeStale = (e as { purgeStale?: unknown }).purgeStale;
    out[k] = {
      g, gap, purgeSince: typeof purgeSince === 'number' ? purgeSince : null,
      ...(purgeStale === true ? { purgeStale: true } : {}),
    };
  }
  return out;
}

@Injectable()
export class CollabAppendAuditWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CollabAppendAuditWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 单飞互斥（setInterval 漏 tick 防叠跑）。 */
  private running = false;
  /** 每 tick 项目数预算（测试缝——红③ 轮转边界用小值触发；生产默认 APPEND_AUDIT_PROJECT_BATCH=200）。 */
  projectBatch = APPEND_AUDIT_PROJECT_BATCH;
  /** 项目宇宙测试隔离缝（C1-1 scopeProjectIds 同族可测性注入——int 套件并行文件共享 dev 库：批选择/
   *  轮转游标/wrap 剪除断言域内化；生产不设=全域零行为变化）。 */
  auditScope: readonly string[] | undefined;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** boot 即跑首 tick（红⑥ 样本年龄面：last_run gauge 在 3002 可服务前落定——init 期完成则巡检零假窗）；
   *  失败不阻启动（error tick 不推进 gauge——巡检年龄判定自然升级为告警）。 */
  async onModuleInit(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => { void this.tick(); }, DOC_APPEND_AUDIT_INTERVAL_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** 审计批内单条 SQL CTE 委托面（红① 三断言+两端侧表豁免——M-2 单源：语义与 test-utils/append-audit
   *  JS 夹面对拍；本文件指针快照水位 token 零引用〔契约 10——repository 外零引用〕，SQL 本体居 repository 静态面）。 */
  private auditAppendBatch(tx: Prisma.TransactionClient, ids: readonly string[]): Promise<readonly AppendAuditViolation[]> {
    return CanvasDocUpdateRepository.auditAppendBatch(tx, ids);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const now = Date.now();
    try {
      const plan = await this.prisma.$transaction(async (tx) => {
        // advisory 单飞首句（xact 域——双 worker 并发 tick 第二取锁者必然失败→skip+计数）
        const lock = await tx.$queryRaw<{ ok: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtext(${APPEND_AUDIT_ADVISORY_KEY})) AS ok`;
        if (!lock[0]?.ok) return { singleflight: true as const };
        // 轮转游标读（首 tick 无行折 ''/空态）
        const cur = await tx.$queryRaw<{ lastKey: string | null; lastGap: Prisma.JsonValue | null }[]>`
          SELECT "lastKey", "lastGap" FROM "CollabJobCursor" WHERE job = ${DOC_APPEND_GAP_AUDIT_JOB}::text`;
        const lastKey = cur[0]?.lastKey ?? '';
        const prevGap = parseGapState(cur[0]?.lastGap);
        // 批选择：项目宇宙=CanvasProject LEFT JOIN CanvasDoc（预算+1 探测续批；红③ skip 面两档计数；
        // auditScope 测试隔离缝=投影不变——生产不设）
        const scopeSql = this.auditScope ? Prisma.sql` AND p.id = ANY(${this.auditScope}::text[])` : Prisma.empty;
        const heads = await tx.$queryRaw<{
          projectId: string; noDoc: boolean; inactive: boolean;
          generation: number | null; purgeBelowSeq: bigint | null;
        }[]>`
          SELECT p.id AS "projectId", (d."projectId" IS NULL) AS "noDoc",
                 (p."lifecycleState" IS DISTINCT FROM 'ACTIVE') AS "inactive",
                 d.generation, d."purgeBelowSeq"
          FROM "CanvasProject" p
          LEFT JOIN "CanvasDoc" d ON d."projectId" = p.id
          WHERE p.id > ${lastKey}::text${scopeSql}
          ORDER BY p.id ASC
          LIMIT ${this.projectBatch + 1}`;
        const full = heads.length > this.projectBatch;
        const batch = heads.slice(0, this.projectBatch);
        const eligible = batch.filter((r) => !r.noDoc && !r.inactive);
        // 审计 CTE（单条 SQL 批内——红①③；eligible 空批=零行返回）
        const violations = await this.auditAppendBatch(tx, eligible.map((r) => r.projectId));
        // gap 边沿合并（false→true 才 inc——lastGap 持久判重；换代（g 变）即新域从 false 起）
        const byProject = new Map<string, AppendAuditViolation[]>();
        for (const v of violations) {
          const list = byProject.get(v.projectId);
          if (list == null) byProject.set(v.projectId, [v]); else list.push(v);
        }
        const nextGap: LastGapState = { ...prevGap };
        const newGaps: string[] = [];
        const resolvedGaps: string[] = [];
        const purgeStaleEdges: Array<{ projectId: string; ageMs: number }> = [];
        for (const r of eligible) {
          const pid = r.projectId;
          const generation = r.generation ?? 0;
          const gap = byProject.has(pid);
          const prev = prevGap[pid];
          const prevActive = prev != null && prev.g === generation && prev.gap;
          if (gap && !prevActive) newGaps.push(pid);
          if (!gap && prevActive) resolvedGaps.push(pid);
          // purge 义务年龄（红②——doc 级 purgeBelowSeq 持久非空窗；观察起点=首见 tick，衰减/修复即清）
          const purgeSince = r.purgeBelowSeq != null ? (prev?.purgeSince ?? now) : null;
          const purgeAgeMs = purgeSince == null ? null : now - purgeSince;
          const purgeStale = purgeAgeMs != null && purgeAgeMs > PURGE_OBLIGATION_STALE_MS;
          if (purgeStale && purgeAgeMs != null && prev?.purgeStale !== true) {
            purgeStaleEdges.push({ projectId: pid, ageMs: purgeAgeMs });
          }
          nextGap[pid] = { g: generation, gap, purgeSince, ...(purgeStale ? { purgeStale: true } : {}) };
        }
        // 轮转边界（批不满=周目到尾）：lastGap 孤儿项剪除（项目/doc 删除后残留态虚增 current gauge）
        if (!full) {
          const scopeAlive = this.auditScope ? Prisma.sql` WHERE "projectId" = ANY(${this.auditScope}::text[])` : Prisma.empty;
          const alive = new Set((await tx.$queryRaw<{ projectId: string }[]>`
            SELECT "projectId" FROM "CanvasDoc"${scopeAlive}`).map((a) => a.projectId));
          for (const k of Object.keys(nextGap)) if (!alive.has(k)) delete nextGap[k];
        }
        const nextKey = full ? batch[batch.length - 1]!.projectId : '';
        await tx.$executeRaw`
          INSERT INTO "CollabJobCursor" (job, "lastKey", "lastGap", "updatedAt")
          VALUES (${DOC_APPEND_GAP_AUDIT_JOB}::text, ${nextKey}::text, ${JSON.stringify(nextGap)}::jsonb, now())
          ON CONFLICT (job) DO UPDATE
            SET "lastKey" = EXCLUDED."lastKey", "lastGap" = EXCLUDED."lastGap", "updatedAt" = now()`;
        return {
          singleflight: false as const,
          skips: {
            noDoc: batch.filter((r) => r.noDoc).length,
            inactive: batch.filter((r) => !r.noDoc && r.inactive).length,
          },
          byProject, newGaps, resolvedGaps, purgeStaleEdges,
          gapCount: Object.values(nextGap).filter((e) => e.gap).length,
        };
      }, { timeout: TICK_TX_TIMEOUT_MS, maxWait: 5_000 });
      // 提交后计数（tx 回滚不虚计——retention 家族纪律）
      if (plan.singleflight) {
        collabAppendAuditTickTotal.inc({ result: 'skip-singleflight' });
        return;
      }
      collabAppendAuditTickTotal.inc({ result: 'ok' });
      for (let i = 0; i < plan.skips.noDoc; i += 1) collabAppendAuditTickTotal.inc({ result: 'skip-no-doc' });
      for (let i = 0; i < plan.skips.inactive; i += 1) collabAppendAuditTickTotal.inc({ result: 'skip-inactive' });
      // 红① 新 gap 边沿 inc+结构化失败输出+即时 capture
      for (const pid of plan.newGaps) {
        docAppendGapTotal.inc();
        this.reportGapFailure(pid, plan.byProject.get(pid)!);
      }
      for (const pid of plan.resolvedGaps) {
        this.logger.warn(`doc append gap 修复回落 project=${pid}（true→false 边沿——collab_doc_append_gap_current 本 tick 重算回落）`);
      }
      // 红② purge 义务年龄独立告警（不被审计三断言吞掉）
      for (const e of plan.purgeStaleEdges) {
        collabAppendAuditPurgeStaleTotal.inc();
        this.logger.error(`append 审计 purge 义务年龄告警 project=${e.projectId}（purgeBelowSeq 持续非空 ${Math.floor(e.ageMs / 60_000)}min > ${PURGE_OBLIGATION_STALE_MS / 60_000}min——compact resumePurges 收敛链卡死；分诊 runbook §6）`);
        captureCollabException(
          new Error(`purge obligation stale ${Math.floor(e.ageMs / 60_000)}min project=${e.projectId}`),
          { docName: projectDocName(e.projectId), reason: 'append-audit-purge-stale', connectionId: '-' },
        );
      }
      collabDocAppendGapCurrent.set(plan.gapCount);   // 红① current gauge——每 tick 重算（持久态全域计数）
      collabAppendAuditLastRunUnixSeconds.set(Math.floor(now / 1000));   // 红⑥ 样本年龄判定面（完成 tick 推进）
    } catch (e) {
      collabAppendAuditTickTotal.inc({ result: 'error' });
      this.logger.error(`append 审计 tick 失败（error tick 不推进 last_run gauge——巡检样本年龄判定自然升龄告警）: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** 红① 失败输出（plan：{projectId,generation,指针水位,pgSeq,断言违例,缺失区间} 结构化）——
   *  BigInt 恒十进制字符串（system-history.ts 契约纪律）+日志留档+即时 captureCollabException。 */
  private reportGapFailure(pid: string, rows: readonly AppendAuditViolation[]): void {
    const head = rows[0]!;
    const failure = {
      projectId: pid, generation: head.generation,
      snapshotFloor: head.snapshotFloor.toString(), pgSeq: head.pgSeq.toString(),   // 指针快照水位（SQL 别名列——值 stringify）
      violations: rows.map((v) => ({
        kind: v.kind,
        rowSeq: v.row_seq == null ? null : v.row_seq.toString(),
        missingCount: v.missing_count == null ? null : Number(v.missing_count),
        missingSample: v.missing_sample == null ? null : v.missing_sample.map((s) => s.toString()),
        note: v.note,
      })),
    };
    this.logger.error(`doc append gap 审计违例（三断言：a 行内密度/b 行间衔接∨侧表覆盖/c 边界两端豁免）: ${JSON.stringify(failure)}`);
    captureCollabException(
      new Error(`doc append gap audit violations project=${pid} generation=${head.generation} kinds=${rows.map((r) => r.kind).join('/')}`),
      { docName: projectDocName(pid), reason: 'doc-append-gap-audit', connectionId: '-' },
    );
  }
}