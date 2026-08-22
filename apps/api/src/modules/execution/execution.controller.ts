import { Controller, Post, Get, Body, Param, Inject, Req } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ExecutionService } from './execution.service';
import { Request } from 'express';
import { EXECUTION_QUEUE_NAME } from './execution.constants';

@Controller('api/execution')
export class ExecutionController {
  constructor(
    @Inject(ExecutionService) private readonly service: ExecutionService,
    @InjectQueue(EXECUTION_QUEUE_NAME) private readonly executionQueue: Queue,
  ) {}

  @Post('execute')
  execute(@Body() body: { projectId: string; nodeId?: string; nodeIds?: string[]; userId?: string }) {
    return this.service.execute(body.projectId, body.nodeId, body.userId || 'default-user', body.nodeIds);
  }

  @Post('enqueue')
  async enqueue(
    @Body() body: { projectId: string; nodeId?: string },
    @Req() req: Request,
  ) {
    const job = await this.executionQueue.add('execution', {
      projectId: body.projectId,
      nodeId: body.nodeId,
      userId: (req as any).user?.id,
    });

    return {
      jobId: job.id,
      status: 'queued',
    };
  }

  @Get('jobs/:id')
  async getJob(@Param('id') id: string) {
    const job = await this.executionQueue.getJob(id);
    if (!job) return { error: 'Job not found' };
    const state = await job.getState();
    return { id: job.id, state, progress: job.progress };
  }
}
