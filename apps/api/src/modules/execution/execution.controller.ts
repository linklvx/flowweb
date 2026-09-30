import { Controller, Post, Get, Body, Param, Query, Inject, Req, Headers, NotFoundException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ExecutionService } from './execution.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { GenerationIntentService } from './generation-intent.service';
import { Request } from 'express';
import { EXECUTION_QUEUE_NAME } from './execution.constants';

@Controller('api/execution')
export class ExecutionController {
  constructor(
    @Inject(ExecutionService) private readonly service: ExecutionService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @InjectQueue(EXECUTION_QUEUE_NAME) private readonly executionQueue: Queue,
    @Inject(GenerationIntentService) private readonly intentService: GenerationIntentService,
  ) {}

  @Post('execute')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 批0c-8：付费任务端点收紧（全局 300/min 见 app.module）
  execute(
    @Body() body: { projectId: string; nodeId?: string; nodeIds?: string[] },
    @Req() req: Request,
    @Headers('x-yjs-sv') sv?: string,
    @Headers('x-intent-id') intentId?: string, // 批0.5-6：客户端意图 id（幂等键）透传 service claim
  ) {
    const svBytes = sv ? new Uint8Array(Buffer.from(sv, 'base64')) : undefined;
    return this.service.execute(body.projectId, body.nodeId, (req as any).user?.id, body.nodeIds, svBytes, intentId);
  }

  @Post('enqueue')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 批0c-8：付费任务端点收紧（全局 300/min 见 app.module）
  async enqueue(
    @Body() body: { projectId: string; nodeId?: string; intentId?: string },
    @Req() req: Request,
    @Headers('x-yjs-sv') sv?: string,
  ) {
    await this.perm.assertEditor(body.projectId, (req as any).user?.id);
    const job = await this.executionQueue.add('execution', {
      projectId: body.projectId,
      nodeId: body.nodeId,
      userId: (req as any).user?.id,
      sv: sv ?? null,
      intentId: body.intentId ?? null, // 批0.5-6：意图 id 透传（claim 接 enqueue 链路在 0.5-8——failed 钩子 intentRowId 同期接上）
    });

    return {
      jobId: job.id,
      status: 'queued',
    };
  }

  /** 批0.5-6：节点意图列表（断连恢复读面）。成员级——VIEWER 也可见（与 jobs/:id 同口径）。 */
  @Get('intents')
  async listIntents(@Query('projectId') projectId: string, @Query('nodeId') nodeId: string, @Req() req: Request) {
    const role = await this.perm.resolve(projectId, (req as any).user?.id);
    if (!role) throw new NotFoundException(); // 404 不泄露存在性
    return { code: 0, data: await this.intentService.listByNode(projectId, nodeId) };
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
