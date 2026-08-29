import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { VideoTrimController } from './video-trim.controller';
import { VideoTrimService } from './video-trim.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('VideoTrimController', () => {
  let controller: VideoTrimController;
  let mockService: Partial<Record<keyof VideoTrimService, ReturnType<typeof vi.fn>>>;
  let permSvc: { assertEditor: ReturnType<typeof vi.fn> };
  let prisma: { media: { findUnique: ReturnType<typeof vi.fn> } };

  beforeEach(async () => {
    mockService = {
      submitTrim: vi.fn().mockResolvedValue({ taskId: 'task-001' }),
      getTaskStatus: vi.fn().mockResolvedValue({ status: 'done', outputFileId: 'out-1' }),
    };
    permSvc = {
      assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    };
    prisma = {
      media: { findUnique: vi.fn().mockResolvedValue({ projectId: null }) },
    };

    const module = await Test.createTestingModule({
      controllers: [VideoTrimController],
      providers: [
        { provide: VideoTrimService, useValue: mockService },
        { provide: ProjectPermissionService, useValue: permSvc },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    controller = module.get(VideoTrimController);
  });

  describe('POST /video-trim', () => {
    const mockReq = (overrides?: Record<string, unknown>) => ({
      user: { id: 'user-1' },
      workflowId: 'wf-1',
      ...overrides,
    });

    it('should return taskId on valid submission', async () => {
      const result = await controller.submitTrim(
        { fileId: 'file-1', startTime: 5, endTime: 10, nodeId: 'node-1' },
        mockReq() as any,
      );
      expect(result).toEqual({ taskId: 'task-001' });
      expect(mockService.submitTrim).toHaveBeenCalledWith({
        fileId: 'file-1', startTime: 5, endTime: 10, nodeId: 'node-1',
        userId: 'user-1', workflowId: '',
      });
    });

    it('EDITOR：media 有 projectId 时 assertEditor 放行', async () => {
      prisma.media.findUnique.mockResolvedValue({ projectId: 'proj-9' });
      await controller.submitTrim(
        { fileId: 'file-1', startTime: 5, endTime: 10, nodeId: 'node-1' },
        mockReq() as any,
      );
      expect(permSvc.assertEditor).toHaveBeenCalledWith('proj-9', 'user-1');
      expect(mockService.submitTrim).toHaveBeenCalled();
    });

    it('VIEWER：403 拒绝且 service.submitTrim 未被调用', async () => {
      prisma.media.findUnique.mockResolvedValue({ projectId: 'proj-9' });
      permSvc.assertEditor.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
      await expect(
        controller.submitTrim(
          { fileId: 'file-1', startTime: 5, endTime: 10, nodeId: 'node-1' },
          mockReq() as any,
        ),
      ).rejects.toThrow('无项目编辑权限');
      expect(mockService.submitTrim).not.toHaveBeenCalled();
    });

    it('media 无 projectId 时跳过 assertEditor（个人素材由 service ownership 兜底）', async () => {
      prisma.media.findUnique.mockResolvedValue({ projectId: null });
      await controller.submitTrim(
        { fileId: 'file-1', startTime: 5, endTime: 10, nodeId: 'node-1' },
        mockReq() as any,
      );
      expect(permSvc.assertEditor).not.toHaveBeenCalled();
      expect(mockService.submitTrim).toHaveBeenCalled();
    });
  });

  describe('GET /video-trim/:taskId', () => {
    it('should return task status', async () => {
      const result = await controller.getTaskStatus('task-1');
      expect(result).toEqual({ status: 'done', outputFileId: 'out-1' });
      expect(mockService.getTaskStatus).toHaveBeenCalledWith('task-1');
    });
  });
});
