import { Controller, Post, Get, Body, Param, Req, HttpCode, Inject } from '@nestjs/common';
import { Request } from 'express';
import { StoryboardService } from './storyboard.service';

@Controller('api/projects/:projectId/storyboard')
export class StoryboardController {
  constructor(@Inject(StoryboardService) private readonly service: StoryboardService) {}

  @Post('stitch')
  @HttpCode(202)
  stitch(@Param('projectId') projectId: string, @Body() body: any, @Req() req: Request) {
    return this.service.createStitchTask(projectId, body, (req as any).user?.id ?? 'default-user');
  }

  @Get('stitch/:taskId')
  status(@Param('projectId') projectId: string, @Param('taskId') taskId: string) {
    return this.service.getTaskStatus(projectId, taskId);
  }
}
