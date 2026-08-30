import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AdminAnnouncementController } from './admin-announcement.controller';
import { ContentService } from './content.service';

describe('AdminAnnouncementController', () => {
  let controller: AdminAnnouncementController;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    service = {
      listAnnouncements: vi.fn().mockResolvedValue([]),
      createAnnouncement: vi.fn().mockResolvedValue({ id: 'a1' }),
      updateAnnouncement: vi.fn().mockResolvedValue({ id: 'a1' }),
      deleteAnnouncement: vi.fn().mockResolvedValue({ id: 'a1' }),
      getCards: vi.fn(),
      getActiveAnnouncement: vi.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminAnnouncementController],
      providers: [{ provide: ContentService, useValue: service }],
    }).compile();
    controller = module.get(AdminAnnouncementController);
  });

  it('GET 列表转发 service.listAnnouncements', async () => {
    service.listAnnouncements.mockResolvedValue([{ id: 'a1' }]);
    expect(await controller.list()).toEqual([{ id: 'a1' }]);
  });

  it('POST 转发 dto 到 createAnnouncement', async () => {
    const dto = { message: 'm', active: true };
    await controller.create(dto);
    expect(service.createAnnouncement).toHaveBeenCalledWith(dto);
  });

  it('PATCH 转发 id 与 dto', async () => {
    await controller.update('a1', { active: false });
    expect(service.updateAnnouncement).toHaveBeenCalledWith('a1', { active: false });
  });

  it('DELETE 转发 id', async () => {
    await controller.remove('a1');
    expect(service.deleteAnnouncement).toHaveBeenCalledWith('a1');
  });
});
