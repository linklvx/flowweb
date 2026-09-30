import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { ApiCallerService } from '../execution/api-caller.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { GenerationIntentService } from '../execution/generation-intent.service';
import { AI_IMAGE_EDIT_QUEUE_NAME, CREDIT_COST_PER_EDIT } from './ai-image-edit.constants';
import { LightingConsumer, type LightingJobData } from './lighting/lighting.consumer';
import axios from 'axios';
import axiosRetry from 'axios-retry';

export interface AiImageEditJobData {
  taskType: 'outpaint' | 'erase' | 'redraw' | 'lighting';
  userId: string;
  projectId: string;
  nodeId: string;
  fileId: string;
  maskFileId?: string;
  rect?: { x: number; y: number; width: number; height: number };
  imageWidth?: number;
  imageHeight?: number;
  prompt?: string;
  strength?: number;
  /** 批0.5-8：意图行 id / 客户端幂等键——controller claim 后随 job.data 下传（consume guard/complete 门序/failed 钩子） */
  intentRowId?: string;
  intentId?: string;
}

/** maxStalledCount:1——stalled 仅重排一次（防双跑双扣——扣费幂等由意图表 intentGuard 兜底）；
 *  lockDuration:60s——长外呼（扩图/重绘/打光）锁续期窗口，过短会误判 stalled（execution.processor 同款）。 */
