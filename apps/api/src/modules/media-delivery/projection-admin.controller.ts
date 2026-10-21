// apps/api/src/modules/media-delivery/projection-admin.controller.ts
// Y1b T15（spec :91「dead 行 on-load reconcile/admin retry 重驱」）：投影行 admin retry 最小入口
// ——终态行（orphaned/dead）re-open→pending（undo 恢复节点后重投/人工重驱死行）。
// 鉴权=AdminGuard 全局 /api/admin/* 路径守卫承载（admin.intent.controller force-void 同形态——
// 本模块不重复挂 guard）。
import { Body, Controller, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { ProjectionOutboxPoller } from './projection-outbox.poller';

/** retry body（admin intent DTO 先例——body-param-ratchet 禁 inline 形态）。 */
class RetryProjectionDto {
  @IsString()
  @MinLength(1)
  projectionId!: string;
}

@Controller('api/admin/projections')
export class ProjectionAdminController {
  constructor(@Inject(ProjectionOutboxPoller) private readonly poller: ProjectionOutboxPoller) {}

  /** 单行重开（orphaned/dead→pending——superseded 不重开：槽位已换代，重开必再 superseded）。 */
  @Post('retry')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async retry(@Body() dto: RetryProjectionDto): Promise<{ requeued: boolean; state: string }> {
    return this.poller.retryProjection(dto.projectionId);
  }
}
