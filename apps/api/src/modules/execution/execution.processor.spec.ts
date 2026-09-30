import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionProcessor } from './execution.processor';
import { ExecutionService } from './execution.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { GenerationIntentService } from './generation-intent.service';
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
        // 批0.5-6 最小装置：failed 钩子依赖（writeExecStatus/fail）
        { provide: CollabDocumentService, useValue: { writeExecStatus: vi.fn().mockResolvedValue(undefined) } },
        { provide: GenerationIntentService, useValue: { claim: vi.fn(), complete: vi.fn(), fail: vi.fn().mockResolvedValue(undefined) } },
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

    // 第6/7参：intentId（无则 undefined）+ jobId（批0.5-6——claim 同 job 可重入）
    expect(execService.execute).toHaveBeenCalledWith('p1', 'n1', 'u1', undefined, undefined, undefined, 'job-1');
    expect(job.updateProgress).toHaveBeenCalledWith(10);
    expect(job.updateProgress).toHaveBeenCalledWith(100);
    expect(result).toEqual({ success: true, errors: [] });
  });

  it('should handle job without nodeId', async () => {
    const job = {
      id: 'job-2',
      data: { projectId: 'p1', userId: 'u1' },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    await processor.process(job);
    expect(execService.execute).toHaveBeenCalledWith('p1', undefined, 'u1', undefined, undefined, undefined, 'job-2');
  });

  it('should decode job.data.sv base64 and pass to execute', async () => {
    const b64 = Buffer.from('hello').toString('base64');
    const job = {
      id: 'job-4',
      data: { projectId: 'p1', nodeId: 'n1', userId: 'u1', sv: b64 },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    await processor.process(job);
    const svArg = (execService.execute.mock.calls[0][4] as Uint8Array);
    expect([...svArg]).toEqual([104, 101, 108, 108, 111]);
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
