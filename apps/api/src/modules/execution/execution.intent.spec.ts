import { describe, it, expect, vi } from 'vitest';
import { ExecutionService } from './execution.service';
import { ExecutionController } from './execution.controller';
import { ExecutionProcessor } from './execution.processor';
import { NodeBusyError } from './generation-intent.service';
import { normalizeIntentParams } from './normalize-intent-params';

/** 批0.5-6 必红：execution 同步路径全链挂意图表——claim（幂等/互斥/再激活）→ 外呼 →
 *  consume(intentGuard CAS 门) → complete 门序（count===1 才写 doc，F13"看到产物 ⇒ 意图仍有效"）
 *  → writeExecStatus(done)；catch 路径 fail + exec map error。
 *  装置复用 execution.security.spec 的 makeService 骨架，增 intentService mock 与 collabDoc.writeExecStatus。
 *  构造器参数序对齐 execution.service.ts：
 *  (prisma, topology, validation, apiCaller, teamCredit, perm, collabDoc, gateway, downloadQueue, intentService)。 */
const TEXT_NODE = { id: 'n1', type: 'textInput', data: { model: 'seed-model-kimi' } };
const VIDEO_NODE = { id: 'n2', type: 'videoGen', data: { model: 'v1' } };
const IMAGE_NODE = { id: 'n3', type: 'imageGen', data: { model: 'm1' } };

function makeService(nodes: any[], intentOverrides: Record<string, any> = {}) {
  const prisma = {
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ id: 'p1', teamId: 't1' }) },
    pricingRule: { findFirst: vi.fn().mockResolvedValue({ creditCost: 1 }) },
    style: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const topology = {
    getScope: vi.fn().mockReturnValue(nodes),
    sort: vi.fn().mockReturnValue(nodes),
    collectUpstreamData: vi.fn().mockReturnValue({ textContents: ['hi'], imageUrl: null }),
  };
  const validation = { validateAll: vi.fn().mockResolvedValue({ valid: true, errors: [] }) };
  const apiCaller = {
    callTextGen: vi.fn().mockResolvedValue({ content: 'AI结果' }),
    callVideoGen: vi.fn().mockResolvedValue({ url: 'http://v' }),
    callImageGen: vi.fn().mockResolvedValue({ url: 'http://img' }),
  };
  const teamCredit = {
    consume: vi.fn().mockResolvedValue({ success: true }),
    getBalanceView: vi.fn().mockResolvedValue({ credits: 1, subscriptionCredits: 0, total: 1 }),
  };
  const perm = { resolve: vi.fn(), assertEditor: vi.fn().mockResolvedValue(undefined) };
  const collabDoc = {
    readCanvas: vi.fn().mockResolvedValue({ nodes, edges: [] }),
    writeNodeData: vi.fn(),
    writeExecStatus: vi.fn().mockResolvedValue(undefined),
  };
  const gateway = { emitNodeStatus: vi.fn(), emitExecutionComplete: vi.fn() };
  const downloadQueue = { add: vi.fn() };
  const intentService = {
    claim: vi.fn().mockResolvedValue({ created: true, intent: { id: 'row-1', intentId: 'i-1' } }),
    complete: vi.fn().mockResolvedValue(1),
    fail: vi.fn().mockResolvedValue(undefined),
    attachJob: vi.fn(),
    listByNode: vi.fn().mockResolvedValue([]),
    ...intentOverrides,
  };
  const svc: any = new (ExecutionService as any)(
    prisma, topology, validation, apiCaller, teamCredit, perm, collabDoc, gateway, downloadQueue, intentService,
  );
  return { svc, prisma, apiCaller, teamCredit, perm, collabDoc, gateway, downloadQueue, intentService };
}

