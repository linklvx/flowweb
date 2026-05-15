import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionProcessor } from './execution.processor';
import { ExecutionService } from './execution.service';
import { Job } from 'bullmq';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ExecutionProcessor', () => {
  let processor: ExecutionProcessor;
  let execService: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    execService = {
      execute: vi.fn().mockResolvedValue({ success: true, errors: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionProcessor,
        { provide: ExecutionService, useValue: execService },
      ],
    }).compile();

    processor = module.get<ExecutionProcessor>(ExecutionProcessor);
  });

  it('should process job and call service.execute with correct params', async () => {
    const job = {
      id: 'job-1',
      data: { projectId: 'p1', nodeId: 'n1', userId: 'u1' },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    const result = await processor.process(job);

    expect(execService.execute).toHaveBeenCalledWith('p1', 'n1', 'u1');
    expect(job.updateProgress).toHaveBeenCalledWith(10);
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });

  it('should handle job without nodeId', async () => {
    const job = {
      id: 'job-2',
      data: { projectId: 'p1', userId: 'u1' },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    await processor.process(job);
    expect(execService.execute).toHaveBeenCalledWith('p1', undefined, 'u1');
  });

  it('should throw error on failure and trigger retry', async () => {
    execService.execute.mockRejectedValue(new Error('AI service down'));

    const job = {
      id: 'job-3',
      data: { projectId: 'p1', nodeId: 'n1', userId: 'u1' },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    await expect(processor.process(job)).rejects.toThrow('AI service down');
    expect(job.updateProgress).toHaveBeenCalledWith(10);
    expect(job.updateProgress).not.toHaveBeenCalledWith(100);
  });
});
