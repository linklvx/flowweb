import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { MediaBatchService } from './media-batch.service';

describe('MediaBatchService（左面板聚合：按 mediaId 集合查，绕开 type 硬编码过滤）', () => {
  let svc: MediaBatchService; let prisma: any; let minio: any;
  beforeEach(() => {
    prisma = {
      media: { findMany: vi.fn().mockResolvedValue([{ id: 'm1', key: 'k1.mp4', thumbnailKey: 't1.jpg' }]) },
      teamMember: { findFirst: vi.fn().mockResolvedValue({ role: 'MEMBER' }) }, // assertTeamMember 的查询形状（team.util.ts L29）
    };
    minio = { generatePresignedGetUrl: vi.fn().mockResolvedValue('http://signed') }; // 构造器第 2 参——缺了 batchGet 必 TypeError
    svc = new MediaBatchService(prisma, minio);
  });

  it('按 ids 批查 + 成员校验 + presigned URL', async () => {
    const r = await svc.batchGet('u1', 't1', ['m1', 'm2']);
    expect(prisma.teamMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teamId: 't1', userId: 'u1' }) }));
    expect(prisma.media.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] }, teamId: 't1', deletedAt: null },
      select: expect.objectContaining({ id: true, key: true, mimeType: true }),
    });
    expect(r).toHaveLength(1);
    expect(r[0].url).toBe('http://signed');
    expect(r[0].thumbnailUrl).toBe('http://signed');
  });

  it('他团 teamId → 403（非成员不暴露存在性，findMany 不触发）', async () => {
    prisma.teamMember.findFirst.mockResolvedValueOnce(null);
    await expect(svc.batchGet('u1', 't-other', ['m1'])).rejects.toThrow(ForbiddenException);
    expect(prisma.media.findMany).not.toHaveBeenCalled();
  });
});
