import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MediaService } from './media.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { NotFoundException } from '@nestjs/common';

describe('MediaService', () => {
  let service: MediaService;
  let prisma: any;
  let minio: any;
  let redis: any;

  beforeEach(async () => {
    prisma = {
      media: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'media-1',
          userId: 'user1',
          key: 'results/user1/proj1/node1/2026-05-20/a.png',
          status: 'completed',
          type: 'generated',
        }),
      },
    };
    minio = {
      generatePresignedGetUrl: vi.fn().mockResolvedValue(
        'http://127.0.0.1:9000/flowai/results/user1/proj1/node1/2026-05-20/a.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&...',
      ),
    };
    redis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: 'REDIS_CLIENT', useValue: redis },
      ],
    }).compile();
    service = module.get<MediaService>(MediaService);
  });

  it('should return cached URL if present', async () => {
    redis.get = vi.fn().mockResolvedValue('http://cached-url/path?X-Amz=...');
    const url = await service.getMediaUrl('media-1', 'user1');
    expect(url).toBe('http://cached-url/path?X-Amz=...');
    expect(minio.generatePresignedGetUrl).not.toHaveBeenCalled();
  });

  it('should generate presigned URL and cache it on miss', async () => {
    const url = await service.getMediaUrl('media-1', 'user1');
    expect(url).toContain('X-Amz-Algorithm');
    expect(redis.set).toHaveBeenCalledWith(
      'media:url:user1:media-1',
      expect.any(String),
      'EX',
      840,
    );
  });

  it('should throw NotFoundException for non-existent media', async () => {
    prisma.media.findFirst = vi.fn().mockResolvedValue(null);
    await expect(
      service.getMediaUrl('nonexistent', 'user1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('should reject access from wrong userId', async () => {
    prisma.media.findFirst = vi.fn().mockResolvedValue(null);
    await expect(
      service.getMediaUrl('media-1', 'user2'),
    ).rejects.toThrow(NotFoundException);
  });
});
