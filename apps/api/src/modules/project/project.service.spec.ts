import { Test, TestingModule } from '@nestjs/testing';
import { ProjectService } from './project.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamService } from '../team/team.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildLegacyDocState } from '../canvas/canvas-legacy.reader';

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
      team: { findFirst: vi.fn().mockResolvedValue({ id: 'team1' }) },
      canvasDoc: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        { provide: PrismaService, useValue: prisma },
        { provide: TeamService, useValue: { ensureDefaultTeam: vi.fn().mockResolvedValue({ id: 'team1' }) } },
      ],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
  });

  describe('create', () => {
    it('should create a project with given name', async () => {
      const mockProject = { id: 'p1', name: '未命名项目', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      const result = await service.create('未命名项目', 'u1');
      expect(result.id).toBe('p1');
      expect(result.name).toBe('未命名项目');
      expect(prisma.canvasProject.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: '未命名项目', teamId: 'team1' }),
      });
      expect(prisma.canvasDoc.create).not.toHaveBeenCalled();
    });

    it('带 nodes 时序列化写入 CanvasDoc', async () => {
      const mockProject = { id: 'p1', name: '未命名项目', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      const nodes = [{ id: 'n1', type: 'textInput', position: { x: 1, y: 2 }, data: { text: 'a' } }];
      const edges = [{ id: 'e1', source: 'n1', target: 'n2' }];
      await service.create('导入', 'u1', nodes, edges);
      expect(prisma.canvasDoc.create).toHaveBeenCalledWith({
        data: { projectId: 'p1', state: expect.any(Buffer) },
      });
    });
  });

  describe('findById', () => {
    it('should return project with nodes and edges', async () => {
      const mockProject = { id: 'p1', name: 'Test', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      const result = await service.findById('p1');
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it('从 CanvasDoc 反序列化 nodes/edges', async () => {
      const mockProject = { id: 'p1', name: 'Test', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);
      prisma.canvasDoc.findUnique.mockResolvedValue({
        projectId: 'p1',
        state: buildLegacyDocState(
          [{ id: 'n1', type: 'textInput', position: { x: 3, y: 4 }, data: { text: 'hi' } }],
          [{ id: 'e1', source: 'n1', target: 'n2' }],
        ),
      });

      const result = await service.findById('p1');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]).toMatchObject({ id: 'n1', type: 'textInput', data: { text: 'hi' } });
      expect(result.edges).toEqual([{ id: 'e1', sourceId: 'n1', targetId: 'n2' }]);
    });

    it('should throw NotFoundException when project missing', async () => {
      prisma.canvasProject.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id')).rejects.toThrow();
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
