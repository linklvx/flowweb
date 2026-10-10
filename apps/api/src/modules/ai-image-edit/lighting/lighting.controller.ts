import { Controller, Post, Get, Body, Param, Inject, Req, UsePipes, ValidationPipe, NotFoundException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LightingService } from './lighting.service';
import { ProjectPermissionService } from '../../team/project-permission.service';
import { CreateLightingTaskDto } from './dto/create-lighting-task.dto';
import { GenerationIntentService } from '../../execution/generation-intent.service';
import { PricingResolverService } from '../../execution/pricing-resolver.service';
import { normalizeIntentParams } from '../../execution/normalize-intent-params';
import { paramsToPrompt } from './lighting.consumer';
import { CollabDocumentService } from '../../collab/collab-document.service';
import { assertSyncAdmitted } from '../../collab/sync-admission';

@Controller('api/image-edit/lighting')
export class LightingController {
  constructor(
    @Inject(LightingService) private readonly service: LightingService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(GenerationIntentService) private readonly intentService: GenerationIntentService,
    @Inject(PricingResolverService) private readonly resolver: PricingResolverService,
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
  ) {}

  @Post('tasks')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 批0c-8：付费任务端点收紧（全局 300/min 见 app.module）
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async createTask(@Body() body: CreateLightingTaskDto, @Req() req: any) {
    const userId = (req as any).user?.id;
    const { teamId } = await this.perm.assertEditorWithTeam(body.projectId, userId); // 无条件（批0c：省略 projectId 即旁路）
    // 批0.5-8 意图表扩面（F13）：claim（createTask 前）→ attachJob 回写 jobId。
    // paramsHash = paramsToPrompt 纯派生稳定串——与 consumer 外呼 prompt 同函数（两处各自实现=两键双扣）。
    // 意图行管幂等/互斥/对账；LightingTask 照旧管业务状态（两者并存）。
    // Y0b-1（E1）：claim 前解析 kind 级定价快照（lighting=modelId IS NULL 规则，Z5）+ teamId（assertEditorWithTeam 零额外查询）。
    // Y0b-2 T6（Z78/Z109）：body.regenToken=客户端手势 token（改名自 intentId 位）；replayed/result
    // 裸值返回交全局拦截器单层包裹（信封清剿——改前 {code,data} 双层）。60s 去重命中 fail 后按重放返回。
    // Y0b-2 T7：SV 支配门（claim 之前零意图行——body.stateVector 必填，缺省 400）。
    await assertSyncAdmitted(this.collabDoc, body.projectId, body.stateVector);
    const pricing = await this.resolver.resolveByNodeTypeKey('lighting');
    const { intent, created } = await this.intentService.claim({
      projectId: body.projectId,
      nodeId: body.nodeId,
      userId,
      gestureToken: body.regenToken,
      kind: 'lighting',
      paramsHash: normalizeIntentParams('lighting', {
        // Y0b-2 T6（R3-P0-1）：originalImageId 进哈希——源图变=操作身份变=新 idemKey（白名单同步）
        originalImageId: body.originalImageId,
        prompt: paramsToPrompt(body.params, body.params.customPrompt),
      }),
      pricing,
      teamId,
    });
    if (!created) {
      // SUCCEEDED 幂等重放——零 enqueue 零扣费，回放既有产物引用
      return { replayed: true, resultRef: intent.resultRef };
    }
    try {
      const result = await this.service.createTask(body, userId, intent.id, intent.intentId);
      if (result.jobId) {
        await this.intentService.attachJob(intent.id, result.jobId);
        return result;
      }
      // createTask 命中 60s 去重未入队——释放执行权（防 RUNNING 孤儿把节点锁死 15min），按重放返回既有任务
      await this.intentService.fail(intent.id, '任务去重：60 秒内同参数任务已存在');
      return { replayed: true, taskId: result.taskId, status: result.status };
    } catch (e: any) {
      // createTask 失败（积分不足/项目不存在等）——防 RUNNING 孤儿锁节点（execution.service catch 先例）
      await this.intentService.fail(intent.id, String(e?.message ?? e));
      throw e;
    }
  }

  @Get('tasks/:taskId')
  async getTask(@Param('taskId') taskId: string, @Req() req: any) {
    const userId = (req as any).user?.id;
    const task = await this.service.getTask(taskId, userId);
    if (!task) {
      // Y0b-2 T6（Z78 信封清剿）：手包 404 信封退役——NotFoundException 交全局 exception filter（404 语义保持）
      throw new NotFoundException('任务不存在');
    }
    return task;
  }
}
