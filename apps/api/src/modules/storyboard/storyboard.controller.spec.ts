import { Test, TestingModule } from '@nestjs/testing';
import { StoryboardController } from './storyboard.controller';
import { StoryboardService } from './storyboard.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('StoryboardController', () => {
  let controller: StoryboardController;
  let service: {
    createStitchTask: ReturnType<typeof vi.fn>;
    getTaskStatus: ReturnType<typeof vi.fn>;
  };
  let perm: {
    assertEditor: ReturnType<typeof vi.fn>;
    resolve: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      createStitchTask: vi.fn().mockResolvedValue({ taskId: 'job1', status: 'PENDING' }),
      getTaskStatus: vi.fn().mockResolvedValue({ taskId: 'job1', status: 'COMPLETED', fileId: 'out1' }),
    };
    perm = {
      assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
      resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StoryboardController],
      providers: [
        { provide: StoryboardService, useValue: service },
        { provide: ProjectPermissionService, useValue: perm },
      ],
    }).compile();

    controller = module.get<StoryboardController>(StoryboardController);
  });

  describe('POST stitch', () => {
    it('合法 → 202 且调 createStitchTask(projectId, body, userId)', async () => {
      const body = { fileIds: ['f1', 'f2'], gridRows: 1, gridCols: 2, aspectRatio: '16:9', showIndex: false, resolution: '2K' };
      const req = { user: { id: 'u1' } } as any;
      const result = await controller.stitch('p1', body, req);
      expect(service.createStitchTask).toHaveBeenCalledWith('p1', body, 'u1');
      expect(result).toEqual({ taskId: 'job1', status: 'PENDING' });
    });

    it('无 user → userId 为 undefined（不回退 default-user，AuthGuard 负责拦截未登录）', async () => {
      const body = { fileIds: ['f1'], gridRows: 1, gridCols: 1, aspectRatio: '16:9', showIndex: false, resolution: '2K' };
      const req = {} as any;
      await controller.stitch('p1', body, req);
      expect(service.createStitchTask).toHaveBeenCalledWith('p1', body, undefined);
    });

    it('service 抛 BadRequestException → 400', async () => {
      service.createStitchTask.mockRejectedValue(new BadRequestException('fileIds 不能为空'));
      const body = { fileIds: [], gridRows: 1, gridCols: 1, aspectRatio: '16:9', showIndex: false, resolution: '2K' };
      const req = {} as any;
      await expect(controller.stitch('p1', body, req)).rejects.toThrow(BadRequestException);
    });

    it('stitch 提交前校验 assertEditor', async () => {
      perm.assertEditor.mockResolvedValue(undefined);
      const body = { fileIds: ['f1'], gridRows: 1, gridCols: 1, aspectRatio: '16:9', showIndex: false, resolution: '2K' };
      await controller.stitch('p1', body, { user: { id: 'u1' } } as any);
      expect(perm.assertEditor).toHaveBeenCalledWith('p1', 'u1');
    });

    it('VIEWER（assertEditor 拒绝）→ 403 且 service 未被调', async () => {
      perm.assertEditor.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
      const body = { fileIds: ['f1'], gridRows: 1, gridCols: 1, aspectRatio: '16:9', showIndex: false, resolution: '2K' };
      await expect(controller.stitch('p1', body, { user: { id: 'u1' } } as any)).rejects.toThrow(ForbiddenException);
      expect(service.createStitchTask).not.toHaveBeenCalled();
    });
  });

  describe('GET stitch/:taskId', () => {
    it('转发 getTaskStatus', async () => {
      const result = await controller.status('p1', 'job1', { user: { id: 'u1' } } as any);
      expect(perm.resolve).toHaveBeenCalledWith('p1', 'u1');
      expect(service.getTaskStatus).toHaveBeenCalledWith('p1', 'job1');
      expect(result).toEqual({ taskId: 'job1', status: 'COMPLETED', fileId: 'out1' });
    });

    it('resolve 非 null（非成员）→ 403', async () => {
      perm.resolve.mockResolvedValue(null);
      await expect(controller.status('p1', 'job1', { user: { id: 'u1' } } as any)).rejects.toThrow(ForbiddenException);
      expect(service.getTaskStatus).not.toHaveBeenCalled();
    });

    it('NotFoundException → 404', async () => {
      service.getTaskStatus.mockRejectedValue(new NotFoundException('任务不存在'));
      await expect(controller.status('p1', 'nope', { user: { id: 'u1' } } as any)).rejects.toThrow(NotFoundException);
    });
  });
});
