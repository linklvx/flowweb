// apps/api/src/modules/collab/collab-doc.controller.ts
// Y0b-4 T8（Q-G，spec §4.1④）：POST /api/collab/doc/:projectId/shrink——超配额态唯一自救通道。
// Y0b-4 T9（Q-H）：POST /api/collab/doc/:projectId/export-fresh——墓碑主导文档的真空出口。
// Y0b-4 T9a（Q-U v6）：POST /api/collab/doc/:projectId/vacuum——文档代际替换（重建画布历史）。
// 薄层：权限/信号量/预演语义全在 CollabShrinkService（本 controller 只路由+限流+user 透传）。
// 未登录 401 由全局 AuthGuard 承载（/api/collab 不在 PUBLIC_PREFIXES）；503 SHRINK_BUSY 的
// Retry-After 由 CollabNotServingFilter 附（同 COLLAB_NOT_SERVING 族）。
import { Body, Controller, Inject, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CollabShrinkService } from './collab-shrink.service';

@Controller('api/collab/doc')
export class CollabDocController {
  constructor(
    @Inject(CollabShrinkService) private readonly shrinkSvc: CollabShrinkService,
  ) {}

  /** body 校验在 service（BadRequestException——全仓无全局 ValidationPipe，execution.controller 同惯例）；
   *  inline 类型形态=body-param-ratchet 棘轮惯例（基线登记）。 */
  @Post(':projectId/shrink')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })   // 独立桶（覆盖全局 300/min——重操作端点收紧）
  async shrink(
    @Param('projectId') projectId: string,
    @Body() body: { deleteNodeIds?: string[]; keepNodeIds?: string[]; recalibrate?: boolean },
    @Req() req: Request,
  ) {
    return this.shrinkSvc.shrink(projectId, (req as any).user?.id, body);
  }

  /** T9（Q-H）：导出到新项目（无 body——幂等 latch/团队归属/落地编码校验全在 service）。 */
  @Post(':projectId/export-fresh')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })   // 同 shrink 桶配置（重操作端点收紧——覆盖全局 300/min）
  async exportFresh(
    @Param('projectId') projectId: string,
    @Req() req: Request,
  ) {
    return this.shrinkSvc.exportFresh(projectId, (req as any).user?.id);
  }

  /** T9a（Q-U v6）：vacuum 文档代际替换（重建画布历史——全端刷新；二次确认在 T11 客户端 UX，
   *  服务端只收显式确认后的请求）。七步协议/中止恢复/SV 代际门全在 service+gateway。 */
  @Post(':projectId/vacuum')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })   // 同 shrink 桶配置（重操作端点收紧——覆盖全局 300/min）
  async vacuum(
    @Param('projectId') projectId: string,
    @Req() req: Request,
  ) {
    return this.shrinkSvc.vacuum(projectId, (req as any).user?.id);
  }
}
