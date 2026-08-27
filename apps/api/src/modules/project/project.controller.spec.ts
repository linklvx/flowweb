import { Test, TestingModule } from '@nestjs/testing';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ProjectController', () => {
  let controller: ProjectController;
  let service: any;

  beforeEach(async () => {
    service = {
      create: vi.fn().mockResolvedValue({ id: 'p1', name: 'test' }),
      findById: vi.fn().mockResolvedValue({ id: 'p1', nodes: [], edges: [] }),
      updateName: vi.fn().mockResolvedValue({ id: 'p1', name: 'updated' }),
      delete: vi.fn().mockResolvedValue({}),
      getProjectFolder: vi.fn().mockResolvedValue({ folderId: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectController],
      providers: [{ provide: ProjectService, useValue: service }],
    }).compile();

    controller = module.get<ProjectController>(ProjectController);
  });

  it('POST /api/projects should create project（带登录 userId）', async () => {
    const result = await controller.create({ name: 'test' }, { user: { id: 'u1' } } as any);
    expect(result.id).toBe('p1');
    expect(service.create).toHaveBeenCalledWith('test', 'u1');
  });

  it('POST /api/projects should default name to 未命名项目', async () => {
    await controller.create({ name: '' }, { user: { id: 'u1' } } as any);
    expect(service.create).toHaveBeenCalledWith('未命名项目', 'u1');
  });

  it('GET /api/projects/:id should return project with nodes and edges', async () => {
    const result = await controller.getProject('p1');
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('edges');
  });

  it('GET /api/projects/:id/folder 登录时透传 userId', async () => {
    await controller.getProjectFolder('p1', { user: { id: 'u1' } } as any);
    expect(service.getProjectFolder).toHaveBeenCalledWith('p1', 'u1');
  });

  it('GET /api/projects/:id/folder 未登录时透传 undefined', async () => {
    await controller.getProjectFolder('p1', {} as any);
    expect(service.getProjectFolder).toHaveBeenCalledWith('p1', undefined);
  });

  it('PUT /api/projects/:id/viewport 窗口期 no-op 200', async () => {
    const result = await controller.updateViewport('p1', { viewport: { x: 10, y: 20, zoom: 1.5 } });
    expect(result).toEqual({ success: true });
  });

  it('PATCH /api/projects/:id should update project name', async () => {
    const result = await controller.updateName('p1', { name: '新名字' });
    expect(result.id).toBe('p1');
    expect(service.updateName).toHaveBeenCalledWith('p1', '新名字');
  });

  it('DELETE /api/projects/:id should delete project', async () => {
    await controller.delete('p1');
    expect(service.delete).toHaveBeenCalledWith('p1');
  });
});

describe('PUT :id/canvas', () => {
  it('窗口期 no-op 200：丢弃 nodes/edges，echo version（Task15 退役）', async () => {
    const controller = new ProjectController({} as any);
    const body = { nodes: [{ id: 'n1' }], edges: [], version: 3 };
    const result = await controller.syncCanvas('p1', body);
    expect(result).toEqual({ version: 3 });
  });
});