describe('批0.5-6 claim 接线（外呼之前，三分支）', () => {
  it('text：claim 参数含 projectId/nodeId/userId/kind/paramsHash（=外呼实参白名单规范化）', async () => {
    const { svc, intentService } = makeService([TEXT_NODE]);
    await svc.execute('p1', 'n1', 'u1', undefined, undefined, 'hdr-intent');
    expect(intentService.claim).toHaveBeenCalledTimes(1);
    expect(intentService.claim).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1', nodeId: 'n1', userId: 'u1', kind: 'text', intentId: 'hdr-intent',
      paramsHash: normalizeIntentParams('text', { prompt: 'hi', model: 'seed-model-kimi', apiUrl: '' }),
    }));
  });

  it('video：kind=video，paramsHash=视频外呼实参集', async () => {
    const { svc, intentService } = makeService([VIDEO_NODE]);
    await svc.execute('p1', 'n2', 'u1', undefined, undefined, 'hdr-intent');
    expect(intentService.claim).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'video', intentId: 'hdr-intent',
      paramsHash: normalizeIntentParams('video', {
        prompt: 'hi', model: 'v1', mode: 'text-to-video',
        imageUrl: undefined, startImageUrl: undefined, endImageUrl: undefined,
        imageUrls: undefined, ratio: undefined, quality: undefined, duration: undefined, audio: undefined,
      }),
    }));
  });

  it('image：kind=image，paramsHash=图片外呼实参集', async () => {
    const { svc, intentService } = makeService([IMAGE_NODE]);
    await svc.execute('p1', 'n3', 'u1', undefined, undefined, 'hdr-intent');
    expect(intentService.claim).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'image', intentId: 'hdr-intent',
      paramsHash: normalizeIntentParams('image', {
        prompt: 'hi', extraPrompt: undefined, style: undefined,
        model: 'm1', resolution: undefined, imageUrl: null,
      }),
    }));
  });
});

describe('批0.5-6 幂等重放（claim created=false ⇒ SUCCEEDED）', () => {
  it('零外呼零扣费零 complete + done 带既有 resultRef', async () => {
    const { svc, apiCaller, teamCredit, gateway, intentService } = makeService([IMAGE_NODE], {
      claim: vi.fn().mockResolvedValue({
        created: false,
        intent: { id: 'row-1', intentId: 'i-1', status: 'SUCCEEDED', resultRef: 'http://old/img.png' },
      }),
    });
    const r = await svc.execute('p1', 'n3', 'u1');
    expect(r.success).toBe(true);
    expect(apiCaller.callImageGen).not.toHaveBeenCalled();
    expect(teamCredit.consume).not.toHaveBeenCalled();
    expect(intentService.complete).not.toHaveBeenCalled();
    expect(gateway.emitNodeStatus).toHaveBeenCalledWith('p1', { nodeId: 'n3', status: 'done', fileId: 'http://old/img.png' });
  });
});

describe('批0.5-6 双击 409（NODE_BUSY 冒泡）', () => {
  it('claim 抛 NodeBusyError → execute rejects（409 族 BusinessException 透出）——零外呼/零 fail/零 exec map 写（不覆盖在飞执行）', async () => {
    const { svc, apiCaller, intentService, collabDoc } = makeService([IMAGE_NODE], {
      claim: vi.fn().mockRejectedValue(new NodeBusyError()),
    });
    await expect(svc.execute('p1', 'n3', 'u1')).rejects.toBeInstanceOf(NodeBusyError);
    expect(apiCaller.callImageGen).not.toHaveBeenCalled();
    expect(intentService.fail).not.toHaveBeenCalled();
    expect(collabDoc.writeExecStatus).not.toHaveBeenCalled();
    expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
  });
});

