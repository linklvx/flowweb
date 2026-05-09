import { Test, TestingModule } from '@nestjs/testing';
import { ContentService } from './content.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ContentService', () => {
  let service: ContentService;
  let prisma: {
    contentCard: { findMany: ReturnType<typeof vi.fn> };
    announcement: { findFirst: ReturnType<typeof vi.fn> };
  };

  beforeEach(async () => {
    prisma = {
      contentCard: { findMany: vi.fn() },
      announcement: { findFirst: vi.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  describe('getCards', () => {
    it('should return active cards sorted by sortOrder', async () => {
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

  describe('getActiveAnnouncement', () => {
    it('should return the active announcement', async () => {
      const mockAnnounce = { id: 'a1', message: 'Test', linkUrl: null, active: true, createdAt: new Date(), updatedAt: new Date() };
      prisma.announcement.findFirst.mockResolvedValue(mockAnnounce);

      const result = await service.getActiveAnnouncement();
      expect(result).toEqual(mockAnnounce);
    });

    it('should return null when no active announcement', async () => {
      prisma.announcement.findFirst.mockResolvedValue(null);
      const result = await service.getActiveAnnouncement();
      expect(result).toBeNull();
    });
  });
});
