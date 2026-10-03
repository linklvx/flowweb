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
import { StorageQuotaService } from '../team/storage-quota.service'; // 文件头 import 区追加
import { MinioService } from '../minio/minio.service';
import { CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';
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
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(1),
        findUnique: vi.fn(),   // Task 4 F2：PK 查 mediaId
        update: vi.fn().mockResolvedValue({}),  // Task 5 removeWork：软删——默认 resolved（裸 vi.fn() 返回 undefined，实现里 .catch 链会 TypeError）
      },
      canvasProject: { findMany: vi.fn().mockResolvedValue([{ id: 'p1' }]), findUnique: vi.fn() },
      videoWork: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      videoCategory: { findMany: vi.fn().mockResolvedValue([]) },
      videoWorkSetting: { findUnique: vi.fn(), upsert: vi.fn() },
      videoTag: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      $executeRaw: vi.fn(),
    };
    minio = { generatePresignedGetUrl: vi.fn().mockResolvedValue('http://minio/presigned'), buildKey: vi.fn(), upload: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) }; // delete 补默认 resolved（Task 5：removeWork/updateWork 删对象——裸 vi.fn() 返回 undefined，实现里 await 链会 TypeError）
    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoWorkService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        // 第六轮：service 构造注入随任务增长（4.2 rateLimiter / 5.3 collabDoc），Nest compile 时解析全部构造参数——
        // 不预置则后续任务一加注入本 spec 整文件编译红。两个 mock 一次配齐，后续任务直接用。
        { provide: RateLimiterService, useValue: { checkIpRateLimit: vi.fn().mockResolvedValue(true), checkUserRateLimit: vi.fn().mockResolvedValue(true), getClientIp: vi.fn().mockReturnValue('1.2.3.4') } },
        { provide: CollabDocumentService, useValue: { readCanvas: vi.fn() } },
        { provide: StorageQuotaService, useValue: { assertCanUpload: vi.fn().mockResolvedValue(undefined), assertMember: vi.fn(), getUsage: vi.fn().mockResolvedValue(0), assertOnConfirm: vi.fn().mockResolvedValue(undefined) } },
        { provide: 'REDIS_CLIENT', useValue: { get: vi.fn(), set: vi.fn(), del: vi.fn().mockResolvedValue(undefined) } }, // del 补默认 resolved（Task 5：removeWork URL 缓存失效——裸 vi.fn() 返回 undefined，实现里 await 链会 TypeError）
      ],
    }).compile();
    // Task 4 F2 默认匹配行——createWork 用例 payload 传 videoKey:'k' + videoMediaId:'m1' 时直接过；
    // negative 用例自行 mockResolvedValueOnce 覆盖（证明默认行没把断言架空）
    prisma.media.findUnique.mockResolvedValue({ id: 'm1', key: 'k', status: 'completed', type: 'uploaded', teamId: 'platform-team', deletedAt: null });
    service = moduleRef.get(VideoWorkService);
  });

