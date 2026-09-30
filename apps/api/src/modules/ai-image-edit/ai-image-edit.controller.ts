import { Controller, Post, Body, Inject, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { AiImageEditService } from './ai-image-edit.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { GenerationIntentService } from '../execution/generation-intent.service';
import { normalizeIntentParams } from '../execution/normalize-intent-params';

// 批0c-8：付费任务端点收紧至 20/min（全局 300/min 见 app.module）
@Throttle({ default: { limit: 20, ttl: 60000 } })
@Controller('api/image-edit')
export class AiImageEditController {
  constructor(
    @Inject(AiImageEditService) private readonly service: AiImageEditService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(GenerationIntentService) private readonly intentService: GenerationIntentService,
  ) {}

  /** 批0.5-8 三端点同构接线（F13）：claim（enqueue 前——意图表是唯一扣费幂等面，队列 attempts:1
   *  堵不住双击双扣）→ SUCCEEDED 幂等重放短路 → enqueue 携 intentRowId/intentId → attachJob 回写
   *  jobId（不回写则 reconcile A 路径对异步队列模块永久失效，长任务被三查误判 VOIDED 照常扣费）。
   *  enqueue 失败 fail 置 FAILED——防 RUNNING 孤儿把节点 partial unique 锁死 15min（execution.service catch 先例）。 */
  private async runGuarded(input: {
    projectId: string;
    nodeId: string;
    userId: string;
    intentId?: string;
    kind: 'outpaint' | 'erase' | 'redraw';
    params: Record<string, unknown>;
    enqueue: (intentRowId: string, intentId: string) => Promise<{ jobId: string }>;
  }) {
    const { intent, created } = await this.intentService.claim({
      projectId: input.projectId,
      nodeId: input.nodeId,
      userId: input.userId,
      intentId: input.intentId ?? randomUUID(),
      kind: input.kind,
      paramsHash: normalizeIntentParams(input.kind, input.params),
    });
    if (!created) {
      // SUCCEEDED 幂等重放——零 enqueue 零扣费，回放既有产物引用
      return { code: 0, data: { replayed: true, resultRef: intent.resultRef } };
    }
    try {
      const r = await input.enqueue(intent.id, intent.intentId);
      await this.intentService.attachJob(intent.id, r.jobId);
      return r;
    } catch (e) {
      await this.intentService.fail(intent.id, String(e));
      throw e;
    }
  }

  @Post('outpaint')
  async outpaint(@Body() body: {
    projectId: string;
    nodeId: string;
    fileId: string;
    rect: { x: number; y: number; width: number; height: number };
    imageWidth: number;
    imageHeight: number;
    intentId?: string; // 批0.5-8：客户端意图 id（幂等键）
  }, @Req() req: any) {
    await this.perm.assertEditor(body.projectId, req.user.id);
    return this.runGuarded({
      projectId: body.projectId,
      nodeId: body.nodeId,
      userId: req.user.id,
      intentId: body.intentId,
      kind: 'outpaint',
      params: { rect: body.rect, imageWidth: body.imageWidth, imageHeight: body.imageHeight },
      enqueue: (intentRowId, intentId) => this.service.enqueueOutpaint(
        req.user.id, body.projectId, body.nodeId, body.fileId,
        body.rect, body.imageWidth, body.imageHeight, intentRowId, intentId,
      ),
    });
  }

  @Post('erase')
  async erase(@Body() body: { projectId: string; nodeId: string; fileId: string; maskFileId: string; intentId?: string }, @Req() req: any) {
    await this.perm.assertEditor(body.projectId, req.user.id);
    return this.runGuarded({
      projectId: body.projectId,
      nodeId: body.nodeId,
      userId: req.user.id,
      intentId: body.intentId,
      kind: 'erase',
      params: {}, // erase 白名单为空——实读外呼参数无稳定项（presigned URL 不进哈希）
      enqueue: (intentRowId, intentId) => this.service.enqueueErase(
        req.user.id, body.projectId, body.nodeId, body.fileId, body.maskFileId, intentRowId, intentId,
      ),
    });
  }

  @Post('redraw')
  async redraw(@Body() body: { projectId: string; nodeId: string; fileId: string; maskFileId: string; prompt: string; strength: number; intentId?: string }, @Req() req: any) {
    await this.perm.assertEditor(body.projectId, req.user.id);
    return this.runGuarded({
      projectId: body.projectId,
      nodeId: body.nodeId,
      userId: req.user.id,
      intentId: body.intentId,
      kind: 'redraw',
      params: { prompt: body.prompt, strength: body.strength },
      enqueue: (intentRowId, intentId) => this.service.enqueueRedraw(
        req.user.id, body.projectId, body.nodeId, body.fileId, body.maskFileId,
        body.prompt, body.strength, intentRowId, intentId,
      ),
    });
  }
}
