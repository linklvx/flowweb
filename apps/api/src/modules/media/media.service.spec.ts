import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MediaService } from './media.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

describe('MediaService', () => {
  let service: MediaService;
  let prisma: any;
  let minio: any;
  let redis: any;

  beforeEach(async () => {
    prisma = {
      media: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'media-1',
          userId: 'user1',
          teamId: 't-team',
          key: 'results/user1/proj1/node1/2026-05-20/a.png',
          status: 'completed',
          type: 'generated',
        }),
      },
      teamMember: { findFirst: vi.fn().mockResolvedValue({ role: 'MEMBER' }) },
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

  it('getMediaUrl 鉴权前置：非 creator 需团队成员（缓存命中也不得跳过）', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', userId: 'other', teamId: 't-team', key: 'k' });
    prisma.teamMember.findFirst.mockResolvedValue(null); // 非成员
    redis.get.mockResolvedValue(JSON.stringify({ url: 'http://pre-warmed-url', expiresAt: Date.now() + 60_000 })); // 缓存已预热
    await expect(service.getMediaUrl('m1', 'u-stranger')).rejects.toThrow(ForbiddenException);
    expect(redis.get).not.toHaveBeenCalled(); // 鉴权未过不得读缓存
    expect(minio.generatePresignedGetUrl).not.toHaveBeenCalled();
  });

  it('getMediaUrl 成员命中缓存直接返回（不再生成新 URL）', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', userId: 'other', teamId: 't-team', key: 'k' });
    prisma.teamMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
    redis.get.mockResolvedValue(JSON.stringify({ url: 'http://cached', expiresAt: Date.now() + 60_000 }));
    const out = await service.getMediaUrl('m1', 'u-teammate');
    expect(out.url).toBe('http://cached');
    expect(out.ttlSec).toBeGreaterThanOrEqual(1);
    expect(minio.generatePresignedGetUrl).not.toHaveBeenCalled();
  });

  it('getMediaUrl 缓存 key 为团队维度 media:url:v2:${teamId}:${fileId}', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', userId: 'u1', teamId: 't-team', key: 'k' });
    redis.get.mockResolvedValue(null);
    minio.generatePresignedGetUrl.mockResolvedValue('http://new');
    const out = await service.getMediaUrl('m1', 'u1');
    expect(out.url).toBe('http://new');
    expect(out.ttlSec).toBe(900);
    expect(redis.set).toHaveBeenCalledWith(
      'media:url:v2:t-team:m1',
      expect.stringMatching(/^\{"url":.*,"expiresAt":\d+\}$/),
      'EX',
      840,
    );
  });

  it('should return cached URL if present', async () => {
    redis.get = vi.fn().mockResolvedValue(
      JSON.stringify({ url: 'http://cached-url/path?X-Amz=...', expiresAt: Date.now() + 60_000 }),
    );
    const out = await service.getMediaUrl('media-1', 'user1');
    expect(out.url).toBe('http://cached-url/path?X-Amz=...');
    expect(out.ttlSec).toBeGreaterThanOrEqual(1);
    expect(minio.generatePresignedGetUrl).not.toHaveBeenCalled();
  });

  it('should generate presigned URL and cache it on miss', async () => {
    const out = await service.getMediaUrl('media-1', 'user1');
    expect(out.url).toContain('X-Amz-Algorithm');
    expect(out.ttlSec).toBe(900);
    expect(redis.set).toHaveBeenCalledWith(
      'media:url:v2:t-team:media-1',
      expect.stringMatching(/^\{"url":.*,"expiresAt":\d+\}$/),
      'EX',
      840,
    );
  });

  it('命中且未过期：返回剩余寿命（expiresAt − now，恒 ≥1），不重签', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ url: 'http://cached', expiresAt: Date.now() + 60_000 }));
    const out = await service.getMediaUrl('media-1', 'user1');
    expect(out.url).toBe('http://cached');
    expect(out.ttlSec).toBeGreaterThanOrEqual(1);
    expect(out.ttlSec).toBeLessThanOrEqual(60);
    expect(minio.generatePresignedGetUrl).not.toHaveBeenCalled();
  });

  it('命中但已过期（remaining ≤ 0）：重签覆写', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ url: 'http://stale', expiresAt: Date.now() - 1_000 }));
    const out = await service.getMediaUrl('media-1', 'user1');
    expect(out.url).not.toBe('http://stale');
    expect(out.ttlSec).toBe(900);
    expect(redis.set).toHaveBeenCalled();
  });

  it('坏值（非 JSON/缺 expiresAt/NaN）：重签覆写自愈不抛', async () => {
    redis.get.mockResolvedValueOnce('not-json');
    await expect(service.getMediaUrl('media-1', 'user1')).resolves.toMatchObject({ ttlSec: 900 });
    redis.get.mockResolvedValueOnce(JSON.stringify({ url: 'http://x' }));
    await expect(service.getMediaUrl('media-1', 'user1')).resolves.toMatchObject({ ttlSec: 900 });
    redis.get.mockResolvedValueOnce(JSON.stringify({ url: 'http://x', expiresAt: 'abc' }));
    await expect(service.getMediaUrl('media-1', 'user1')).resolves.toMatchObject({ ttlSec: 900 });
    redis.get.mockResolvedValueOnce(JSON.stringify({ expiresAt: Date.now() + 60_000 }));  // 缺 url
    await expect(service.getMediaUrl('media-1', 'user1')).resolves.toMatchObject({ ttlSec: 900 });
  });

  it('缓存键版本化 v2', async () => {
    await service.getMediaUrl('media-1', 'user1');
    expect(redis.get).toHaveBeenCalledWith('media:url:v2:t-team:media-1');
  });

  it('响应形状恰两键（运行时锁——API tsc exclude spec，编译期门禁不适用）', async () => {
    const out = await service.getMediaUrl('media-1', 'user1');
    expect(Object.keys(out).sort()).toEqual(['ttlSec', 'url']);
  });

  it('should throw NotFoundException for non-existent media', async () => {
    prisma.media.findUnique = vi.fn().mockResolvedValue(null);
    await expect(
      service.getMediaUrl('nonexistent', 'user1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('should reject access from non-member stranger', async () => {
    prisma.teamMember.findFirst = vi.fn().mockResolvedValue(null);
    await expect(
      service.getMediaUrl('media-1', 'user2'),
    ).rejects.toThrow(ForbiddenException);
  });

  describe('getPresignedUrlByKey', () => {
    it('uploads/system/ 前缀放行并 presign 同一个规范化值', async () => {
      const key = 'uploads/system/2026-01-01/abc.png';
      minio.generatePresignedGetUrl = vi.fn().mockResolvedValue('http://minio/url');
      const url = await service.getPresignedUrlByKey(`  ${key}  `); // 带空白验证 trim
      expect(url).toBe('http://minio/url');
      expect(minio.generatePresignedGetUrl).toHaveBeenCalledWith(key, 900); // 签名用 trim 后的同一值
    });

    it('非 system 前缀一律 403（含登录场景语义，方法级不区分）', async () => {
      await expect(service.getPresignedUrlByKey('uploads/user1/a.png')).rejects.toThrow(ForbiddenException);
      await expect(service.getPresignedUrlByKey('results/user1/p/n/x.mp4')).rejects.toThrow(ForbiddenException);
    });

    it('尾斜杠边界：uploads/systematic-x 不放行', async () => {
      await expect(service.getPresignedUrlByKey('uploads/systematic-x/evil.png')).rejects.toThrow(ForbiddenException);
    });

    it('空 key 拒绝', async () => {
      await expect(service.getPresignedUrlByKey('   ')).rejects.toThrow(BadRequestException);
    });

    it('undefined key（不带 query 调用）拒绝', async () => {
      await expect(service.getPresignedUrlByKey(undefined as any)).rejects.toThrow(BadRequestException);
    });
  });
});
