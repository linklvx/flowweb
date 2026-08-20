import { Test, TestingModule } from '@nestjs/testing';
import { CanvasService } from './canvas.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectService } from '../project/project.service';
import { FolderService } from '../folder/folder.service';
import { TemplateService } from '../template/template.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('CanvasService', () => {
  let service: CanvasService;
  let prisma: any;
  let projectService: any;
  let folderService: any;
  let templateService: any;

  beforeEach(async () => {
    prisma = {
      folder: { findFirst: vi.fn().mockResolvedValue(null) },
      template: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 't1', status: 'SAVED' }),
        update: vi.fn().mockResolvedValue({ id: 't2', status: 'SAVED' }),
      },
      $transaction: vi.fn(),
    };
    projectService = {};
    folderService = { touch: vi.fn() };
    templateService = { clearCache: vi.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanvasService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectService, useValue: projectService },
        { provide: FolderService, useValue: folderService },
        { provide: TemplateService, useValue: templateService },
      ],
    }).compile();
    service = module.get<CanvasService>(CanvasService);
  });

  describe('create', () => {
    it('事务创建 CanvasProject + DRAFT Template，返回 templateId/projectId/name', async () => {
      prisma.folder.findFirst.mockResolvedValue({ id: 'f1' });
      prisma.$transaction.mockImplementation(async (fn: any) => fn({
        canvasProject: { create: vi.fn().mockResolvedValue({ id: 'p1' }) },
        template: { create: vi.fn().mockResolvedValue({ id: 't1' }) },
      }));
      const result = await service.create('新画布', 'f1', 'u1');
      expect(result).toEqual({ templateId: 't1', projectId: 'p1', name: '新画布' });
      expect(templateService.clearCache).toHaveBeenCalled();
      expect(folderService.touch).toHaveBeenCalledWith(['f1']);
    });

    it('事务内 Template 数据含 folderId/status DRAFT/isPublic false', async () => {
      const templateCreate = vi.fn().mockResolvedValue({ id: 't1' });
      prisma.$transaction.mockImplementation(async (fn: any) => fn({
        canvasProject: { create: vi.fn().mockResolvedValue({ id: 'p1' }) },
        template: { create: templateCreate },
      }));
      await service.create('新画布', null, 'u1');
      expect(templateCreate).toHaveBeenCalledWith({
        data: {
          name: '新画布', userId: 'u1', projectId: 'p1',
          folderId: null, status: 'DRAFT', isPublic: false,
        },
      });
      expect(folderService.touch).not.toHaveBeenCalled();
    });

    it('folderId 非本人文件夹抛 BadRequest', async () => {
      prisma.folder.findFirst.mockResolvedValue(null);
      await expect(service.create('新画布', 'fx', 'u1')).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    describe('空名默认编号（Fix 7）', () => {
      function mockTx(names: string[]) {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue(0),
          canvasProject: { create: vi.fn().mockResolvedValue({ id: 'p1' }) },
          template: {
            findMany: vi.fn().mockResolvedValue(names.map((name) => ({ name }))),
            create: vi.fn().mockResolvedValue({ id: 't1' }),
          },
        };
        prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
        return tx;
      }

      it('空名走编号：事务内取 advisory lock，无已有未命名 → 未命名项目1', async () => {
        const tx = mockTx(['我的画布']);
        const result = await service.create('', null, 'u1');
        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
        expect(tx.template.findMany).toHaveBeenCalledWith({ where: { userId: 'u1' }, select: { name: true } });
        expect(tx.canvasProject.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: '未命名项目1' }) });
        expect(tx.template.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: '未命名项目1', status: 'DRAFT' }) });
        expect(result).toEqual({ templateId: 't1', projectId: 'p1', name: '未命名项目1' });
      });

      it('已有 未命名项目1、3 → 下一个为 4，非未命名名不影响编号', async () => {
        const tx = mockTx(['未命名项目1', '我的画布', '未命名项目3']);
        const result = await service.create('', null, 'u1');
        expect(result.name).toBe('未命名项目4');
      });

      it('空白名同样走编号分支', async () => {
        const tx = mockTx([]);
        const result = await service.create('   ', null, 'u1');
        expect(tx.template.findMany).toHaveBeenCalled();
        expect(result.name).toBe('未命名项目1');
      });

      it('非空名不取锁、不查编号，原名创建', async () => {
        const tx = mockTx(['未命名项目1']);
        const result = await service.create('我的新画布', null, 'u1');
        expect(tx.$executeRaw).not.toHaveBeenCalled();
        expect(tx.template.findMany).not.toHaveBeenCalled();
        expect(tx.canvasProject.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: '我的新画布' }) });
        expect(result.name).toBe('我的新画布');
      });
    });
  });

  describe('save', () => {
    const project = {
      id: 'p1', userId: 'u1',
      nodes: [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }],
      edges: [{ id: 'e1', sourceId: 'n1', targetId: 'n1' }],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    beforeEach(() => {
      projectService.findById = vi.fn().mockResolvedValue(project);
      prisma.template.findUnique.mockResolvedValue(null);
    });

    it('无关联 Template 时创建，status=SAVED，规范化 edges 的 sourceId/targetId', async () => {
      const result = await service.save('p1', { name: '名', description: 'd', isPublic: false }, 'u1');
      expect(prisma.template.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: '名', description: 'd', isPublic: false, status: 'SAVED',
          projectId: 'p1', userId: 'u1',
          templateData: {
            nodes: [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }],
            edges: [{ id: 'e1', source: 'n1', target: 'n1' }],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        }),
      });
      expect(result.id).toBe('t1');
      expect(templateService.clearCache).toHaveBeenCalled();
    });

    it('有关联 Template 时更新且不 touch 文件夹', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't2', folderId: 'f1', isPublic: true });
      await service.save('p1', { name: '名' }, 'u1');
      expect(prisma.template.update).toHaveBeenCalledWith({
        where: { id: 't2' },
        data: expect.objectContaining({ name: '名', status: 'SAVED' }),
      });
      expect(prisma.template.create).not.toHaveBeenCalled();
      expect(folderService.touch).not.toHaveBeenCalled();
    });

    it('update 保留未传的 isPublic', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't2', isPublic: true });
      await service.save('p1', { name: '名' }, 'u1');
      expect(prisma.template.update).toHaveBeenCalledWith({
        where: { id: 't2' },
        data: expect.objectContaining({ isPublic: true }),
      });
    });

    it('非本人工程抛 Forbidden', async () => {
      projectService.findById.mockResolvedValue({ ...project, userId: 'other' });
      await expect(service.save('p1', { name: '名' }, 'u1')).rejects.toThrow(ForbiddenException);
    });

    it('并发首存 P2002 回退为 update', async () => {
      const p2002: any = new Error('Unique constraint failed');
      p2002.code = 'P2002';
      prisma.template.create.mockRejectedValueOnce(p2002);
      prisma.template.findUnique.mockResolvedValue({ id: 't2', isPublic: false });
      const result = await service.save('p1', { name: '名' }, 'u1');
      expect(prisma.template.update).toHaveBeenCalled();
      expect(result.id).toBe('t2');
    });
  });
});
