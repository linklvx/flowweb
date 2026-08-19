import { Test, TestingModule } from '@nestjs/testing';
import { CanvasService } from './canvas.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectService } from '../project/project.service';
import { FolderService } from '../folder/folder.service';
import { TemplateService } from '../template/template.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

describe('CanvasService', () => {
  let service: CanvasService;
  let prisma: any;
  let projectService: any;
  let folderService: any;
  let templateService: any;

  beforeEach(async () => {
    prisma = {
      folder: { findFirst: vi.fn().mockResolvedValue(null) },
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
    it('事务创建 CanvasProject + DRAFT Template，返回 templateId/projectId', async () => {
      prisma.folder.findFirst.mockResolvedValue({ id: 'f1' });
      prisma.$transaction.mockImplementation(async (fn: any) => fn({
        canvasProject: { create: vi.fn().mockResolvedValue({ id: 'p1' }) },
        template: { create: vi.fn().mockResolvedValue({ id: 't1' }) },
      }));
      const result = await service.create('新画布', 'f1', 'u1');
      expect(result).toEqual({ templateId: 't1', projectId: 'p1' });
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
  });
});