// 第九轮：describe 开行移到文件级 beforeEach 之后（首任务用例从下一行开始；后续任务直接追加同级 describe 即可引用替身）

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
    // 泛型 toThrow(BadRequestException) 升级为文案 + **不补 videoMediaId**（spec §4.5 前提）——F2 若抢跑到 flags 之前，
    // 此用例会抛'视频文件不存在或未完成上传'而非 flags 文案 → 红。补了 mediaId + 默认匹配行会让 F2 在任何顺序下通过，
    // 顺序不可观测（Task 4 审查 I-1）。顺序正确（flags 先抛）时不查 media、此用例绿。
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k',
      allowViewProcess: true, allowClone: false, canvasProjectId: undefined } as any)).rejects.toThrow('开启创作过程/克隆需要画布来源');
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k',
      allowViewProcess: false, allowClone: true, canvasProjectId: undefined } as any)).rejects.toThrow('开启创作过程/克隆需要画布来源');
  });

  it('allowClone=true 且 allowViewProcess=false → 400（第八轮裁定：克隆入口在创作过程视图顶栏——开关耦合，防前端不可达死开关；update 语义=合并现有值后判定）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', name: 'n', updatedAt: new Date(), user: null, team: { owner: { name: 'o' } } }); // 防御性：正常时序 flags 先抛、此 stub 不被消费
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k', canvasProjectId: 'p1',
      allowViewProcess: false, allowClone: true } as any)).rejects.toThrow('允许克隆必须同时允许查看创作过程'); // 同样不补 videoMediaId（顺序探测器，见首条 flags 用例注）
    // 现有 allowViewProcess=true：单独开 allowClone 不 400
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'DRAFT', publishedAt: null, allowViewProcess: true, allowClone: false, canvasProjectId: 'p1' });
    prisma.videoWork.update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await expect(service.updateWork('w1', { allowClone: true } as any)).resolves.toBeTruthy();
    // 现有 allowViewProcess=false：开 allowClone → 400
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'DRAFT', publishedAt: null, allowViewProcess: false, allowClone: false, canvasProjectId: 'p1' });
    await expect(service.updateWork('w1', { allowClone: true } as any)).rejects.toThrow('允许克隆必须同时允许查看创作过程');
  });

  it('发布动作：status 转 PUBLISHED 且 publishedAt 为空 → 服务端设 now；请求体带 publishedAt 被忽略', async () => {
    prisma.videoWork.create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await service.createWork({ title: 't', authorName: 'a', videoKey: 'k', videoMediaId: 'm1', status: 'PUBLISHED', publishedAt: new Date('2000-01-01') } as any);
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
    await service.createWork({ title: 't', authorName: 'a', videoKey: 'k', videoMediaId: 'm1', durationSec: 12.6 } as any);
    expect((prisma.videoWork.create as Mock).mock.calls[0][0].data.durationSec).toBe(13);
  });

  it('removeWork 平台域作品：删对象 + Media 软删 + 缓存失效（videoWork:url:key + process）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', videoKey: 'uploads/system/2026-09-18/a.mp4', videoMediaId: 'm1', coverKey: 'uploads/system/c.jpg' });
    prisma.videoWork.count = vi.fn().mockResolvedValue(0); // 排他：无共享
    prisma.videoWork.delete = vi.fn().mockResolvedValue({});
    minio.delete = vi.fn().mockResolvedValue(undefined);
    await service.removeWork('w1');
    expect(minio.delete).toHaveBeenCalledWith('uploads/system/2026-09-18/a.mp4'); // 平台域删对象（非真空——findUnique 已 stub）
    expect(minio.delete).toHaveBeenCalledWith('uploads/system/c.jpg');             // 封面同域同删
    expect(prisma.media.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1' }, data: expect.objectContaining({ deletedAt: expect.any(Date) }) })); // 软删释放平台配额
    expect((service as any).redis.del).toHaveBeenCalledWith('videoWork:url:uploads/system/2026-09-18/a.mp4'); // 卫生动作：防将来"删对象但保留行"路径
    expect(prisma.videoWork.delete).toHaveBeenCalledWith({ where: { id: 'w1' } });
  });

  it('removeWork 存量 results/ 域作品：只删 DB 行不删对象（旧红线保留的半边——旧对象与源 Media 共享）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w2', videoKey: 'results/u1/p1/n1/d/v.mp4', videoMediaId: 'm2', coverKey: null });
    prisma.videoWork.delete = vi.fn().mockResolvedValue({});
    await service.removeWork('w2');
    expect(minio.delete).not.toHaveBeenCalled(); // 域外不删
    expect(prisma.videoWork.delete).toHaveBeenCalledWith({ where: { id: 'w2' } });
  });

  it('removeWork 行不存在 → 404（先查后删——裸 delete 抛 P2025 变 500）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue(null);
    await expect(service.removeWork('w-404')).rejects.toThrow(NotFoundException);
  });

  it('removeWork 排他：videoMediaId 被其他作品引用 → 不删对象（防存量共享/直调；封面 coverKey 字符串比对）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w3', videoKey: 'uploads/system/a.mp4', videoMediaId: 'm3', coverKey: 'uploads/system/c.jpg' });
    prisma.videoWork.count = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0); // 第一次=videoMediaId 排他(共享)，第二次=coverKey 排他(独占)
    prisma.videoWork.delete = vi.fn().mockResolvedValue({});
    await service.removeWork('w3');
    expect(minio.delete).not.toHaveBeenCalledWith('uploads/system/a.mp4'); // 共享视频不删
    expect(minio.delete).toHaveBeenCalledWith('uploads/system/c.jpg');     // 独占封面照删
  });

  it('removeWork MinIO 抖动不阻断（尽力而为——失败仅记日志，作品删除照常成功）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w4', videoKey: 'uploads/system/a.mp4', videoMediaId: 'm4', coverKey: null });
    prisma.videoWork.count = vi.fn().mockResolvedValue(0);
    prisma.videoWork.delete = vi.fn().mockResolvedValue({});
    minio.delete = vi.fn().mockRejectedValue(new Error('minio down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(service.removeWork('w4')).resolves.toBeUndefined(); // 不抛
    expect(prisma.videoWork.delete).toHaveBeenCalled();
    errSpy.mockRestore();
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

  // 批次 3 质量审查 Minor（plan 级缺口补齐）：miss 路径——查 DB 一次并回写缓存（键值同 CATEGORY_CACHE_KEY 实际常量）
  it('listCategoriesPublic 缓存 miss → findMany 1 次 + set(key, json, EX, 60)', async () => {
    prisma.videoCategory.findMany = vi.fn().mockResolvedValue([{ id: 'c1', name: 'AI真人影视', sortOrder: 1 }]);
    (service as any).redis.get = vi.fn().mockResolvedValue(null);
    (service as any).redis.set = vi.fn().mockResolvedValue('OK');
    const rows = await service.listCategoriesPublic();
    expect(prisma.videoCategory.findMany).toHaveBeenCalledTimes(1);
    expect((service as any).redis.set).toHaveBeenCalledWith(
      'videoWork:categories', JSON.stringify(rows), 'EX', 60,
    );
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

describe('recordView', () => {
  // 第十一轮：实现第一行就是 findUnique + status 校验——文件级 findUnique 是裸 vi.fn()（undefined），
  // 不补桩则①②在首个 await 抛 NotFoundException（update 计数=0）、③期望 Throttler 实得 NotFound，三条全红。
  // describe 级 beforeEach 在文件级之后执行，DRAFT 用例自带覆盖不受影响。
  beforeEach(() => { prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'PUBLISHED' }); });

  it('同 IP 1h 内重复请求只 +1（Redis 去重）', async () => {
    prisma.videoWork.update = vi.fn().mockResolvedValue({});
    (service as any).redis.set = vi.fn().mockResolvedValue('OK');      // 第一次 NX 成功
    await service.recordView('w1', '1.2.3.4');
    (service as any).redis.set = vi.fn().mockResolvedValue(null);      // 第二次 NX 失败
    await service.recordView('w1', '1.2.3.4');
    expect(prisma.videoWork.update).toHaveBeenCalledTimes(1);
    expect(prisma.videoWork.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { viewCount: { increment: 1 } } });
    // set 被换新 mock 两次，此处 calls[0] 指第二次（NX 失败）调用——非键参数与第一次相同；键含 ipHash 故切片断言
    expect((service as any).redis.set.mock.calls[0].slice(1)).toEqual(['1', 'EX', 3600, 'NX']);
  });

  it('StrictMode 双发（同 IP 连续两次）计数仍 1 —— spec §7.4', async () => {
    let call = 0;
    (service as any).redis.set = vi.fn().mockImplementation(() => Promise.resolve(call++ === 0 ? 'OK' : null));
    prisma.videoWork.update = vi.fn().mockResolvedValue({});
    await service.recordView('w9', '5.5.5.5');
    await service.recordView('w9', '5.5.5.5');
    expect(prisma.videoWork.update).toHaveBeenCalledTimes(1);
  });

  it('限流超限 → 429（ThrottlerException 语义）', async () => {
    (service as any).rateLimiter.checkIpRateLimit = vi.fn().mockResolvedValue(false);
    await expect(service.recordView('w1', '9.9.9.9')).rejects.toThrow(ThrottlerException);
    expect((service as any).rateLimiter.checkIpRateLimit).toHaveBeenCalledWith('9.9.9.9', 'video-work:view', 60, 30);
  });

  it('DRAFT 作品 → 404', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'DRAFT' });
    await expect(service.recordView('w1', '1.1.1.1')).rejects.toThrow(NotFoundException);
  });
});

