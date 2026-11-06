// apps/api/src/modules/admin/erasure/erasure.controller.ts
// C4-c1（plan Task C4-3 FAILED re-drive+admin includeDeleted wiring——生产就绪收尾批·project-erasure）：
// erasure 运维读面+FAILED 重驱 HTTP 端点（admin 域惯例=intent force-void/OpsGate unfreeze 同族：
// 全局 AuthGuard（session）+AdminGuard（/api/admin/* path 门），零本文件守卫装饰）。
//   GET  /api/admin/erasure/runs?state=&take=   —— run 列表（**admin 可见 DELETING/FAILED**——C4-a
//     红⑦「admin 可见 DELETING」缺补：project 行读经 runWithIncludeDeleted 包裹〔读过滤 Proxy 开关
//     接线 admin 读面——DELETING/已删行名可见〕；runbook 面文档归 C4-c2）；
//   POST /api/admin/erasure/runs/:erasureId/re-drive —— FAILED→PENDING（attempts 保留+error 清空
//     ——reDriveErasureRun 单源 free function；非 FAILED 409/缺失 404；audit 同事务落痕）。
// census ⑰：admin 域=api 进程装配（AdminModule），worker 闭包零新增边。
import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UnauthorizedException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import { runWithIncludeDeleted } from '../../../prisma/read-path.filter';
import { reDriveErasureRun } from '../../collab/project-erasure';

/** run 列表页上界（admin 面防拉全表——state 过滤+updatedAt 倒序）。 */
const ADMIN_RUNS_TAKE_MAX = 100;

/** run 列表行（project 维名称/态经 includeDeleted 读——admin 可见 DELETING）。 */
interface AdminErasureRunRow {
  erasureId: string;
  scopeType: string;
  scopeId: string;
  teamId: string | null;
  parentRunId: string | null;
  state: string;
  stage: string | null;
  dryRun: boolean;
  attempts: number;
  error: string | null;
  requestedBy: string;
  requestedAt: Date;
  updatedAt: Date;
  manifestPath: string | null;
  /** project 维展示名（含 DELETING——includeDeleted；已删行/team scope=null）。 */
  projectName: string | null;
  projectLifecycle: string | null;
}

@Controller('api/admin/erasure')
export class AdminErasureController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** run 列表（admin 可见 DELETING/FAILED——includeDeleted 接线 admin 读面）。 */
  @Get('runs')
  async listRuns(
    @Query('state') state?: string,
    @Query('take') take?: string,
  ): Promise<{ runs: AdminErasureRunRow[] }> {
    const t = Math.max(1, Math.min(ADMIN_RUNS_TAKE_MAX, Number(take) || 20));
    const runs = await this.prisma.projectErasureRun.findMany({
      where: state ? { state } : undefined,
      orderBy: { updatedAt: 'desc' },
      take: t,
    });
    // project 维名称/态：**includeDeleted 包裹**（DELETING 行是 admin 面正当观察对象——C4-a 红⑦
    // 「admin 可见 DELETING」；已删行〔PURGING_DB 完成〕=null 非错）
    const pids = [...new Set(runs.filter((r) => r.scopeType === 'project').map((r) => r.scopeId))];
    const projects = pids.length > 0 ? await runWithIncludeDeleted(() => this.prisma.canvasProject.findMany({
      where: { id: { in: pids } }, select: { id: true, name: true, lifecycleState: true },
    })) : [];
    const byId = new Map(projects.map((p) => [p.id, p]));
    return {
      runs: runs.map((r) => {
        const p = r.scopeType === 'project' ? byId.get(r.scopeId) : undefined;
        return {
          erasureId: r.erasureId, scopeType: r.scopeType, scopeId: r.scopeId, teamId: r.teamId,
          parentRunId: r.parentRunId, state: r.state, stage: r.stage, dryRun: r.dryRun,
          attempts: r.attempts, error: r.error, requestedBy: r.requestedBy, requestedAt: r.requestedAt,
          updatedAt: r.updatedAt, manifestPath: r.manifestPath,
          projectName: p?.name ?? null, projectLifecycle: p?.lifecycleState ?? null,
        };
      }),
    };
  }

  /** FAILED 重驱（reDriveErasureRun 单源——attempts 保留+error 清空+恢复锚保留；audit 同事务）。 */
  @Post('runs/:erasureId/re-drive')
  @HttpCode(200)
  async reDrive(@Param('erasureId') erasureId: string, @Req() req: Request): Promise<{ run: { erasureId: string; state: string }; attempts: number }> {
    // OpsGate unfreeze 同款：req.user 缺失即显式拒（守卫序漂移防护——审计 operator 链不许静默断）
    const user = (req as { user?: { id?: string; name?: string | null } }).user;
    if (user?.id == null) throw new UnauthorizedException('req.user 缺失——守卫序漂移（AuthGuard 须先于 AdminGuard 解析 req.user），拒回落默认 operator');
    const result = await this.prisma.$transaction(async (tx) => reDriveErasureRun(tx as never, {
      erasureId, operatorId: user.id!, operatorName: user.name ?? user.id!,
    }));
    if (!result.ok && result.reason === 'MISSING') throw new NotFoundException(`erasure run ${erasureId} 不存在`);
    if (!result.ok) throw new ConflictException({ code: 'ERASURE_RE_DRIVE_STATE', message: `run 状态 ${result.reason.slice('STATE_'.length)} 非 FAILED（活跃 run 轮询自愈面已覆盖——re-drive 仅 FAILED 档）` });
    return { run: { erasureId: result.run.erasureId, state: result.run.state }, attempts: result.attempts };
  }
}
