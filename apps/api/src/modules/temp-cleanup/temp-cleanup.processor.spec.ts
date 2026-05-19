import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TempCleanupProcessor } from './temp-cleanup.processor';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Job } from 'bullmq';

describe('TempCleanupProcessor', () => {
  let processor: TempCleanupProcessor;
  let prisma: any;
  let minio: any;

  beforeEach(async () => {
    prisma = {
      media: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'm1', key: 'temp/u1/2026-05-19/a.png' },
          { id: 'm2', key: 'temp/u1/2026-05-19/b.png' },
        ]),
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };
    minio = {
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TempCleanupProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
      ],
    }).compile();
    processor = module.get<TempCleanupProcessor>(TempCleanupProcessor);
  });

  it('should find expired temp files, delete from MinIO, then delete DB records', async () => {
    const job = { data: {} } as Job;
    await processor.process(job);

    expect(prisma.media.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: 'temp',
          expiresAt: expect.any(Object),
        }),
        take: 1000,
      }),
    );
    expect(minio.delete).toHaveBeenCalledTimes(2);
    expect(prisma.media.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] } },
    });
  });

  it('should handle empty result gracefully', async () => {
    prisma.media.findMany = vi.fn().mockResolvedValue([]);
    const job = { data: {} } as Job;
    await processor.process(job);
    expect(minio.delete).not.toHaveBeenCalled();
    expect(prisma.media.deleteMany).not.toHaveBeenCalled();
  });
});
