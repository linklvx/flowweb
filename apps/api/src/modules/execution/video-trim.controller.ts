import { Controller, Post, Get, Body, Param, Req, Inject } from '@nestjs/common';
import { VideoTrimService } from './video-trim.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('api/execution')
export class VideoTrimController {
  constructor(
    @Inject(VideoTrimService) private readonly videoTrimService: VideoTrimService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Post('video-trim')
  async submitTrim(
    @Body() body: { fileId: string; startTime: number; endTime: number; nodeId: string },
    @Req() req: any,
  ) {
    const userId = (req as any).user?.id;
    const media = await this.prisma.media.findUnique({
      where: { id: body.fileId },
      select: { projectId: true },
    });
    if (media?.projectId) await this.perm.assertEditor(media.projectId, userId);
    return this.videoTrimService.submitTrim({
      ...body,
      userId,
      workflowId: '', // derived from media record in service
    });
  }

  @Get('video-trim/:taskId')
  async getTaskStatus(@Param('taskId') taskId: string) {
    return this.videoTrimService.getTaskStatus(taskId);
  }
}
