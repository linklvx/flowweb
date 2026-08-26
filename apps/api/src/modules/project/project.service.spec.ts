import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
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

describe('ProjectService.syncCanvas', () => {
  const mkTx = () => ({
    canvasProject: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    canvasNode: { deleteMany: vi.fn(), createMany: vi.fn() },
    canvasEdge: { deleteMany: vi.fn(), createMany: vi.fn() },
  });

  const mkService = (tx: ReturnType<typeof mkTx>) => {
    const prisma = {
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    };
    return { service: new ProjectService(prisma as any), prisma };
  };

  const nodes = [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }];
  const edges = [{ id: 'e1', source: 'n1', target: 'n2' }];

  it('version 匹配：事务内更新 nodes+edges，version+1 并返回', async () => {
    const tx = mkTx();
    tx.canvasProject.updateMany.mockResolvedValue({ count: 1 });
    const { service } = mkService(tx);
    const result = await service.syncCanvas('p1', nodes, edges, 3);
    expect(tx.canvasProject.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', version: 3 },
      data: { version: 4 },
    });
    expect(tx.canvasNode.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(tx.canvasEdge.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(tx.canvasNode.createMany).toHaveBeenCalled();
    expect(tx.canvasEdge.createMany).toHaveBeenCalled();
    expect(result).toEqual({ version: 4 });
  });

  it('保留客户端 node ID + parentId 父先子后排序', async () => {
    const tx = mkTx();
    tx.canvasProject.updateMany.mockResolvedValue({ count: 1 });
    const { service } = mkService(tx);
    const mixed = [
      { id: 'child', type: 'textInput', position: { x: 0, y: 0 }, data: {}, parentId: 'parent' },
      { id: 'parent', type: 'group', position: { x: 0, y: 0 }, data: {} },
    ];
    await service.syncCanvas('p1', mixed, [], 0);
    const arg = tx.canvasNode.createMany.mock.calls[0][0].data as any[];
    expect(arg[0].id).toBe('parent');
    expect(arg[1].id).toBe('child');
  });

  it('空 nodes/edges：deleteMany 后不 createMany', async () => {
    const tx = mkTx();
    tx.canvasProject.updateMany.mockResolvedValue({ count: 1 });
    const { service } = mkService(tx);
    await service.syncCanvas('p1', [], [], 0);
    expect(tx.canvasNode.createMany).not.toHaveBeenCalled();
    expect(tx.canvasEdge.createMany).not.toHaveBeenCalled();
  });

  it('version 不匹配：抛 ConflictException', async () => {
    const tx = mkTx();
    tx.canvasProject.updateMany.mockResolvedValue({ count: 0 });
    tx.canvasProject.findUnique.mockResolvedValue({ version: 9 });
    const { service } = mkService(tx);
    await expect(service.syncCanvas('p1', nodes, edges, 3)).rejects.toThrow(ConflictException);
    expect(tx.canvasNode.deleteMany).not.toHaveBeenCalled();
  });

  it('项目不存在：抛 NotFoundException', async () => {
    const tx = mkTx();
    tx.canvasProject.updateMany.mockResolvedValue({ count: 0 });
    tx.canvasProject.findUnique.mockResolvedValue(null);
    const { service } = mkService(tx);
    await expect(service.syncCanvas('p1', nodes, edges, 3)).rejects.toThrow(NotFoundException);
  });
});
