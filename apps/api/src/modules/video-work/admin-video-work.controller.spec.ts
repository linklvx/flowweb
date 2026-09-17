import { Test } from '@nestjs/testing';
import type { Mock } from 'vitest'; // 必须显式导入——vitest/globals 只声明运行时全局、无 Mock 类型（先例 canvas-doc-update.repository.spec.ts:2）
import { BadRequestException } from '@nestjs/common'; // 第十轮（C1-5）：Task 2.5 缺文件用例 toThrow 用
import { AdminVideoWorkController } from './admin-video-work.controller';
import { VideoWorkService } from './video-work.service';

describe('AdminVideoWorkController categories/tags', () => {
  let controller: AdminVideoWorkController;
  // 第八轮：Record<string, Mock>——原窄注解还是旧方法名（listCategories/listTags），与下方赋值（listAllCategories/listAllTags）
  // 是 TS2741+TS2353；且 Task 2.4/2.5/2.6 补方法时窄注解需逐任务 lockstep。Record 让后续任务直接加 vi.fn() 行即可。
  let service: Record<string, Mock>;

  beforeEach(async () => {
    service = {
      // 第七轮：方法名必须与 controller 实际调用一致——controller 是 listAllCategories()/listAllTags()
      // （admin 端返回全部含 inactive），mock 写 listCategories/listTags 是 TypeError（B1）
      listAllCategories: vi.fn().mockResolvedValue([]),
      createCategory: vi.fn().mockResolvedValue({ id: 'c1' }),
      updateCategory: vi.fn().mockResolvedValue({ id: 'c1' }),
      deleteCategory: vi.fn().mockResolvedValue(undefined),
      listAllTags: vi.fn().mockResolvedValue([]),
      createTag: vi.fn().mockResolvedValue({ id: 't1' }),
      updateTag: vi.fn().mockResolvedValue({ id: 't1' }),
      deleteTag: vi.fn().mockResolvedValue(undefined),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminVideoWorkController],
      providers: [{ provide: VideoWorkService, useValue: service }],
    }).compile();
    controller = moduleRef.get(AdminVideoWorkController);
  });

  it('GET categories 调 service.listAllCategories', async () => {
    await controller.listCategories();
    expect(service.listAllCategories).toHaveBeenCalled();
  });

  it('POST categories 传 DTO 给 service', async () => {
    await controller.createCategory({ name: 'AI真人影视', sortOrder: 0, active: true });
    expect(service.createCategory).toHaveBeenCalledWith({ name: 'AI真人影视', sortOrder: 0, active: true });
  });

  it('PUT categories/:id 与 DELETE categories/:id 透传', async () => {
    await controller.updateCategory('c1', { name: 'MV' });
    await controller.deleteCategory('c1');
    expect(service.updateCategory).toHaveBeenCalledWith('c1', { name: 'MV' });
    expect(service.deleteCategory).toHaveBeenCalledWith('c1');
  });

  it('tags 同构透传', async () => {
    await controller.listTags();
    await controller.createTag({ name: '悬疑', sortOrder: 0, active: true });
    await controller.updateTag('t1', { active: false });
    await controller.deleteTag('t1');
    expect(service.listAllTags).toHaveBeenCalled();
    expect(service.createTag).toHaveBeenCalledWith({ name: '悬疑', sortOrder: 0, active: true });
  });

  it('GET / 作品列表分页透传', async () => {
    service.listAllWorks = vi.fn().mockResolvedValue({ items: [], total: 0 });
    await controller.listWorks('1', '20');
    expect(service.listAllWorks).toHaveBeenCalledWith(1, 20);
  });

  it('DELETE 只调 removeWork（service 内不调 minio.delete——红线在 service 测试断言）', async () => {
    service.removeWork = vi.fn().mockResolvedValue(undefined);
    await controller.deleteWork('w1');
    expect(service.removeWork).toHaveBeenCalledWith('w1');
  });

  // 标题同步（原"categories/tags/candidates"已过期）+ 数组换名：'listCandidates' → 'canvasCheck'（删方法与去名必须同批，悬空名直接红）
  it('路由声明序：静态段（categories/tags/canvas-check/presign-video）先于作品 :id', () => {
    const proto = AdminVideoWorkController.prototype;
    const names = Object.getOwnPropertyNames(proto).filter(n => n !== 'constructor');
    const idRoutes = ['getWork', 'updateWork', 'deleteWork'].map(n => names.indexOf(n)).filter(i => i >= 0);
    const staticRoutes = ['listCategories', 'listTags', 'canvasCheck', 'uploadCover', 'getSettings', 'presignVideo'];
    for (const s of staticRoutes) {
      expect(names.indexOf(s)).toBeGreaterThan(-1);
      expect(Math.min(...idRoutes)).toBeGreaterThan(names.indexOf(s)); // :id 吃 GET 静态段（canvas-check 返回 200+null 而非 404）
    }
  });

  it('uploadCover 转发 service（buffer/mimetype）', async () => {
    service.uploadCover = vi.fn().mockResolvedValue({ key: 'uploads/system/xxx.webp' });
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // PNG 魔数头
    const res = await controller.uploadCover({ buffer: png, mimetype: 'image/png', originalname: 'x.png' } as any);
    expect(service.uploadCover).toHaveBeenCalledWith(png, 'image/png');
    expect(res.key).toContain('uploads/system/');
  });
  it('缺文件 → 400 file is required', async () => {
    await expect(controller.uploadCover(undefined as any)).rejects.toThrow(BadRequestException);
  });

  it('presign-video 转发 DTO 给 service', async () => {
    service.presignVideo = vi.fn().mockResolvedValue({ fileId: 'm1', uploadUrl: 'http://x', key: 'k', fields: {} });
    const res = await controller.presignVideo({ fileName: 'a.mp4', fileSize: 1, fileType: 'video/mp4' });
    expect(service.presignVideo).toHaveBeenCalledWith({ fileName: 'a.mp4', fileSize: 1, fileType: 'video/mp4' });
    expect(res.fileId).toBe('m1');
  });

  it('canvas-check 转发 query id', async () => {
    service.canvasCheck = vi.fn().mockResolvedValue({ id: 'p1', name: 'x', ownerName: null, updatedAt: '2026-09-01' });
    await controller.canvasCheck('p1');
    expect(service.canvasCheck).toHaveBeenCalledWith('p1');
  });
});