describe('toggleLike', () => {
  // 未登录 401 在 controller spec 断言（本文件只测登录路径；第六轮删除空体占位用例——恒绿假覆盖）
  it('限流：checkUserRateLimit 拒绝 → 429（spec §7.5"限流 429"——view/clone 均已限流，like 第八轮补齐）', async () => {
    (service as any).rateLimiter.checkUserRateLimit = vi.fn().mockResolvedValue(false);
    await expect(service.toggleLike('w1', 'u1')).rejects.toThrow(ThrottlerException);
    expect((service as any).rateLimiter.checkUserRateLimit).toHaveBeenCalledWith('u1', 'video-work:like', 60, 30);
  });

  it('首次点赞：NX 成功 → +1 且返回 liked:true', async () => {
    (service as any).redis.set = vi.fn().mockResolvedValue('OK');
    prisma.$executeRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve(1)); // tagged template mock
    // findUnique 被调两次（先查 status、后回读 likeCount）——$executeRaw 是 mock 不真改库，须序列化给值（第六轮）
    prisma.videoWork.findUnique = vi.fn()
      .mockResolvedValueOnce({ status: 'PUBLISHED' })
      .mockResolvedValueOnce({ likeCount: 5 });
    const res = await service.toggleLike('w1', 'u1');
    const call = (prisma.$executeRaw as any).mock.calls[0];
    expect(call[0].join('?')).toContain('GREATEST("likeCount" + ?, 0)'); // SQL 模板拼接（C2 Task 4.3 统一式）
    expect(call.slice(1)).toEqual([1, 'w1']);                            // 值序 (delta, id)，字面量
    expect(res).toEqual({ liked: true, likeCount: 5 });
    expect((service as any).redis.set.mock.calls[0].slice(1)).toEqual(['1', 'EX', 7776000, 'NX']);
  });

  it('再点取消：NX 失败 → -1 删键', async () => {
    (service as any).redis.set = vi.fn().mockResolvedValue(null); // NX 失败=已赞
    (service as any).redis.del = vi.fn();
    prisma.$executeRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve(1));
    prisma.videoWork.findUnique = vi.fn()
      .mockResolvedValueOnce({ status: 'PUBLISHED' })
      .mockResolvedValueOnce({ likeCount: 4 });
    const res = await service.toggleLike('w1', 'u1');
    const call = (prisma.$executeRaw as any).mock.calls[0];
    expect(call[0].join('?')).toContain('GREATEST("likeCount" + ?, 0)');
    expect(call.slice(1)).toEqual([-1, 'w1']);
    expect((service as any).redis.del).toHaveBeenCalledWith('videoWork:like:w1:u1');
    expect(res).toEqual({ liked: false, likeCount: 4 });
  });

  it('GREATEST 下界：likeCount=0 时取消不再减（SQL 层保护）', async () => {
    (service as any).redis.set = vi.fn().mockResolvedValue(null);
    prisma.$executeRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve(1));
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'PUBLISHED', likeCount: 0 });
    await service.toggleLike('w1', 'u1');
    const call = (prisma.$executeRaw as any).mock.calls[0];
    expect(call[0].join('?')).toContain('GREATEST("likeCount" + ?, 0)');
    expect(call.slice(1)).toEqual([-1, 'w1']);
  });
});

