import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { StorageQuotaService } from '../team/storage-quota.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { artifactDiscardedTotal } from '../execution/exec.metrics';
import { AI_DOWNLOAD_QUEUE_NAME } from './ai-download.constants';
import axios from 'axios';
import axiosRetry from 'axios-retry';

export interface AiDownloadJobData {
  userId: string;
  projectId: string;
  nodeId: string;
  taskId: string;
  resultUrl: string;
  mimeType: string;
}

@Processor(AI_DOWNLOAD_QUEUE_NAME)
export class AiDownloadProcessor extends WorkerHost {
  private readonly logger = new Logger(AiDownloadProcessor.name);
  private retryConfigured = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(ExecutionGateway) private readonly gateway: ExecutionGateway,
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
    @Inject(StorageQuotaService) private readonly quota: StorageQuotaService,
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

  async process(job: Job<AiDownloadJobData>): Promise<{ status: string; fileId?: string; reason?: string }> {
    const { userId, projectId, nodeId, taskId, resultUrl, mimeType } = job.data;
    this.logger.log(`Downloading AI result: ${resultUrl}`);

    this.ensureRetryConfigured();

    // 1. Download AI result with axios-retry
    const response = await axios.get(resultUrl, {
      responseType: 'arraybuffer',
      timeout: 120000, // 2 min timeout for large files
    });

    const buffer = Buffer.from(response.data);
    const ext = mimeType.split('/')[1] || 'bin';

    // 2. Build key and upload to MinIO
    const key = this.minio.buildKey('generated', userId, { projectId, nodeId, ext });
    // ⑥ 生成物超限语义：配额校验失败 → Media 不建、节点失败态、credits 不退（推理已发生）
    const quotaTeamId = (await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
      select: { teamId: true },
    }))?.teamId;
    if (!quotaTeamId) {
      // project 缺失/解析失败：job 已无意义，直接 failed 不再 create Media（不回落个人团队）
      Sentry.captureException(new Error(`ai-download: project team missing for job ${job.id}`));
      return { status: 'failed', reason: 'PROJECT_TEAM_MISSING' };
    }
    try {
      await this.quota.assertCanUpload(quotaTeamId, buffer.length);
    } catch {
      await this.collabDoc.writeNodeData(projectId, nodeId, {
        errorCode: 'storage_quota_exceeded',
      });
      this.gateway.emitNodeStatus(projectId, {
        nodeId,
        status: 'error',
        error: '存储空间不足：请清理素材或升级团队订阅',
      });
      this.logger.warn(`storage quota exceeded for project ${projectId}, node ${nodeId}`);
      return { status: 'failed' };
    }

    await this.minio.upload(key, buffer, mimeType);

    // 3. Create Media record (directly status=completed)
    const media = await this.prisma.media.create({
      data: {
        userId,
        teamId: quotaTeamId,
        key,
        originalName: `ai-generated-${nodeId}.${ext}`,
        mimeType,
        size: buffer.length,
        projectId,
        nodeId,
        taskId,
        type: 'generated',
        status: 'completed',
      },
    });

    // 4. Write fileId to server doc (real-time persistence), socket 仅进度通知
    //    Z44 nodeAlive 守卫（Y0b-2 T5）：written:false=节点已删——产物丢弃计数（账已结清，无退款腿）
    const deliver = await this.collabDoc.writeNodeData(projectId, nodeId, { fileId: media.id, resultUrl: job.data.resultUrl });
    if (!deliver.written) {
      artifactDiscardedTotal.inc({ cause: 'node-deleted' });
      this.logger.warn(`[ai-download] 节点 ${nodeId} 已删——产物 ${media.id} 丢弃（nodeAlive 守卫）`);
      return { status: 'completed', fileId: media.id };
    }

    this.gateway.emitNodeStatus(projectId, {
      nodeId,
      status: 'done',
      fileId: media.id,
    });

    this.logger.log(`AI result stored: ${media.id}`);
    return { status: 'completed', fileId: media.id };
  }
}
