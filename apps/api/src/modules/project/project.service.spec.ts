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
        findFirst: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      template: {
        findUnique: vi.fn(),
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

    it('persists parentId; parentless nodes written first (self-FK insert order)', async () => {
      await service.syncNodes('p1', [
        // 故意乱序：子节点在前 —— 实现须排序（无 parentId 先写）
        { id: 'n1', type: 'imageGen', position: { x: 10, y: 10 }, data: {}, parentId: 'g1' },
        { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: {} },
      ]);
      expect(prisma.canvasNode.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ id: 'g1', parentId: null }),
          expect.objectContaining({ id: 'n1', parentId: 'g1' }),
        ],
      });
    });

    it('无 width/height 的节点落库 null（空白节点动态尺寸不持久化）', async () => {
      await service.syncNodes('p1', [
        { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} },
      ]);

      expect(prisma.canvasNode.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'n1', width: null, height: null })],
      });
    });

    it('有 width/height 的节点原样透传', async () => {
      await service.syncNodes('p1', [
        { id: 'n2', type: 'imageGen', position: { x: 0, y: 0 }, data: {}, width: 548, height: 309 },
      ]);

      expect(prisma.canvasNode.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'n2', width: 548, height: 309 })],
      });
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

  describe('updateName', () => {
    it('should update project name', async () => {
      prisma.canvasProject.update.mockResolvedValue({ id: 'p1', name: '新项目名' });
      await service.updateName('p1', '新项目名');
      expect(prisma.canvasProject.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { name: '新项目名' },
      });
    });
  });

  describe('updateDimensions', () => {
    let txMock: any;

    beforeEach(() => {
      txMock = {
        canvasNode: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      prisma.$transaction = vi.fn((callback: any) => callback(txMock));
    });

    it('should update dimensions of existing nodes via updateMany', async () => {
      await service.updateDimensions('p1', [
        { id: 'n1', width: 300, height: 200 },
        { id: 'n2', width: 400, height: 300 },
      ]);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(txMock.canvasNode.updateMany).toHaveBeenCalledTimes(2);
      expect(txMock.canvasNode.updateMany).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { width: 300, height: 200 },
      });
      expect(txMock.canvasNode.updateMany).toHaveBeenCalledWith({
        where: { id: 'n2' },
        data: { width: 400, height: 300 },
      });
    });

    it('should not throw when node does not exist (updateMany returns count 0)', async () => {
      txMock.canvasNode.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateDimensions('p1', [{ id: 'nonexistent', width: 300, height: 200 }]),
      ).resolves.not.toThrow();
    });
  });

  describe('delete', () => {
    it('should delete project by id', async () => {
      prisma.canvasProject.delete.mockResolvedValue({ id: 'p1' });
      await service.delete('p1');
      expect(prisma.canvasProject.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    });
  });

  describe('cleanDrafts', () => {
    it('删除无 Template 关联且 24h 未更新的本人工程', async () => {
      prisma.canvasProject.deleteMany.mockResolvedValue({ count: 4 });
      const result = await service.cleanDrafts('u1');
      expect(prisma.canvasProject.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'u1',
          updatedAt: { lt: expect.any(Date) },
          templates: { none: {} },
        },
      });
      expect(result).toEqual({ deletedCount: 4 });
    });
  });

  describe('getProjectFolder', () => {
    it('属主项目返回 template 的 folderId', async () => {
      prisma.canvasProject.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.template.findUnique.mockResolvedValue({ folderId: 'f1' });

      const result = await service.getProjectFolder('p1', 'u1');

      expect(prisma.canvasProject.findFirst).toHaveBeenCalledWith({
        where: { id: 'p1', userId: 'u1' },
        select: { id: true },
      });
      expect(result).toEqual({ folderId: 'f1' });
    });

    it('非属主项目返回 null 且不查 template（不暴露存在性）', async () => {
      prisma.canvasProject.findFirst.mockResolvedValue(null);

      const result = await service.getProjectFolder('p1', 'other-user');

      expect(result).toEqual({ folderId: null });
      expect(prisma.template.findUnique).not.toHaveBeenCalled();
    });

    it('未登录（userId 空）直接返回 null 且不查库', async () => {
      const result = await service.getProjectFolder('p1', undefined);

      expect(result).toEqual({ folderId: null });
      expect(prisma.canvasProject.findFirst).not.toHaveBeenCalled();
    });

    it('无 template 记录返回 null', async () => {
      prisma.canvasProject.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.template.findUnique.mockResolvedValue(null);

      const result = await service.getProjectFolder('p1', 'u1');

      expect(result).toEqual({ folderId: null });
    });
  });
});
