import { Test, TestingModule } from '@nestjs/testing';
import { ProjectService } from './project.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ProjectService', () => {
  let service: ProjectService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      canvasProject: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      canvasNode: {
        createMany: vi.fn(),
        deleteMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      canvasEdge: {
        createMany: vi.fn(),
        deleteMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
  });

  describe('create', () => {
    it('should create a project with given name', async () => {
      const mockProject = { id: 'p1', name: '未命名项目', viewport: { x: 0, y: 0, zoom: 1 }, createdAt: new Date(), updatedAt: new Date() };
      const mockProjectFull = { ...mockProject, nodes: [], edges: [] };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProjectFull);

      const result = await service.create('未命名项目');
      expect(result.id).toBe('p1');
      expect(result.name).toBe('未命名项目');
    });
  });

  describe('findById', () => {
    it('should return project with nodes and edges', async () => {
      const mockProject = { id: 'p1', name: 'Test', nodes: [], edges: [], viewport: {}, createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      const result = await service.findById('p1');
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it('should throw NotFoundException when project missing', async () => {
      prisma.canvasProject.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id')).rejects.toThrow();
    });
  });

  describe('syncNodes', () => {
    it('should delete existing nodes and create new ones', async () => {
      await service.syncNodes('p1', [
        { id: 'n1', type: 'text', position: { x: 100, y: 200 }, data: { content: 'hello' } },
      ]);

      expect(prisma.canvasNode.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
      expect(prisma.canvasNode.createMany).toHaveBeenCalled();
    });

    it('should handle empty nodes array', async () => {
      await service.syncNodes('p1', []);
      expect(prisma.canvasNode.deleteMany).toHaveBeenCalled();
      expect(prisma.canvasNode.createMany).not.toHaveBeenCalled();
    });
  });

  describe('syncEdges', () => {
    it('should delete existing edges and create new ones', async () => {
      await service.syncEdges('p1', [
        { id: 'e1', sourceId: 'n1', targetId: 'n2' },
      ]);

      expect(prisma.canvasEdge.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
      expect(prisma.canvasEdge.createMany).toHaveBeenCalled();
    });
  });

  describe('updateViewport', () => {
    it('should update viewport on project', async () => {
      prisma.canvasProject.update.mockResolvedValue({ id: 'p1', viewport: { x: 10, y: 20, zoom: 1.5 } });
      await service.updateViewport('p1', { x: 10, y: 20, zoom: 1.5 });
      expect(prisma.canvasProject.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { viewport: { x: 10, y: 20, zoom: 1.5 } },
      });
    });
  });

  describe('delete', () => {
    it('should delete project by id', async () => {
      prisma.canvasProject.delete.mockResolvedValue({ id: 'p1' });
      await service.delete('p1');
      expect(prisma.canvasProject.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    });
  });
});
