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
      updateViewport: vi.fn().mockResolvedValue({}),
      syncNodes: vi.fn().mockResolvedValue([]),
      syncEdges: vi.fn().mockResolvedValue([]),
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

  it('POST /api/projects should create project', async () => {
    const result = await controller.create({ name: 'test' });
    expect(result.id).toBe('p1');
    expect(service.create).toHaveBeenCalledWith('test');
  });

  it('POST /api/projects should default name to 未命名项目', async () => {
    await controller.create({ name: '' });
    expect(service.create).toHaveBeenCalledWith('未命名项目');
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

  it('PUT /api/projects/:id/viewport should update viewport', async () => {
    await controller.updateViewport('p1', { viewport: { x: 10, y: 20, zoom: 1.5 } });
    expect(service.updateViewport).toHaveBeenCalledWith('p1', { x: 10, y: 20, zoom: 1.5 });
  });

  it('PUT /api/projects/:id/nodes should sync nodes', async () => {
    const nodes = [{ id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: {} }];
    await controller.syncNodes('p1', { nodes });
    expect(service.syncNodes).toHaveBeenCalledWith('p1', nodes);
  });

  it('PUT /api/projects/:id/edges should sync edges', async () => {
    const edges = [{ id: 'e1', sourceId: 'n1', targetId: 'n2' }];
    await controller.syncEdges('p1', { edges });
    expect(service.syncEdges).toHaveBeenCalledWith('p1', edges);
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
