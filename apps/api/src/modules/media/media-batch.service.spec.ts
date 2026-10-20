import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { MediaBatchService, MEDIA_CONTENT_URL_TTL_SEC } from './media-batch.service';

// Y1a+Y1b T5：batch 响应降级 content 路由引用——url/thumbnailUrl 字段名维持（web 契约），
// 值从 presigned URL 换 /api/media/:id/content[?variant=thumbnail]；MinIO presign 依赖删除。
describe('MediaBatchService（左面板聚合：按 mediaId 集合查 + content 路由引用）', () => {
  let svc: MediaBatchService; let prisma: any; let minio: any;
  beforeEach(() => {
    prisma = {
      media: { findMany: vi.fn().mockResolvedValue([{ id: 'm1', key: 'k1.mp4', thumbnailKey: 't1.jpg' }]) },
      teamMember: { findFirst: vi.fn().mockResolvedValue({ role: 'MEMBER' }) }, // assertTeamMember 的查询形状（team.util.ts L29）
    };
    minio = { generatePresignedGetUrl: vi.fn() }; // 保留 mock 以断言「不再被调」（T5 起 MinioService 依赖退役）
    svc = new MediaBatchService(prisma);
  });

  it('按 ids 批查 + 成员校验 + url=content 路由引用（零 presign）', async () => {
    const r = await svc.batchGet('u1', 't1', ['m1', 'm2']);
    expect(prisma.teamMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teamId: 't1', userId: 'u1' }) }));
    expect(prisma.media.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] }, teamId: 't1', deletedAt: null },
      select: expect.objectContaining({ id: true, key: true, mimeType: true }),
    });
    expect(r).toHaveLength(1);
    expect(r[0].url).toBe('/api/media/m1/content');                 // content 路由引用（红：现状 presigned http URL）
    expect(r[0].thumbnailUrl).toBe('/api/media/m1/content?variant=thumbnail');
    expect(minio.generatePresignedGetUrl).not.toHaveBeenCalled();   // presign 旁路删除（红：现状两次调用）
  });

  it('无缩略图行：thumbnailUrl=null（不引用主对象）', async () => {
    prisma.media.findMany.mockResolvedValue([{ id: 'm2', key: 'k2.mp4', thumbnailKey: null }]);
    const r = await svc.batchGet('u1', 't1', ['m2']);
    expect(r[0].thumbnailUrl).toBeNull();
  });

  it('他团 teamId → 403（非成员不暴露存在性，findMany 不触发）', async () => {
    prisma.teamMember.findFirst.mockResolvedValueOnce(null);
    await expect(svc.batchGet('u1', 't-other', ['m1'])).rejects.toThrow(ForbiddenException);
    expect(prisma.media.findMany).not.toHaveBeenCalled();
  });

  it('契约：响应条目 ttlSec === MEDIA_CONTENT_URL_TTL_SEC（content 路径稳定——ttlSec 降级为客户端缓存有效期提示）', async () => {
    const r = await svc.batchGet('u1', 't1', ['m1']);
    expect(r[0].ttlSec).toBe(MEDIA_CONTENT_URL_TTL_SEC);
  });
});