describe('批0.5-6 complete 门序（F13：看到产物 ⇒ 意图仍有效）', () => {
  it('count===1：text → resultRef=text 产物摘要 + writeNodeData({result}) + writeExecStatus(done, intentId)', async () => {
    const { svc, collabDoc, intentService } = makeService([TEXT_NODE]);
    await svc.execute('p1', 'n1', 'u1');
    expect(intentService.complete).toHaveBeenCalledWith('row-1', 'text:AI结果');
    expect(collabDoc.writeNodeData).toHaveBeenCalledWith('p1', 'n1', expect.objectContaining({ result: 'AI结果' }));
    expect(collabDoc.writeExecStatus).toHaveBeenCalledWith('p1', 'n1', expect.objectContaining({ status: 'done', intentId: 'i-1' }));
  });

  it('count===1：video → resultRef=videoUrl 锚点 + writeExecStatus(done, intentId, fileId)', async () => {
    const { svc, collabDoc, intentService } = makeService([VIDEO_NODE]);
    await svc.execute('p1', 'n2', 'u1');
    expect(intentService.complete).toHaveBeenCalledWith('row-1', 'http://v');
    expect(collabDoc.writeNodeData).toHaveBeenCalledWith('p1', 'n2', { videoUrl: 'http://v' });
    expect(collabDoc.writeExecStatus).toHaveBeenCalledWith('p1', 'n2', expect.objectContaining({ status: 'done', intentId: 'i-1', fileId: 'http://v' }));
  });

  it('count===1：image → resultRef=resultUrl 锚点（media.create 在下载侧异步，本服务以 URL 为锚）', async () => {
    const { svc, collabDoc, intentService } = makeService([IMAGE_NODE]);
    await svc.execute('p1', 'n3', 'u1');
    expect(intentService.complete).toHaveBeenCalledWith('row-1', 'http://img');
    expect(collabDoc.writeNodeData).toHaveBeenCalledWith('p1', 'n3', { resultUrl: 'http://img' });
    expect(collabDoc.writeExecStatus).toHaveBeenCalledWith('p1', 'n3', expect.objectContaining({ status: 'done', intentId: 'i-1', fileId: 'http://img' }));
  });

  it('count===0（行已被 reconcile VOIDED+退款）→ writeNodeData/done/download 全跳过 + 对账告警', async () => {
    const { svc, collabDoc, gateway, downloadQueue } = makeService([IMAGE_NODE], {
      complete: vi.fn().mockResolvedValue(0),
    });
    const warn = vi.spyOn((svc as any).logger, 'warn');
    const r = await svc.execute('p1', 'n3', 'u1');
    expect(r.success).toBe(true);
    expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
    expect(collabDoc.writeExecStatus).not.toHaveBeenCalledWith('p1', 'n3', expect.objectContaining({ status: 'done' }));
    expect(gateway.emitNodeStatus).not.toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'done' }));
    expect(downloadQueue.add).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('批0.5-6 consume intentGuard（CAS 扣费门——重跑全组合只扣一次）', () => {
  it('三分支 consume 全带 {intentRowId, intentId}', async () => {
    const { svc, teamCredit } = makeService([TEXT_NODE, VIDEO_NODE, IMAGE_NODE]);
    await svc.execute('p1', undefined, 'u1');
    expect(teamCredit.consume).toHaveBeenCalledTimes(3);
    for (const c of teamCredit.consume.mock.calls) {
      expect(c[4]).toEqual({ intentRowId: 'row-1', intentId: 'i-1' });
    }
  });
});

describe('批0.5-6 执行开始 loading（exec map 服务端写）', () => {
  it('claim 后 writeExecStatus({status:"loading", jobId, intentId})——异步路径 jobId 透传', async () => {
    const { svc, collabDoc } = makeService([TEXT_NODE]);
    await svc.execute('p1', 'n1', 'u1', undefined, undefined, undefined, 'job-9');
    expect(collabDoc.writeExecStatus).toHaveBeenCalledWith('p1', 'n1', expect.objectContaining({ status: 'loading', jobId: 'job-9', intentId: 'i-1' }));
  });

  it('loading 写失败 best-effort——执行不受阻', async () => {
    const { svc, collabDoc } = makeService([TEXT_NODE]);
    collabDoc.writeExecStatus.mockRejectedValueOnce(new Error('doc down'));
    const r = await svc.execute('p1', 'n1', 'u1');
    expect(r.success).toBe(true);
    expect(collabDoc.writeNodeData).toHaveBeenCalled();
  });
});

describe('批0.5-6 catch 路径（意图终态必达——error 展示不受门序限）', () => {
  it('外呼抛错 → intentService.fail + writeExecStatus(error) + 返回失败', async () => {
    const { svc, apiCaller, intentService, collabDoc, gateway } = makeService([TEXT_NODE]);
    apiCaller.callTextGen.mockRejectedValue(new Error('boom'));
    const r = await svc.execute('p1', 'n1', 'u1');
    expect(r.success).toBe(false);
    expect(r.errors[0]).toContain('boom');
    expect(intentService.fail).toHaveBeenCalledWith('row-1', expect.stringContaining('boom'));
    expect(collabDoc.writeExecStatus).toHaveBeenCalledWith('p1', 'n1', expect.objectContaining({ status: 'error' }));
    expect(gateway.emitNodeStatus).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'error' }));
  });

  it('扣费失败（consume success:false）→ 意图置 FAILED（同 intentId 重试 rearm 免费续跑，非 NodeBusy 到 reconcile）', async () => {
    const { svc, teamCredit, intentService, collabDoc } = makeService([TEXT_NODE]);
    teamCredit.consume.mockResolvedValue({ success: false, reason: 'CREDIT_INSUFFICIENT' });
    const r = await svc.execute('p1', 'n1', 'u1');
    expect(r.success).toBe(false);
    expect(intentService.fail).toHaveBeenCalledWith('row-1', expect.stringContaining('扣费'));
    expect(collabDoc.writeExecStatus).toHaveBeenCalledWith('p1', 'n1', expect.objectContaining({ status: 'error' }));
  });
});

