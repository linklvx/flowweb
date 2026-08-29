import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { VideoSeparateController } from './video-separate.controller';
import { VideoSeparateService } from './video-separate.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('VideoSeparateController', () => {
  let controller: VideoSeparateController;
  let mockService: { submitSeparate: ReturnType<typeof vi.fn> };
  let permSvc: { assertEditor: ReturnType<typeof vi.fn> };
  let prisma: { media: { findUnique: ReturnType<typeof vi.fn> } };

  beforeEach(async () => {
    mockService = {
      submitSeparate: vi.fn().mockResolvedValue({ taskId: 'task-001' }),
    };
    permSvc = {
      assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    };
    prisma = {
      media: { findUnique: vi.fn().mockResolvedValue({ projectId: null }) },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VideoSeparateController],
      providers: [
        { provide: VideoSeparateService, useValue: mockService },
        { provide: ProjectPermissionService, useValue: permSvc },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    controller = module.get<VideoSeparateController>(VideoSeparateController);
  });

  describe('POST /video-separate', () => {
    const dto = { fileId: 'file-1', nodeId: 'node-1', mode: 'audio' };
    const mockReq = (id = 'user-1') => ({ user: { id }, workflowId: 'wf-1' }) as any;

    it('EDITOR：media 有 projectId 时 assertEditor 放行且 service 收到 req.user.id', async () => {
      prisma.media.findUnique.mockResolvedValue({ projectId: 'proj-7' });
      const result = await controller.submitSeparate(dto, mockReq());
      expect(permSvc.assertEditor).toHaveBeenCalledWith('proj-7', 'user-1');
      expect(mockService.submitSeparate).toHaveBeenCalledWith({
        ...dto,
        userId: 'user-1',
        workflowId: 'wf-1', // req.workflowId 透传（现状语义）
      });
      expect(result).toEqual({ taskId: 'task-001' });
    });

    it('VIEWER：403 拒绝且 service.submitSeparate 未被调用', async () => {
      prisma.media.findUnique.mockResolvedValue({ projectId: 'proj-7' });
      permSvc.assertEditor.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
      await expect(controller.submitSeparate(dto, mockReq())).rejects.toThrow('无项目编辑权限');
      expect(mockService.submitSeparate).not.toHaveBeenCalled();
    });
  });
});
