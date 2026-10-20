import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabWritePort } from '../collab/collab-write.port';
import { StorageQuotaService } from '../team/storage-quota.service';
import { EmitPort } from '../gateway/emit.port';
import { SafeRemoteFetchService } from '../media/safe-remote-fetch.service';
import { artifactDiscardedTotal } from '../execution/exec.metrics';
import { AI_DOWNLOAD_QUEUE_NAME } from './ai-download.constants';

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

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(EmitPort) private readonly emitPort: EmitPort,   // Y0c T24（Z101）：emitNodeStatus 2 调用点改道 emit 端口（api=Direct/worker=降级 no-op）
    @Inject(CollabWritePort) private readonly collabDoc: CollabWritePort,
    @Inject(StorageQuotaService) private readonly quota: StorageQuotaService,
    // T6：下载经 SafeRemoteFetch（SSRF 四门+流式限长）——axios/axios-retry 直连退役（BullMQ attempts:3 承担重试面）
    @Inject(SafeRemoteFetchService) private readonly safeFetch: SafeRemoteFetchService,
  ) {
    super();
  }

  async process(job: Job<AiDownloadJobData>): Promise<{ status: string; fileId?: string; reason?: string }> {
    const { userId, projectId, nodeId, taskId, resultUrl, mimeType } = job.data;
    this.logger.log(`Downloading AI result: ${resultUrl}`);

    // 1. Download AI result（T6：SSRF 四门+限长经 SafeRemoteFetch）
    const { buffer } = await this.safeFetch.fetchBuffer(resultUrl);
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
      this.emitPort.emitNodeStatus(projectId, {
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

    this.emitPort.emitNodeStatus(projectId, {
      nodeId,
      status: 'done',
      fileId: media.id,
    });

    this.logger.log(`AI result stored: ${media.id}`);
    return { status: 'completed', fileId: media.id };
  }
}
