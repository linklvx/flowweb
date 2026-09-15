import { Test } from '@nestjs/testing';
import type { Mock } from 'vitest'; // 显式导入（同 Task 2.1 注）
// 第十轮（C1-5）：宿主文件异常类导入一次配齐——后续用例 toThrow(BadRequest 2.3/2.5/2.6、NotFound 3.3/4.2、
// Throttler 4.2/4.3、ServiceUnavailable 5.3)全靠它，缺任一即 TS2304、红因与 plan 声明不符
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { VideoWorkService } from './video-work.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';   // service 构造注入（Task 4.2 起）
import { CollabDocumentService } from '../collab/collab-document.service';        // service 构造注入（Task 5.3 起）
import { MinioService } from '../minio/minio.service';
import Redis from 'ioredis';

// 第九轮：替身提升为模块级 + any——后续任务（2.3/2.4/2.5/2.6/3.2/3.3/4.2/4.3/5.3）追加的是**同级** describe，
// 引用 describe 内声明是 TS2304；窄类型另挡后续赋值（prisma.videoWork.* / prisma.videoWorkSetting.* /
// prisma.videoCategory.* / prisma.$executeRaw / minio.delete/buildKey/upload 均 TS2339——api test 第一步是 tsc）。
// any 先例：media.service.spec.ts:10-12、video-work-clone.service.spec。vitest 文件级 beforeEach 对本文件全部 describe 生效。
let service: VideoWorkService;
let prisma: any;
let minio: any;

beforeEach(async () => {
    // 第十轮：命名空间一次配齐（与 providers"创建即完整"同思路）——any 只放宽了类型，命名空间缺失时
    // prisma.videoWork.create = vi.fn() 仍是运行时 TypeError: Cannot set properties of undefined（第九轮遗留：
    // 原 TS2339 编译红只是被搬进运行时，没有消失）。方法给空 vi.fn()，各用例用自己的 mockResolvedValue(Once) 覆盖。
    prisma = {
      media: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'm1', key: 'results/u1/p1/n1/d/v.mp4', projectId: 'p1', thumbnailKey: 'thumbnails/m1.webp',
          metadata: { durationSec: 12.6, width: 1280, height: 720 }, createdAt: new Date('2026-09-01'),
        }]),
        count: vi.fn().mockResolvedValue(1),
      },
      canvasProject: { findMany: vi.fn().mockResolvedValue([{ id: 'p1' }]), findUnique: vi.fn() },
      videoWork: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn(), count: vi.fn() },
      videoCategory: { findMany: vi.fn().mockResolvedValue([]) },
      videoWorkSetting: { findUnique: vi.fn(), upsert: vi.fn() },
      videoTag: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      $executeRaw: vi.fn(),
    };
    minio = { generatePresignedGetUrl: vi.fn().mockResolvedValue('http://minio/presigned'), buildKey: vi.fn(), upload: vi.fn(), delete: vi.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoWorkService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        // 第六轮：service 构造注入随任务增长（4.2 rateLimiter / 5.3 collabDoc），Nest compile 时解析全部构造参数——
        // 不预置则后续任务一加注入本 spec 整文件编译红。两个 mock 一次配齐，后续任务直接用。
        { provide: RateLimiterService, useValue: { checkIpRateLimit: vi.fn().mockResolvedValue(true), checkUserRateLimit: vi.fn().mockResolvedValue(true), getClientIp: vi.fn().mockReturnValue('1.2.3.4') } },
        { provide: CollabDocumentService, useValue: { readCanvas: vi.fn() } },
        { provide: 'REDIS_CLIENT', useValue: { get: vi.fn(), set: vi.fn(), del: vi.fn() } },
      ],
    }).compile();
    service = moduleRef.get(VideoWorkService);
  });

// 第九轮：describe 开行移到文件级 beforeEach 之后（首任务用例从下一行开始；后续任务直接追加同级 describe 即可引用替身）
describe('VideoWorkService.listCandidates', () => {

  it('口径：type=generated + video/mp4 + completed + 未删除 + metadata.origin=video-project', async () => {
    await service.listCandidates(1, 20);
    const where = prisma.media.findMany.mock.calls[0][0].where;
    expect(where.type).toBe('generated');
    expect(where.mimeType).toBe('video/mp4');
    expect(where.status).toBe('completed');
    expect(where.deletedAt).toBeNull();
    expect(where.metadata).toEqual({ path: ['origin'], equals: 'video-project' });
  });

  it('canvasExists 批量单查（findMany in，非逐条 findUnique）', async () => {
    const res = await service.listCandidates(1, 20);
    expect(prisma.canvasProject.findMany).toHaveBeenCalledWith({ where: { id: { in: ['p1'] } }, select: { id: true } });
    expect(res.items[0].canvasExists).toBe(true);
    expect(prisma.canvasProject.findMany).toHaveBeenCalledTimes(1);
  });

  it('projectId 为空 → canvasExists=false', async () => {
    prisma.media.findMany.mockResolvedValue([{ id: 'm2', key: 'k', projectId: null, thumbnailKey: null, metadata: {}, createdAt: new Date() }]);
    const res = await service.listCandidates(1, 20);
    expect(res.items[0].canvasExists).toBe(false);
  });

  it('durationSec 取整入库口径（12.6 → 13）', async () => {
    const res = await service.listCandidates(1, 20);
    expect(res.items[0].durationSec).toBe(13);
  });
});

// 第十一轮：补 invalidateCategoryCache 服务端覆盖——Task 2.1 的 category/tag CRUD 由 controller spec 的
// service mock 驱动、service 侧此前零用例，spec §4.2"admin 改类型时主动删缓存"无测试钉住（redis 即文件级
// providers 的 REDIS_CLIENT 替身，(service as any).redis 取同一实例）
describe('category CRUD 缓存失效', () => {
  it('createCategory → prisma.videoCategory.create + redis.del(videoWork:categories)', async () => {
    prisma.videoCategory.create = vi.fn().mockResolvedValue({ id: 'c1' });
    await service.createCategory({ name: 'AI真人影视' });
    expect(prisma.videoCategory.create).toHaveBeenCalledWith({ data: { name: 'AI真人影视' } });
    expect((service as any).redis.del).toHaveBeenCalledWith('videoWork:categories');
  });

  it('deleteCategory → prisma.videoCategory.delete + redis.del', async () => {
    prisma.videoCategory.delete = vi.fn().mockResolvedValue({ id: 'c1' });
    await service.deleteCategory('c1');
    expect(prisma.videoCategory.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect((service as any).redis.del).toHaveBeenCalledWith('videoWork:categories');
  });
});
