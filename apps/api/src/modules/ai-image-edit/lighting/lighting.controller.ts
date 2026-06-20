import { Controller, Post, Get, Body, Param, Inject } from '@nestjs/common';
import { LightingService } from './lighting.service';
import { CreateLightingTaskDto } from './dto/create-lighting-task.dto';

@Controller('api/image-edit/lighting')
export class LightingController {
  constructor(@Inject(LightingService) private readonly service: LightingService) {}

  @Post('tasks')
  async createTask(@Body() body: CreateLightingTaskDto) {
    // TODO: get userId from auth guard
    const userId = 'default-user';
    const result = await this.service.createTask(body, userId);
    return { code: 0, data: result };
  }

  @Get('tasks/:taskId')
  async getTask(@Param('taskId') taskId: string) {
    // TODO: get userId from auth guard
    const userId = 'default-user';
    const task = await this.service.getTask(taskId, userId);
    if (!task) {
      return { code: 404, data: null, message: '任务不存在' };
    }
    return { code: 0, data: task };
  }
}
