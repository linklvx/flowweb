import { Controller, Post, Get, Body, Param, Query, Inject, Req, NotFoundException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ExecutionService } from './execution.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { GenerationIntentService } from './generation-intent.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { assertSyncAdmitted } from '../collab/sync-admission';
import { Request } from 'express';
import { EXECUTION_QUEUE_NAME } from './execution.constants';
import { execMaxNodes } from './intent-key.util';
import { BusinessException } from '../../common/exceptions/business.exception';

@Controller('api/execution')
export class ExecutionController {
  constructor(
    @Inject(ExecutionService) private readonly service: ExecutionService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @InjectQueue(EXECUTION_QUEUE_NAME) private readonly executionQueue: Queue,
    @Inject(GenerationIntentService) private readonly intentService: GenerationIntentService,
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
  ) {}

  /** Y0b-2 T6（Z103）：意图 id 请求头已删（无消费者）——token 走 body.regenToken（与 enqueue 单管道对齐）。
   *  Y0b-2 T7：SV 支配门（claim 之前零外呼零冻结零意图行）——SV 请求头退役，SV 随 body.stateVector。 */
  @Post('execute')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 批0c-8：付费任务端点收紧（全局 300/min 见 app.module）
  async execute(
    @Body() body: { projectId: string; nodeId?: string; nodeIds?: string[]; regenToken?: string; stateVector: string },
    @Req() req: Request,
  ) {
    // 权限恒先于 SV 门（T7 质量审 I-2——与 enqueue/image-edit/lighting 三端点同型；0c-6 存在性 oracle：
    // perm 未过者不得以 409-vs-403 差分探测 doc 同步态）
    await this.perm.assertEditor(body.projectId, (req as any).user?.id);
    // Y0b-2 T8（Z90/Z117）：EXEC_MAX_NODES 病态批硬闸（DTO 级——nodeIds 在 body 直读，先于 SV 门零 doc 读）；
    // Σdeadline≤EXEC_SYNC_HARD_CAP 闸在 service（与 readCanvas 同一次 doc 读——enqueue 单节点形态 Σ 恒≤
    // 单 kind deadline≤HARD_CAP〔启动断言锁 api-caller onModuleInit 预算锁〕，结构性不越帽故无 DTO 位）。
    if (body.nodeIds && body.nodeIds.length > execMaxNodes()) {
      throw new BusinessException('EXEC_SCOPE_TOO_LARGE', `组执行节点数 ${body.nodeIds.length} 超上限 ${execMaxNodes()}（EXEC_MAX_NODES）`);
    }
    await assertSyncAdmitted(this.collabDoc, body.projectId, body.stateVector);
    // regenToken=客户端手势 token（Z79/Z109）——无 token 普通执行=undefined（内容键路径）
    return this.service.execute(body.projectId, body.nodeId, (req as any).user?.id, body.nodeIds, body.regenToken);
  }

  @Post('enqueue')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 批0c-8：付费任务端点收紧（全局 300/min 见 app.module）
  async enqueue(
    @Body() body: { projectId: string; nodeId?: string; regenToken?: string; stateVector: string },
    @Req() req: Request,
  ) {
    await this.perm.assertEditor(body.projectId, (req as any).user?.id);
    // Y0b-2 T7：SV 门在 controller（入队时判定——job 载荷零客户端状态）
    await assertSyncAdmitted(this.collabDoc, body.projectId, body.stateVector);
    const job = await this.executionQueue.add('execution', {
      projectId: body.projectId,
      nodeId: body.nodeId,
      userId: (req as any).user?.id,
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
