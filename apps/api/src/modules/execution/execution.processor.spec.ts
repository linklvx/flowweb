import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionProcessor } from './execution.processor';
import { ExecutionService } from './execution.service';
import { CollabWritePort } from '../collab/collab-write.port';
import { GenerationIntentService } from './generation-intent.service';
import { Job, DelayedError } from 'bullmq';
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
        { provide: CollabWritePort, useValue: { writeExecStatus: vi.fn().mockResolvedValue(undefined) } },
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
    expect(execService.execute).toHaveBeenCalledWith('p1', 'n1', 'u1', undefined, undefined, 'job-1', undefined, expect.any(Function)); // T9 收尾：第8参=onClaimed 回调（票回写）
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

    expect(execService.execute).toHaveBeenCalledWith('p1', 'n1', 'u1', undefined, 'held-token-1', 'job-5', undefined, expect.any(Function));
  });

  it('should handle job without nodeId', async () => {
    const job = {
      id: 'job-2',
      data: { projectId: 'p1', userId: 'u1' },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    await processor.process(job);
    expect(execService.execute).toHaveBeenCalledWith('p1', undefined, 'u1', undefined, undefined, 'job-2', undefined, undefined); // nodeId 缺失⇒onClaimed 不传
  });

  it('Y0b-2 T7：job.data 遗留 sv 字段被忽略（载荷零客户端状态——SV 判定在受理端点门）。Y0b-5 T13 豁免说明：job.data.traceId 不违本断言意图——traceId 是服务端生成值（requestTraceMiddleware 的 requestTraceStorage/ALS 来源，非客户端可控状态），enqueue 点显式携带、processor 首行重建（跨 Redis 保真锚——claim 审计列落库凭此，BullMQ worker 无 HTTP ALS）', async () => {
    const trace = '4bf92f3577b34da6a3ce929d0e0e4736';
    const job = {
      id: 'job-4',
      data: { projectId: 'p1', nodeId: 'n1', userId: 'u1', sv: Buffer.from('hello').toString('base64'), traceId: trace },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    await processor.process(job);
    expect(execService.execute).toHaveBeenCalledWith('p1', 'n1', 'u1', undefined, undefined, 'job-4', trace, expect.any(Function));
  });

  it('Y0b-5 T13：job.data.traceId 缺省（旧 job）→ execute 第7参 undefined 禁 fallback jobId（jobId 是 claim 业务 CAS 键——两键域独立不复用）', async () => {
    const job = {
      id: '42',
      data: { projectId: 'p1', nodeId: 'n1', userId: 'u1' },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    await processor.process(job);
    expect(execService.execute).toHaveBeenCalledWith('p1', 'n1', 'u1', undefined, undefined, '42', undefined, expect.any(Function));
  });

  it('Y0b-5 T13 微修：完成/失败日志行与 start 行同 JSON 形态携 traceId（跨 Redis trace 全程贯穿——终态行断链即不可关联）', async () => {
    const trace = '4bf92f3577b34da6a3ce929d0e0e4736';
    const logSpy = vi.spyOn((processor as any).logger, 'log');
    const errSpy = vi.spyOn((processor as any).logger, 'error');

    const job = {
      id: 'job-t1',
      data: { projectId: 'p1', nodeId: 'n1', userId: 'u1', traceId: trace },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;
    await processor.process(job);
    expect(JSON.parse(logSpy.mock.calls.at(-1)![0] as string)).toMatchObject({
      event: 'execution_job_done', traceId: trace, jobId: 'job-t1',
    });

    execService.execute.mockRejectedValue(new Error('boom'));
    const job2 = {
      id: 'job-t2',
      data: { projectId: 'p1', nodeId: 'n1', userId: 'u1', traceId: trace },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;
    await expect(processor.process(job2)).rejects.toThrow('boom');
    expect(JSON.parse(errSpy.mock.calls.at(-1)![0] as string)).toMatchObject({
      event: 'execution_job_failed', traceId: trace, jobId: 'job-t2', message: 'boom',
    });
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

/** T9 收尾（评审 Important①）：failed 钩子票守卫——job.data 票=本 process 代 claim 成功后回写
 *  （updateData 同步刷新实例快照）。claim 在 worker 内（与 edit/lighting 的 controller 预制票分立）：
 *  无票=claim 前 throw（readCanvas 503/validate 等）的旧 worker 迟到钩子——行属 takeover 新代（takeover
 *  不改 jobId，findByActiveNode(jobId) 必命中新代行），改前 fail(..., running.execSeq) 自读自写使代际
 *  CAS 形同虚设=误杀新代 worker（产物 CAS 丢弃+白烧外呼）。直构装置对齐 execution.intent.spec makeProcessor。 */
describe('T9 收尾：failed 钩子票守卫（旧 worker 不得误杀 takeover 新代行）', () => {
  const makeProc = () => {
    const executionService = { execute: vi.fn() };
    const intentService = {
      findByActiveNode: vi.fn(),
      fail: vi.fn().mockResolvedValue(undefined),
    };
    const p: any = new ExecutionProcessor(executionService as any, {} as any, intentService as any);
    return { p, intentService, executionService };
  };
  /** takeover 新代在飞行：jobId=本 job（takeover 不改 jobId）、execSeq 已换代 */
  const genRow = (execSeq = 7n) => ({ id: 'row-take', intentId: 'row-uuid-take', execSeq });

  it('红：job.data 无票（claim 前 throw 的旧 worker——GC/网络暂停苏醒后 readCanvas 503/validate throw）+行已 takeover 换代 → fail 零调用（现状自读自写 running.execSeq 误杀新代行）', async () => {
    const { p, intentService } = makeProc();
    intentService.findByActiveNode.mockResolvedValue(genRow(7n));
    const job = { id: 'job-take', data: { projectId: 'p1', nodeId: 'n1', userId: 'u1' } };

    await p.onFailed(job as any, new Error('readCanvas 503'));

    expect(intentService.findByActiveNode).toHaveBeenCalledWith('p1', 'n1', 'job-take');
    expect(intentService.fail).not.toHaveBeenCalled(); // 红：现状 fail(row-take, 'readCanvas 503', 'job-take', 7n)
  });

  it('红：票代际 ≠ 行代际（旧 worker claim 后行被接管换代）→ fail 零调用+warn 退役可观测', async () => {
    const { p, intentService } = makeProc();
    intentService.findByActiveNode.mockResolvedValue(genRow(8n));
    const warnSpy = vi.spyOn((p as any).logger, 'warn');
    const job = { id: 'job-take', data: { projectId: 'p1', nodeId: 'n1', userId: 'u1', ticket: { nodeId: 'n1', intentRowId: 'row-take', execSeq: '7' } } };

    await p.onFailed(job as any, new Error('boom'));

    expect(intentService.fail).not.toHaveBeenCalled(); // 红：现状无票比对直接 fail
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('execution_failed_hook_stale_ticket'));
  });

  it('红：票 nodeId 异（组执行上游节点 claim 票不得当目标节点票）→ fail 零调用', async () => {
    const { p, intentService } = makeProc();
    intentService.findByActiveNode.mockResolvedValue(genRow(7n));
    const job = { id: 'job-take', data: { projectId: 'p1', nodeId: 'n1', userId: 'u1', ticket: { nodeId: 'n-upstream', intentRowId: 'row-up', execSeq: '7' } } };

    await p.onFailed(job as any, new Error('boom'));

    expect(intentService.fail).not.toHaveBeenCalled(); // 红：现状无 nodeId 比对
  });

  it('票匹配（本 process 代 claim 行后 throw——迟到钩子兜底面保留）→ fail(running.id, reason, job.id, running.execSeq)（真 CAS——票已保证代际同源）', async () => {
    const { p, intentService } = makeProc();
    intentService.findByActiveNode.mockResolvedValue(genRow(7n));
    const job = { id: 'job-take', data: { projectId: 'p1', nodeId: 'n1', userId: 'u1', ticket: { nodeId: 'n1', intentRowId: 'row-take', execSeq: '7' } } };

    await p.onFailed(job as any, new Error('late backstop'));

    expect(intentService.fail).toHaveBeenCalledWith('row-take', 'late backstop', 'job-take', 7n);
  });

  it('红：process 透传 onClaimed 回调（execute 第8参）——claim 成功即回写票进 job.data（nodeId 匹配才写）', async () => {
    const { p, executionService } = makeProc();
    executionService.execute.mockImplementation(async (_a: any, _b: any, _c: any, _d: any, _e: any, _f: any, _g: any, onClaimed?: (t: any) => void) => {
      onClaimed?.({ nodeId: 'n1', intentRowId: 'row-9', execSeq: '5' });
      return { success: true, errors: [], results: [], totalCost: 0 };
    });
    const updateData = vi.fn().mockResolvedValue(undefined);
    const job = {
      id: 'job-claim', data: { projectId: 'p1', nodeId: 'n1', userId: 'u1' },
      updateProgress: vi.fn().mockResolvedValue(undefined), updateData,
    } as unknown as Job;

    await p.process(job);

    expect(updateData).toHaveBeenCalledWith(expect.objectContaining({
      ticket: { nodeId: 'n1', intentRowId: 'row-9', execSeq: '5' },
    })); // 红：现状 execute 无回调参数——claim 结果不回写
  });

  it('红：onClaimed 上游节点票（nodeId 不匹配）不回写（enqueue 单节点=组执行上游 claim 不覆盖目标票）', async () => {
    const { p, executionService } = makeProc();
    executionService.execute.mockImplementation(async (_a: any, _b: any, _c: any, _d: any, _e: any, _f: any, _g: any, onClaimed?: (t: any) => void) => {
      onClaimed?.({ nodeId: 'n-upstream', intentRowId: 'row-up', execSeq: '5' });
      return { success: true, errors: [], results: [], totalCost: 0 };
    });
    const updateData = vi.fn().mockResolvedValue(undefined);
    const job = {
      id: 'job-claim', data: { projectId: 'p1', nodeId: 'n1', userId: 'u1' },
      updateProgress: vi.fn().mockResolvedValue(undefined), updateData,
    } as unknown as Job;

    await p.process(job);

    expect(updateData).not.toHaveBeenCalled(); // 红：现状无回写语义可言——绿后为 nodeId 过滤断言
  });

  it('红：skip 后 moveToDelayed 失败（锁失守等）→ warn 携 jobId+原因（退回 ack 降级可观测——改前仅缺 execution_job_skip_delayed 日志间接可判）', async () => {
    const { p, executionService } = makeProc();
    executionService.execute.mockResolvedValue({
      success: false,
      errors: [{ nodeId: 'n1', status: 'skipped' as const, error: '该节点正在生成中', errorCode: 'NODE_BUSY' }],
      results: [], totalCost: 0,
    });
    const warnSpy = vi.spyOn((p as any).logger, 'warn');
    const job = {
      id: 'job-move-fail', token: 'tok-1',
      data: { projectId: 'p1', nodeId: 'n1', userId: 'u1' },
      updateProgress: vi.fn().mockResolvedValue(undefined),
      moveToDelayed: vi.fn().mockRejectedValue(new Error('Missing lock for job job-move-fail')),
    } as unknown as Job;

    const result = await p.process(job); // move 失败退回正常 ack——不硬死

    expect(result).toEqual(expect.objectContaining({ success: false }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('execution_job_skip_move_failed')); // 红：现状零 warn
    const payload = JSON.parse(warnSpy.mock.calls.find((c: any[]) => c[0].includes('execution_job_skip_move_failed'))![0] as string);
    expect(payload).toMatchObject({ jobId: 'job-move-fail', projectId: 'p1', reason: expect.stringContaining('Missing lock') });
  });

  it('skip 后 moveToDelayed 成功 → 照常 DelayedError 重排（既有行为回归钉——warn 零调用）', async () => {
    const { p, executionService } = makeProc();
    executionService.execute.mockResolvedValue({
      success: false,
      errors: [{ nodeId: 'n1', status: 'skipped' as const, error: 'INTENT_SAME_JOB_ALIVE', errorCode: 'INTENT_SAME_JOB_ALIVE' }],
      results: [], totalCost: 0,
    });
    const warnSpy = vi.spyOn((p as any).logger, 'warn');
    const job = {
      id: 'job-move-ok', token: 'tok-2',
      data: { projectId: 'p1', nodeId: 'n1', userId: 'u1' },
      updateProgress: vi.fn().mockResolvedValue(undefined),
      moveToDelayed: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    await expect(p.process(job)).rejects.toThrow(DelayedError);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
