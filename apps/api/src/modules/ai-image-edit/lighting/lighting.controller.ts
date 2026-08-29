import { Controller, Post, Get, Body, Param, Inject, Req } from '@nestjs/common';
import { LightingService } from './lighting.service';
import { ProjectPermissionService } from '../../team/project-permission.service';
import { CreateLightingTaskDto } from './dto/create-lighting-task.dto';

@Controller('api/image-edit/lighting')
export class LightingController {
  constructor(
    @Inject(LightingService) private readonly service: LightingService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
  ) {}

  @Post('tasks')
  async createTask(@Body() body: CreateLightingTaskDto, @Req() req: any) {
    const userId = (req as any).user?.id;
    if (body.projectId) await this.perm.assertEditor(body.projectId, userId);
    const result = await this.service.createTask(body, userId);
    return { code: 0, data: result };
  }

  @Get('tasks/:taskId')
  async getTask(@Param('taskId') taskId: string, @Req() req: any) {
    const userId = (req as any).user?.id;
    const task = await this.service.getTask(taskId, userId);
    if (!task) {
      return { code: 404, data: null, message: '任务不存在' };
    }
    return { code: 0, data: task };
  }
}
