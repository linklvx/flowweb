import { Test, TestingModule } from '@nestjs/testing';
import { ProjectService } from './project.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamService } from '../team/team.service';
import { CollabDocumentService } from '../collab/collab-document.service';
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
      teamMember: { findFirst: vi.fn().mockResolvedValue(null) },
      team: { findFirst: vi.fn().mockResolvedValue({ id: 'team1' }) },
      canvasDoc: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      projectMember: { create: vi.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = vi.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        { provide: PrismaService, useValue: prisma },
        { provide: TeamService, useValue: { ensureDefaultTeam: vi.fn().mockResolvedValue({ id: 'team1' }) } },
        { provide: CollabDocumentService, useValue: { readCanvas: vi.fn(), withDoc: vi.fn() } },
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
    });

    it('带 nodes 时经 withDoc 直连写入', async () => {
      const mockProject = { id: 'p1', name: '未命名项目', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      const nodes = [{ id: 'n1', type: 'textInput', position: { x: 1, y: 2 }, data: { text: 'a' } }];
      const edges = [{ id: 'e1', source: 'n1', target: 'n2' }];
      const collabDoc = (service as any).collabDoc;
      await service.create('导入', 'u1', nodes, edges);
      expect(collabDoc.withDoc).toHaveBeenCalledWith('p1', expect.any(Function));
    });

    it('登录创建者写入 PROJECT_OWNER 成员记录', async () => {
      const mockProject = { id: 'p1', name: '未命名项目', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      await service.create('未命名项目', 'u1');
      expect(prisma.projectMember.create).toHaveBeenCalledWith({
        data: { projectId: 'p1', userId: 'u1', role: 'PROJECT_OWNER' },
      });
    });

    it('匿名创建（无 userId）不写成员记录', async () => {
      const mockProject = { id: 'p1', name: '未命名项目', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      await service.create('未命名项目', undefined);
      expect(prisma.projectMember.create).not.toHaveBeenCalled();
    });

    it('团队化：传 teamId 时校验成员并写入该团队', async () => {
      prisma.teamMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
      const mockProject = { id: 'p1', name: '团项目', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      await service.create('团项目', 'u1', undefined, undefined, 't-team');

      expect(prisma.teamMember.findFirst).toHaveBeenCalledWith({
        where: { teamId: 't-team', userId: 'u1', team: { status: 'ACTIVE' } },
        select: { role: true },
      });
      expect(prisma.canvasProject.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ teamId: 't-team' }),
      });
    });

    it('团队化：传非成员 teamId 抛 403', async () => {
      await expect(service.create('x', 'u1', undefined, undefined, 't-team')).rejects.toThrow('非团队成员');
      expect(prisma.canvasProject.create).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return project（Task13 起：画布内容走 Hocuspocus，不再随行返回）', async () => {
      const mockProject = { id: 'p1', name: 'Test', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      const result = await service.findById('p1');
      expect(result).not.toHaveProperty('nodes');
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
    it('teamId 匹配的项目返回 template 的 folderId', async () => {
      prisma.canvasProject.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.template.findUnique.mockResolvedValue({ folderId: 'f1' });

      const result = await service.getProjectFolder('p1', 'u1', 't1');

      expect(prisma.canvasProject.findFirst).toHaveBeenCalledWith({
        where: { id: 'p1', teamId: 't1' },
        select: { id: true },
      });
      expect(result).toEqual({ folderId: 'f1' });
    });

    it('teamId 不匹配返回 null 且不查 template（不暴露存在性）', async () => {
      prisma.canvasProject.findFirst.mockResolvedValue(null);

      const result = await service.getProjectFolder('p1', 'u1', 't-other');

      expect(result).toEqual({ folderId: null });
      expect(prisma.template.findUnique).not.toHaveBeenCalled();
    });

    it('未登录或 teamId 缺失直接返回 null 且不查库', async () => {
      const r1 = await service.getProjectFolder('p1', undefined, 't1');
      const r2 = await service.getProjectFolder('p1', 'u1', undefined);

      expect(r1).toEqual({ folderId: null });
      expect(r2).toEqual({ folderId: null });
      expect(prisma.canvasProject.findFirst).not.toHaveBeenCalled();
    });

    it('无 template 记录返回 null', async () => {
      prisma.canvasProject.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.template.findUnique.mockResolvedValue(null);

      const result = await service.getProjectFolder('p1', 'u1', 't1');

      expect(result).toEqual({ folderId: null });
    });
  });
});
