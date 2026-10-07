// Y0a-3（spec §3.3）：GET /api/ready（PUBLIC+@SkipThrottle——探针轮询不吃共享限流桶）+
// POST /api/drain（CollabAdminAuthGuard 把关+AuditLog 审计——Z15）。draining 档 503 属预期——
// **部署判据读响应体不读状态码**（reason=draining+pending 收敛）。
import { Controller, Get, HttpCode, Logger, Post, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CollabReadyService } from './collab-ready.service';
import { CollabGateway } from './collab.gateway';
import { CollabAdminAuthGuard } from './collab-admin-auth.guard';
import { AuditService } from '../../common/audit/audit.service';

@SkipThrottle()
@Controller('api')
export class CollabReadyController {
  private readonly logger = new Logger(CollabReadyController.name);

  constructor(
    private readonly ready: CollabReadyService,
    private readonly gateway: CollabGateway,
    private readonly audit: AuditService,
  ) {}

  @Get('ready')
  async getReady(@Req() req: Request, @Res() res: Response): Promise<void> {
    const r = await this.ready.getReady();
    // V17/P21 两档视图：无 token={ready,reason,redis,epoch}（探针/gate 所需）；有效
    // x-prometheus-token（COLLAB_ADMIN_TOKEN 或回退 PROMETHEUS_TOKEN）=全字段（holder/pending/
    // stranded/holderRenewedAgoMs——host+pid 属内部信息，/api 经 nginx 公网可达）。drill/gate 已持 token。
    const token = process.env.COLLAB_ADMIN_TOKEN ?? process.env.PROMETHEUS_TOKEN;
    const authorized = !!token && req.headers['x-prometheus-token'] === token;
    if (!authorized) {
      const { ready, reason, redis, epoch } = r.body;
      res.status(r.status).json({ ready, reason, redis, epoch });
      return;
    }
    res.status(r.status).json(r.body);
  }

  @Post('drain')
  @UseGuards(CollabAdminAuthGuard)
  @HttpCode(200)
  async drain(): Promise<{ draining: boolean; autoReleaseAt: number; pending: ReturnType<CollabGateway['computePending']> }> {
    const { autoReleaseAt, pending } = this.gateway.beginDraining();
    // 审计是旁路不是前置——drain 已生效，写失败不得让值班误判"未进入 drain"重试中断部署链（break-glass 同判）
    try {
      await this.audit.log({
        operatorId: 'system:drain', operatorName: 'system:drain',
        targetType: 'COLLAB_LEASE', targetId: 'primary', action: 'collab_drain',
        afterValue: { autoReleaseAt }, remark: `pending=${JSON.stringify(pending)}`,
      });
    } catch (error) {
      this.logger.error({ event: 'drain_audit_failed', error });
    }
    return { draining: true, autoReleaseAt, pending };
  }
}
