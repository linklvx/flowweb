import { Test, TestingModule } from '@nestjs/testing';
import { StoryboardController } from './storyboard.controller';
import { StoryboardService } from './storyboard.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('StoryboardController', () => {
  let controller: StoryboardController;
  let service: {
    createStitchTask: ReturnType<typeof vi.fn>;
    getTaskStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      createStitchTask: vi.fn().mockResolvedValue({ taskId: 'job1', status: 'PENDING' }),
      getTaskStatus: vi.fn().mockResolvedValue({ taskId: 'job1', status: 'COMPLETED', fileId: 'out1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StoryboardController],
      providers: [{ provide: StoryboardService, useValue: service }],
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

    it('无 user → 用 default-user', async () => {
      const body = { fileIds: ['f1'], gridRows: 1, gridCols: 1, aspectRatio: '16:9', showIndex: false, resolution: '2K' };
      const req = {} as any;
      await controller.stitch('p1', body, req);
      expect(service.createStitchTask).toHaveBeenCalledWith('p1', body, 'default-user');
    });

    it('service 抛 BadRequestException → 400', async () => {
      service.createStitchTask.mockRejectedValue(new BadRequestException('fileIds 不能为空'));
      const body = { fileIds: [], gridRows: 1, gridCols: 1, aspectRatio: '16:9', showIndex: false, resolution: '2K' };
      const req = {} as any;
      await expect(controller.stitch('p1', body, req)).rejects.toThrow(BadRequestException);
    });
  });

  describe('GET stitch/:taskId', () => {
    it('转发 getTaskStatus', async () => {
      const result = await controller.status('p1', 'job1');
      expect(service.getTaskStatus).toHaveBeenCalledWith('p1', 'job1');
      expect(result).toEqual({ taskId: 'job1', status: 'COMPLETED', fileId: 'out1' });
    });

    it('NotFoundException → 404', async () => {
      service.getTaskStatus.mockRejectedValue(new NotFoundException('任务不存在'));
      await expect(controller.status('p1', 'nope')).rejects.toThrow(NotFoundException);
    });
  });
});
