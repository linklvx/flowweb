import { Test, TestingModule } from '@nestjs/testing';
import { TemplateService } from './template.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectService } from '../project/project.service';
import { FolderService } from '../folder/folder.service';
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
    folder: {
      findFirst: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
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
  let folderService: {
    touch: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    prisma = {
      $transaction: vi.fn((ops: any[]) => Promise.resolve(ops.map(() => ({})))),
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
      folder: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
      },
      canvasProject: {
        findFirst: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue({}),
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
    folderService = {
      touch: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectService, useValue: projectService },
        { provide: FolderService, useValue: folderService },
      ],
    }).compile();

    service = module.get<TemplateService>(TemplateService);
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

    describe('findMany folderId 过滤', () => {
      it('type=my + folderId=root 过滤 folderId=null', async () => {
        prisma.template.findMany.mockResolvedValue([]);
        await service.findMany({ type: 'my', folderId: 'root' } as any, 'u1');
        expect(prisma.template.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ userId: 'u1', folderId: null }),
        }));
      });

      it('type=my + 具体 folderId 精确匹配', async () => {
        prisma.template.findMany.mockResolvedValue([]);
        await service.findMany({ type: 'my', folderId: 'f1' } as any, 'u1');
        expect(prisma.template.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ folderId: 'f1' }),
        }));
      });

      it('非 type=my 时 folderId 被忽略', async () => {
        prisma.template.findMany.mockResolvedValue([]);
        await service.findMany({ type: 'community', folderId: 'f1' } as any, 'u1');
        const where = prisma.template.findMany.mock.calls[0][0].where;
        expect(where.folderId).toBeUndefined();
      });
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

    describe('级联删除工程', () => {
      it('同事务删除 Template 与关联 CanvasProject，并 touch 文件夹', async () => {
        prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: 'f1', projectId: 'p1' });
        prisma.$transaction.mockResolvedValue([{}, {}]);
        await service.delete('t1', 'u1');
        const ops = prisma.$transaction.mock.calls[0][0];
        expect(ops).toHaveLength(2);
        expect(folderService.touch).toHaveBeenCalledWith(['f1']);
      });

      it('无关联工程时不删工程', async () => {
        prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: null, projectId: null });
        prisma.$transaction.mockResolvedValue([{}]);
        await service.delete('t1', 'u1');
        expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(1);
      });
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

  describe('update folderId 移动', () => {
    it('folderId 变化时校验目标文件夹归属并 touch 源与目标', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: 'f1' });
      prisma.folder.findFirst.mockResolvedValue({ id: 'f2', userId: 'u1' });
      prisma.template.update.mockResolvedValue({ id: 't1', folderId: 'f2' });
      await service.update('t1', { folderId: 'f2' } as any, 'u1');
      expect(prisma.folder.findFirst).toHaveBeenCalledWith({ where: { id: 'f2', userId: 'u1' } });
      expect(folderService.touch).toHaveBeenCalledWith(['f1', 'f2']);
    });

    it('目标文件夹非本人抛 BadRequest', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: null });
      prisma.folder.findFirst.mockResolvedValue(null);
      await expect(service.update('t1', { folderId: 'fx' } as any, 'u1')).rejects.toThrow(BadRequestException);
    });

    it('folderId 传 null 移到根目录，touch 源文件夹', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: 'f1' });
      prisma.template.update.mockResolvedValue({ id: 't1', folderId: null });
      await service.update('t1', { folderId: null } as any, 'u1');
      expect(prisma.template.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { folderId: null },
      });
      expect(folderService.touch).toHaveBeenCalledWith(['f1']);
    });

    it('改名时 touch 所在文件夹；isPublic 切换不 touch', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: 'f1' });
      prisma.template.update.mockResolvedValue({ id: 't1' });
      await service.update('t1', { name: '新名' } as any, 'u1');
      expect(folderService.touch).toHaveBeenCalledWith(['f1']);
      (folderService.touch as any).mockClear();
      await service.update('t1', { isPublic: true } as any, 'u1');
      expect(folderService.touch).not.toHaveBeenCalled();
    });
  });
});
