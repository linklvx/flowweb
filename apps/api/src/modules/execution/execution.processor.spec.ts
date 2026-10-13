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

    // 第5/6参：regenToken（无则 undefined，Y0b-2 T6 Z91——T7 sv 形参删除后左移）+ jobId（批0.5-6——claim 同 job 可重入）
    // 第7参：traceId（Y0b-5 T13——job.data 无 traceId 时 undefined，禁 fallback jobId：jobId 是 claim 业务 CAS 键）
    expect(execService.execute).toHaveBeenCalledWith('p1', 'n1', 'u1', undefined, undefined, 'job-1', undefined);
    expect(job.updateProgress).toHaveBeenCalledWith(10);
    expect(job.updateProgress).toHaveBeenCalledWith(100);
    expect(result).toEqual({ success: true, errors: [] });
  });

  it('Y0b-2 T6（Z91）：job.data.regenToken → execute 第5参透传（enqueue 管道与 execute 直达同 claim 语义）+jobId 第6参', async () => {
    const job = {
      id: 'job-5',
      data: { projectId: 'p1', nodeId: 'n1', userId: 'u1', regenToken: 'held-token-1' },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    await processor.process(job);

    expect(execService.execute).toHaveBeenCalledWith('p1', 'n1', 'u1', undefined, 'held-token-1', 'job-5', undefined);
  });

  it('should handle job without nodeId', async () => {
    const job = {
      id: 'job-2',
      data: { projectId: 'p1', userId: 'u1' },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    await processor.process(job);
    expect(execService.execute).toHaveBeenCalledWith('p1', undefined, 'u1', undefined, undefined, 'job-2', undefined);
  });

  it('Y0b-2 T7：job.data 遗留 sv 字段被忽略（载荷零客户端状态——SV 判定在受理端点门）。Y0b-5 T13 豁免说明：job.data.traceId 不违本断言意图——traceId 是服务端生成值（requestTraceMiddleware 的 requestTraceStorage/ALS 来源，非客户端可控状态），enqueue 点显式携带、processor 首行重建（跨 Redis 保真锚——claim 审计列落库凭此，BullMQ worker 无 HTTP ALS）', async () => {
    const trace = '4bf92f3577b34da6a3ce929d0e0e4736';
    const job = {
      id: 'job-4',
      data: { projectId: 'p1', nodeId: 'n1', userId: 'u1', sv: Buffer.from('hello').toString('base64'), traceId: trace },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    await processor.process(job);
    expect(execService.execute).toHaveBeenCalledWith('p1', 'n1', 'u1', undefined, undefined, 'job-4', trace);
  });

  it('Y0b-5 T13：job.data.traceId 缺省（旧 job）→ execute 第7参 undefined 禁 fallback jobId（jobId 是 claim 业务 CAS 键——两键域独立不复用）', async () => {
    const job = {
      id: '42',
      data: { projectId: 'p1', nodeId: 'n1', userId: 'u1' },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    await processor.process(job);
    expect(execService.execute).toHaveBeenCalledWith('p1', 'n1', 'u1', undefined, undefined, '42', undefined);
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
