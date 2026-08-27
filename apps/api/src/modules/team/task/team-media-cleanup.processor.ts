import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../minio/minio.service';

@Injectable()
@Processor('team-media-cleanup')
export class TeamMediaCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(TeamMediaCleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {
    super();
  }

  /** 解散后批量清理 MinIO 对象（Media 行已随 team 级联删除，仅清对象） */
  async process(job: Job<{ medias: { id: string; bucket: string; key: string }[] }>): Promise<void> {
    const { medias } = job.data;
    let failed = 0;
    for (const m of medias) {
      try {
        await this.minio.delete(m.key);
      } catch {
        failed++;
      }
    }
    if (failed > 0) this.logger.warn(`cleanup: ${failed}/${medias.length} objects failed (team media rows already removed)`);
  }
}
