// TD-33/C1b T9：ErasureRegistry——擦除意识的**DB 权威**（PG 快照唯一源；进程内 Map=缓存）。
// 两集合分层：blocked（写拒绝，零删除，Map pid→ERASING|ERASED）/ purgeable（可清残，唯一删除判据）。
// 一条 SQL 同快照产出两集合（purgeable⊆blocked 运行时断言失败即 fail-closed 按 blocked）；无放行档。
// blocked 五档：①CanvasProject.lifecycleState<>'ACTIVE'（非等值 fail-closed）②Team.status<>'ACTIVE'
// ③active run（state∉{DONE,FAILED}，行在否皆拒）④terminal run∧ACTIVE 行→ERASING（restore-pending，
// 旧 spool 重放会复活已擦内容）⑤terminal run∧无 ACTIVE 行→ERASED。
// 起点=CanvasProject∪run.scopeId 双支 UNION（Team DISBANDING 在 worker 建子 run 前的子项目=ACTIVE
// 行无 run——从 run 出发扫不到=写屏障失效窗）。run 支一律 scopeType='project'∧dryRun=false
// （dry-run run 永久 PENDING⇒不过滤=一次删除预览永久锁活项目）。
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  yjsBlockedProjects, yjsPurgeableProjects, restorePendingProjects,
  erasureRegistryAgeMs, erasureManifestMissingTotal, erasureRefreshFailuresTotal,
} from './erasure-registry.metrics';

export type ErasureBlockedState = 'ERASING' | 'ERASED';

interface ErasureSnapshotRow {
  projectId: string;
  blocked: ErasureBlockedState | null;
  restorePending: boolean;
  purgeable: boolean;
  manifestMissing: boolean;
}

@Injectable()
export class CollabErasureRegistryService {
  private readonly logger = new Logger(CollabErasureRegistryService.name);
  private blocked = new Map<string, ErasureBlockedState>();
  private purgeable = new Set<string>();
  private restorePending = new Set<string>();
  /** during-mark 簿记：load 查询返回后合并 version>查询起点的 mark，再替换快照（project.gone 后仍放行窗闭合）。 */
  private readonly marks = new Map<string, { version: number; state: ErasureBlockedState }>();
  private markSeq = 0;
  private loadInFlight: Promise<void> | null = null;
  private refreshInFlight = false;
  private loadedAtMs: number | null = null;
  /** manifestPath 缺失 per-pid 去重（持续状态非事件——refresh 每轮见同一 pid 不重复计数）。 */
  private readonly manifestMissingSeen = new Set<string>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 写拒绝判据（读实时 Map——mark 即时生效非缓存快照）。 */
  isBlocked(projectId: string): ErasureBlockedState | undefined {
    return this.blocked.get(projectId);
  }

  blockedMap(): ReadonlyMap<string, ErasureBlockedState> {
    return this.blocked;
  }

  /** 即时 mark（project.gone/team.disbanding/sweep 先 mark）——version 供 load 合并。 */
  mark(projectId: string, state: ErasureBlockedState): void {
    this.marks.set(projectId, { version: ++this.markSeq, state });
    this.blocked.set(projectId, state);
  }

  /** load 快照（仅供 boot sweep/gauge——删除授权必须 live）。 */
  listPurgeableProjectIds(): string[] {
    return [...this.purgeable];
  }

  restorePendingCount(): number {
    return this.restorePending.size;
  }

  registryAgeMs(): number | null {
    return this.loadedAtMs == null ? null : Date.now() - this.loadedAtMs;
  }

  /** 全路径取新快照（lease 获取/rejoin/start-failed 重试统一）——single-flight，无短缓存
   *  （陈旧快照=擦除陈旧窗；force 仅为调用面语义保留）。失败交由调用方 start-failed。 */
  async load(_opts: { force?: boolean } = {}): Promise<void> {
    if (this.loadInFlight) return this.loadInFlight;
    this.loadInFlight = this.doLoad().finally(() => { this.loadInFlight = null; });
    return this.loadInFlight;
  }

  /** 周期 refresh（T14 timer 10s）：在飞即跳过（慢查询重叠=旧快照晚归覆盖新状态）；失败保留旧
   *  Map 不替换（fail-closed——清空/替换=新擦除项目短窗放行）+age 继续增长。 */
  async refresh(): Promise<void> {
    if (this.refreshInFlight) return;
    this.refreshInFlight = true;
    try {
      await this.doLoad();
    } catch (e) {
      erasureRefreshFailuresTotal.inc();
      const age = this.registryAgeMs();
      if (age != null) erasureRegistryAgeMs.set(age);
      this.logger.error(`ErasureRegistry refresh 失败（旧 Map 保留不替换）：${(e as Error).message}`);
    } finally {
      this.refreshInFlight = false;
    }
  }

