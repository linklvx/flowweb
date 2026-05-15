import { Test, TestingModule } from '@nestjs/testing';
import { TemplateService } from './template.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectService } from '../project/project.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

describe('TemplateService', () => {
  let service: TemplateService;
  let prisma: {
    template: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
    };
    canvasProject: {
      findFirst: ReturnType<typeof vi.fn>;
    };
    user: {
      upsert: ReturnType<typeof vi.fn>;
    };
  };
  let projectService: {
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    prisma = {
      template: {
        create: vi.fn().mockResolvedValue({ id: 't1', name: 'Test', userId: 'u1', isPublic: false }),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
        upsert: vi.fn().mockResolvedValue({}),
      },
      canvasProject: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      user: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    projectService = {
      findById: vi.fn().mockResolvedValue({
        id: 'p1', userId: 'u1', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
      }),
      create: vi.fn().mockImplementation((name: string) => Promise.resolve({ id: 'p2', name })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectService, useValue: projectService },
      ],
    }).compile();

    service = module.get<TemplateService>(TemplateService);
  });

  describe('create', () => {
    it('should create template when user owns the project', async () => {
      const result = await service.create(
        { projectId: 'p1', name: 'My Template', isPublic: false },
        'u1',
      );
      expect(prisma.template.create).toHaveBeenCalled();
      expect(result.id).toBe('t1');
    });

    it('should throw ForbiddenException when user does not own project', async () => {
      await expect(
        service.create({ projectId: 'p1', name: 'Test' }, 'other-user'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow saving project with null userId (existing projects)', async () => {
      projectService.findById.mockResolvedValue({
        id: 'p1', userId: null, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
      });
      const result = await service.create({ projectId: 'p1', name: 'Test' }, 'any-user');
      expect(prisma.template.create).toHaveBeenCalled();
    });
  });

  describe('findMany', () => {
    it('should return paginated results with isOwner flag', async () => {
      prisma.template.findMany.mockResolvedValue([
        { id: 't1', name: 'T1', userId: 'u1', isPublic: true, importCount: 5,
          category: 'OFFICIAL', description: '', coverUrl: '',
          createdAt: new Date(), updatedAt: new Date() },
      ]);
      prisma.template.count.mockResolvedValue(1);
      const result = await service.findMany({ type: 'official', page: 1, limit: 20 }, 'u1');
      expect(result.templates[0].isOwner).toBe(true);
      expect(result.total).toBe(1);
    });

    it('should filter by type=my', async () => {
      prisma.template.count.mockResolvedValue(0);
      await service.findMany({ type: 'my', page: 1, limit: 20 }, 'u1');
      const callArgs = prisma.template.findMany.mock.calls[0][0];
      expect(callArgs.where.userId).toBe('u1');
    });
  });

  describe('getTemplate', () => {
    it('should return template if public', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', isPublic: true, userId: 'creator' });
      const result = await service.getTemplate('t1', 'other-user');
      expect(result.id).toBe('t1');
    });

    it('should throw ForbiddenException if private and not creator', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', isPublic: false, userId: 'creator' });
      await expect(service.getTemplate('t1', 'other-user')).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if template does not exist', async () => {
      prisma.template.findUnique.mockResolvedValue(null);
      await expect(service.getTemplate('nonexistent', 'u1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update when user is creator', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1' });
      await service.update('t1', { name: 'Updated' }, 'u1');
      expect(prisma.template.update).toHaveBeenCalledWith({
        where: { id: 't1' }, data: { name: 'Updated' },
      });
    });

    it('should throw ForbiddenException when not creator', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'creator' });
      await expect(
        service.update('t1', { name: 'Hacked' }, 'other-user'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('delete', () => {
    it('should delete when user is creator', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1' });
      await service.delete('t1', 'u1');
      expect(prisma.template.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });

    it('should throw ForbiddenException when not creator', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'creator' });
      await expect(service.delete('t1', 'other-user')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('import', () => {
    const validTemplate = {
      id: 't1', name: 'Test Template', isPublic: true, userId: 'creator',
      templateData: {
        nodes: [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { text: 'hi' } }],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    };

    it('should import public template and create project', async () => {
      prisma.template.findUnique.mockResolvedValue(validTemplate);
      const result = await service.import('t1', 'other-user');
      expect(projectService.create).toHaveBeenCalled();
      expect(prisma.template.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { importCount: { increment: 1 } },
      });
      expect(result.name).toBe('Test Template (副本)');
    });

    it('should throw ForbiddenException if private and not creator', async () => {
      prisma.template.findUnique.mockResolvedValue({ ...validTemplate, isPublic: false });
      await expect(service.import('t1', 'other-user')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('initOfficialTemplates', () => {
    it('should upsert official templates', async () => {
      await service.initOfficialTemplates();
      expect(prisma.template.upsert).toHaveBeenCalled();
    });
  });
});