@Processor(AI_IMAGE_EDIT_QUEUE_NAME, { maxStalledCount: 1, lockDuration: 60_000 })
export class AiImageEditProcessor extends WorkerHost {
  private readonly logger = new Logger(AiImageEditProcessor.name);
  private retryConfigured = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(ExecutionGateway) private readonly gateway: ExecutionGateway,
    @Inject(ApiCallerService) private readonly apiCaller: ApiCallerService,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
    @Inject(LightingConsumer) private readonly lightingConsumer: LightingConsumer,
    @Inject(GenerationIntentService) private readonly intentService: GenerationIntentService,
  ) {
    super();
  }

  private ensureRetryConfigured(): void {
    if (this.retryConfigured) return;
    // Guard: only configure axios-retry when axios has the expected structure
    // (avoids crash when axios is mocked in tests)
    if (typeof (axios as any).request === 'function') {
      axiosRetry(axios, {
        retries: 3,
        retryDelay: (retryCount) => axiosRetry.exponentialDelay(retryCount),
        retryCondition: (error) =>
          axiosRetry.isNetworkOrIdempotentRequestError(error) ||
          (!!error.response && error.response.status >= 500),
      });
    }
    this.retryConfigured = true;
  }

  private async getMediaKey(fileId: string, userId: string, projectId: string): Promise<string> {
    const media = await this.prisma.media.findUnique({ where: { id: fileId } });
    if (!media || (media.userId !== userId && media.projectId !== projectId)) {
      throw new Error(`Media not found: ${fileId}`); // 404 语义——不泄露存在性
    }
    return media.key;
  }

  async process(job: Job<AiImageEditJobData>): Promise<{ status: string; fileId?: string; reason?: string }> {
    const { taskType, userId, projectId, nodeId, fileId, maskFileId, rect, imageWidth, imageHeight, prompt, strength, intentRowId, intentId } = job.data;
    this.logger.log(`Processing ${taskType} for node ${nodeId}`);

    this.ensureRetryConfigured();

    try {
      // 1. Get presigned URLs for source image and optional mask
      const sourceKey = await this.getMediaKey(fileId, userId, projectId);
      const imageUrl = await this.minio.generatePresignedGetUrl(sourceKey, 3600);

      let maskUrl: string | undefined;
      if (maskFileId) {
        const maskKey = await this.getMediaKey(maskFileId, userId, projectId);
        maskUrl = await this.minio.generatePresignedGetUrl(maskKey, 3600);
      }

      // 2. Call the appropriate API method
      let result: { url: string };
      switch (taskType) {
        case 'outpaint':
          result = await this.apiCaller.callOutpainting(
            imageUrl,
            rect!,
            imageWidth!,
            imageHeight!,
          );
          break;
        case 'erase':
          result = await this.apiCaller.callErase(imageUrl, maskUrl!);
          break;
        case 'redraw':
          result = await this.apiCaller.callRedraw(imageUrl, maskUrl!, prompt!, strength!);
          break;
        case 'lighting':
          return this.lightingConsumer.handleLightingJob(job as unknown as Job<LightingJobData>);
        default:
          throw new Error(`Unknown taskType: ${taskType}`);
      }

      // 3. Download the result image
      const response = await axios.get(result.url, {
        responseType: 'arraybuffer',
        timeout: 120000,
      });

      const buffer = Buffer.from(response.data);
      const contentType: string = String(response.headers['content-type'] || 'image/png');
      const ext = contentType.split('/')[1] || 'png';

      // 4. Resolve project team（Media 归属与积分同源）；缺失即 failed 不回落个人团队（前移至产物落库前——不产孤儿 MinIO 对象）
      const projectTeamId = (await this.prisma.canvasProject.findUnique({
        where: { id: projectId },
        select: { teamId: true },
      }))?.teamId;
      if (!projectTeamId) {
        Sentry.captureException(new Error(`ai-image-edit: project team missing for node ${nodeId}`));
        return { status: 'failed', reason: 'PROJECT_TEAM_MISSING' };
      }

      // 5. Deduct credit (team pool)——前移至产物落库前（F4 不变量：看到产物 ⇒ 已扣费）；返回值必须检查（批0c：免费算力止血）
      //    批0.5-8：intentGuard CAS 门（creditsConsumed:0）——stalled 重排双跑只扣一次
      const consumeResult = await this.teamCredit.consume(
        projectTeamId, userId, CREDIT_COST_PER_EDIT, `edit:${nodeId}`,
        ...(intentRowId && intentId ? [{ intentRowId, intentId }] : []),
      );
      if (!consumeResult.success) {
        this.logger.warn(`Edit credit-consume failed for node ${nodeId}: ${consumeResult.reason ?? 'unknown'}`);
        this.gateway.emitNodeStatus(projectId, {
          nodeId,
          status: 'edit-failed',
          error: `扣费失败：${consumeResult.reason ?? 'CREDIT_CONSUME_FAILED'}`,
        });
        return { status: 'failed', reason: consumeResult.reason ?? 'CREDIT_CONSUME_FAILED' };
      }

      // 6. Upload to MinIO
      const key = this.minio.buildKey('generated', userId, { projectId, nodeId, ext });
      await this.minio.upload(key, buffer, contentType);

      // 7. Create Media record
      const media = await this.prisma.media.create({
        data: {
          userId,
          teamId: projectTeamId,
          key,
          originalName: `ai-edited-${nodeId}.${ext}`,
          mimeType: contentType,
          size: buffer.length,
          projectId,
          nodeId,
          type: 'generated',
          status: 'completed',
        },
      });

      // 7.5 批0.5-8 complete 门序（F13：看到产物 ⇒ 意图仍有效）：count===1 才投递产物——
      //     count===0 = 行已被 reconcile VOIDED+退款，writeNodeData/emit 零调用（外呼产物留作物证）
      if (intentRowId) {
        const gated = await this.intentService.complete(intentRowId, media.id);
        if (gated !== 1) {
          this.logger.warn(`[intent-reconcile] 意图 ${intentId} 已被 VOIDED——跳过产物写入（外呼产物留作物证）`);
          return { status: 'completed', fileId: media.id };
        }
      }

      // 8. Write fileId/尺寸 to server doc；socket 仅进度通知
      await this.collabDoc.writeNodeData(projectId, nodeId, {
        fileId: media.id,
        ...(job.data.imageWidth ? { width: job.data.imageWidth, height: job.data.imageHeight } : {}),
      });
      this.gateway.emitNodeStatus(projectId, {
        nodeId,
        status: 'edit-result',
        fileId: media.id,
      });

      this.logger.log(`Edit complete: ${media.id}`);
      return { status: 'completed', fileId: media.id };
    } catch (error: any) {
      this.logger.error(`Edit failed: ${error.message}`, error.stack);

      // 批0.5-8：意图终态必达——外呼/扣费抛错置 FAILED（同 intentId 重试走 rearm 免费续跑）
      if (intentRowId) await this.intentService.fail(intentRowId, String(error?.message ?? error));
      if (projectId) {
        await this.collabDoc.writeExecStatus(projectId, nodeId, {
          status: 'error', error: String(error?.message ?? error).slice(0, 200), intentId: intentId ?? undefined,
        }).catch(() => {}); // best-effort——doc 写失败不吞原始错误
      }

      // Push failure via WebSocket — do NOT deduct credit on failure
      this.gateway.emitNodeStatus(projectId, {
        nodeId,
        status: 'edit-failed',
        error: error.message,
      });

      // Re-throw to trigger BullMQ retry
      throw error;
    }
  }

  /** 批0.5-8 F13 终态兜底（execution.processor 同款）：SIGKILL 场景 process 的 catch 不执行——
   *  意图终态只能靠 worker 钩子。形态按 bullmq Worker 'failed' 实际签名 (job, error, prev) 位置参数；
   *  job 可为 undefined（移除中）。lighting job 同队列共用本钩子（intentRowId 在 job.data）。 */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<AiImageEditJobData> | undefined, err: Error) {
    if (!job) return;
    const { projectId, nodeId, intentId, intentRowId } = job.data ?? {};
    if (!projectId || !nodeId) return;
    const reason = String(err?.message ?? err);
    await this.collabDoc.writeExecStatus(projectId, nodeId, {
      status: 'error', error: reason.slice(0, 200), intentId: intentId ?? undefined,
    });
    if (intentRowId) await this.intentService.fail(intentRowId, reason); // ACTIVE 守卫幂等——与 process catch 双写不冲突
  }
}
