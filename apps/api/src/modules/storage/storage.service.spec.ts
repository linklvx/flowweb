import { StorageQuotaService } from '../team/storage-quota.service';
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageService } from './storage.service';
import { MediaRegistrationService } from '../media/media-registration.service';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ForbiddenException } from '@nestjs/common';

/** PNG 最小可判型缓冲（file-type 16.x 需可读 chunk——过短会 EndOfStream） */
const PNG_HEAD = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452', 'hex'),
  Buffer.alloc(13, 1),
]);

describe('StorageService', () => {
  let service: StorageService;
  let prisma: any;
  let minio: any;
  let quota: { assertCanUpload: any; assertOnConfirm: any; assertMember: any };
  let registration: { prepareUpload: any; confirmUpload: any; deletePending: any };

  beforeEach(async () => {
    prisma = {
      team: { findFirst: vi.fn().mockResolvedValue({ id: 'team1' }) },
      canvasProject: { findUnique: vi.fn() },
      teamMember: { findFirst: vi.fn() },
      media: {
        findFirst: vi.fn(),
      },
    };
    minio = {
      buildKey: vi.fn().mockReturnValue('uploads/user1/2026-05-20/uuid.png'),
      generatePresignedPost: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:9000/flowai',
        fields: {
          key: 'uploads/user1/2026-05-20/uuid.png',
          'Content-Type': 'image/png',
          Policy: 'mock-policy',
          'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
          'X-Amz-Credential': 'mock',
          'X-Amz-Date': 'mock',
          'X-Amz-Signature': 'mock',
        },
      }),
      statSize: vi.fn().mockResolvedValue(2048000),
      getHeadBytes: vi.fn().mockResolvedValue(PNG_HEAD),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    quota = {
      assertCanUpload: vi.fn(),
      assertOnConfirm: vi.fn(),
      assertMember: vi.fn(),
    };
    registration = {
      prepareUpload: vi.fn().mockResolvedValue({
        id: 'media-1', key: 'uploads/u1/2026-01-01/a.png', status: 'pending',
        mimeType: 'image/png', size: 2048000n,
      }),
      confirmUpload: vi.fn().mockResolvedValue(undefined),
      deletePending: vi.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: StorageQuotaService, useValue: quota },
        { provide: MediaRegistrationService, useValue: registration },
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
    expect(registration.prepareUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user1',
        teamId: 'team1',
        mimeType: 'image/png',
        size: 2048000,
        type: 'uploaded',
      }),
    );
  });

  it('presign 三级回落①：projectId → project.teamId + 成员校验 + projectId 落行（T4-⑥）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't-team' });
    await service.presignUpload('u1', { projectId: 'p1', fileName: 'a.png', fileType: 'image/png', fileSize: 100, type: 'image' as any });
    expect(quota.assertMember).toHaveBeenCalledWith('t-team', 'u1');
    expect(registration.prepareUpload).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 't-team',
      projectId: 'p1', // 落列（现状缺失根修）
    }));
  });

  it('presign 三级回落②：无 projectId 带 teamId → assertMember 放行', async () => {
    await service.presignUpload('u1', { teamId: 't-team', fileName: 'a.png', fileType: 'image/png', fileSize: 100, type: 'image' as any });
    expect(quota.assertMember).toHaveBeenCalledWith('t-team', 'u1');
    expect(registration.prepareUpload).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 't-team',
    }));
  });

  it('presign 三级回落②反例：他团队成员 → assertMember 拒绝', async () => {
    quota.assertMember.mockRejectedValue(new ForbiddenException('非团队成员'));
    await expect(
      service.presignUpload('u1', { teamId: 't-other', fileName: 'a.png', fileType: 'image/png', fileSize: 100, type: 'image' as any }),
    ).rejects.toThrow(ForbiddenException);
    expect(registration.prepareUpload).not.toHaveBeenCalled();
  });

  it('presign 三级回落③：都无 → 默认团队', async () => {
    prisma.team.findFirst.mockResolvedValue({ id: 't-default' });
    await service.presignUpload('u1', { fileName: 'a.png', fileType: 'image/png', fileSize: 100, type: 'image' as any });
    expect(registration.prepareUpload).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 't-default',
    }));
  });

  it('presign 三级回落①：项目不存在 → 拒绝', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    await expect(
      service.presignUpload('u1', { projectId: 'p-404', fileName: 'a.png', fileType: 'image/png', fileSize: 100, type: 'image' as any }),
    ).rejects.toThrow('项目不存在');
    expect(registration.prepareUpload).not.toHaveBeenCalled();
  });

  it('T4-① clientUploadId 透传：携带时原样进幂等键；空串=不启用', async () => {
    await service.presignUpload('u1', { teamId: 't-team', fileName: 'a.png', fileType: 'image/png', fileSize: 100, type: 'uploaded', clientUploadId: 'cuid-1' });
    expect(registration.prepareUpload).toHaveBeenCalledWith(expect.objectContaining({ clientUploadId: 'cuid-1' }));
    await service.presignUpload('u1', { teamId: 't-team', fileName: 'a.png', fileType: 'image/png', fileSize: 100, type: 'uploaded', clientUploadId: '' });
    expect(registration.prepareUpload).toHaveBeenLastCalledWith(expect.objectContaining({ clientUploadId: undefined }));
  });

  it('T4-① clientUploadId 非法（>128）→ 400', async () => {
    await expect(
      service.presignUpload('u1', { teamId: 't-team', fileName: 'a.png', fileType: 'image/png', fileSize: 100, type: 'uploaded', clientUploadId: 'x'.repeat(129) }),
    ).rejects.toThrow('clientUploadId 非法');
    expect(registration.prepareUpload).not.toHaveBeenCalled();
  });

  it('should confirm upload and update status to completed', async () => {
    prisma.media.findFirst = vi.fn().mockResolvedValue({ id: 'media-1', userId: 'user1', teamId: 'team1', status: 'pending', key: 'uploads/u1/test.png', size: 2048000 });
    const result = await service.confirmUpload('user1', {
      fileId: 'media-1',
      key: 'uploads/u1/test.png',
      fileSize: 2048000,
    });
    expect(result.fileId).toBe('media-1');
    expect(registration.confirmUpload).toHaveBeenCalledWith({
      mediaId: 'media-1',
      actualSize: 2048000,
      sniffedMimeType: 'image/png', // 嗅探为准（T4-④）
    });
  });

  it('D1 victim key：请求体传任意 key 也不生效——statSize/delete/getHeadBytes 收到的都是 media.key', async () => {
    prisma.media.findFirst = vi.fn().mockResolvedValue({ id: 'media-1', userId: 'user1', teamId: 'team1', status: 'pending', key: 'uploads/system/real.mp4', size: 2048000 });
    minio.statSize.mockResolvedValue(2048000);
    await service.confirmUpload('user1', { fileId: 'media-1', key: 'victim/obj', fileSize: 1 }); // 攻击载荷：受害者 key + 伪造大小
    expect(minio.statSize).toHaveBeenCalledWith('uploads/system/real.mp4'); // 用行内 key 探测
    expect(minio.getHeadBytes).toHaveBeenCalledWith('uploads/system/real.mp4'); // 嗅探也用行内 key
    expect(registration.confirmUpload).toHaveBeenCalled();                     // 正常完成，victim 无感
  });

  it('confirmUpload 团队成员可确认他人上传', async () => {
    prisma.media.findFirst.mockResolvedValue({ id: 'm1', userId: 'other', teamId: 't-team', key: 'k', size: 100 });
    prisma.teamMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
    minio.statSize.mockResolvedValue(100);
    await service.confirmUpload('u1', { fileId: 'm1', key: 'k', fileSize: 100 });
    expect(prisma.teamMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teamId: 't-team', userId: 'u1' }) }),
    );
    expect(registration.confirmUpload).toHaveBeenCalled();
  });

  it('confirmUpload 非成员 → 403/400 拒绝', async () => {
    prisma.media.findFirst.mockResolvedValue({ id: 'm1', userId: 'other', teamId: 't-team', key: 'k' }); // 授权在 statSize 之前，无需 size
    prisma.teamMember.findFirst.mockResolvedValue(null);
    minio.statSize.mockResolvedValue(100);
    await expect(service.confirmUpload('u1', { fileId: 'm1', key: 'k', fileSize: 100 })).rejects.toThrow(ForbiddenException);
    expect(registration.confirmUpload).not.toHaveBeenCalled();
  });

  it('should reject confirm if fileSize mismatch（D1 后判据 = actualSize vs media.size；请求体 key 与 fixture 不同——防"实现回退 dto.key 也绿"的真空断言）', async () => {
    prisma.media.findFirst = vi.fn().mockResolvedValue({ id: 'media-1', userId: 'user1', teamId: 'team1', status: 'pending', key: 'uploads/u1/test.png', size: 2048000 });
    minio.statSize = vi.fn().mockResolvedValue(999); // 真实对象 999 ≠ 行内 size 2048000
    await expect(
      service.confirmUpload('user1', { fileId: 'media-1', key: 'victim/obj', fileSize: 999 }), // 请求体 key 故意不同
    ).rejects.toThrow(); // 请求体 fileSize=999（旧实现会放行——新实现不读它，仍按行内 size 拒）
    expect(minio.delete).toHaveBeenCalledWith('uploads/u1/test.png'); // 清理也用行内 key（非 victim——攻击 A 独立钉子）
    expect(minio.delete).not.toHaveBeenCalledWith('victim/obj');
    expect(registration.deletePending).toHaveBeenCalledWith('media-1'); // 行删除守卫 pending
  });

  it('T4-④ 嗅探白名单外（不可判型字节）→ 删对象+删行+400，confirmUpload 不触达', async () => {
    prisma.media.findFirst = vi.fn().mockResolvedValue({ id: 'media-1', userId: 'user1', teamId: 'team1', status: 'pending', key: 'uploads/u1/fake.png', size: 100 });
    minio.statSize.mockResolvedValue(100);
    minio.getHeadBytes.mockResolvedValue(Buffer.from('plain text not a media file'));
    await expect(service.confirmUpload('user1', { fileId: 'media-1', key: 'k', fileSize: 100 })).rejects.toThrow('文件类型不受支持');
    expect(minio.delete).toHaveBeenCalledWith('uploads/u1/fake.png');
    expect(registration.deletePending).toHaveBeenCalledWith('media-1');
    expect(registration.confirmUpload).not.toHaveBeenCalled();
  });
});
