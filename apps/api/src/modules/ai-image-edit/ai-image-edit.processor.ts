import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { getOwnerTeamId } from '../team/team.util';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { ApiCallerService } from '../execution/api-caller.service';
import { CreditService } from '../credit/credit.service';
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
}

@Processor(AI_IMAGE_EDIT_QUEUE_NAME)
export class AiImageEditProcessor extends WorkerHost {
  private readonly logger = new Logger(AiImageEditProcessor.name);
  private retryConfigured = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(ExecutionGateway) private readonly gateway: ExecutionGateway,
    @Inject(ApiCallerService) private readonly apiCaller: ApiCallerService,
    @Inject(CreditService) private readonly credit: CreditService,
    @Inject(LightingConsumer) private readonly lightingConsumer: LightingConsumer,
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

  private async getMediaKey(fileId: string): Promise<string> {
    const media = await this.prisma.media.findUnique({ where: { id: fileId } });
    if (!media) {
      throw new Error(`Media not found: ${fileId}`);
    }
    return media.key;
  }

  async process(job: Job<AiImageEditJobData>): Promise<{ status: string; fileId?: string }> {
    const { taskType, userId, projectId, nodeId, fileId, maskFileId, rect, imageWidth, imageHeight, prompt, strength } = job.data;
    this.logger.log(`Processing ${taskType} for node ${nodeId}`);

    this.ensureRetryConfigured();

    try {
      // 1. Get presigned URLs for source image and optional mask
      const sourceKey = await this.getMediaKey(fileId);
      const imageUrl = await this.minio.generatePresignedGetUrl(sourceKey, 3600);

      let maskUrl: string | undefined;
      if (maskFileId) {
        const maskKey = await this.getMediaKey(maskFileId);
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

      // 4. Upload to MinIO
      const key = this.minio.buildKey('generated', userId, { projectId, nodeId, ext });
      await this.minio.upload(key, buffer, contentType);

      // 5. Create Media record
      const media = await this.prisma.media.create({
        data: {
          userId,
          teamId: await getOwnerTeamId(this.prisma, userId),
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

      // 6. Deduct credit
      await this.credit.deduct(userId, CREDIT_COST_PER_EDIT);

      // 7. Push success via WebSocket
      this.gateway.emitNodeStatus(projectId, {
        nodeId,
        status: 'edit-result',
        fileId: media.id,
      });

      this.logger.log(`Edit complete: ${media.id}`);
      return { status: 'completed', fileId: media.id };
    } catch (error: any) {
      this.logger.error(`Edit failed: ${error.message}`, error.stack);

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
}
