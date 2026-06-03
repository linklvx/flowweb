import { Test, TestingModule } from '@nestjs/testing';
import { FolderController } from './folder.controller';
import { FolderService } from '../services/folder.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('FolderController', () => {
  let controller: FolderController;
  let service: any;

  beforeEach(async () => {
    service = {
      create: vi.fn(),
      findAllByUserId: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      moveUp: vi.fn(),
      moveFolder: vi.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FolderController],
      providers: [{ provide: FolderService, useValue: service }],
    }).compile();
    controller = module.get<FolderController>(FolderController);
  });

  const mockReq = (userId = 'user-1') => ({ user: { id: userId } }) as any;

  it('POST / should return { success: true, data }', async () => {
    service.create.mockResolvedValue({ id: 'f-1', name: 'Test' });
    const res = await controller.create({ name: 'Test' }, mockReq());
    expect(res).toEqual({ success: true, data: { id: 'f-1', name: 'Test' } });
  });

  it('GET / should return { success: true, data }', async () => {
    service.findAllByUserId.mockResolvedValue([{ id: 'f-1' }]);
    const res = await controller.findAll(mockReq());
    expect(res).toEqual({ success: true, data: [{ id: 'f-1' }] });
  });

  it('PUT /:id should return { success: true, data }', async () => {
    service.update.mockResolvedValue({ id: 'f-1', name: 'Updated' });
    const res = await controller.update('f-1', { name: 'Updated' }, mockReq());
    expect(res).toEqual({ success: true, data: { id: 'f-1', name: 'Updated' } });
  });

  it('DELETE /:id should return { success: true }', async () => {
    service.remove.mockResolvedValue(undefined);
    const res = await controller.remove('f-1', mockReq());
    expect(res).toEqual({ success: true });
  });

  it('PUT /:id/move-up should return { success: true }', async () => {
    service.moveUp.mockResolvedValue(undefined);
    const res = await controller.moveUp('f-1', mockReq());
    expect(res).toEqual({ success: true });
  });

  it('PUT /:id/move should return { success: true }', async () => {
    service.moveFolder.mockResolvedValue(undefined);
    const res = await controller.move('f-1', { parentId: null, afterId: 'f-2' }, mockReq());
    expect(service.moveFolder).toHaveBeenCalledWith('f-1', { parentId: null, afterId: 'f-2' }, 'user-1');
    expect(res).toEqual({ success: true });
  });
});
