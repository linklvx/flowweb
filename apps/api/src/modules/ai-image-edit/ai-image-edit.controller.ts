import { Controller, Post, Body, Inject, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Throttle } from '@nestjs/throttler';
import { AiImageEditService } from './ai-image-edit.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { GenerationIntentService } from '../execution/generation-intent.service';
import { PricingResolverService } from '../execution/pricing-resolver.service';
import { normalizeIntentParams } from '../execution/normalize-intent-params';
import { CollabDocumentService } from '../collab/collab-document.service';
import { assertSyncAdmitted } from '../collab/sync-admission';
import { WorkerPresenceService } from '../worker-presence/worker-presence.service';
import { QUEUE_NAMES } from '../../config/queue.constants';
import type { ExecutionTicket } from '../execution/execution.types';

// 批0c-8：付费任务端点收紧至 20/min（全局 300/min 见 app.module）
@Throttle({ default: { limit: 20, ttl: 60000 } })
@Controller('api/image-edit')
export class AiImageEditController {
  constructor(
    @Inject(AiImageEditService) private readonly service: AiImageEditService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(GenerationIntentService) private readonly intentService: GenerationIntentService,
    @Inject(PricingResolverService) private readonly resolver: PricingResolverService,
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
    // Y0c T29-II（Z148②）：付费队列 enqueue fail-closed 门（当前单进程拓扑下 registered 恒≥1、
    // 门不可实际触发——T30 补 processor 注册门后自动生效，见 worker-presence.service.ts 裁决①注释）
    @Inject(WorkerPresenceService) private readonly presence: WorkerPresenceService,
  ) {}

  /** 批0.5-8 三端点同构接线（F13）：claim（enqueue 前——意图表是唯一扣费幂等面，队列 attempts:1
   *  堵不住双击双扣）→ SUCCEEDED 幂等重放短路 → enqueue 携 ticket → attachJob 回写
   *  jobId（不回写则 reconcile A 路径对异步队列模块永久失效，长任务被三查误判 VOIDED 照常扣费）。
   *  enqueue 失败 fail 置 FAILED——防 RUNNING 孤儿把节点 partial unique 锁死 15min（execution.service catch 先例）。
   *  Y1a T9：job data 携 ExecutionTicket {intentRowId,execSeq,jobId}——jobId=controller 预生成 UUID
   *  （add({jobId})——票完整先于入队；execSeq wire=string）；fail 携代际票（execSeq）。
   *  Y0b-1（E1）：claim 前解析 kind 级定价快照（编辑 4 kind=modelId IS NULL 规则，Z5）+ teamId（assertEditorWithTeam 零额外查询）。
   *  Y0b-2 T6（Z78/Z109）：body.regenToken=客户端手势 token（改名自 intentId 位——防新调用方拿它查
   *  intents 端点）；replayed 返回裸值交全局拦截器单层包裹（信封清剿）。
   *  Y0b-2 T7：SV 支配门三端点同型（claim 之前零意图行——body.stateVector 必填，缺省 400）。 */
  private async runGuarded(input: {
    projectId: string;
    nodeId: string;
    userId: string;
    teamId: string;
    regenToken?: string;
    stateVector: string;
    kind: 'outpaint' | 'erase' | 'redraw';
    params: Record<string, unknown>;
    enqueue: (ticket: ExecutionTicket) => Promise<{ jobId: string }>;
  }) {
    await assertSyncAdmitted(this.collabDoc, input.projectId, input.stateVector);
    // Y0c T29-II（Z148②/F11 同源）：worker 准入门——定价快照/claim 之前拒 ⇒ 零意图行零冻结零退款
    // 义务（503 WORKER_ABSENT+Retry-After: 30）。覆盖 outpaint/erase/redraw 三 add 点（lighting 的
    // 第 4 处 add 在 LightingController.createTask 同款门——不经本方法）。
    await this.presence.assertAdmittable(QUEUE_NAMES.AI_IMAGE_EDIT);
    const pricing = await this.resolver.resolveByNodeTypeKey(input.kind);
    const { intent, created, artifactRev } = await this.intentService.claim({
      projectId: input.projectId,
      nodeId: input.nodeId,
      userId: input.userId,
      gestureToken: input.regenToken,
      kind: input.kind,
      paramsHash: normalizeIntentParams(input.kind, input.params),
      pricing,
      teamId: input.teamId,
    });
    if (!created) {
      // SUCCEEDED 幂等重放——零 enqueue 零扣费，回放既有产物引用
      return { replayed: true, resultRef: intent.resultRef };
    }
    // T9 票三字段完整先于入队：jobId 预生成（add({jobId})）+execSeq wire=string（BigInt 禁入 JSON）
    const ticket: ExecutionTicket = { intentRowId: intent.id, execSeq: intent.execSeq.toString(), jobId: randomUUID(), expectedRev: artifactRev };   // T10：claimCapture 槽位 rev 随票
    try {
      const r = await input.enqueue(ticket);
      await this.intentService.attachJob(intent.id, r.jobId);
      return r;
    } catch (e) {
      await this.intentService.fail(intent.id, String(e), undefined, intent.execSeq);
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
    regenToken?: string; // Y0b-2 T6：客户端手势 token（改名自 intentId 位——Z109）
    stateVector: string; // Y0b-2 T7：SV 支配门（缺省 400）
  }, @Req() req: any) {
    const { teamId } = await this.perm.assertEditorWithTeam(body.projectId, req.user.id);
    return this.runGuarded({
      projectId: body.projectId,
      nodeId: body.nodeId,
      userId: req.user.id,
      teamId,
      regenToken: body.regenToken,
      stateVector: body.stateVector,
      kind: 'outpaint',
      // Y0b-2 T6（R3-P0-1）：fileId 进 paramsHash——源图变=操作身份变=新 idemKey（白名单同步）
      params: { fileId: body.fileId, rect: body.rect, imageWidth: body.imageWidth, imageHeight: body.imageHeight },
      enqueue: (ticket) => this.service.enqueueOutpaint(
        req.user.id, body.projectId, body.nodeId, body.fileId,
        body.rect, body.imageWidth, body.imageHeight, ticket,
      ),
    });
  }

