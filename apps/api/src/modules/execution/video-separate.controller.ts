import { Controller, Post, Get, Body, Param, Req, Inject } from '@nestjs/common';
import { VideoSeparateService } from './video-separate.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('api/execution')
export class VideoSeparateController {
  constructor(
    @Inject(VideoSeparateService) private readonly separateService: VideoSeparateService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Post('video-separate')
  async submitSeparate(
    @Body() dto: { fileId: string; nodeId: string; mode: string },
    @Req() req: any,
  ) {
    const userId = (req as any).user?.id;
    const media = await this.prisma.media.findUnique({
      where: { id: dto.fileId },
      select: { projectId: true },
    });
    if (media?.projectId) await this.perm.assertEditor(media.projectId, userId);
    return this.separateService.submitSeparate({
      ...dto,
      userId,
      workflowId: req.workflowId || '', // workflowId 由 AuthGuard 注入，画布内操作可能缺失，降级为空字符串
    });
  }

  @Get('video-separate/:taskId')
  async getTaskStatus(@Param('taskId') taskId: string, @Req() req: any) {
    return this.separateService.getTaskStatus(taskId, req.user.id);
  }
}
