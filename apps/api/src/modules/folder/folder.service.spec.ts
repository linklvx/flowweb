import { Test, TestingModule } from '@nestjs/testing';
import { FolderService } from './folder.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('FolderService', () => {
  let service: FolderService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      folder: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'f1', name: '新建', userId: 'u1' }),
        update: vi.fn().mockResolvedValue({ id: 'f1', name: '改名' }),
        delete: vi.fn().mockResolvedValue({ id: 'f1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      template: { count: vi.fn().mockResolvedValue(0) },
      $transaction: vi.fn().mockResolvedValue([0, { id: 'f1' }]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FolderService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<FolderService>(FolderService);
  });

  it('list 返回聚合 canvasCount 与最近3张缩略图', async () => {
    prisma.folder.findMany.mockResolvedValue([
      {
        id: 'f1', name: '工作', parentId: null,
        createdAt: new Date('2026-08-01'), updatedAt: new Date('2026-08-18'),
        templates: [
          { id: 't1', coverUrl: 'http://a.png' },
          { id: 't2', coverUrl: null },
        ],
        _count: { templates: 5 },
      },
    ]);
    const result = await service.list('u1');
    expect(prisma.folder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1' },
      include: {
        templates: { take: 3, orderBy: { updatedAt: 'desc' }, select: { id: true, coverUrl: true } },
        _count: { select: { templates: true } },
      },
    }));
    expect(result.folders[0].canvasCount).toBe(5);
    expect(result.folders[0].thumbnails).toEqual([
      { id: 't1', coverUrl: 'http://a.png' },
      { id: 't2', coverUrl: null },
    ]);
  });

  it('create 同级重名抛 BadRequest', async () => {
    prisma.folder.findFirst.mockResolvedValue({ id: 'f1', name: '工作' });
    await expect(service.create('工作', 'u1')).rejects.toThrow(BadRequestException);
  });

  it('create 正常创建', async () => {
    const folder = await service.create('新文件夹', 'u1');
    expect(prisma.folder.create).toHaveBeenCalledWith({
      data: { name: '新文件夹', userId: 'u1' },
    });
    expect(folder.id).toBe('f1');
  });

  it('rename 排除自身的重名校验：同名其他文件夹存在才报错', async () => {
    prisma.folder.findFirst.mockImplementation(({ where }: any) => {
      // 第一次调用：查找原文件夹（有 id 字段且没有 not）
      if (where.id && typeof where.id === 'string') {
        return Promise.resolve({ id: 'f1', name: '旧名', parentId: null, userId: 'u1' });
      }
      // 第二次调用：查找重名（有 id.not）
      if (where.id?.not) {
        return Promise.resolve(null); // 没有重名
      }
      return Promise.resolve(null);
    });
    await service.rename('f1', '任何名', 'u1');
    expect(prisma.folder.findFirst).toHaveBeenLastCalledWith({
      where: { userId: 'u1', parentId: null, name: '任何名', id: { not: 'f1' } },
    });
  });

  it('rename 同名其他文件夹存在抛 BadRequest', async () => {
    prisma.folder.findFirst.mockImplementation(({ where }: any) =>
      where.id ? Promise.resolve({ id: 'f1', name: '旧名', parentId: null, userId: 'u1' }) : Promise.resolve({ id: 'f2' }),
    );
    await expect(service.rename('f1', '重名', 'u1')).rejects.toThrow(BadRequestException);
  });

  it('rename 非本人文件夹抛 NotFound', async () => {
    prisma.folder.findFirst.mockResolvedValue(null);
    await expect(service.rename('fx', '名', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('remove 在同事务内 count + delete，返回 movedCanvasCount', async () => {
    prisma.folder.findFirst.mockResolvedValue({ id: 'f1', userId: 'u1' });
    prisma.$transaction.mockResolvedValue([3, { id: 'f1' }]);
    const result = await service.remove('f1', 'u1');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(result).toEqual({ movedCanvasCount: 3 });
  });

  it('touch 显式更新 updatedAt（updateMany 不触发 @updatedAt）', async () => {
    await service.touch(['f1', 'f2', null]);
    expect(prisma.folder.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['f1', 'f2'] } },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('touch 空数组不发起查询', async () => {
    await service.touch([null]);
    expect(prisma.folder.updateMany).not.toHaveBeenCalled();
  });
});
