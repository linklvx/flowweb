import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
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

  async process(job: Job<AiDownloadJobData>): Promise<{ status: string; fileId?: string }> {
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
    await this.minio.upload(key, buffer, mimeType);

    // 3. Create Media record (directly status=completed)
    const media = await this.prisma.media.create({
      data: {
        userId,
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

    // 4. Push fileId via Socket
    this.gateway.emitNodeStatus(nodeId, 'done', {
      fileId: media.id,
      status: 'done',
    });

    this.logger.log(`AI result stored: ${media.id}`);
    return { status: 'completed', fileId: media.id };
  }
}