  @Post('erase')
  async erase(@Body() body: { projectId: string; nodeId: string; fileId: string; maskFileId: string; regenToken?: string; stateVector: string }, @Req() req: any) {
    const { teamId } = await this.perm.assertEditorWithTeam(body.projectId, req.user.id);
    return this.runGuarded({
      projectId: body.projectId,
      nodeId: body.nodeId,
      userId: req.user.id,
      teamId,
      regenToken: body.regenToken,
      stateVector: body.stateVector,
      kind: 'erase',
      // Y0b-2 T6（R3-P0-1）：erase 空集根修——双输入 fileId/maskFileId 进哈希（改前 sha256('{}') 全局常量）
      params: { fileId: body.fileId, maskFileId: body.maskFileId },
      enqueue: (ticket) => this.service.enqueueErase(
        req.user.id, body.projectId, body.nodeId, body.fileId, body.maskFileId, ticket,
      ),
    });
  }

  @Post('redraw')
  async redraw(@Body() body: { projectId: string; nodeId: string; fileId: string; maskFileId: string; prompt: string; strength: number; regenToken?: string; stateVector: string }, @Req() req: any) {
    const { teamId } = await this.perm.assertEditorWithTeam(body.projectId, req.user.id);
    return this.runGuarded({
      projectId: body.projectId,
      nodeId: body.nodeId,
      userId: req.user.id,
      teamId,
      regenToken: body.regenToken,
      stateVector: body.stateVector,
      kind: 'redraw',
      // Y0b-2 T6（R3-P0-1）：fileId/maskFileId 进 paramsHash——源图/mask 变=新 idemKey
      params: { fileId: body.fileId, maskFileId: body.maskFileId, prompt: body.prompt, strength: body.strength },
      enqueue: (ticket) => this.service.enqueueRedraw(
        req.user.id, body.projectId, body.nodeId, body.fileId, body.maskFileId,
        body.prompt, body.strength, ticket,
      ),
    });
  }
}
