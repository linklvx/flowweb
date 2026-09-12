import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TEMP_CLEANUP_QUEUE_NAME } from './temp-cleanup.constants';

@Processor(TEMP_CLEANUP_QUEUE_NAME)
export class TempCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(TempCleanupProcessor.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ cleaned: number }> {
    // 1. Find expired temp files（P1-D：generated pending 共用 expiresAt 过期语义——completed 置 expiresAt=null 豁免）
    const expiredMedias = await this.prisma.media.findMany({
      where: {
        expiresAt: { lt: new Date() },
        OR: [{ type: 'temp' }, { type: 'generated', status: 'pending' }],
      },
      take: 1000,
      select: { id: true, key: true },
    });

    if (expiredMedias.length === 0) {
      this.logger.log('No expired temp files to clean');
      return { cleaned: 0 };
    }

    // 2. Batch delete from MinIO (don't fail if one delete fails)
    await Promise.all(
      expiredMedias.map((m) =>
        this.minio.delete(m.key).catch((err) =>
          this.logger.warn(`Failed to delete ${m.key}: ${err.message}`),
        ),
      ),
    );

    // 3. Batch delete DB records
    const ids = expiredMedias.map((m) => m.id);
    await this.prisma.media.deleteMany({
      where: { id: { in: ids } },
    });

    this.logger.log(`Cleaned up ${expiredMedias.length} temp files`);
    return { cleaned: expiredMedias.length };
  }
}
