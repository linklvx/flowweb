import { Injectable, Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../minio/minio.service';
import { ExecutionGateway } from '../../gateway/execution.gateway';
import { ApiCallerService } from '../../execution/api-caller.service';
import { CreditService } from '../../credit/credit.service';
import { CREDIT_COST_PER_EDIT } from '../ai-image-edit.constants';
import axios from 'axios';

const LightingTaskStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  FAILED: 'failed',
} as const;

export interface LightingParams {
  position: { x: number; y: number; z: number };
  brightness: number;
  colorTemperature: number;
  rimLight: boolean;
  customPrompt?: string;
}

export interface LightingJobData {
  taskType: 'lighting';
  userId: string;
  nodeId: string;
  projectId?: string;
  taskId: string;
  originalImageUrl: string;
  params: LightingParams;
}

function paramsToPrompt(params: LightingParams, customPrompt?: string): string {
  const directionMap: Record<string, string> = {
    '-1,0': '左侧',
    '0,1': '上方',
    '1,0': '右侧',
    '0,-1': '下方',
  };

  const xDir = params.position.x < -1 ? '左侧' : params.position.x > 1 ? '右侧' : '';
  const yDir = params.position.y > 1 ? '上方' : params.position.y < -1 ? '下方' : '';
  const zDir = params.position.z > 5 ? '正前方' : params.position.z < 3 ? '正后方' : '';
  const direction = [xDir, yDir, zDir].filter(Boolean).join('') || '正前方';

  const brightnessDesc =
    params.brightness > 70 ? '强烈' : params.brightness > 30 ? '适中' : '柔和';
  const rimLightDesc = params.rimLight ? '开启轮廓光' : '';

  return [
    `主光源从${direction}照射`,
    `亮度${brightnessDesc}`,
    `色温${params.colorTemperature}K`,
    rimLightDesc,
    customPrompt,
  ]
    .filter(Boolean)
    .join('，');
}

@Injectable()
export class LightingConsumer {
  private readonly logger = new Logger(LightingConsumer.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(ExecutionGateway) private readonly gateway: ExecutionGateway,
    @Inject(ApiCallerService) private readonly apiCaller: ApiCallerService,
    @Inject(CreditService) private readonly credit: CreditService,
  ) {}

  async handleLightingJob(job: Job<LightingJobData>): Promise<{ status: string; fileId?: string }> {
    const { userId, nodeId, projectId, taskId, originalImageUrl, params } = job.data;

    this.logger.log(`Processing lighting for task ${taskId}, node ${nodeId}`);

    // 1. Update task status to processing
    await this.prisma.lightingTask.update({
      where: { id: taskId },
      data: { status: LightingTaskStatus.PROCESSING },
    });

    try {
      // 2. Get original image presigned URL
      const presignedUrl = await this.minio.generatePresignedGetUrl(
        originalImageUrl.replace(/.*\/media\//, '').split('?')[0] || originalImageUrl,
        3600,
      );

      // 3. Build prompt from params
      const promptText = paramsToPrompt(params, params.customPrompt);
      this.logger.log(`Lighting prompt: ${promptText}`);

      // 4. Call AI gateway for relighting
      const result = await this.apiCaller.callRelighting?.(
        typeof presignedUrl === 'string' ? presignedUrl : originalImageUrl,
        promptText,
      );

      if (!result?.url) {
        throw new Error('AI relighting returned no result URL');
      }

      // 5. Download result image
      const response = await axios.get(result.url, {
        responseType: 'arraybuffer',
        timeout: 120000,
      });

      const buffer = Buffer.from(response.data);
      const contentType: string = String(response.headers['content-type'] || 'image/png');
      const ext = contentType.split('/')[1] || 'png';

      // 6. Upload to MinIO
      const key = this.minio.buildKey('generated', userId, { projectId, nodeId, ext });
      await this.minio.upload(key, buffer, contentType);

      // 7. Create Media record
      const media = await this.prisma.media.create({
        data: {
          userId,
          key,
          originalName: `lighting-${nodeId}.${ext}`,
          mimeType: contentType,
          size: buffer.length,
          projectId,
          nodeId,
          taskId,
          type: 'generated',
          status: 'completed',
        },
      });

      // 8. Update LightingTask
      const presignedResultUrl = await this.minio.generatePresignedGetUrl(key, 3600);
      await this.prisma.lightingTask.update({
        where: { id: taskId },
        data: {
          status: LightingTaskStatus.SUCCESS,
          resultImageUrl: presignedResultUrl,
          resultMediaId: media.id,
          completedAt: new Date(),
        },
      });

      // 9. Deduct credit
      await this.credit.deduct(userId, CREDIT_COST_PER_EDIT);

      // 10. Push success via WebSocket
      this.gateway.emitNodeStatus(projectId || '', {
        nodeId,
        status: 'lighting-result',
        fileId: media.id,
        resultUrl: presignedResultUrl,
      } as any);

      this.logger.log(`Lighting complete: task ${taskId}, media ${media.id}`);
      return { status: 'completed', fileId: media.id };
    } catch (error: any) {
      this.logger.error(`Lighting failed: ${error.message}`, error.stack);

      // Update task to failed
      await this.prisma.lightingTask.update({
        where: { id: taskId },
        data: {
          status: LightingTaskStatus.FAILED,
          errorMessage: error.message,
          completedAt: new Date(),
        },
      });

      // Push failure via WebSocket
      this.gateway.emitNodeStatus(projectId || '', {
        nodeId,
        status: 'lighting-failed',
        error: error.message,
      } as any);

      // Re-throw to trigger BullMQ retry
      throw error;
    }
  }
}
