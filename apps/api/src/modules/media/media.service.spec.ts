import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MediaService } from './media.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

// Y1a+Y1b T5：getMediaUrl（/url 读侧 presign 旁路）删除——本文件改钉 assertMediaReadable 团队级单门
//（真 PG 四例归 media-content.int.spec；此处为 mock 形状钉：成员放行/公开作品兜底/其余 403）。
describe('MediaService（assertMediaReadable 单门+findReadable+by-key 维持）', () => {
  let service: MediaService;
  let prisma: any;
  let minio: any;

  beforeEach(() => {
    prisma = {
      media: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'media-1', userId: 'user1', teamId: 't-team', key: 'k', bucket: 'flowai',
          mimeType: 'image/png', sniffedMimeType: null, status: 'completed', sourceUrl: null,
          originalName: 'a.png', deletedAt: null, thumbnailKey: null,
        }),
      },
      teamMember: { findFirst: vi.fn().mockResolvedValue({ role: 'MEMBER' }) },
      videoWork: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    minio = { generatePresignedGetUrl: vi.fn() };
    service = new MediaService(prisma as PrismaService, minio as unknown as MinioService);
  });

  describe('assertMediaReadable（团队级单门）', () => {
    it('团队成员放行（creator 与否同门——单门不分 creator）', async () => {
      await expect(service.assertMediaReadable({ id: 'media-1', teamId: 't-team' }, 'u-member')).resolves.toBeUndefined();
      expect(prisma.teamMember.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ teamId: 't-team', userId: 'u-member' }),
      }));
    });

    it('非成员+未发布引用 → 403（不区分团队存在性）', async () => {
      prisma.teamMember.findFirst.mockResolvedValue(null);
      await expect(service.assertMediaReadable({ id: 'media-1', teamId: 't-team' }, 'u-stranger')).rejects.toThrow(ForbiddenException);
    });

    it('非成员+已发布作品引用（videoMediaId 锚）→ 放行（公开页兜底——平台作品对全员可读）', async () => {
      prisma.teamMember.findFirst.mockResolvedValue(null);
      prisma.videoWork.findFirst.mockResolvedValue({ id: 'w1' });
      await expect(service.assertMediaReadable({ id: 'media-1', teamId: 'platform-team' }, 'u-stranger')).resolves.toBeUndefined();
      expect(prisma.videoWork.findFirst).toHaveBeenCalledWith({
        where: { videoMediaId: 'media-1', status: 'PUBLISHED' },
        select: { id: true },
      });
    });

    it('未登录（userId null）仅作品兜底可用——无兜底 403', async () => {
      prisma.videoWork.findFirst.mockResolvedValue(null);
      await expect(service.assertMediaReadable({ id: 'media-1', teamId: 't-team' }, null)).rejects.toThrow(ForbiddenException);
      prisma.videoWork.findFirst.mockResolvedValue({ id: 'w1' });
      await expect(service.assertMediaReadable({ id: 'media-1', teamId: 't-team' }, null)).resolves.toBeUndefined();
    });
  });

  describe('findReadable（行装载+404 面）', () => {
    it('缺失行 → null（controller 404）；软删行 → null；在库+单门过 → 整行返回', async () => {
      prisma.media.findUnique.mockResolvedValueOnce(null);
      await expect(service.findReadable('nope', 'u1')).resolves.toBeNull();
      prisma.media.findUnique.mockResolvedValueOnce({ deletedAt: new Date() });
      await expect(service.findReadable('gone', 'u1')).resolves.toBeNull();
      const row = await service.findReadable('media-1', 'u1');
      expect(row).toMatchObject({ id: 'media-1', teamId: 't-team' });
    });

    it('单门拒 → 透传 403（行不返回）', async () => {
      prisma.teamMember.findFirst.mockResolvedValue(null);
      await expect(service.findReadable('media-1', 'stranger')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getPresignedUrlByKey（by-key 维持——公开素材 uploads/system/ 唯一合法域）', () => {
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
