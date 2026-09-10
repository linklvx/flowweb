// apps/api/src/modules/video-project/generated-media.service.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ForbiddenException } from '@nestjs/common';
import { GeneratedMediaService } from './generated-media.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { StorageQuotaService } from '../team/storage-quota.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { THUMBNAIL_GENERATOR_QUEUE } from '../material-library/constants/material-library.constants';

describe('GeneratedMediaService（复用状态机语义，方法自建）', () => {
  let svc: GeneratedMediaService; let prisma: any; let minio: any; let quota: any; let perm: any; let thumb: any;
  const base = { userId: 'u1', workflowId: 'w1', videoProjectId: 'p1', resolution: '1080p', durationSec: 60 }; // 无 teamId——服务端派生

  beforeEach(() => {
    prisma = {
      media: { create: vi.fn().mockResolvedValue({ id: 'm1' }), findUnique: vi.fn(), update: vi.fn().mockResolvedValue({ id: 'm1' }) },
      canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
    };
    minio = {
      buildKey: vi.fn().mockReturnValue('results/u1/w1/n1/2026-09-10/uuid.mp4'),
      generatePresignedPost: vi.fn().mockResolvedValue({ url: 'http://minio/post', fields: { key: 'results/u1/w1/n1/2026-09-10/uuid.mp4' } }),
      // statSize 是新方法：内部消化 HeadObjectCommand 的 ContentLength，直接返回数字
      statSize: vi.fn().mockResolvedValue(12_345_678),
    };
    quota = { assertCanUpload: vi.fn().mockResolvedValue(undefined) };
    perm = { assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR') };
    thumb = { add: vi.fn().mockResolvedValue(undefined) };
    svc = new GeneratedMediaService(prisma, minio, quota, perm, thumb);
  });

  it('register（编码完成后调用，actualSize=Blob.size）: teamId 服务端派生 + 建 pending Media + presigned POST + 配额终判', async () => {
    const r = await svc.register({ ...base, actualSize: 12_345_000 });
    expect(r.mediaId).toBe('m1');
    expect(r.upload.url).toBe('http://minio/post');
    expect(perm.assertEditor).toHaveBeenCalledWith('w1', 'u1'); // 权限门
    expect(prisma.canvasProject.findUnique).toHaveBeenCalledWith({ where: { id: 'w1' }, select: { teamId: true } }); // 派生而非客户端传入
    expect(quota.assertCanUpload).toHaveBeenCalledWith('t1', 12_345_000);
    expect(minio.generatePresignedPost).toHaveBeenCalledWith('results/u1/w1/n1/2026-09-10/uuid.mp4', 'video/mp4', 12_345_000);
    expect(prisma.media.create.mock.calls[0][0].data).toMatchObject({ teamId: 't1', type: 'generated', status: 'pending', mimeType: 'video/mp4', size: 12_345_000 });
  });

  it('confirm: statSize 实际大小落库 + 缩略图 seekSec 从 metadata.durationSec 读', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', userId: 'u1', key: 'k.mp4', metadata: { durationSec: 30 } });
    await svc.confirm('u1', { mediaId: 'm1' }); // 不再收 key/时长——均从 register 时落的记录读
    expect(minio.statSize).toHaveBeenCalledWith('k.mp4');
    expect(prisma.media.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'm1' },
      data: expect.objectContaining({ status: 'completed', size: 12_345_678 }),
    }));
    expect(thumb.add).toHaveBeenCalledWith('generate-thumbnail',
      expect.objectContaining({ mediaId: 'm1', key: 'k.mp4', mimeType: 'video/mp4', seekSec: 3 })); // max(1, 30*0.1)
  });

  it('confirm: 归属校验失败拒绝', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', userId: 'other' });
    await expect(svc.confirm('u1', { mediaId: 'm1' })).rejects.toThrow(ForbiddenException);
  });

  // provider 级 DI 冒烟（本仓惯例 getQueueToken 模式）——整模块 compile 会撞 ExecutionModule/CollabModule 的
  // Redis useFactory 真实连接（见 Task 7 注），故用此法拦截"忘写 BullModule.registerQueue"的接线错误
  it('DI 可解析（@InjectQueue token 满足）', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        GeneratedMediaService,
        { provide: PrismaService, useValue: {} },
        { provide: MinioService, useValue: {} },
        { provide: StorageQuotaService, useValue: {} },
        { provide: ProjectPermissionService, useValue: {} },
        { provide: getQueueToken(THUMBNAIL_GENERATOR_QUEUE), useValue: { add: vi.fn() } },
      ],
    }).compile();
    expect(mod.get(GeneratedMediaService)).toBeDefined();
  });
});