describe('injectThumbnails', () => {
  it('收集 fileId 批量查 Media.thumbnailKey → presign 注入 data.thumbnailUrl，响应不含 fileId', async () => {
    prisma.media.findMany = vi.fn().mockResolvedValue([
      { id: 'f1', thumbnailKey: 'thumbnails/f1.webp' },
      { id: 'f2', thumbnailKey: null },
    ]);
    minio.generatePresignedGetUrl = vi.fn().mockResolvedValue('http://minio/thumbs');
    const raw = {
      nodes: [
        { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: { prompt: { text: 'a', html: 'b' }, fileId: 'f1' } },
        { id: 'n2', type: 'videoGen', position: { x: 0, y: 0 }, data: { model: 'm', fileId: 'f2' } },
      ],
      edges: [],
    };
    const out = await service.injectThumbnails(raw as any);
    expect(prisma.media.findMany).toHaveBeenCalledWith({ where: { id: { in: ['f1', 'f2'] } }, select: { id: true, thumbnailKey: true } });
    expect(out.nodes[0].data.thumbnailUrl).toBe('http://minio/thumbs'); // 有 thumbnail 的注入
    expect(out.nodes[1].data.thumbnailUrl).toBeUndefined();             // 无 thumbnail 不注入（前端占位）
    expect(out.nodes[0].data.fileId).toBe('f1');                        // 注入阶段保留 fileId，过滤阶段剥（管线顺序）
  });
});

