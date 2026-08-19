import { Test, TestingModule } from '@nestjs/testing';
import { FolderController } from './folder.controller';
import { FolderService } from './folder.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

describe('FolderController', () => {
  let controller: FolderController;
  let service: any;
  const req = (id?: string) => ({ user: id ? { id } : undefined });

  beforeEach(async () => {
    service = {
      list: vi.fn().mockResolvedValue({ folders: [] }),
      create: vi.fn().mockResolvedValue({ id: 'f1', name: 'n' }),
      rename: vi.fn().mockResolvedValue({ id: 'f1', name: 'n2' }),
      remove: vi.fn().mockResolvedValue({ movedCanvasCount: 2 }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FolderController],
      providers: [{ provide: FolderService, useValue: service }],
    }).compile();
    controller = module.get<FolderController>(FolderController);
  });

  it('GET 未登录抛 Unauthorized', async () => {
    await expect(controller.list(req() as any)).rejects.toThrow(UnauthorizedException);
  });

  it('GET 登录返回列表', async () => {
    const result = await controller.list(req('u1') as any);
    expect(service.list).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ folders: [] });
  });

  it('POST 校验并创建', async () => {
    const result = await controller.create({ name: '工作' }, req('u1') as any);
    expect(service.create).toHaveBeenCalledWith('工作', 'u1');
    expect(result).toEqual({ id: 'f1', name: 'n' });
  });

  it('PATCH 重命名', async () => {
    await controller.rename('f1', { name: '新名' }, req('u1') as any);
    expect(service.rename).toHaveBeenCalledWith('f1', '新名', 'u1');
  });

  it('DELETE 返回 movedCanvasCount', async () => {
    const result = await controller.remove('f1', req('u1') as any);
    expect(service.remove).toHaveBeenCalledWith('f1', 'u1');
    expect(result).toEqual({ movedCanvasCount: 2 });
  });
});
