import { Test } from '@nestjs/testing';
import type { Mock } from 'vitest'; // 显式导入（同 Task 2.1 注）
// 第十轮（C1-5）：宿主文件异常类导入一次配齐——后续用例 toThrow(BadRequest 2.3/2.5/2.6、NotFound 3.3/4.2、
// Throttler 4.2/4.3、ServiceUnavailable 5.3)全靠它，缺任一即 TS2304、红因与 plan 声明不符
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { VideoWorkService } from './video-work.service';
import { VideoWorkController } from './video-work.controller'; // getDetail describe 的路由声明序用例断言原型方法序
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

describe('createWork/updateWork 保存校验与发布语义', () => {
  it('(allowViewProcess||allowClone)=true 且无 canvasProjectId → 400', async () => {
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k',
      allowViewProcess: true, allowClone: false, canvasProjectId: undefined } as any)).rejects.toThrow(BadRequestException);
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k',
      allowViewProcess: false, allowClone: true, canvasProjectId: undefined } as any)).rejects.toThrow(BadRequestException);
  });

  it('allowClone=true 且 allowViewProcess=false → 400（第八轮裁定：克隆入口在创作过程视图顶栏——开关耦合，防前端不可达死开关；update 语义=合并现有值后判定）', async () => {
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k', canvasProjectId: 'p1',
      allowViewProcess: false, allowClone: true } as any)).rejects.toThrow(BadRequestException);
    // 现有 allowViewProcess=true：单独开 allowClone 不 400
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'DRAFT', publishedAt: null, allowViewProcess: true, allowClone: false, canvasProjectId: 'p1' });
    prisma.videoWork.update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await expect(service.updateWork('w1', { allowClone: true } as any)).resolves.toBeTruthy();
    // 现有 allowViewProcess=false：开 allowClone → 400
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'DRAFT', publishedAt: null, allowViewProcess: false, allowClone: false, canvasProjectId: 'p1' });
    await expect(service.updateWork('w1', { allowClone: true } as any)).rejects.toThrow(BadRequestException);
  });

  it('发布动作：status 转 PUBLISHED 且 publishedAt 为空 → 服务端设 now；请求体带 publishedAt 被忽略', async () => {
    prisma.videoWork.create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await service.createWork({ title: 't', authorName: 'a', videoKey: 'k', status: 'PUBLISHED', publishedAt: new Date('2000-01-01') } as any);
    const data = (prisma.videoWork.create as Mock).mock.calls[0][0].data;
    expect(data.publishedAt.getFullYear()).toBeGreaterThan(2025); // now，非请求体的 2000
  });

  it('再次下架上架不重置 publishedAt（已有 publishedAt → update payload 不写该键）', async () => {
    // updateWork 签名是 (id, dto)——现有行由 service 内部 findUnique 查，此处必须 mock（文件级 videoWork.findUnique 是裸 vi.fn() 返回 undefined——第十一轮修正：原"桩不含 videoWork"表述已过期，第十轮已配齐命名空间）
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'PUBLISHED', publishedAt: new Date('2026-01-01'), allowViewProcess: false, allowClone: false, canvasProjectId: null });
    prisma.videoWork.update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await service.updateWork('w1', { status: 'PUBLISHED' } as any);
    const data = (prisma.videoWork.update as Mock).mock.calls[0][0].data;
    expect(data.publishedAt).toBeUndefined(); // 不动原值 = payload 不含该键（Prisma update 未设键即保留 DB 原值）
  });

  it('durationSec 小数取整（12.6 → 13）', async () => {
    prisma.videoWork.create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await service.createWork({ title: 't', authorName: 'a', videoKey: 'k', durationSec: 12.6 } as any);
    expect((prisma.videoWork.create as Mock).mock.calls[0][0].data.durationSec).toBe(13);
  });

  it('removeWork 不触碰 MinIO（删除红线——MinioService 的删除方法真名是 delete，minio.service.ts:117；全类无 removeObject，原断言恒真抓不到任何真实调用，第八轮修正）', async () => {
    prisma.videoWork.delete = vi.fn().mockResolvedValue({});
    minio.delete = vi.fn().mockResolvedValue(undefined);   // 替身显式提供 delete——实现真调用会让下方断言红
    await service.removeWork('w1');
    expect(minio.generatePresignedGetUrl).not.toHaveBeenCalled();
    expect(minio.delete).not.toHaveBeenCalled();           // 红线：只删 DB 行，禁删对象（spec §4.3）
  });
});

