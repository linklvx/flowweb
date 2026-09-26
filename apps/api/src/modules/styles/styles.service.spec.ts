import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StylesService } from './styles.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';

const mkPrisma = () => ({
  styleCategory: { findMany: vi.fn() },
  style: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  styleFavorite: {
    findMany: vi.fn(),
    findUnique: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  styleRecentUsage: {
    findMany: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
    update: vi.fn(),
  },
});

const mkMinio = () => ({ generatePresignedGetUrl: vi.fn().mockResolvedValue('/signed.png') });

describe('StylesService', () => {
  let service: StylesService;
  let prisma: ReturnType<typeof mkPrisma>;
  let minio: ReturnType<typeof mkMinio>;

  beforeEach(async () => {
    prisma = mkPrisma();
    minio = mkMinio();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StylesService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
      ],
    }).compile();
    service = module.get(StylesService);
  });

  describe('listCategories', () => {
    it('active 分类按 sortOrder asc', async () => {
      prisma.styleCategory.findMany.mockResolvedValue([{ id: 'c1', name: '摄影写真', sortOrder: 1 }]);
      const out = await service.listCategories();
      expect(prisma.styleCategory.findMany).toHaveBeenCalledWith({
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
      });
      expect(out).toEqual([{ id: 'c1', name: '摄影写真', sortOrder: 1 }]);
    });
  });

  describe('list', () => {
    it('tab=all：active 过滤+排序含 id tiebreaker+favorited 批量+presign', async () => {
      prisma.style.findMany.mockResolvedValue([
        { id: 's1', name: 'A', coverKey: 'k1', authorName: null, isCommercial: true, usageCount: 3, promptText: 'p1', active: true },
      ]);
      prisma.styleFavorite.findMany.mockResolvedValue([{ styleId: 's1' }]);
      const out = await service.list('u1', { tab: 'all', page: 1, pageSize: 20 });
      expect(prisma.style.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ active: true }),
        orderBy: [{ sortOrder: 'asc' }, { usageCount: 'desc' }, { id: 'asc' }],
      }));
      expect(out.items[0]).toMatchObject({ id: 's1', coverUrl: '/signed.png', favorited: true, promptText: 'p1' });
      expect(prisma.styleFavorite.findMany).toHaveBeenCalledWith({ where: { userId: 'u1', styleId: { in: ['s1'] } }, select: { styleId: true } });
    });

    it('tab=favorites：分页 join 行（styleFavorite.createdAt desc, id desc）——我的收藏时间倒序非全局收藏数', async () => {
      prisma.styleFavorite.findMany.mockResolvedValue([
        { id: 'f2', styleId: 's2', createdAt: new Date(), style: { id: 's2', name: 'B', coverKey: 'k2', authorName: null, isCommercial: false, usageCount: 0, promptText: 'p', active: true } },
      ]);
      prisma.styleFavorite.count.mockResolvedValue(1);
      const out = await service.list('u1', { tab: 'favorites', page: 1, pageSize: 20 });
      expect(prisma.styleFavorite.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'u1', style: { active: true } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0, take: 20,
      }));
      expect(out.items[0]).toMatchObject({ id: 's2' });
      expect(prisma.style.findMany).not.toHaveBeenCalled(); // 不走 style 主表分页
    });

    it('tab=recent：同构换 styleRecentUsage.lastUsedAt desc；favorited 按真实收藏集（用过≠收藏，P1-5）', async () => {
      prisma.styleRecentUsage.findMany.mockResolvedValue([
        { id: 'r1', styleId: 's2', lastUsedAt: new Date(), style: { id: 's2', name: 'B', coverKey: 'k2', authorName: null, isCommercial: false, usageCount: 0, promptText: 'p', active: true } },
      ]);
      prisma.styleRecentUsage.count.mockResolvedValue(1);
      prisma.styleFavorite.findMany.mockResolvedValue([]); // 未收藏过
      const out = await service.list('u1', { tab: 'recent', page: 1, pageSize: 20 });
      expect(prisma.styleRecentUsage.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'u1', style: { active: true } },
        orderBy: [{ lastUsedAt: 'desc' }, { id: 'desc' }],
      }));
      expect(out.items[0].favorited).toBe(false); // 钉死：recent 不硬编码 true
    });

    it('搜索在收藏 tab 同样生效（styleFilter 折入 relation filter，P1-6；recent 走同一 styleFilter 构造）', async () => {
      prisma.styleFavorite.findMany.mockResolvedValue([]);
      prisma.styleFavorite.count.mockResolvedValue(0);
      await service.list('u1', { tab: 'favorites', search: '胶片', commercialOnly: true, page: 1, pageSize: 20 });
      expect(prisma.styleFavorite.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'u1', style: { active: true, isCommercial: true, OR: expect.any(Array) } },
      }));
    });
  });

  describe('getById', () => {
    it('不存在/停用 → 404（钉死语义，spec §4.5）', async () => {
      prisma.style.findFirst.mockResolvedValue(null);
      await expect(service.getById('u1', 'sx')).rejects.toThrow(NotFoundException);
    });
  });

  describe('favorite', () => {
    it('favorited=true → createMany skipDuplicates（幂等无 P2002）', async () => {
      prisma.styleFavorite.createMany.mockResolvedValue({ count: 1 });
      const out = await service.favorite('u1', 's1', true);
      expect(prisma.styleFavorite.createMany).toHaveBeenCalledWith({
        data: [{ userId: 'u1', styleId: 's1' }], skipDuplicates: true,
      });
      expect(out).toEqual({ favorited: true });
    });

    it('favorited=false → deleteMany（0 行不抛）', async () => {
      prisma.styleFavorite.deleteMany.mockResolvedValue({ count: 0 });
      const out = await service.favorite('u1', 's1', false);
      expect(out).toEqual({ favorited: false });
    });
  });

  describe('use（D26 非事务三步）', () => {
    it('首次：create 成功 → updateMany 计数（where 折进 active）', async () => {
      prisma.style.findFirst.mockResolvedValue({ id: 's1', active: true, coverKey: 'k' });
      prisma.styleRecentUsage.create.mockResolvedValue({});
      const out = await service.use('u1', 's1');
      expect(prisma.styleRecentUsage.create).toHaveBeenCalledWith({ data: { userId: 'u1', styleId: 's1' } });
      expect(prisma.style.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', active: true }, data: { usageCount: { increment: 1 } },
      });
      expect(out.id).toBe('s1'); // 返回扁平 StyleListItem（H3 口径统一：测试/实现/前端三方一致）
    });

    it('重复使用：create 撞 P2002 → 退化 update lastUsedAt，不计数', async () => {
      prisma.style.findFirst.mockResolvedValue({ id: 's1', active: true, coverKey: 'k' });
      prisma.styleRecentUsage.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
      await service.use('u1', 's1');
      expect(prisma.styleRecentUsage.update).toHaveBeenCalledWith({
        where: { userId_styleId: { userId: 'u1', styleId: 's1' } },
        data: { lastUsedAt: expect.any(Date) },
      });
      expect(prisma.style.updateMany).not.toHaveBeenCalled();
    });

    it('停用/不存在 → 404', async () => {
      prisma.style.findFirst.mockResolvedValue(null);
      await expect(service.use('u1', 'sx')).rejects.toThrow(NotFoundException);
    });
  });
});
