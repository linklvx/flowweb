import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { HomeBannerController } from './home-banner.controller';
import { AdminHomeBannerController } from './admin-home-banner.controller';
import { HomeBannerService } from './home-banner.service';
import { MinioService } from '../minio/minio.service';

describe('HomeBannerController（公开）', () => {
  it('GET active 转发 service.listActive', async () => {
    const svc = { listActive: vi.fn().mockResolvedValue([{ id: 'b1' }]) };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HomeBannerController],
      providers: [{ provide: HomeBannerService, useValue: svc }],
    }).compile();
    const controller = module.get(HomeBannerController);
    expect(await controller.listActive()).toEqual([{ id: 'b1' }]);
  });
});

describe('AdminHomeBannerController', () => {
  let adminController: AdminHomeBannerController;
  let svc: Record<string, ReturnType<typeof vi.fn>>;
  let minio: { buildKey: ReturnType<typeof vi.fn>; upload: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    svc = {
      listActive: vi.fn(),
      listAll: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'b1' }),
      update: vi.fn().mockResolvedValue({ id: 'b1' }),
      remove: vi.fn().mockResolvedValue({ id: 'b1' }),
    };
    minio = {
      buildKey: vi.fn().mockReturnValue('uploads/system/k.jpg'),
      upload: vi.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminHomeBannerController],
      providers: [
        { provide: HomeBannerService, useValue: svc },
        { provide: MinioService, useValue: minio },
      ],
    }).compile();
    adminController = module.get(AdminHomeBannerController);
  });

  it('GET 列表转发 listAll', async () => {
    svc.listAll.mockResolvedValue([{ id: 'b1' }]);
    expect(await adminController.list()).toEqual([{ id: 'b1' }]);
  });

  it('POST/DELETE 转发 service', async () => {
    await adminController.create({ imageKey: 'k' });
    expect(svc.create).toHaveBeenCalledWith({ imageKey: 'k' });
    await adminController.update('b1', { active: false });
    expect(svc.update).toHaveBeenCalledWith('b1', { active: false });
    await adminController.remove('b1');
    expect(svc.remove).toHaveBeenCalledWith('b1');
  });

  it('upload：magic number 校验通过后走 MinIO 并返回 imageKey', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const r = await adminController.upload({ buffer: png, mimetype: 'image/png' });
    expect(minio.upload).toHaveBeenCalledWith('uploads/system/k.jpg', png, 'image/png');
    expect(r).toEqual({ imageKey: 'uploads/system/k.jpg' });
  });

  it('upload：magic number 不匹配抛 BadRequestException', async () => {
    const bad = Buffer.from([0x00, 0x01, 0x02, 0x03, 4, 5, 6, 7, 8, 9, 10, 11]);
    await expect(
      adminController.upload({ buffer: bad, mimetype: 'image/png' }),
    ).rejects.toThrow('文件类型不匹配');
  });
});