describe('uploadCover（magic-number + system 域）', () => {
  it('非图片字节 → 400（mimetype 伪装拦截）', async () => {
    await expect(service.uploadCover(Buffer.from('not an image'), 'image/png')).rejects.toThrow(BadRequestException);
  });
  it('合法 PNG → buildKey("uploaded","system") + upload(key, buffer, mimetype) 三参、key 匹配 ^uploads/system/', async () => {
    minio.buildKey = vi.fn().mockReturnValue('uploads/system/2026-09-16/abc.png');
    minio.upload = vi.fn().mockResolvedValue(undefined);
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const res = await service.uploadCover(png, 'image/png');
    expect(minio.upload).toHaveBeenCalledWith('uploads/system/2026-09-16/abc.png', png, 'image/png'); // 三参（C2 定稿断言，第八轮落进正文）
    expect(res.key).toMatch(/^uploads\/system\//);
  });
});

describe('settings 轮播设置', () => {
  it('无行返回默认值（不依赖 DB 有行）', async () => {
    prisma.videoWorkSetting.findUnique = vi.fn().mockResolvedValue(null);
    const s = await service.getSettings();
    expect(s).toEqual({ carouselEnabled: true, carouselScope: 'all' });
  });
  it('PUT 走 upsert singleton 行', async () => {
    prisma.videoWorkSetting.upsert = vi.fn().mockResolvedValue({});
    await service.updateSettings({ carouselEnabled: false, carouselScope: 'category' });
    expect(prisma.videoWorkSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'singleton' } }),
    );
  });
  it('carouselScope 非法值 → 400', async () => {
    await expect(service.updateSettings({ carouselEnabled: true, carouselScope: 'xx' as any })).rejects.toThrow(BadRequestException);
  });
});

describe('listPublished', () => {
  it('orderBy 含 id tiebreaker（spec §4.2）', async () => {
    prisma.videoWork.findMany = vi.fn().mockResolvedValue([]);
    prisma.videoWork.count = vi.fn().mockResolvedValue(0);
    await service.listPublished(undefined, 1, 20);
    expect(prisma.videoWork.findMany.mock.calls[0][0].orderBy).toEqual([
      { sortOrder: 'asc' }, { publishedAt: 'desc' }, { id: 'asc' },
    ]);
  });

  it('categoryId 为 plain filter（不校验 active）', async () => {
    prisma.videoWork.findMany = vi.fn().mockResolvedValue([]);
    prisma.videoWork.count = vi.fn().mockResolvedValue(0);
    await service.listPublished('any-cat', 1, 20);
    expect(prisma.videoWork.findMany.mock.calls[0][0].where.categoryId).toBe('any-cat');
  });

  it('listCategoriesPublic 命中缓存第二次不查 DB', async () => {
    prisma.videoCategory.findMany = vi.fn().mockResolvedValue([]);
    const redisGet = (service as any).redis.get.mockResolvedValue('[]');
    await service.listCategoriesPublic();
    await service.listCategoriesPublic();
    expect(prisma.videoCategory.findMany).toHaveBeenCalledTimes(0); // 全部命中缓存
    redisGet.mockReset();
  });
});

describe('getDetail', () => {
  const work = {
    id: 'w1', title: 't', description: 'd', authorName: 'a', categoryId: 'c1',
    videoKey: 'vk', coverKey: 'ck', canvasProjectId: 'p1',
    viewCount: 10, likeCount: 5, tags: ['x'], publishedAt: new Date(), durationSec: 100, width: 16, height: 9,
    allowViewProcess: true, allowClone: true, status: 'PUBLISHED',
  };

  it('DRAFT → 404', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ ...work, status: 'DRAFT' });
    await expect(service.getDetail('w1', null)).rejects.toThrow(NotFoundException);
  });

  it('画布不存在（findUnique null）→ canViewProcess/canClone=false 且不抛', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue(work);
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue(null);
    const d = await service.getDetail('w1', null);
    expect(d.canViewProcess).toBe(false);
    expect(d.canClone).toBe(false);
  });

  it('liked 初始态：匿名 false 且未查询 like 键（匿名短路——C2 Task 3.3 收窄版：presignWork 的 URL 缓存也会 redis.get，全量 not.toHaveBeenCalled 必红）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue(work);
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue({ id: 'p1' });
    const redisGet = (service as any).redis.get;
    const d = await service.getDetail('w1', null);
    expect(d.liked).toBe(false);
    expect(redisGet.mock.calls.flat().some((k: any) => String(k).startsWith('videoWork:like:'))).toBe(false); // 只断言 like 键未查
  });

  it('路由声明序：categories/settings 静态段先于 :id（Task 3.2 移入——本任务首写 getDetail；settings 端点第七轮已前移至 Task 3.2，此处一并断言）', () => {
    const names = Object.getOwnPropertyNames(VideoWorkController.prototype).filter(n => n !== 'constructor');
    expect(names.indexOf('listCategories')).toBeLessThan(names.indexOf('getDetail'));
    expect(names.indexOf('getSettings')).toBeLessThan(names.indexOf('getDetail'));
  });

  it('liked 初始态：已登录读同一 like key（videoWork:like:{workId}:{userId}）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue(work);
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue({ id: 'p1' });
    (service as any).redis.get.mockResolvedValue('1');
    const d = await service.getDetail('w1', 'user9');
    expect(d.liked).toBe(true);
    expect((service as any).redis.get).toHaveBeenCalledWith('videoWork:like:w1:user9');
  });

  it('详情端点不触发 readCanvas（canvasProject 校验只 findUnique）——第七轮改无条件断言（spec §7.6 红线：条件式 `if (collabDoc)` 在实现改字段名/漏注入时静默变绿）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue(work);
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue({ id: 'p1' });
    await service.getDetail('w1', null);
    const readCanvas = (service as any).collabDoc.readCanvas; // Task 1.3 签名一次到位——构造注入必然存在（Task 2.2 spec providers 已提供）
    expect(readCanvas).not.toHaveBeenCalled();
  });
});