describe('getProcessSnapshot（安全验收）', () => {
  const work = { id: 'w1', title: 't', canvasProjectId: 'p1', allowViewProcess: true, status: 'PUBLISHED' };
  const rawCanvas = {
    nodes: [
      { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '<p>一只猫在窗台上</p>', prompt: 'p' } },
      { id: 'n2', type: 'imageGen', position: { x: 0, y: 0 }, data: { prompt: { text: 'cat', html: '<p>evil</p>' }, fileId: 'f1', mediaUrl: 'http://secret', mediaName: 'a.png' } },
      { id: 'n3', type: 'videoGen', position: { x: 0, y: 0 }, data: { label: '末班地铁 · 导出 1', model: 'video-01', origin: 'video-edit', videoProjectId: 'vp1', fileId: 'f3' } },
      { id: 'n35', type: 'videoEdit', position: { x: 0, y: 0 }, data: { timeline: [1], draft: '内部时间轴' } }, // 第八轮：快照保留 videoEdit（仅结构字段，spec:228）
      { id: 'n4', type: 'multiImageGen', position: { x: 0, y: 0 }, data: { prompt: '分镜提示', images: [{ url: 'u' }], generationBatchId: 'g4', nodeStatus: 'done' } },
      // O0c-1 派生输入完备夹具：storyboard 组带完整 config+collapsed；g2=折叠 manual 组（collapsed:true——公开白名单两键都进 payload）
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', cells: ['n1', 'ghost-id', null], name: '分镜1', storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' }, collapsed: false } },
      { id: 'g2', type: 'group', position: { x: 500, y: 0 }, width: 320, height: 180, data: { groupType: 'normal', cells: ['n2'], name: '手动组', collapsed: true, savedSize: { width: 100, height: 60 } } },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
  };

  function setup(over: any = {}) {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ ...work, ...over });
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue({ id: 'p1' });
    prisma.media.findMany = vi.fn().mockResolvedValue([]);
    (service as any).collabDoc = { readCanvas: vi.fn().mockResolvedValue(rawCanvas) };
    // 第十轮：Map 支撑的 get/set——原 get 恒 null + set 空 vi.fn()，"缓存命中第二次不触 readCanvas"必红
    //（第二次 get 仍 null → 重算 → readCanvas 被调 2 次）。对照 Task 3.2 命中用例（mockResolvedValue('[]')）。
    const cache = new Map<string, string>();
    (service as any).redis.get = vi.fn(async (k: string) => cache.get(k) ?? null); // 未写过 → null（首调无缓存）
    (service as any).redis.set = vi.fn(async (k: string, v: string) => { cache.set(k, v); return 'OK'; });
  }

  it('键级断言：响应全 key 不含敏感字段（递归收集）', async () => {
    setup();
    const out = await service.getProcessSnapshot('w1');
    const collectKeys = (o: any): string[] =>
      Array.isArray(o) ? o.flatMap(collectKeys) :
      o && typeof o === 'object' ? [...Object.keys(o), ...Object.values(o).flatMap(collectKeys)] : [];
    const keys = collectKeys(out);
    for (const banned of ['html', 'fileId', 'mediaUrl', 'referencedImageIds', 'allImages', 'referenceImage', 'referenceVideo', 'referenceAudio', 'trimmedFileId', 'generationBatchId', 'mediaName', 'videoProjectId', 'origin', 'sourceId', 'storageKey', 'userId', 'email']) { // O0c-1：storageKey/userId/email 入泄漏红线
      expect(keys).not.toContain(banned);
    }
  });

  it('正向断言：textInput 纯文本 / imageGen prompt.text / videoGen label / multiImageGen prompt / group groupType+cells 原样（防 key 写错全绿——spec §7.6 全五类配对）', async () => {
    setup();
    const out = await service.getProcessSnapshot('w1');
    const n1 = out.nodes.find((n: any) => n.id === 'n1')!;
    const n2 = out.nodes.find((n: any) => n.id === 'n2')!;
    const n3 = out.nodes.find((n: any) => n.id === 'n3')!;
    const n4 = out.nodes.find((n: any) => n.id === 'n4')!;
    const g = out.nodes.find((n: any) => n.id === 'g1')!;
    expect(n1.data.content).toBe('一只猫在窗台上');
    expect(n2.data.prompt).toBe('cat');
    expect(n3.data.label).toBe('末班地铁 · 导出 1');
    expect(n4.data.prompt).toBe('分镜提示');
    expect(g.data.groupType).toBe('storyboard');
    expect(g.data.cells).toEqual(['n1', 'ghost-id', null]); // 原样返回逐项比对（含悬空 id/null——勿写"全项可在 nodes 中找到"，悬空 id 是已接受行为会红在已知项上）
    // O0c-1 派生输入完备：storyboard/collapsed 必须进公开 payload——缺任一，O0c-2 deriveRenderCanvas 派生退化 auto
    expect(g.data.storyboard).toEqual({ aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' });
    expect(g.data.collapsed).toBe(false);
    const g2 = out.nodes.find((n: any) => n.id === 'g2')!;
    expect(g2.data.collapsed).toBe(true);           // 折叠 manual 组公开面保折叠态（cs 折叠渲染档派生输入）
    expect(g2.data.savedSize).toBeUndefined();      // savedSize 折叠快照键公开面仍剥（键删归 O0c-3）
    const edit = out.nodes.find((n: any) => n.id === 'n35')!;
    expect(edit).toBeTruthy();      // videoEdit 节点保留（spec:228，第八轮）
    expect(edit.data).toEqual({});  // data 全剥（timeline/draft 不外泄）
  });

  it('edges 有 source/target 无 sourceId；缓存命中第二次不触 readCanvas', async () => {
    setup();
    const out = await service.getProcessSnapshot('w1');
    expect(out.edges[0]).toEqual({ id: 'e1', source: 'n1', target: 'n2' }); // 第十轮补：edges 正向断言（原只覆盖"无 sourceId"半边，与用例标题不符）
    await service.getProcessSnapshot('w1');
    const readCanvas = (service as any).collabDoc.readCanvas;
    expect(readCanvas).toHaveBeenCalledTimes(1);
  });

  it('DRAFT 或 allowViewProcess=false 或画布不存在 → 404', async () => {
    setup({ status: 'DRAFT' });
    await expect(service.getProcessSnapshot('w1')).rejects.toThrow(NotFoundException);
    setup({ allowViewProcess: false });
    await expect(service.getProcessSnapshot('w1')).rejects.toThrow(NotFoundException);
    setup();  // 第十一轮：mockResolvedValue 是替换语义——不复位则 allowViewProcess:false 残留，下一断言在第一守卫就 404，"画布不存在"分支零覆盖（假绿）
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue(null);
    await expect(service.getProcessSnapshot('w1')).rejects.toThrow(NotFoundException);
  });

  it('管线终点：injectThumbnails 注入的 thumbnailUrl 过滤后仍在节点 data 上、fileId 键级剥除', async () => {
    setup();
    prisma.media.findMany = vi.fn().mockResolvedValue([{ id: 'f1', thumbnailKey: 'thumbnails/f1.webp' }]);
    const out = await service.getProcessSnapshot('w1');
    const n2 = out.nodes.find((n: any) => n.id === 'n2')!; // n2 带 fileId:'f1'（rawCanvas）
    expect(n2.data.thumbnailUrl).toBe('http://minio/presigned'); // presign 返回值沿用文件级 setup 的 minio mock
    expect(n2.data).not.toHaveProperty('fileId'); // 注入阶段保留 → 白名单阶段剥除（管线顺序终点形态）
  });

  it('公开 payload 泄漏红线（O0c-1）：JSON 序列化无 fileId/storageKey/userId/email——媒体引用单通道 thumbnailUrl（cellNodes 公开载荷 [{id,thumbnailUrl}] 的 API 半边：fileId 不进 payload，web 侧映射归 O0c-2）', async () => {
    setup();
    prisma.media.findMany = vi.fn().mockResolvedValue([{ id: 'f1', thumbnailKey: 'thumbnails/f1.webp' }]);
    const out = await service.getProcessSnapshot('w1');
    const json = JSON.stringify(out);
    for (const banned of ['fileId', 'storageKey', 'userId', 'email']) {
      expect(json, `公开 payload 含泄漏键 ${banned}`).not.toContain(`"${banned}"`);
    }
    expect(json).toContain('thumbnailUrl'); // 公开页媒体通道（分镜格子取图走此键——主画布 fileId/公开页 thumbnailUrl 双通道）
  });

  it('下线失效双机制①（守卫优先于缓存）：DRAFT 翻转后即使缓存有残留也 404 且不触 readCanvas', async () => {
    setup();
    await service.getProcessSnapshot('w1'); // 第一次 PUBLISHED：生产缓存（redis Map 已写入键）+ readCanvas 1 次
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ ...work, status: 'DRAFT' }); // 只翻转状态——不重建 redis，缓存残留
    await expect(service.getProcessSnapshot('w1')).rejects.toThrow(NotFoundException);
    expect((service as any).collabDoc.readCanvas).toHaveBeenCalledTimes(1); // 守卫在缓存读取之前，未因缓存命中被短路
  });

  it('下线失效双机制②：updateWork → redis.del(videoWork:process:w1:v2)（写路径失效——O0b-0 键拼 schema 常量）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'DRAFT', publishedAt: null, allowViewProcess: false, allowClone: false, canvasProjectId: null });
    prisma.videoWork.update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await service.updateWork('w1', { title: 'x' } as any);
    expect((service as any).redis.del).toHaveBeenCalledWith(`videoWork:process:w1:v${CANVAS_DOC_SCHEMA_VERSION}`);
  });

  it('O0b-0：PROCESS_CACHE 键拼 schema 常量（翻转批 300s 窗口隔离——v1 旧空间载荷不命中新键）', async () => {
    setup();
    await service.getProcessSnapshot('w1');
    const setKey = (service as any).redis.set.mock.calls[0][0] as string;
    expect(setKey).toBe(`videoWork:process:w1:v${CANVAS_DOC_SCHEMA_VERSION}`);
  });

  it('readCanvas 挂起 → 有界超时 503', async () => {
    setup();
    (service as any).collabDoc.readCanvas = vi.fn().mockImplementation(() => new Promise(() => {})); // 永不 resolve
    await expect(service.getProcessSnapshot('w1')).rejects.toThrow(ServiceUnavailableException);
  }, 10000);
});

