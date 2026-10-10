import { Test } from '@nestjs/testing';
import type { Mock } from 'vitest'; // 显式导入（同 Task 2.1 注）
import { UnauthorizedException } from '@nestjs/common'; // 第十轮（C1-5）：Task 4.3 like 401 / 6.2 clone 401 用例 toThrow 用
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VideoWorkController } from './video-work.controller';
import { VideoWorkService } from './video-work.service';
import { VideoWorkCloneService } from './video-work-clone.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';
// 第七轮：controller 构造签名自 Task 1.3 一次到位（service+rateLimiter+cloneService）——providers 创建即完整，
// 后续任务只往 service mock 补方法，providers 永不二次编辑（第六轮"各任务追加 provider"的补丁作废）

describe('VideoWorkController（公开）', () => {
  let controller: VideoWorkController;
  let service: Record<string, Mock>;
  // 第十一轮：moduleRef 提升 describe 作用域——Task 6.2 的 clone 用例要从它取 VideoWorkCloneService 实例断言，
  // 局部 const 到不了后续追加的用例（原只活在注释里，不提升是 TS2304）
  let moduleRef: any;
  // service mock 随任务补齐 controller 实际调用的方法：getDetail(3.3)/recordView(4.2)/toggleLike(4.3)/getProcess(5.3)/clone(6.2)/getSettings(3.2 本任务即加)

  beforeEach(async () => {
    service = {
      listPublished: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      listCategoriesPublic: vi.fn().mockResolvedValue([]),
      getSettings: vi.fn().mockResolvedValue({ carouselEnabled: true, carouselScope: 'all' }),
      recordView: vi.fn().mockResolvedValue({ counted: true }),
      toggleLike: vi.fn().mockResolvedValue({ liked: true, likeCount: 1 }),
    };
    moduleRef = await Test.createTestingModule({
      controllers: [VideoWorkController],
      providers: [
        { provide: VideoWorkService, useValue: service },
        { provide: RateLimiterService, useValue: { getClientIp: vi.fn().mockReturnValue('1.2.3.4'), checkIpRateLimit: vi.fn().mockResolvedValue(true), checkUserRateLimit: vi.fn().mockResolvedValue(true) } },
        { provide: VideoWorkCloneService, useValue: { clone: vi.fn().mockResolvedValue({ projectId: 'new-p' }) } },
      ],
    }).compile();
    controller = moduleRef.get(VideoWorkController);
  });

  it('GET / 分页参数 clamp（pageSize=9999 → 50；page=0 → 1）', async () => {
    await controller.list(undefined, '0', '9999');
    expect(service.listPublished).toHaveBeenCalledWith(undefined, 1, 50);
  });

  it('GET /categories 已注册（声明顺序断言在 Task 3.3 首写 :id 路由时补——本任务 getDetail 尚不存在，indexOf=-1 恒红）', () => {
    const names = Object.getOwnPropertyNames(VideoWorkController.prototype).filter(n => n !== 'constructor');
    expect(names.indexOf('listCategories')).toBeGreaterThan(-1);
  });

  it('POST :id/view 传 getClientIp 结果给 service', async () => {
    await controller.recordView('w1', { headers: {} });
    expect(service.recordView).toHaveBeenCalledWith('w1', '1.2.3.4');
  });

  it('POST like 未登录 req.user 为空 → 401', async () => {
    await expect(controller.toggleLike('w1', { /* req 无 user */ } as any)).rejects.toThrow(UnauthorizedException);
  });

  it('POST :id/clone 未登录 req 无 user → 401', async () => {
    await expect(controller.clone('w1', { /* req 无 user */ } as any)).rejects.toThrow(UnauthorizedException);
  });

  it('POST :id/clone 登录 → 调 cloneService.clone(id, userId)', async () => {
    const cloneSvc = moduleRef.get(VideoWorkCloneService); // moduleRef 已在 Task 3.2 提升到 describe 作用域（第十一轮落实——原"提升即可"只活在注释，局部 const 到不了本用例是 TS2304）
    await controller.clone('w1', { user: { id: 'u1' } } as any);
    expect(cloneSvc.clone).toHaveBeenCalledWith('w1', 'u1');
  });

  // Y0b-2 T8（E71）：process 端点限流 30/min——源文本锚（storyboard.pipe.spec.ts:82 先例形态：
  // 装饰器元数据断言无既有约定，读源码文本钉住档位防回归）
  it('E71：GET :id/process 有 @Throttle({default:{limit:30,ttl:60_000}})', () => {
    const src = readFileSync(resolve(__dirname, 'video-work.controller.ts'), 'utf8');
    expect(src).toContain('@Throttle({ default: { limit: 30, ttl: 60_000 } })');
  });
});
