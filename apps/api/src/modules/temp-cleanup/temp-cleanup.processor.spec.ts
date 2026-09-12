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
        // R18③：精确对象（objectContaining 里的 type:'temp' 单字段会"回绿但 OR 分支零覆盖"）——
        // temp 与 generated pending 共用 expiresAt 过期语义，completed 产物豁免
        where: {
          expiresAt: expect.any(Object),
          OR: [{ type: 'temp' }, { type: 'generated', status: 'pending' }],
        },
        take: 1000,
        select: { id: true, key: true },
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
