// apps/api/src/modules/video-project/generated-media.service.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
      media: { create: vi.fn().mockResolvedValue({ id: 'm1' }), findUnique: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue({ id: 'm1' }) },
      canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
    };
    minio = {
      buildKey: vi.fn().mockReturnValue('results/u1/w1/n1/2026-09-10/uuid.mp4'),
      generatePresignedPost: vi.fn().mockResolvedValue({ url: 'http://minio/post', fields: { key: 'results/u1/w1/n1/2026-09-10/uuid.mp4' } }),
      // statSize 是新方法：内部消化 HeadObjectCommand 的 ContentLength，直接返回数字
      statSize: vi.fn().mockResolvedValue(12_345_678),
    };
    quota = { assertCanUpload: vi.fn().mockResolvedValue(undefined), assertOnConfirm: vi.fn().mockResolvedValue(undefined) };
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

  it('register 480p/900s 接受；显式 width/height 落 metadata（不传则无该键——勘误⑦：resolution 无法表达 9:16 的 1080×1920）', async () => {
    await svc.register({ ...base, resolution: '480p', durationSec: 900, actualSize: 100 });
    expect(prisma.media.create.mock.calls[0][0].data.metadata).toEqual(
      { origin: 'video-project', videoProjectId: 'p1', resolution: '480p', durationSec: 900 }); // toEqual 忽略 undefined 键——未传即无该键
    await svc.register({ ...base, resolution: '480p', durationSec: 10, actualSize: 100, width: 854, height: 480 });
    expect(prisma.media.create.mock.calls[1][0].data.metadata).toEqual(
      { origin: 'video-project', videoProjectId: 'p1', resolution: '480p', durationSec: 10, width: 854, height: 480 });
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

  // —— 批7-1（P1-D）：confirm 终判 + clientRequestId 幂等 + generated pending 24h TTL ——

  it('confirm 超限回滚：assertOnConfirm 抛（其内部已删对象+删行）→ BadRequestException 传播且 thumbnailQueue.add 未被调（插入点在 add 之前——缩略图不得指向死行）', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', userId: 'u1', key: 'k.mp4', bucket: 'flowai', metadata: { durationSec: 30 } });
    quota.assertOnConfirm.mockRejectedValue(new BadRequestException('存储空间不足，上传已取消'));
    await expect(svc.confirm('u1', { mediaId: 'm1' })).rejects.toThrow(BadRequestException);
    expect(quota.assertOnConfirm).toHaveBeenCalledWith('m1', 12_345_678, 'k.mp4', 'flowai'); // actualSize=statSize 终判口径
    expect(thumb.add).not.toHaveBeenCalled();
    expect(prisma.media.update).not.toHaveBeenCalled(); // 行已被 assertOnConfirm 删——再 update 即 P2025
  });

  it('register 幂等：同 clientRequestId 返回同一条 Media（不新建行、不重估配额——插入点在 assertCanUpload 之前重试不被二次拦截；assertEditor 权限门不绕过）', async () => {
    prisma.media.findFirst.mockResolvedValue({ id: 'm0', key: 'k0.mp4', size: 100 });
    const r = await svc.register({ ...base, actualSize: 100, clientRequestId: 'req-1' });
    expect(perm.assertEditor).toHaveBeenCalledWith('w1', 'u1'); // 幂等分支仍在编辑器门之后
    expect(prisma.media.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'u1', // R18②：作用域化——防枚举他人 clientRequestId 命中他人 pending 行
        metadata: { path: ['clientRequestId'], equals: 'req-1' },
        status: 'pending', // completed 同 id 命中即语义错误（复用旧产物=静默覆盖首产物 key）
      },
    });
    expect(r.mediaId).toBe('m0');
    expect(minio.generatePresignedPost).toHaveBeenCalledWith('k0.mp4', 'video/mp4', 100);
    expect(prisma.media.create).not.toHaveBeenCalled();
    expect(quota.assertCanUpload).not.toHaveBeenCalled();
  });

  it('register 写 expiresAt = now+24h（generated pending 24h TTL 回收）', async () => {
    await svc.register({ ...base, actualSize: 100 });
    const expiresAt = prisma.media.create.mock.calls[0][0].data.expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });

  it('register 落 metadata.clientRequestId（幂等查询的写侧——find 过滤 path clientRequestId 必须有持久化来源）', async () => {
    await svc.register({ ...base, actualSize: 100, clientRequestId: 'req-2' });
    expect(prisma.media.findFirst).toHaveBeenCalled();
    expect(prisma.media.create.mock.calls[0][0].data.metadata).toEqual(
      { origin: 'video-project', videoProjectId: 'p1', resolution: '1080p', durationSec: 60, clientRequestId: 'req-2' });
  });

  it('confirm 成功置 expiresAt=null（completed 产物不进 24h 回收）', async () => {
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', userId: 'u1', key: 'k.mp4', bucket: 'flowai', metadata: { durationSec: 30 } });
    await svc.confirm('u1', { mediaId: 'm1' });
    expect(prisma.media.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'm1' },
      data: expect.objectContaining({ status: 'completed', expiresAt: null }),
    }));
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
