import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AiImageEditController } from './ai-image-edit.controller';
import { AiImageEditService } from './ai-image-edit.service';
import { ProjectPermissionService } from '../team/project-permission.service';

describe('AiImageEditController', () => {
  let controller: AiImageEditController;
  let service: { enqueueOutpaint: ReturnType<typeof vi.fn>; enqueueErase: ReturnType<typeof vi.fn>; enqueueRedraw: ReturnType<typeof vi.fn> };
  let permSvc: { assertEditor: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = {
      enqueueOutpaint: vi.fn().mockResolvedValue({ jobId: 'job-outpaint-1' }),
      enqueueErase: vi.fn().mockResolvedValue({ jobId: 'job-erase-1' }),
      enqueueRedraw: vi.fn().mockResolvedValue({ jobId: 'job-redraw-1' }),
    };
    permSvc = {
      assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiImageEditController],
      providers: [
        { provide: AiImageEditService, useValue: service },
        { provide: ProjectPermissionService, useValue: permSvc },
      ],
    }).compile();
    controller = module.get<AiImageEditController>(AiImageEditController);
  });

  describe('POST /api/image-edit/outpaint', () => {
    it('should enqueue outpaint job with userId from req.user and return jobId', async () => {
      const body = {
        projectId: 'proj1',
        nodeId: 'node1',
        fileId: 'file-1',
        rect: { x: -16, y: 0, width: 528, height: 512 },
        imageWidth: 512,
        imageHeight: 512,
      };
      const req = { user: { id: 'u1' } } as any;
      const result = await controller.outpaint(body, req);
      expect(service.enqueueOutpaint).toHaveBeenCalledWith(
        'u1', 'proj1', 'node1', 'file-1', { x: -16, y: 0, width: 528, height: 512 }, 512, 512,
      );
      expect(result).toEqual({ jobId: 'job-outpaint-1' });
    });
  });

  describe('POST /api/image-edit/erase', () => {
    it('should enqueue erase job with userId from req.user and return jobId', async () => {
      const body = {
        projectId: 'proj1',
        nodeId: 'node1',
        fileId: 'file-1',
        maskFileId: 'mask-1',
      };
      const req = { user: { id: 'u1' } } as any;
      const result = await controller.erase(body, req);
      expect(service.enqueueErase).toHaveBeenCalledWith(
        'u1', 'proj1', 'node1', 'file-1', 'mask-1',
      );
      expect(result).toEqual({ jobId: 'job-erase-1' });
    });
  });

  describe('POST /api/image-edit/redraw', () => {
    it('should enqueue redraw job with userId from req.user and return jobId', async () => {
      const body = {
        projectId: 'proj1',
        nodeId: 'node1',
        fileId: 'file-1',
        maskFileId: 'mask-1',
        prompt: 'a beautiful sunset',
        strength: 70,
      };
      const req = { user: { id: 'u1' } } as any;
      const result = await controller.redraw(body, req);
      expect(service.enqueueRedraw).toHaveBeenCalledWith(
        'u1', 'proj1', 'node1', 'file-1', 'mask-1', 'a beautiful sunset', 70,
      );
      expect(result).toEqual({ jobId: 'job-redraw-1' });
    });
  });

  describe('安全止血（spec 批0c-1 判据①：非成员 403 且 service 零调用）', () => {
    it('outpaint：assertEditor 拒绝 → 抛错且 service 零调用（越权扣费面）', async () => {
      permSvc.assertEditor.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
      const body = {
        projectId: 'p1',
        nodeId: 'n1',
        fileId: 'f1',
        rect: { x: 0, y: 0, width: 10, height: 10 },
        imageWidth: 10,
        imageHeight: 10,
      };
      const req = { user: { id: 'u1' } } as any;
      await expect(controller.outpaint(body, req)).rejects.toThrow('无项目编辑权限');
      expect(permSvc.assertEditor).toHaveBeenCalledWith('p1', 'u1');
      expect(service.enqueueOutpaint).not.toHaveBeenCalled();
    });

    it('erase/redraw 同守卫：拒绝 → service 零调用', async () => {
      permSvc.assertEditor.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
      const req = { user: { id: 'u1' } } as any;
      await expect(controller.erase({ projectId: 'p1', nodeId: 'n1', fileId: 'f1', maskFileId: 'm1' }, req)).rejects.toThrow('无项目编辑权限');
      await expect(controller.redraw({ projectId: 'p1', nodeId: 'n1', fileId: 'f1', maskFileId: 'm1', prompt: 'x', strength: 0.5 }, req)).rejects.toThrow('无项目编辑权限');
      expect(permSvc.assertEditor).toHaveBeenCalledWith('p1', 'u1');
      expect(service.enqueueErase).not.toHaveBeenCalled();
      expect(service.enqueueRedraw).not.toHaveBeenCalled();
    });
  });
});
