import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { getQueueToken } from '@nestjs/bullmq';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ExecutionController', () => {
  let controller: ExecutionController;
  let service: { execute: ReturnType<typeof vi.fn> };
  let queue: {
    add: ReturnType<typeof vi.fn>;
    getJob: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      execute: vi.fn().mockResolvedValue({ success: true, errors: [] }),
    };
    queue = {
      add: vi.fn().mockResolvedValue({ id: 'job-123' }),
      getJob: vi.fn().mockResolvedValue({
        id: 'job-123',
        getState: vi.fn().mockResolvedValue('completed'),
        progress: 100,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExecutionController],
      providers: [
        { provide: ExecutionService, useValue: service },
        { provide: getQueueToken('execution'), useValue: queue },
      ],
    }).compile();

    controller = module.get<ExecutionController>(ExecutionController);
  });

  describe('execute', () => {
    it('should call service.execute with provided parameters', async () => {
      const body = { projectId: 'p1', nodeId: 'n2', userId: 'user-1' };
      const result = await controller.execute(body);
      expect(service.execute).toHaveBeenCalledWith('p1', 'n2', 'user-1');
      expect(result).toEqual({ success: true, errors: [] });
    });

    it('should default userId to default-user when not provided', async () => {
      const body = { projectId: 'p1' };
      await controller.execute(body);
      expect(service.execute).toHaveBeenCalledWith('p1', undefined, 'default-user');
    });
  });

  describe('enqueue', () => {
    it('should add job to queue and return jobId', async () => {
      const req = { user: { id: 'user-1' } } as any;
      const body = { projectId: 'p1', nodeId: 'n2' };
      const result = await controller.enqueue(body, req);
      expect(queue.add).toHaveBeenCalledWith('execution', {
        projectId: 'p1',
        nodeId: 'n2',
        userId: 'user-1',
      });
      expect(result).toEqual({ jobId: 'job-123', status: 'queued' });
    });

    it('should handle missing user on request', async () => {
      const req = {} as any;
      const body = { projectId: 'p1' };
      const result = await controller.enqueue(body, req);
      expect(queue.add).toHaveBeenCalledWith('execution', {
        projectId: 'p1',
        nodeId: undefined,
        userId: undefined,
      });
      expect(result.status).toBe('queued');
    });
  });

  describe('getJob', () => {
    it('should return job state and progress', async () => {
      const result = await controller.getJob('job-123');
      expect(queue.getJob).toHaveBeenCalledWith('job-123');
      expect(result).toEqual({ id: 'job-123', state: 'completed', progress: 100 });
    });

    it('should return error when job not found', async () => {
      queue.getJob.mockResolvedValue(null);
      const result = await controller.getJob('nonexistent');
      expect(result).toEqual({ error: 'Job not found' });
    });
  });
});
