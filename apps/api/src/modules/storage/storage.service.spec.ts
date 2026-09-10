import { StorageQuotaService } from '../team/storage-quota.service';
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageService } from './storage.service';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ForbiddenException } from '@nestjs/common';

describe('StorageService', () => {
  let service: StorageService;
  let prisma: any;
  let minio: any;
  let quota: { assertCanUpload: any; assertOnConfirm: any; assertMember: any };

  beforeEach(async () => {
    prisma = {
      team: { findFirst: vi.fn().mockResolvedValue({ id: 'team1' }) },
      canvasProject: { findUnique: vi.fn() },
      teamMember: { findFirst: vi.fn() },
      media: {
        create: vi.fn().mockResolvedValue({ id: 'media-1', key: 'uploads/u1/2026-01-01/a.png', status: 'pending' }),
        update: vi.fn().mockResolvedValue({ id: 'media-1', status: 'completed' }),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        delete: vi.fn().mockResolvedValue({}),
      },
    };
    minio = {
      buildKey: vi.fn().mockReturnValue('uploads/user1/2026-05-20/uuid.png'),
      generatePresignedPost: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:9000/flowai',
        fields: {
          key: 'uploads/user1/2026-05-20/uuid.png',
          Policy: 'mock-policy',
          'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
          'X-Amz-Credential': 'mock',
          'X-Amz-Date': 'mock',
          'X-Amz-Signature': 'mock',
        },
      }),
      statSize: vi.fn().mockResolvedValue(2048000),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    quota = {
      assertCanUpload: vi.fn(),
      assertOnConfirm: vi.fn(),
      assertMember: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: StorageQuotaService, useValue: quota },
      ],
    }).compile();
    service = module.get<StorageService>(StorageService);
  });

  it('should generate presigned POST URL and create pending Media', async () => {
    const result = await service.presignUpload(
      'user1',
      { fileName: 'ref.png', fileSize: 2048000, fileType: 'image/png', type: 'uploaded' },
    );
    expect(result.fileId).toBe('media-1');
    expect(result.uploadUrl).toBe('http://127.0.0.1:9000/flowai');
    expect(result.fields).toBeDefined();
    expect(result.fields.key).toBe('uploads/user1/2026-05-20/uuid.png');
    expect(prisma.media.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user1',
          teamId: 'team1',
          status: 'pending',
          type: 'uploaded',
        }),
      }),
    );
  });

  it('presign 三级回落①：projectId → project.teamId + 成员校验', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't-team' });
    await service.presignUpload('u1', { projectId: 'p1', fileName: 'a.png', fileType: 'image/png', fileSize: 100, type: 'image' as any });
    expect(quota.assertMember).toHaveBeenCalledWith('t-team', 'u1');
    expect(prisma.media.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ teamId: 't-team' }),
    }));
  });

  it('presign 三级回落②：无 projectId 带 teamId → assertMember 放行', async () => {
    await service.presignUpload('u1', { teamId: 't-team', fileName: 'a.png', fileType: 'image/png', fileSize: 100, type: 'image' as any });
    expect(quota.assertMember).toHaveBeenCalledWith('t-team', 'u1');
    expect(prisma.media.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ teamId: 't-team' }),
    }));
  });

  it('presign 三级回落②反例：他团队成员 → assertMember 拒绝', async () => {
    quota.assertMember.mockRejectedValue(new ForbiddenException('非团队成员'));
    await expect(
      service.presignUpload('u1', { teamId: 't-other', fileName: 'a.png', fileType: 'image/png', fileSize: 100, type: 'image' as any }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.media.create).not.toHaveBeenCalled();
  });

  it('presign 三级回落③：都无 → 默认团队', async () => {
    prisma.team.findFirst.mockResolvedValue({ id: 't-default' });
    await service.presignUpload('u1', { fileName: 'a.png', fileType: 'image/png', fileSize: 100, type: 'image' as any });
    expect(prisma.media.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ teamId: 't-default' }),
    }));
  });

  it('presign 三级回落①：项目不存在 → 拒绝', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    await expect(
      service.presignUpload('u1', { projectId: 'p-404', fileName: 'a.png', fileType: 'image/png', fileSize: 100, type: 'image' as any }),
    ).rejects.toThrow('项目不存在');
    expect(prisma.media.create).not.toHaveBeenCalled();
  });

  it('should confirm upload and update status to completed', async () => {
    prisma.media.findFirst = vi.fn().mockResolvedValue({ id: 'media-1', userId: 'user1', teamId: 'team1', status: 'pending', key: 'uploads/u1/test.png' });
    const result = await service.confirmUpload('user1', {
      fileId: 'media-1',
      key: 'uploads/u1/test.png',
      fileSize: 2048000,
    });
    expect(result.fileId).toBe('media-1');
    expect(prisma.media.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'media-1' },
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  it('confirmUpload 团队成员可确认他人上传', async () => {
    prisma.media.findFirst.mockResolvedValue({ id: 'm1', userId: 'other', teamId: 't-team' });
    prisma.teamMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
    minio.statSize.mockResolvedValue(100);
    await service.confirmUpload('u1', { fileId: 'm1', key: 'k', fileSize: 100 });
    expect(prisma.teamMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teamId: 't-team', userId: 'u1' }) }),
    );
    expect(prisma.media.update).toHaveBeenCalled();
  });

  it('confirmUpload 非成员 → 403/400 拒绝', async () => {
    prisma.media.findFirst.mockResolvedValue({ id: 'm1', userId: 'other', teamId: 't-team' });
    prisma.teamMember.findFirst.mockResolvedValue(null);
    minio.statSize.mockResolvedValue(100);
    await expect(service.confirmUpload('u1', { fileId: 'm1', key: 'k', fileSize: 100 })).rejects.toThrow(ForbiddenException);
    expect(prisma.media.update).not.toHaveBeenCalled();
  });

  it('should reject confirm if fileSize mismatch', async () => {
    prisma.media.findFirst = vi.fn().mockResolvedValue({ id: 'media-1', userId: 'user1', teamId: 'team1', status: 'pending', key: 'uploads/u1/test.png' });
    minio.statSize = vi.fn().mockResolvedValue(999);
    await expect(
      service.confirmUpload('user1', {
        fileId: 'media-1',
        key: 'uploads/u1/test.png',
        fileSize: 2048000,
      }),
    ).rejects.toThrow();
    expect(minio.delete).toHaveBeenCalled();
  });
});
