import { Controller, Post, Get, Body, Param, Req, HttpCode, Inject, ForbiddenException, UsePipes, ValidationPipe } from '@nestjs/common';
import { Request } from 'express';
import { StoryboardService } from './storyboard.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CreateStitchTaskDto } from './storyboard.dto';

@Controller('api/projects/:projectId/storyboard')
export class StoryboardController {
  constructor(
    @Inject(StoryboardService) private readonly service: StoryboardService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
  ) {}

  @Post('stitch')
  @HttpCode(202)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) // 走私 400 可观测——非静默剥除
  async stitch(@Param('projectId') projectId: string, @Body() body: CreateStitchTaskDto, @Req() req: Request) {
    const userId = (req as any).user?.id;
    await this.perm.assertEditor(projectId, userId);
    return this.service.createStitchTask(projectId, body, userId);
  }

  @Get('stitch/:taskId')
  async status(@Param('projectId') projectId: string, @Param('taskId') taskId: string, @Req() req: Request) {
    const userId = (req as any).user?.id;
    const role = await this.perm.resolve(projectId, userId);
    if (!role) throw new ForbiddenException('无项目访问权限');
    return this.service.getTaskStatus(projectId, taskId);
  }
}
