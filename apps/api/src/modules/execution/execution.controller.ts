import { Controller, Post, Get, Body, Param, Inject, Req, Headers } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ExecutionService } from './execution.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { Request } from 'express';
import { EXECUTION_QUEUE_NAME } from './execution.constants';

@Controller('api/execution')
export class ExecutionController {
  constructor(
    @Inject(ExecutionService) private readonly service: ExecutionService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @InjectQueue(EXECUTION_QUEUE_NAME) private readonly executionQueue: Queue,
  ) {}

  @Post('execute')
  execute(
    @Body() body: { projectId: string; nodeId?: string; nodeIds?: string[] },
    @Req() req: Request,
    @Headers('x-yjs-sv') sv?: string,
  ) {
    const svBytes = sv ? new Uint8Array(Buffer.from(sv, 'base64')) : undefined;
    return this.service.execute(body.projectId, body.nodeId, (req as any).user?.id, body.nodeIds, svBytes);
  }

  @Post('enqueue')
  async enqueue(
    @Body() body: { projectId: string; nodeId?: string },
    @Req() req: Request,
    @Headers('x-yjs-sv') sv?: string,
  ) {
    await this.perm.assertEditor(body.projectId, (req as any).user?.id);
    const job = await this.executionQueue.add('execution', {
      projectId: body.projectId,
      nodeId: body.nodeId,
      userId: (req as any).user?.id,
      sv: sv ?? null,
    });

    return {
      jobId: job.id,
      status: 'queued',
    };
  }

  @Get('jobs/:id')
  async getJob(@Param('id') id: string, @Req() req: Request) {
    const job = await this.executionQueue.getJob(id);
    const jobProjectId = (job?.data as any)?.projectId as string | undefined;
    if (!job || !jobProjectId) return { error: 'Job not found' }; // default-deny——无归属信息即 404（fail-closed，不枚举 state/progress）
    const role = await this.perm.resolve(jobProjectId, (req as any).user?.id);
    if (!role) return { error: 'Job not found' };                  // 非成员 404（不泄露存在性）
    const state = await job.getState();
    return { id: job.id, state, progress: job.progress };
  }
}