  /** 端点/sweep 用 live 批量判定（不读快照——load 时行必在⇒快照几乎永不包含运行期刚变 purgeable 的 pid）。 */
  async listPurgeableProjectIdsLive(projectIds: string[]): Promise<Set<string>> {
    if (projectIds.length === 0) return new Set();
    const rows = await this.prisma.$queryRaw<{ projectId: string }[]>`
      SELECT DISTINCT r."scopeId" AS "projectId"
      FROM "ProjectErasureRun" r
      WHERE r."scopeType" = 'project' AND r."dryRun" = false
        AND r."scopeId" = ANY(${projectIds}::text[])
        AND NOT EXISTS (SELECT 1 FROM "CanvasProject" c WHERE c.id = r."scopeId")`;
    return new Set(rows.map((r) => r.projectId));
  }

  private async doLoad(): Promise<void> {
    const startSeq = this.markSeq;
    const rows = await this.prisma.$queryRaw<ErasureSnapshotRow[]>`
      WITH blocked_rows AS (
        SELECT cp.id AS "projectId", 'ERASING'::text AS st,
               EXISTS (
                 SELECT 1 FROM "ProjectErasureRun" r
                 WHERE r."scopeType" = 'project' AND r."scopeId" = cp.id AND r."dryRun" = false
                   AND r.state IN ('DONE', 'FAILED')
               ) AS "restorePending"
        FROM "CanvasProject" cp
        JOIN "Team" t ON t.id = cp."teamId"
        WHERE cp."lifecycleState" <> 'ACTIVE' OR t.status <> 'ACTIVE'
        UNION ALL
        SELECT r."scopeId" AS "projectId",
               CASE
                 WHEN r.state NOT IN ('DONE', 'FAILED') THEN 'ERASING'
                 WHEN EXISTS (SELECT 1 FROM "CanvasProject" c WHERE c.id = r."scopeId") THEN 'ERASING'
                 ELSE 'ERASED'
               END AS st,
               (r.state IN ('DONE', 'FAILED')
                 AND EXISTS (SELECT 1 FROM "CanvasProject" c WHERE c.id = r."scopeId")) AS "restorePending"
        FROM "ProjectErasureRun" r
        WHERE r."scopeType" = 'project' AND r."dryRun" = false
      ),
      blocked_agg AS (
        SELECT "projectId",
               CASE WHEN bool_or(st = 'ERASING') THEN 'ERASING' ELSE 'ERASED' END AS blocked,
               bool_or("restorePending") AS "restorePending"
        FROM blocked_rows GROUP BY "projectId"
      ),
      purgeable_rows AS (
        SELECT r."scopeId" AS "projectId",
               bool_or(r."manifestPath" IS NULL) AS "manifestMissing"
        FROM "ProjectErasureRun" r
        WHERE r."scopeType" = 'project' AND r."dryRun" = false
          AND NOT EXISTS (SELECT 1 FROM "CanvasProject" c WHERE c.id = r."scopeId")
        GROUP BY r."scopeId"
      )
      SELECT COALESCE(b."projectId", p."projectId") AS "projectId",
             b.blocked AS blocked,
             COALESCE(b."restorePending", false) AS "restorePending",
             (p."projectId" IS NOT NULL) AS purgeable,
             COALESCE(p."manifestMissing", false) AS "manifestMissing"
      FROM blocked_agg b
      FULL OUTER JOIN purgeable_rows p ON p."projectId" = b."projectId"`;

    const blocked = new Map<string, ErasureBlockedState>();
    const purgeable = new Set<string>();
    const restore = new Set<string>();
    for (const r of rows) {
      if (r.blocked === 'ERASING' || r.blocked === 'ERASED') blocked.set(r.projectId, r.blocked);
      if (r.purgeable) {
        purgeable.add(r.projectId);
        if (!blocked.has(r.projectId)) {
          // purgeable⊆blocked 断言失败=fail-closed 按 blocked（不清）
          this.logger.error(`ErasureRegistry purgeable⊆blocked 断言失败（${r.projectId}）——fail-closed 按 ERASED 拒写`);
          blocked.set(r.projectId, 'ERASED');
        }
        if (r.manifestMissing && !this.manifestMissingSeen.has(r.projectId)) {
          this.manifestMissingSeen.add(r.projectId);
          erasureManifestMissingTotal.inc();
        }
      }
      if (r.restorePending) restore.add(r.projectId);
    }
    // during-mark 合并：查询期间的新 mark 优先于快照
    for (const [pid, m] of this.marks) if (m.version > startSeq) blocked.set(pid, m.state);
    for (const pid of purgeable) if (!blocked.has(pid)) blocked.set(pid, 'ERASED');

    this.blocked = blocked;
    this.purgeable = purgeable;
    this.restorePending = restore;
    this.loadedAtMs = Date.now();
    yjsBlockedProjects.set(blocked.size);
    yjsPurgeableProjects.set(purgeable.size);
    restorePendingProjects.set(restore.size);
    erasureRegistryAgeMs.set(0);
  }
}