describe('批0.5-6 组执行 intentId 派生（裁定：每节点独立 UUID，入参仅落首个执行节点）', () => {
  it('多节点循环各自独立意图行——首节点用入参 intentId，其余派 UUID，consume 各带各 guard', async () => {
    const { svc, intentService, teamCredit } = makeService([TEXT_NODE, IMAGE_NODE]);
    intentService.claim.mockImplementation(async (input: any) => ({
      created: true, intent: { id: `row-${input.nodeId}`, intentId: input.intentId },
    }));
    await svc.execute('p1', undefined, 'u1', ['n1', 'n3'], undefined, 'hdr-intent');
    expect(intentService.claim).toHaveBeenCalledTimes(2);
    expect(intentService.claim.mock.calls[0][0]).toEqual(expect.objectContaining({ nodeId: 'n1', intentId: 'hdr-intent' }));
    expect(intentService.claim.mock.calls[1][0]).toEqual(expect.objectContaining({ nodeId: 'n3' }));
    expect(intentService.claim.mock.calls[1][0].intentId).not.toBe('hdr-intent');
    expect(intentService.claim.mock.calls[1][0].intentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(teamCredit.consume.mock.calls[0][4]).toEqual({ intentRowId: 'row-n1', intentId: 'hdr-intent' });
    expect(teamCredit.consume.mock.calls[1][4]).toEqual({ intentRowId: 'row-n3', intentId: intentService.claim.mock.calls[1][0].intentId });
  });
});

/** 装置：processor 直构（构造器序对齐 execution.processor.ts：(executionService, collabDoc, intentService)）。
 *  onFailed 形态按 bullmq Worker 'failed' 实际签名（job, error, prev）位置参数——
 *  @nestjs/bullmq explorer 直绑 worker.on（banner-cleanup.processor.ts:17 先例）。 */
function makeProcessor() {
  const executionService = { execute: vi.fn() };
  const collabDoc = { writeExecStatus: vi.fn().mockResolvedValue(undefined) };
  const intentService = { claim: vi.fn(), complete: vi.fn(), fail: vi.fn().mockResolvedValue(undefined), attachJob: vi.fn(), listByNode: vi.fn() };
  const p: any = new (ExecutionProcessor as any)(executionService, collabDoc, intentService);
  return { p, collabDoc, intentService };
}

describe('批0.5-6 processor failed 钩子（SIGKILL 终态兜底——双写 exec map + 意图表）', () => {
  it('failed → writeExecStatus(error, intentId) + intentService.fail(intentRowId) 双写', async () => {
    const { p, collabDoc, intentService } = makeProcessor();
    const job = { data: { projectId: 'p1', nodeId: 'n1', intentId: 'i-1', intentRowId: 'row-1' } };
    await p.onFailed(job as any, new Error('worker died'));
    expect(collabDoc.writeExecStatus).toHaveBeenCalledWith('p1', 'n1', expect.objectContaining({ status: 'error', intentId: 'i-1', error: 'worker died' }));
    expect(intentService.fail).toHaveBeenCalledWith('row-1', 'worker died');
  });

  it('无 intentRowId（enqueue 未接 claim——0.5-8 接上后自动全通）→ 只写 exec map', async () => {
    const { p, collabDoc, intentService } = makeProcessor();
    const job = { data: { projectId: 'p1', nodeId: 'n1', intentId: 'i-1' } };
    await p.onFailed(job as any, new Error('x'));
    expect(collabDoc.writeExecStatus).toHaveBeenCalled();
    expect(intentService.fail).not.toHaveBeenCalled();
  });

  it('无 projectId/nodeId → 早退零写', async () => {
    const { p, collabDoc, intentService } = makeProcessor();
    await p.onFailed({ data: { userId: 'u1' } } as any, new Error('x'));
    expect(collabDoc.writeExecStatus).not.toHaveBeenCalled();
    expect(intentService.fail).not.toHaveBeenCalled();
  });

  it('job undefined（bullmq failed 事件首参可 undefined）→ 零写', async () => {
    const { p, collabDoc } = makeProcessor();
    await p.onFailed(undefined as any, new Error('x'));
    expect(collabDoc.writeExecStatus).not.toHaveBeenCalled();
  });
});

/** 装置：controller 直构（构造器序对齐 execution.controller.ts：(service, perm, executionQueue, intentService)）。 */
function makeController() {
  const service = { execute: vi.fn().mockResolvedValue({ success: true, errors: [] }) };
  const perm = { resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'), assertEditor: vi.fn() };
  const queue = { add: vi.fn().mockResolvedValue({ id: 'job-1' }), getJob: vi.fn() };
  const intentService = { listByNode: vi.fn().mockResolvedValue([]) };
  const ctrl: any = new (ExecutionController as any)(service, perm, queue, intentService);
  return { ctrl, service, perm, queue, intentService };
}

describe('批0.5-6 controller 意图接线', () => {
  it('execute 读 x-intent-id 头透传 service 第6参', async () => {
    const { ctrl, service } = makeController();
    const b64 = Buffer.from('sv').toString('base64');
    await ctrl.execute({ projectId: 'p1', nodeId: 'n1' }, { user: { id: 'u1' } } as any, b64, 'hdr-intent');
    expect(service.execute).toHaveBeenCalledWith('p1', 'n1', 'u1', undefined, expect.any(Uint8Array), 'hdr-intent');
  });

  it('enqueue body.intentId 透传 job.data；缺省 null', async () => {
    const { ctrl, queue } = makeController();
    await ctrl.enqueue({ projectId: 'p1', nodeId: 'n2', intentId: 'i-9' }, { user: { id: 'u1' } } as any);
    expect(queue.add).toHaveBeenCalledWith('execution', {
      projectId: 'p1', nodeId: 'n2', userId: 'u1', sv: null, intentId: 'i-9',
    });
    await ctrl.enqueue({ projectId: 'p1', nodeId: 'n2' }, { user: { id: 'u1' } } as any);
    expect(queue.add).toHaveBeenLastCalledWith('execution', {
      projectId: 'p1', nodeId: 'n2', userId: 'u1', sv: null, intentId: null,
    });
  });
});
