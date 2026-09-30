import { describe, it, expect, vi } from 'vitest';
import { ExecutionService } from './execution.service';

/** F4 必红：consume 失败后 doc 不得含本次新产物（text/video 今天违反——先写产物后扣费）。
 *  装置只驱动 execute 的 text/video 两分支；依赖全 mock。
 *  构造器参数序对齐 execution.service.ts：(prisma, topology, validation, apiCaller, teamCredit, perm, collabDoc, gateway, downloadQueue)。 */
function makeService(consumeOk: boolean, nodes: any[]) {
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
    consume: vi.fn().mockResolvedValue(consumeOk ? { success: true } : { success: false, reason: 'INSUFFICIENT_CREDITS' }),
    getBalanceView: vi.fn().mockResolvedValue({ credits: 1, subscriptionCredits: 0, total: 1 }),
  };
  const perm = { resolve: vi.fn(), assertEditor: vi.fn().mockResolvedValue(undefined) };
  const collabDoc = { readCanvas: vi.fn().mockResolvedValue({ nodes, edges: [] }), writeNodeData: vi.fn() };
  const gateway = { emitNodeStatus: vi.fn(), emitExecutionComplete: vi.fn() };
  const downloadQueue = { add: vi.fn() };
  const svc: any = new (ExecutionService as any)(
    prisma, topology, validation, apiCaller, teamCredit, perm, collabDoc, gateway, downloadQueue,
  );
  return { svc, collabDoc, teamCredit, prisma, perm };
}

describe('F4 产物序（spec v5.10：看到产物 ⇒ 已扣费）', () => {
  it('text：consume 失败 → writeNodeData 零调用（今天先写——必红）', async () => {
    const { svc, collabDoc } = makeService(false, [{ id: 'n1', type: 'textInput', data: { model: 'seed-model-kimi' } }]);
    const r = await svc.execute('p1', 'n1', 'u1');
    expect(r.success).toBe(false);
    expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
  });

  it('video：consume 失败 → writeNodeData 零调用（今天先写——必红）', async () => {
    const { svc, collabDoc } = makeService(false, [{ id: 'n1', type: 'videoGen', data: { model: 'v1' } }]);
    const r = await svc.execute('p1', 'n1', 'u1');
    expect(r.success).toBe(false);
    expect(collabDoc.writeNodeData).not.toHaveBeenCalled();
  });

  it('text：consume 成功 → writeNodeData 正常写（回归锚）', async () => {
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
