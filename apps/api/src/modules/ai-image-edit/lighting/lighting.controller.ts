import { Controller, Post, Get, Body, Param, Inject, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { LightingService } from './lighting.service';
import { ProjectPermissionService } from '../../team/project-permission.service';
import { CreateLightingTaskDto } from './dto/create-lighting-task.dto';
import { GenerationIntentService } from '../../execution/generation-intent.service';
import { normalizeIntentParams } from '../../execution/normalize-intent-params';
import { paramsToPrompt } from './lighting.consumer';

@Controller('api/image-edit/lighting')
export class LightingController {
  constructor(
    @Inject(LightingService) private readonly service: LightingService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(GenerationIntentService) private readonly intentService: GenerationIntentService,
  ) {}

  @Post('tasks')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 批0c-8：付费任务端点收紧（全局 300/min 见 app.module）
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async createTask(@Body() body: CreateLightingTaskDto, @Req() req: any) {
    const userId = (req as any).user?.id;
    await this.perm.assertEditor(body.projectId, userId); // 无条件（批0c：省略 projectId 即旁路）
    // 批0.5-8 意图表扩面（F13）：claim（createTask 前）→ attachJob 回写 jobId。
    // paramsHash = paramsToPrompt 纯派生稳定串——与 consumer 外呼 prompt 同函数（两处各自实现=两键双扣）。
    // 意图行管幂等/互斥/对账；LightingTask 照旧管业务状态（两者并存）。
    const { intent, created } = await this.intentService.claim({
      projectId: body.projectId,
      nodeId: body.nodeId,
      userId,
      intentId: body.intentId ?? randomUUID(),
      kind: 'lighting',
      paramsHash: normalizeIntentParams('lighting', {
        prompt: paramsToPrompt(body.params, body.params.customPrompt),
      }),
    });
    if (!created) {
      // SUCCEEDED 幂等重放——零 enqueue 零扣费，回放既有产物引用
      return { code: 0, data: { replayed: true, resultRef: intent.resultRef } };
    }
    try {
      const result = await this.service.createTask(body, userId, intent.id, intent.intentId);
      if (result.jobId) {
        await this.intentService.attachJob(intent.id, result.jobId);
        return { code: 0, data: result };
      }
      // createTask 命中 60s 去重未入队——释放执行权（防 RUNNING 孤儿把节点锁死 15min），按重放返回既有任务
      await this.intentService.fail(intent.id, '任务去重：60 秒内同参数任务已存在');
      return { code: 0, data: { replayed: true, taskId: result.taskId, status: result.status } };
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
      return { code: 404, data: null, message: '任务不存在' };
    }
    return { code: 0, data: task };
  }
}
