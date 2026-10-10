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

  /** Y0b-2 T6（Z103）：意图 id 请求头已删（无消费者）——token 走 body.regenToken（与 enqueue 单管道对齐）。 */
  @Post('execute')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 批0c-8：付费任务端点收紧（全局 300/min 见 app.module）
  execute(
    @Body() body: { projectId: string; nodeId?: string; nodeIds?: string[]; regenToken?: string },
    @Req() req: Request,
    @Headers('x-yjs-sv') sv?: string,
  ) {
    const svBytes = sv ? new Uint8Array(Buffer.from(sv, 'base64')) : undefined;
    // regenToken=客户端手势 token（Z79/Z109）——无 token 普通执行=undefined（内容键路径）
    return this.service.execute(body.projectId, body.nodeId, (req as any).user?.id, body.nodeIds, svBytes, body.regenToken);
  }

  @Post('enqueue')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 批0c-8：付费任务端点收紧（全局 300/min 见 app.module）
  async enqueue(
    @Body() body: { projectId: string; nodeId?: string; regenToken?: string },
    @Req() req: Request,
    @Headers('x-yjs-sv') sv?: string,
  ) {
    await this.perm.assertEditor(body.projectId, (req as any).user?.id);
    const job = await this.executionQueue.add('execution', {
      projectId: body.projectId,
      nodeId: body.nodeId,
      userId: (req as any).user?.id,
      sv: sv ?? null,
      // Y0b-2 T6（Z91）：regenToken 入 job.data——enqueue 管道与 execute 直达同 claim 语义
      //（改前 intentId 位静默丢弃=经 enqueue 的"重新生成"退化回放）；形态校验归 claim 的 normalizeRegenToken
      regenToken: body.regenToken ?? null,
    });

    return {
      jobId: job.id,
      status: 'queued',
    };
  }

  /** 批0.5-6：节点意图列表（断连恢复读面）。成员级——VIEWER 也可见（与 jobs/:id 同口径）。
   *  Y0b-2 T6（Z78 信封清剿）：裸值返回交全局 TransformInterceptor 单层包裹——改前手包 {code,data}
   *  双层使 web apiFetch（返 json.data）拿到 {code,data} 对象非数组 ⇒ alignExecFromIntents 静默 no-op。 */
  @Get('intents')
  async listIntents(@Query('projectId') projectId: string, @Query('nodeId') nodeId: string, @Req() req: Request) {
    const role = await this.perm.resolve(projectId, (req as any).user?.id);
    if (!role) throw new NotFoundException(); // 404 不泄露存在性
    return this.intentService.listByNode(projectId, nodeId);
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
