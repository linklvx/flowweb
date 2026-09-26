import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminStyleService } from './admin-style.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';

const mkPrisma = () => ({
  styleCategory: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  style: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(), // updateStyle/deleteStyle 前置存在性检查用
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
});
const mkMinio = () => ({
  buildKey: vi.fn().mockReturnValue('uploads/system/2026/x.png'),
  upload: vi.fn(),
  generatePresignedGetUrl: vi.fn().mockResolvedValue('/signed.png'),
  delete: vi.fn().mockResolvedValue(undefined), // 补默认 resolved（先例 video-work.service.spec.ts:42——裸 vi.fn() 返回 undefined，实现 await 链会 TypeError）
});

describe('AdminStyleService', () => {
  let service: AdminStyleService;
  let prisma: ReturnType<typeof mkPrisma>;
  let minio: ReturnType<typeof mkMinio>;

  beforeEach(async () => {
    prisma = mkPrisma();
    minio = mkMinio();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminStyleService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
      ],
    }).compile();
    service = module.get(AdminStyleService);
  });

  it('createCategory：重名 → 400 中文提示（folder.service 先例）', async () => {
    prisma.styleCategory.findUnique.mockResolvedValue({ id: 'c1' });
    await expect(service.createCategory({ name: '摄影写真' })).rejects.toThrow('分类已存在');
  });

  it('deleteCategory：下有风格（count>0）→ 400 阻止（material-library/services/folder.service.ts:93-94 先例）', async () => {
    prisma.styleCategory.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.style.count.mockResolvedValue(2);
    await expect(service.deleteCategory('c1')).rejects.toThrow(BadRequestException);
    expect(prisma.styleCategory.delete).not.toHaveBeenCalled();
  });

  it('deleteCategory：无风格 → 删除成功', async () => {
    prisma.styleCategory.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.style.count.mockResolvedValue(0);
    prisma.styleCategory.delete.mockResolvedValue({});
    await service.deleteCategory('c1');
    expect(prisma.styleCategory.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it('uploadCover：png magic-number 通过 → buildKey(\'uploaded\',\'system\')+upload+返回 key（video-work.service.ts:372-382 先例）', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
    const out = await service.uploadCover(png, 'image/png');
    expect(out).toEqual({ key: 'uploads/system/2026/x.png' });
    expect(minio.upload).toHaveBeenCalled();
  });

  it('uploadCover：非图片字节 → 400', async () => {
    await expect(service.uploadCover(Buffer.from('not-image'), 'text/plain')).rejects.toThrow('仅支持');
  });

  it('updateStyle：不存在 → 404', async () => {
    prisma.style.findUnique.mockResolvedValue(null);
    await expect(service.updateStyle('sx', {})).rejects.toThrow(NotFoundException);
  });

  it('deleteStyle：连带清封面对象（home-banner remove 先例）', async () => {
    prisma.style.findUnique.mockResolvedValue({ id: 's1', coverKey: 'k1' });
    prisma.style.delete.mockResolvedValue({});
    await service.deleteStyle('s1');
    expect(minio.delete).toHaveBeenCalledWith('k1');
    expect(prisma.style.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
  });

  it('listStyles：分页+分类/搜索过滤', async () => {
    prisma.style.findMany.mockResolvedValue([]);
    prisma.style.count.mockResolvedValue(0);
    await service.listStyles({ categoryId: 'c1', search: 'x', page: 1, pageSize: 20 });
    expect(prisma.style.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ categoryId: 'c1', OR: expect.any(Array) }),
      skip: 0, take: 20,
    }));
  });
});
