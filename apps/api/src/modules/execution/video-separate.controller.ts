import { Controller, Post, Get, Body, Param, Req } from '@nestjs/common';
import { VideoSeparateService } from './video-separate.service';

@Controller('api/execution')
export class VideoSeparateController {
  constructor(private readonly separateService: VideoSeparateService) {}

  @Post('video-separate')
  async submitSeparate(
    @Body() dto: { fileId: string; nodeId: string; mode: string },
    @Req() req: any,
  ) {
    return this.separateService.submitSeparate({
      ...dto,
      userId: req.user.id,
      workflowId: req.workflowId || '', // workflowId 由 AuthGuard 注入，画布内操作可能缺失，降级为空字符串
    });
  }

  @Get('video-separate/:taskId')
  async getTaskStatus(@Param('taskId') taskId: string, @Req() req: any) {
    return this.separateService.getTaskStatus(taskId, req.user.id);
  }
}
