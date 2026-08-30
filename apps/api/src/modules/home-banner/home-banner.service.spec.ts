import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { HomeBannerService } from './home-banner.service';

const ROW = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  title: null,
  subtitle: null,
  linkUrl: null,
  imageKey: 'uploads/system/x.jpg',
  sortOrder: 0,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

describe('HomeBannerService', () => {
  let service: HomeBannerService;
  let prisma: { homeBanner: Record<string, ReturnType<typeof vi.fn>> };
  let minio: { generatePresignedGetUrl: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = {
      homeBanner: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(ROW()),
        update: vi.fn().mockResolvedValue(ROW()),
        delete: vi.fn().mockResolvedValue(ROW()),
      },
    };
    minio = {
      generatePresignedGetUrl: vi.fn().mockResolvedValue('http://minio/presigned'),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HomeBannerService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
      ],
    }).compile();
    service = module.get(HomeBannerService);
  });

  it('listActive 只取启用行，按 sortOrder 升序，逐行生成 3600s presign', async () => {
    prisma.homeBanner.findMany.mockResolvedValue([ROW({ id: 'b1', sortOrder: 1 }), ROW({ id: 'b2', sortOrder: 2 })]);
    const r = await service.listActive();
    expect(prisma.homeBanner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    );
    expect(minio.generatePresignedGetUrl).toHaveBeenCalledWith('uploads/system/x.jpg', 3600);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ id: 'b1', imageUrl: 'http://minio/presigned' });
  });

  it('listAll 不筛 active，同样附 presign URL', async () => {
    prisma.homeBanner.findMany.mockResolvedValue([ROW({ active: false })]);
    const r = await service.listAll();
    expect(prisma.homeBanner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    );
    expect(r[0]).toMatchObject({ imageUrl: 'http://minio/presigned' });
  });

  it('create 应用默认值（sortOrder=0 active=true，可空字段 null）', async () => {
    await service.create({ imageKey: 'k' });
    expect(prisma.homeBanner.create).toHaveBeenCalledWith({
      data: {
        title: null,
        subtitle: null,
        linkUrl: null,
        imageKey: 'k',
        sortOrder: 0,
        active: true,
      },
    });
  });

  it('update 更换 imageKey 时删除旧对象', async () => {
    prisma.homeBanner.findUnique.mockResolvedValue(ROW({ imageKey: 'old.jpg' }));
    await service.update('b1', { imageKey: 'new.jpg' });
    expect(minio.delete).toHaveBeenCalledWith('old.jpg');
    expect(prisma.homeBanner.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: expect.objectContaining({ imageKey: 'new.jpg' }),
    });
  });

  it('update 不换图时不删对象', async () => {
    prisma.homeBanner.findUnique.mockResolvedValue(ROW());
    await service.update('b1', { title: 't' });
    expect(minio.delete).not.toHaveBeenCalled();
  });

  it('remove 先删 MinIO 对象再删 DB 行（失败可重试不留脏行）', async () => {
    prisma.homeBanner.findUnique.mockResolvedValue(ROW());
    await service.remove('b1');
    expect(minio.delete).toHaveBeenCalledWith('uploads/system/x.jpg');
    expect(prisma.homeBanner.delete).toHaveBeenCalledWith({ where: { id: 'b1' } });
    const order = [minio.delete.mock.invocationCallOrder[0], prisma.homeBanner.delete.mock.invocationCallOrder[0]];
    expect(order[0]).toBeLessThan(order[1]);
  });

  it('remove MinIO 删除抛错时不删 DB 行', async () => {
    prisma.homeBanner.findUnique.mockResolvedValue(ROW());
    minio.delete.mockRejectedValue(new Error('network'));
    await expect(service.remove('b1')).rejects.toThrow('network');
    expect(prisma.homeBanner.delete).not.toHaveBeenCalled();
  });

  it('remove/update 不存在的 id 抛 NotFoundException', async () => {
    await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    await expect(service.update('nope', { title: 't' })).rejects.toThrow(NotFoundException);
  });
});
