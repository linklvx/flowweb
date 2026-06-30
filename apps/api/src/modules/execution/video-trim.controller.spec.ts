import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { VideoTrimController } from './video-trim.controller';
import { VideoTrimService } from './video-trim.service';

describe('VideoTrimController', () => {
  let controller: VideoTrimController;
  let mockService: Partial<Record<keyof VideoTrimService, ReturnType<typeof vi.fn>>>;

  beforeEach(async () => {
    mockService = {
      submitTrim: vi.fn().mockResolvedValue({ taskId: 'task-001' }),
      getTaskStatus: vi.fn().mockResolvedValue({ status: 'done', outputFileId: 'out-1' }),
    };

    const module = await Test.createTestingModule({
      controllers: [VideoTrimController],
      providers: [
        { provide: VideoTrimService, useValue: mockService },
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
  });

  describe('GET /video-trim/:taskId', () => {
    it('should return task status', async () => {
      const result = await controller.getTaskStatus('task-1');
      expect(result).toEqual({ status: 'done', outputFileId: 'out-1' });
      expect(mockService.getTaskStatus).toHaveBeenCalledWith('task-1');
    });
  });
});