describe('presignVideo（admin 成品视频预签）', () => {
  const base = { fileName: 'final.mp4', fileSize: 1000, fileType: 'video/mp4' };

  it('语义校验在 service 抛中文（装饰器 message 是数组→前端只见 Bad Request Exception，中文到不了响应体）', async () => {
    await expect(service.presignVideo({ ...base, fileType: 'video/quicktime' } as any)).rejects.toThrow('仅支持 MP4 格式（video/mp4）');
    await expect(service.presignVideo({ ...base, fileSize: 0 } as any)).rejects.toThrow('文件为空');
    await expect(service.presignVideo({ ...base, fileSize: 1024 * 1024 * 1024 + 1 } as any)).rejects.toThrow('视频不得超过 1GB');
  });

  it('配额支点：quota.assertCanUpload 用 platform-team（勿改成管理员个人团队）', async () => {
    minio.buildKey = vi.fn().mockReturnValue('uploads/system/2026-09-18/a.mp4');
    prisma.media.create = vi.fn().mockResolvedValue({ id: 'm-vid' });
    minio.generatePresignedPost = vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:9000/flowai', fields: { key: 'uploads/system/2026-09-18/a.mp4' } });
    const res = await service.presignVideo({ ...base, fileName: 'x.TXT' } as any); // fileName 扩展名脏值也要过——ext 恒 mp4
    expect(res).toEqual({ fileId: 'm-vid', uploadUrl: 'http://127.0.0.1:9000/flowai', key: 'uploads/system/2026-09-18/a.mp4', fields: { key: 'uploads/system/2026-09-18/a.mp4' } });
    expect((service as any).quota.assertCanUpload).toHaveBeenCalledWith('platform-team', 1000);
    expect(minio.buildKey).toHaveBeenCalledWith('uploaded', 'system', { ext: 'mp4' });
    expect(prisma.media.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      userId: 'platform-owner', teamId: 'platform-team', type: 'uploaded', status: 'pending',
      key: 'uploads/system/2026-09-18/a.mp4', // 与预签 key 一致性钉子——confirm 的 statSize 事实源
      size: 1000, mimeType: 'video/mp4', originalName: 'x.TXT', expiresAt: null, // size 落库=confirm 大小事实源；禁 temp（7d 清理 footgun）
    }) }));
    expect(minio.generatePresignedPost).toHaveBeenCalledWith('uploads/system/2026-09-18/a.mp4', 'video/mp4', 1000, 3600); // expiresIn 3600（默认 900 慢网 1GB 会中途过期）
  });
});

