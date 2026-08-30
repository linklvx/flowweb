import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentService } from './content.service';

describe('ContentService 公告 CRUD', () => {
  let service: ContentService;
  let prisma: {
    contentCard: { findMany: ReturnType<typeof vi.fn> };
    announcement: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    prisma = {
      contentCard: { findMany: vi.fn().mockResolvedValue([]) },
      announcement: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'a1' }),
        update: vi.fn().mockResolvedValue({ id: 'a1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        delete: vi.fn().mockResolvedValue({ id: 'a1' }),
      },
      $transaction: vi.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(ContentService);
  });

  it('getActiveAnnouncement 按 updatedAt 倒序取第一条', async () => {
    prisma.announcement.findFirst.mockResolvedValue({ id: 'a1', message: 'm' });
    const r = await service.getActiveAnnouncement();
    expect(r).toEqual({ id: 'a1', message: 'm' });
    expect(prisma.announcement.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: 'desc' } }),
    );
  });

  it('listAnnouncements 返回全部（按创建时间倒序）', async () => {
    prisma.announcement.findMany.mockResolvedValue([{ id: 'a1' }]);
    const r = await service.listAnnouncements();
    expect(r).toEqual([{ id: 'a1' }]);
    expect(prisma.announcement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });

  it('createAnnouncement 未启用：直接 create，不走事务', async () => {
    await service.createAnnouncement({ message: 'm' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.announcement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        message: 'm',
        bgColor: '#0f2761',
        textColor: '#ffffff',
        linkText: null,
        linkUrl: null,
        active: false,
      }),
    });
  });

  it('createAnnouncement active=true：事务内先禁用其他再创建（互斥）', async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    await service.createAnnouncement({ message: 'm', active: true });
    expect(prisma.announcement.updateMany).toHaveBeenCalledWith({
      where: { active: true },
      data: { active: false },
    });
    expect(prisma.announcement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ active: true }),
    });
  });

  it('updateAnnouncement active=true：事务内先禁用其他再更新（互斥）', async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    await service.updateAnnouncement('a1', { active: true });
    expect(prisma.announcement.updateMany).toHaveBeenCalledWith({
      where: { active: true },
      data: { active: false },
    });
    expect(prisma.announcement.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { active: true },
    });
  });

  it('updateAnnouncement 非启用字段：直接 update，不走事务', async () => {
    await service.updateAnnouncement('a1', { message: 'new' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.announcement.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { message: 'new' },
    });
  });

  it('互斥冲突（P2002）转 ConflictException', async () => {
    prisma.$transaction.mockRejectedValue({ code: 'P2002' });
    await expect(
      service.updateAnnouncement('a1', { active: true }),
    ).rejects.toThrow(ConflictException);
  });

  it('deleteAnnouncement 按 id 删除', async () => {
    await service.deleteAnnouncement('a1');
    expect(prisma.announcement.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
  });

  it('getCards 返回启用卡片并按 sortOrder 排序', async () => {
    const mockCards = [
      { id: '1', title: 'Card 1', coverUrl: 'url1', tags: ['推荐'], desc: 'desc1', sortOrder: 1, active: true, createdAt: new Date(), updatedAt: new Date() },
      { id: '2', title: 'Card 2', coverUrl: 'url2', tags: [], desc: 'desc2', sortOrder: 2, active: true, createdAt: new Date(), updatedAt: new Date() },
    ];
    prisma.contentCard.findMany.mockResolvedValue(mockCards);

    const result = await service.getCards();
    expect(result).toHaveLength(2);
    expect(prisma.contentCard.findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
  });
});
