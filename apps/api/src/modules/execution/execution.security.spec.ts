import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ExecutionService } from './execution.service';
import { ExecutionController } from './execution.controller';

/** F4 必红：扣费失败后 doc 不得含本次新产物（text/video 曾违反——先写产物后扣费）。
 *  批0.5-9 起扣费=reserve（外呼前）；失败语义同构：writeNodeData 零调用。
 *  装置只驱动 execute 的 text/video 两分支；依赖全 mock。
 *  构造器参数序对齐 execution.service.ts：
 *  (prisma, topology, validation, apiCaller, teamCredit, perm, collabDoc, gateway, downloadQueue, intentService)。
 *  intentService 默认放行 {created:true, intent:{id,intentId}}——批0.5-6 claim 接线的最小装置（F4 用例只关心产物序）。 */
function makeService(reserveOk: boolean, nodes: any[]) {
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
    callImageGen: vi.fn(),
  };
  const teamCredit = {
    reserve: vi.fn().mockResolvedValue(reserveOk ? { success: true } : { success: false, reason: 'INSUFFICIENT_CREDITS' }),
    settle: vi.fn().mockResolvedValue({ success: true, settled: true }),
    void_: vi.fn().mockResolvedValue(undefined),
    getBalanceView: vi.fn().mockResolvedValue({ credits: 1, subscriptionCredits: 0, total: 1 }),
  };
  const perm = { resolve: vi.fn(), assertEditor: vi.fn().mockResolvedValue(undefined) };
  const collabDoc = {
    readCanvas: vi.fn().mockResolvedValue({ nodes, edges: [] }),
    isLeaseServing: vi.fn(() => true), // Y0a-3 T8 计费读门——默认放行
    writeNodeData: vi.fn(),
    writeExecStatus: vi.fn().mockResolvedValue(undefined),
  };
  const gateway = { emitNodeStatus: vi.fn(), emitExecutionComplete: vi.fn() };
  const downloadQueue = { add: vi.fn() };
  const intentService = {
    claim: vi.fn().mockResolvedValue({ created: true, intent: { id: 'intent-1', intentId: 'i-1' } }),
    complete: vi.fn().mockResolvedValue(1),
    fail: vi.fn().mockResolvedValue(undefined),
    void_: vi.fn().mockResolvedValue(undefined),
  };
  const svc: any = new (ExecutionService as any)(
    prisma, topology, validation, apiCaller, teamCredit, perm, collabDoc, gateway, downloadQueue, intentService,
  );
  return { svc, collabDoc, teamCredit, prisma, perm };
}

describe('F4 产物序（spec v5.10：看到产物 ⇒ 已扣费）', () => {
  it('text：reserve 失败 → writeNodeData 零调用（扣费前置外呼——零外呼零产物）', async () => {
    const { svc, collabDoc } = makeService(false, [{ id: 'n1', type: 'textInput', data: { model: 'seed-model-kimi' } }]);
    const r = await svc.execute('p1', 'n1', 'u1');
    expect(r.success).toBe(false);
    expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
  });

  it('video：reserve 失败 → writeNodeData 零调用', async () => {
    const { svc, collabDoc } = makeService(false, [{ id: 'n1', type: 'videoGen', data: { model: 'v1' } }]);
    const r = await svc.execute('p1', 'n1', 'u1');
    expect(r.success).toBe(false);
    expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
  });

  it('text：reserve 成功 → writeNodeData 正常写（回归锚）', async () => {
    const { svc, collabDoc } = makeService(true, [{ id: 'n1', type: 'textInput', data: { model: 'seed-model-kimi' } }]);
    await svc.execute('p1', 'n1', 'u1');
    expect(collabDoc.writeNodeData).toHaveBeenCalled();
  });
});

describe('0c-6 存在性 oracle 重排（assertEditor 先于 findUnique）', () => {
  it('assertEditor 抛错时 canvasProject.findUnique 零调用（非成员不可区分不存在 vs 无权）', async () => {
    const { svc, prisma, perm } = makeService(true, []);
    perm.assertEditor.mockRejectedValueOnce(new Error('无项目编辑权限'));
    await expect(svc.execute('p1', 'n1', 'u1')).rejects.toThrow('无项目编辑权限');
    expect(prisma.canvasProject.findUnique).not.toHaveBeenCalled();
  });
});