describe('canvasCheck（admin 画布存在性回显）', () => {
  it('存在 + 个人画布 → ownerName=user.name', async () => {
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue({ id: 'p1', name: '我的画布', updatedAt: new Date('2026-09-01'), user: { name: '张三' }, team: { owner: { name: '张三' } } });
    const res = await service.canvasCheck('p1');
    expect(res).toMatchObject({ id: 'p1', name: '我的画布', ownerName: '张三' });
    expect(res.updatedAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('团队画布（userId=null）→ ownerName 回落 team.owner.name（不得出现 null）', async () => {
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue({ id: 'p2', name: '团队画布', updatedAt: new Date('2026-09-01'), user: null, team: { owner: { name: '老板' } } });
    const res = await service.canvasCheck('p2');
    expect(res.ownerName).toBe('老板');
  });

  it('不存在 → 404 画布不存在', async () => {
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue(null);
    await expect(service.canvasCheck('p-404')).rejects.toThrow(NotFoundException);
  });
});

describe('listAllWorks（edit 信息条封面支撑）', () => {
  it('coverKey 非空 → presign coverUrl（裸 /flowai/ key 在生产 403——桶非公开读）', async () => {
    prisma.videoWork.findMany = vi.fn().mockResolvedValue([{ id: 'w1', coverKey: 'uploads/system/c.jpg' }]);
    prisma.videoWork.count = vi.fn().mockResolvedValue(1);
    const res = await service.listAllWorks(1, 20);
    expect(res.items[0].coverUrl).toBe('http://minio/presigned'); // minio.generatePresignedGetUrl 文件级 mock 固定值
  });
  it('coverKey 空 → coverUrl null', async () => {
    prisma.videoWork.findMany = vi.fn().mockResolvedValue([{ id: 'w2', coverKey: null }]);
    prisma.videoWork.count = vi.fn().mockResolvedValue(1);
    const res = await service.listAllWorks(1, 20);
    expect(res.items[0].coverUrl).toBeNull();
  });
});

describe('createWork 画布校验 + F2 videoKey 不变量（顺序钉死：flags→画布→F2）', () => {
  it('画布不存在 → 400 画布不存在（findCanvasRef）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k', videoMediaId: 'm1', canvasProjectId: 'p-404' } as any))
      .rejects.toThrow('画布不存在');
  });

  it('canvasProjectId 空 → 不校验画布、允许创建（null 分支）', async () => {
    prisma.videoWork.create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k', videoMediaId: 'm1', canvasProjectId: undefined } as any)).resolves.toBeTruthy();
    expect(prisma.canvasProject.findUnique).not.toHaveBeenCalled();
  });

  it('F2：无 videoMediaId → 400（先于 media.findUnique）', async () => {
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k' } as any))
      .rejects.toThrow('视频文件不存在或未完成上传');
    expect(prisma.media.findUnique).not.toHaveBeenCalled();
  });

  it('F2 五条件 negative（默认匹配行之外的行 → 400，证明 beforeEach 行没架空断言）', async () => {
    for (const bad of [
      null,                                                                                 // 不存在
      { id: 'm1', key: 'k', status: 'completed', type: 'uploaded', teamId: 'platform-team', deletedAt: new Date() },   // 软删
      { id: 'm1', key: 'k', status: 'pending', type: 'uploaded', teamId: 'platform-team', deletedAt: null },           // 未完成
      { id: 'm1', key: 'k', status: 'completed', type: 'generated', teamId: 'platform-team', deletedAt: null },        // 非上传
      { id: 'm1', key: 'k', status: 'completed', type: 'uploaded', teamId: 'personal-team', deletedAt: null },         // 非平台团队
      { id: 'm1', key: 'other-key', status: 'completed', type: 'uploaded', teamId: 'platform-team', deletedAt: null }, // key 交叉不符
    ]) {
      prisma.media.findUnique.mockResolvedValueOnce(bad as any);
      await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k', videoMediaId: 'm1' } as any))
        .rejects.toThrow('视频文件不存在或未完成上传');
    }
  });

  it('F2：PK 查 mediaId（勿按 key 查——Media.key 无索引全表扫）', async () => {
    prisma.videoWork.create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await service.createWork({ title: 't', authorName: 'a', videoKey: 'k', videoMediaId: 'm1' } as any);
    expect(prisma.media.findUnique).toHaveBeenCalledWith({ where: { id: 'm1' } });
    expect(prisma.videoWork.create).toHaveBeenCalled();
  });
});

