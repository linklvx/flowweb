import { Controller, Post, Get, Body, Param, Req, Inject } from '@nestjs/common';
import { VideoTrimService } from './video-trim.service';

@Controller('api/execution')
export class VideoTrimController {
  constructor(
    @Inject(VideoTrimService) private readonly videoTrimService: VideoTrimService,
  ) {}

  @Post('video-trim')
  async submitTrim(
    @Body() body: { fileId: string; startTime: number; endTime: number; nodeId: string },
    @Req() req: any,
  ) {
    const userId = req.user?.id;
    const workflowId = req.workflowId;
    return this.videoTrimService.submitTrim({
      ...body,
      userId,
      workflowId,
    });
  }

  @Get('video-trim/:taskId')
  async getTaskStatus(@Param('taskId') taskId: string) {
    return this.videoTrimService.getTaskStatus(taskId);
  }
}
