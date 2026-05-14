import { Controller, Post, Get, Body, Param, Inject } from '@nestjs/common';
import { ExecutionService } from './execution.service';

const Queue = require('bull');

const executionQueue = new Queue('execution', {
  redis: { host: 'localhost', port: 6379 },
  defaultJobOptions: { attempts: 2, timeout: 300000, removeOnComplete: 50, removeOnFail: 100 },
});

@Controller('api/execution')
export class ExecutionController {
  constructor(@Inject(ExecutionService) private readonly service: ExecutionService) {}

  @Post('execute')
  execute(@Body() body: { projectId: string; nodeId?: string; userId?: string }) {
    return this.service.execute(body.projectId, body.nodeId, body.userId || 'default-user');
  }

  @Post('enqueue')
  async enqueue(@Body() body: { projectId: string; nodeId?: string; userId?: string }) {
    const userId = body.userId || 'default-user';
    try {
      const job = await executionQueue.add({ projectId: body.projectId, nodeId: body.nodeId, userId });
      return { jobId: job.id, status: 'queued' };
    } catch {
      return this.service.execute(body.projectId, body.nodeId, userId);
    }
  }

  @Get('jobs/:id')
  async getJob(@Param('id') id: string) {
    const job = await executionQueue.getJob(id);
    if (!job) return { error: 'Job not found' };
    const state = await job.getState();
    return { id: job.id, state, progress: job.progress };
  }
}