/** 批0c-5 必红：GET jobs/:id 今天无归属校验（任何登录用户可查任意 job 的 state/progress）。
 *  装置：controller 直构（构造器序对齐 execution.controller.ts：(service, perm, executionQueue, intentService)）。 */
function makeController(job: any, role: string | null) {
  const queue = { getJob: vi.fn().mockResolvedValue(job) };
  const perm = { resolve: vi.fn().mockResolvedValue(role), assertEditor: vi.fn() };
  const intentService = { listByNode: vi.fn().mockResolvedValue([]) };
  const ctrl: any = new (ExecutionController as any)({}, perm, queue, intentService);
  return { ctrl, queue, perm, intentService };
}

describe('批0c-5 jobs/:id 归属（default-deny + 成员级）', () => {
  it('job.data.projectId 非本人项目（resolve null）→ {error:"Job not found"}，不泄露 state/progress', async () => {
    const job = { id: 'j1', data: { projectId: 'p-other' }, getState: vi.fn().mockResolvedValue('completed'), progress: 100 };
    const { ctrl } = makeController(job, null);
    const r = await ctrl.getJob('j1', { user: { id: 'u1' } } as any);
    expect(r).toEqual({ error: 'Job not found' });
  });

  it('job 无 projectId → 同样 404 语义（default-deny，fail-closed）', async () => {
    const job = { id: 'j1', data: {}, getState: vi.fn().mockResolvedValue('completed'), progress: 100 };
    const { ctrl } = makeController(job, 'PROJECT_EDITOR');
    const r = await ctrl.getJob('j1', { user: { id: 'u1' } } as any);
    expect(r).toEqual({ error: 'Job not found' });
  });

  it('job 不存在 → 404 语义', async () => {
    const { ctrl } = makeController(null, 'PROJECT_EDITOR');
    const r = await ctrl.getJob('nope', { user: { id: 'u1' } } as any);
    expect(r).toEqual({ error: 'Job not found' });
  });

  it('成员（resolve 有角色）→ 返回 state/progress（回归锚）', async () => {
    const job = { id: 'j1', data: { projectId: 'p1' }, getState: vi.fn().mockResolvedValue('completed'), progress: 100 };
    const { ctrl, perm } = makeController(job, 'PROJECT_VIEWER');
    const r = await ctrl.getJob('j1', { user: { id: 'u1' } } as any);
    expect(perm.resolve).toHaveBeenCalledWith('p1', 'u1');
    expect(r).toEqual({ id: 'j1', state: 'completed', progress: 100 });
  });
});

/** 批0.5-6 必红：GET intents 成员级读面——与 jobs/:id 同口径（404 不泄露存在性；VIEWER 也可见）。 */
describe('批0.5-6 GET intents 归属（default-deny + 成员级）', () => {
  it('非成员（resolve null）→ 404 NotFoundException（不泄露意图存在性）', async () => {
    const { ctrl } = makeController(null, null);
    await expect(ctrl.listIntents('p1', 'n1', { user: { id: 'u1' } } as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('VIEWER（成员非 editor）→ 200 返回 listByNode 投影（读面恢复对齐的 REST 兜底）', async () => {
    const rows = [{ id: 'row-1', intentId: 'i-1', kind: 'image', status: 'SUCCEEDED', resultRef: 'http://x' }];
    const { ctrl: c, intentService, perm } = makeController(null, 'PROJECT_VIEWER');
    (intentService as any).listByNode = vi.fn().mockResolvedValue(rows);
    const r = await c.listIntents('p1', 'n1', { user: { id: 'u1' } } as any);
    expect(perm.resolve).toHaveBeenCalledWith('p1', 'u1');
    expect((intentService as any).listByNode).toHaveBeenCalledWith('p1', 'n1');
    expect(r).toEqual({ code: 0, data: rows });
  });
});
