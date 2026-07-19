import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject } from '@nestjs/common';
import { MinioService } from '../../minio/minio.service';
import { QUEUE_NAMES } from '../../../config/queue.constants';

@Processor(QUEUE_NAMES.BANNER_CLEANUP)
export class BannerCleanupProcessor extends WorkerHost {
  constructor(@Inject(MinioService) private readonly minio: MinioService) {
    super();
  }

  async process(job: Job<{ oldImageKey: string }>) {
    const { oldImageKey } = job.data;
    try {
      await this.minio.delete(oldImageKey);
    } catch (err: any) {
      // NoSuchKey = already deleted, which is fine
      if (err.code !== 'NoSuchKey') throw err;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    console.error(`[BannerCleanup] Failed to delete ${job.data.oldImageKey}:`, err.message);
  }
}