describe('updateWork 画布校验 dto-only 口径（勿用 merged——死画布存量作品连改标题都会 400）', () => {
  const existing = (over: Record<string, unknown> = {}) => ({ id: 'w1', status: 'DRAFT', publishedAt: null, allowViewProcess: false, allowClone: false, canvasProjectId: 'p-dead', ...over });

  it('显式传不存在的画布 → 400', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue(existing());
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    await expect(service.updateWork('w1', { canvasProjectId: 'p-404' } as any)).rejects.toThrow('画布不存在');
  });

  it('传 null → 跳过存在性校验、显式清除已存值（dto-only：null 是"显式清除"语义，undefined 才是不动）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue(existing());
    prisma.videoWork.update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await expect(service.updateWork('w1', { canvasProjectId: null } as any)).resolves.toBeTruthy();
    expect(prisma.canvasProject.findUnique).not.toHaveBeenCalled();
  });

  it('存量作品画布已删 + 仅改标题 → 成功（merged 口径下此用例红——旧语义容忍死画布，getDetail 用 canvasExists 降级不报错）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue(existing({ canvasProjectId: 'p-dead' }));
    prisma.videoWork.update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await expect(service.updateWork('w1', { title: '新标题' } as any)).resolves.toBeTruthy();
    expect(prisma.canvasProject.findUnique).not.toHaveBeenCalled(); // dto 未带画布 → 不查
  });

  it('顺序钉子：flags（merged）先于画布校验——allowClone 耦合带不存在画布时抛 flags 文案（画布抢跑则此用例红）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue(existing({ allowViewProcess: false }));
    prisma.canvasProject.findUnique.mockResolvedValue(null); // p-404 不存在——若画布校验抢跑会抛'画布不存在'而非 flags 文案
    await expect(service.updateWork('w1', { allowClone: true, canvasProjectId: 'p-404' } as any))
      .rejects.toThrow('允许克隆必须同时允许查看创作过程'); // merged：existing.allowViewProcess=false + dto.allowClone=true → flags 先抛
  });
});

describe('updateWork 换封面删旧（spec §4.6：DB 更新成功后才删旧对象）', () => {
  it('换封面：DB 更新后删旧封面对象（排他——被其他作品引用则不删）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'DRAFT', publishedAt: null, allowViewProcess: false, allowClone: false, canvasProjectId: null, coverKey: 'uploads/system/old.jpg' });
    prisma.videoWork.update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    prisma.videoWork.count = vi.fn().mockResolvedValue(0);
    await service.updateWork('w1', { coverKey: 'uploads/system/new.jpg' } as any);
    expect(minio.delete).toHaveBeenCalledWith('uploads/system/old.jpg');
  });

  it('换封面：旧 coverKey 被引用 → 不删（同一 key 挂多作品的防御性互斥）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'DRAFT', publishedAt: null, allowViewProcess: false, allowClone: false, canvasProjectId: null, coverKey: 'uploads/system/shared.jpg' });
    prisma.videoWork.update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    prisma.videoWork.count = vi.fn().mockResolvedValue(1); // 被另一作品引用
    await service.updateWork('w1', { coverKey: 'uploads/system/new.jpg' } as any);
    expect(minio.delete).not.toHaveBeenCalled();
  });
});
