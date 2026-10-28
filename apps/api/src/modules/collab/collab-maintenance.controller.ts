// apps/api/src/modules/collab/collab-maintenance.controller.ts
// Y1c T27（spec §6.6）：REST 控制面——admin guard+幂等键。
//   POST /api/collab/maintenance/:projectId/start    幂等键头 x-idempotency-key（必填）→ REQUESTED+后台 run
//   GET  /api/collab/maintenance/:projectId          活跃/末次维护读面（stage/status/error/attempts）
//   POST /api/collab/maintenance/:projectId/abort    显式 abort（仅 SWITCHING 前——解冻恢复）
//   POST /api/collab/maintenance/:projectId/resume   人工显式 resume（post-SWITCHING FAILED→roll-forward）
// admin guard=COLLAB_ADMIN_TOKEN（独立停机令牌——drain 同源；dev fail-open）。start 不等待 run 完成
// （drain 窗分钟级——后台驱动+GET 轮询面；run 失败=FAILED 持久化只读+人工 resume，REST 无自动恢复）。
import { BadRequestException, Controller, Get, HttpException, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CollabAdminAuthGuard } from './collab-admin-auth.guard';
import { CollabMaintenanceService } from './collab-maintenance.service';

@Controller('api/collab/maintenance')
@UseGuards(CollabAdminAuthGuard)
export class CollabMaintenanceController {
  constructor(@Inject(CollabMaintenanceService) private readonly maintenance: CollabMaintenanceService) {}

  /** REQUESTED+后台驱动到终态（fire-and-forget——run 内部逐段幂等+失败 FAILED 持久化）。 */
  @Post(':projectId/start')
  async start(@Param('projectId') projectId: string, @Req() req: Request): Promise<{ ok: boolean; maintenanceId?: string; stage?: string; code?: string }> {
    const idempotencyKey = String(req.headers['x-idempotency-key'] ?? '');
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'x-idempotency-key 头必填（8-128 字符——维护 REQUESTED 幂等键）' });
    }
    const requestedBy = (req as { user?: { id?: string } }).user?.id ?? 'admin';
    const r = await this.maintenance.request({ projectId, idempotencyKey, requestedBy, source: 'rest', leaseOwner: 'rest' });
    if (!r.ok) {
      const status = r.code === 'MAINTENANCE_ACTIVE' ? 409 : r.code === 'IN_FLIGHT_EXECUTIONS' ? 409 : 404;
      throw new HttpException({ code: r.code, maintenanceId: r.maintenanceId ?? undefined }, status);
    }
    // 后台驱动（同幂等键重放=已在档 op 不二次 run——run 幂等续跑由 stage CAS 承载）
    void this.maintenance.run(r.maintenanceId).catch(() => { /* run 失败=FAILED 持久化（GET 面可观测） */ });
    return { ok: true, maintenanceId: r.maintenanceId, stage: r.stage };
  }

  @Get(':projectId')
  async status(@Param('projectId') projectId: string) {
    const op = await this.maintenance.operationOf(projectId);
    if (!op) return { active: false, operation: null };
    return { active: !['COMPLETED', 'FAILED', 'ABORTED'].includes(op.stage), operation: op };
  }

  @Post(':projectId/abort')
  async abort(@Param('projectId') projectId: string) {
    const op = await this.maintenance.operationOf(projectId);
    if (!op) throw new HttpException({ code: 'NOT_FOUND' }, 404);
    const r = await this.maintenance.abort(op.maintenanceId);
    if (!r.ok) throw new HttpException({ code: r.code }, 409);   // NOT_ABORTABLE=SWITCHING 起只许 roll-forward
    return r;
  }

  @Post(':projectId/resume')
  async resume(@Param('projectId') projectId: string) {
    const op = await this.maintenance.operationOf(projectId);
    if (!op) throw new HttpException({ code: 'NOT_FOUND' }, 404);
    const r = await this.maintenance.resume(op.maintenanceId);
    if (!r.ok) throw new HttpException({ code: r.code }, 409);
    void this.maintenance.run(op.maintenanceId).catch(() => { /* FAILED 持久化承载失败面 */ });
    return r;
  }
}
