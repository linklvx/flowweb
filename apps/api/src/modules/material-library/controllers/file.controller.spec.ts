import { Test, TestingModule } from '@nestjs/testing';
import { FileController } from './file.controller';
import { MaterialService } from '../services/material.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('FileController', () => {
  let controller: FileController;
  let service: any;

  beforeEach(async () => {
    service = {
      getFilesByFolderId: vi.fn(),
      moveFile: vi.fn(),
      toggleFavorite: vi.fn(),
      deleteFile: vi.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FileController],
      providers: [{ provide: MaterialService, useValue: service }],
    }).compile();
    controller = module.get<FileController>(FileController);
  });

  const mockReq = (userId = 'user-1') => ({ user: { id: userId } }) as any;

  it('GET / should return files in folder', async () => {
    service.getFilesByFolderId.mockResolvedValue([{ id: 'm-1' }]);
    const res = await controller.getFiles(mockReq(), 'folder-1');
    expect(res).toEqual({ success: true, data: [{ id: 'm-1' }] });
    expect(service.getFilesByFolderId).toHaveBeenCalledWith('user-1', 'folder-1', undefined, undefined);
  });

  it('GET / should work with null folderId', async () => {
    service.getFilesByFolderId.mockResolvedValue([]);
    const res = await controller.getFiles(mockReq());
    expect(service.getFilesByFolderId).toHaveBeenCalledWith('user-1', null, undefined, undefined);
    expect(res).toEqual({ success: true, data: [] });
  });

  it('GET / should forward non-empty type filter to service', async () => {
    service.getFilesByFolderId.mockResolvedValue([{ id: 'm-1', type: 'image' }]);
    const res = await controller.getFiles(mockReq(), 'folder-1', 'image');
    expect(service.getFilesByFolderId).toHaveBeenCalledWith('user-1', 'folder-1', 'image', undefined);
    expect(res).toEqual({ success: true, data: [{ id: 'm-1', type: 'image' }] });
  });

  it('GET / 应透传 teamId（团队成员浏览团队素材库）', async () => {
    service.getFilesByFolderId.mockResolvedValue([]);
    await controller.getFiles(mockReq(), undefined, undefined, 't-team');
    expect(service.getFilesByFolderId).toHaveBeenCalledWith('user-1', null, undefined, 't-team');
  });

  it('PUT /:id/move should move file', async () => {
    service.moveFile.mockResolvedValue({ id: 'm-1', folderId: 'folder-1' });
    const res = await controller.moveFile('m-1', { folderId: 'folder-1' }, mockReq());
    expect(res).toEqual({ success: true, data: { id: 'm-1', folderId: 'folder-1' } });
  });

  it('PUT /:id/move 应透传 teamId', async () => {
    service.moveFile.mockResolvedValue({ id: 'm-1' });
    await controller.moveFile('m-1', { folderId: 'folder-1', teamId: 't-team' }, mockReq());
    expect(service.moveFile).toHaveBeenCalledWith('user-1', 'm-1', 'folder-1', 't-team');
  });

  it('PUT /:id/toggle-favorite should toggle', async () => {
    service.toggleFavorite.mockResolvedValue({ id: 'm-1', isFavorite: true });
    const res = await controller.toggleFavorite('m-1', mockReq());
    expect(res).toEqual({ success: true, data: { id: 'm-1', isFavorite: true } });
  });

  it('DELETE /:id should delete file', async () => {
    service.deleteFile.mockResolvedValue({ id: 'm-1' });
    const res = await controller.deleteFile('m-1', mockReq());
    expect(res).toEqual({ success: true });
  });

  it('POST /batch-delete should batch delete and return count', async () => {
    service.deleteFiles = vi.fn().mockResolvedValue(3);
    const res = await controller.batchDelete({ ids: ['m-1', 'm-2', 'm-3'] }, mockReq());
    expect(service.deleteFiles).toHaveBeenCalledWith('user-1', ['m-1', 'm-2', 'm-3'], undefined);
    expect(res).toEqual({ success: true, count: 3 });
  });

  it('POST /batch-delete should handle empty array', async () => {
    service.deleteFiles = vi.fn().mockResolvedValue(0);
    const res = await controller.batchDelete({ ids: [] }, mockReq());
    expect(service.deleteFiles).toHaveBeenCalledWith('user-1', [], undefined);
    expect(res).toEqual({ success: true, count: 0 });
  });

  it('POST /batch-move should batch move and return count', async () => {
    service.moveFiles = vi.fn().mockResolvedValue(3);
    const res = await controller.batchMove({ ids: ['m-1', 'm-2'], folderId: 'folder-1' }, mockReq());
    expect(service.moveFiles).toHaveBeenCalledWith('user-1', ['m-1', 'm-2'], 'folder-1', undefined);
    expect(res).toEqual({ success: true, count: 3 });
  });

  it('POST /batch-move 应透传 teamId', async () => {
    service.moveFiles = vi.fn().mockResolvedValue(1);
    await controller.batchMove({ ids: ['m-1'], folderId: null, teamId: 't-team' }, mockReq());
    expect(service.moveFiles).toHaveBeenCalledWith('user-1', ['m-1'], null, 't-team');
  });

  it('POST /batch-move should handle null folderId', async () => {
    service.moveFiles = vi.fn().mockResolvedValue(2);
    const res = await controller.batchMove({ ids: ['m-1'], folderId: null }, mockReq());
    expect(service.moveFiles).toHaveBeenCalledWith('user-1', ['m-1'], null, undefined);
    expect(res).toEqual({ success: true, count: 2 });
  });
});
