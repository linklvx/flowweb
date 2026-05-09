import { Test, TestingModule } from '@nestjs/testing';
import { ContentController } from './content.controller';
import { AnnouncementController } from './announcement.controller';
import { ContentService } from './content.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ContentController', () => {
  let controller: ContentController;
  let service: {
    getCards: ReturnType<typeof vi.fn>;
    getActiveAnnouncement: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      getCards: vi.fn().mockResolvedValue([]),
      getActiveAnnouncement: vi.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContentController, AnnouncementController],
      providers: [{ provide: ContentService, useValue: service }],
    }).compile();

    controller = module.get<ContentController>(ContentController);
  });

  it('should return cards', async () => {
    service.getCards.mockResolvedValue([{ id: '1', title: 'Test' }]);
    const result = await controller.getCards();
    expect(result).toHaveLength(1);
  });
});

describe('AnnouncementController', () => {
  let controller: AnnouncementController;
  let service: {
    getCards: ReturnType<typeof vi.fn>;
    getActiveAnnouncement: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      getCards: vi.fn().mockResolvedValue([]),
      getActiveAnnouncement: vi.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContentController, AnnouncementController],
      providers: [{ provide: ContentService, useValue: service }],
    }).compile();

    controller = module.get<AnnouncementController>(AnnouncementController);
  });

  it('should return active announcement', async () => {
    service.getActiveAnnouncement.mockResolvedValue({ id: 'a1', message: 'Hello' });
    const result = await controller.getActiveAnnouncement();
    expect(result!.message).toBe('Hello');
  });
});
