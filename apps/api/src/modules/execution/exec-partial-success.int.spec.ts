// apps/api/src/modules/execution/exec-partial-success.int.spec.ts —— Y0b-2 T5 红用例（真库）
// 真单出口+终态投影：①NodeBusy 组内降级 skipped（Z99/Z44——改前红 :385 throw 整批 409）
// ②请求级 4xx（UNKNOWN_NODE_IDS/CYCLE/EMPTY_SCOPE——循环前 throw 合法）③F4 gated≠1 补终态 error 投影（Z95）
// ④部分成功（n2 余额不足不阻断 n3）⑤reaper 投影分治（Z106/Z112——isDocResident+deferred 计数+两码分诊）。
// 纪律：NodeBusy 用真 partial unique 造（占位 RUNNING 行），reserve 失败用 spy 包装真 teamCredit（真库其余全真链）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerationIntentService } from './generation-intent.service';
import { IntentReconcileService } from './intent-reconcile.service';
import { ExecutionService } from './execution.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { PricingResolverService } from './pricing-resolver.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { execProjectionDeferredTotal } from './exec.metrics';
import { ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';
import { BusinessException } from '../../common/exceptions/business.exception';

// 无 DATABASE_URL（CI 未起库）自动 skip
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamCredit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const intentSvc = new GenerationIntentService(prisma as unknown as PrismaService);
const resolver = new PricingResolverService(prisma as unknown as PrismaService);
const validation = new ValidationService(prisma as unknown as PrismaService, resolver);
const perm = new ProjectPermissionService(prisma as unknown as PrismaService);

const totalOf = (m: any): number => Object.values(m.hashMap ?? {}).reduce((s: number, v: any) => s + (v.value ?? 0), 0);

const UID = `int-eps-owner-${Date.now()}`;
const PID = `int-eps-${Date.now()}`;
let TID = '';
/** 手工 claim 用定价快照（deadline-reaper 同款：真库 active 付费规则行——execute 走 validation plans 真源）。 */
let PAID: { pricingRuleId: string; modelId: string | null; resolutionId: string | null; durationId: string | null; creditCost: number };

/** 夹具节点（funds-four-way 同款——真 seed 规则键：text=kimi / image=hy-image 1024）。 */
const textNode = (id: string) => ({ id, type: 'textInput', data: { model: 'seed-model-kimi' } });
const imageNode = (id: string) => ({ id, type: 'imageGen', data: { model: 'seed-model-hy-image', resolution: 'seed-res-hy-1024' } });

/** ExecutionService 直构（funds-four-way 形态）：collab 面=记录器 stub（writeNodeData/writeExecStatus 可断言）。 */
function makeExec(nodes: any[], collabOverrides: Record<string, unknown> = {}) {
  const apiCaller = new ApiCallerService(prisma as unknown as PrismaService);
  vi.spyOn(apiCaller, 'callImageGen').mockResolvedValue({ url: 'http://x/1.png' } as any);
  vi.spyOn(apiCaller, 'callTextGen').mockResolvedValue({ content: '文本结果' } as any);
  const writeExecCalls: Array<{ nodeId: string; patch: any }> = [];
  const writeNodeCalls: Array<{ nodeId: string; patch: any }> = [];
  const collabDoc: any = {
    readCanvas: async () => ({ nodes, edges: [] }),
    isLeaseServing: () => true,
    writeNodeData: vi.fn(async (_p: string, nodeId: string, patch: any) => {
      writeNodeCalls.push({ nodeId, patch });
      return { written: true };
    }),
    writeExecStatus: vi.fn(async (_p: string, nodeId: string, patch: any) => {
      writeExecCalls.push({ nodeId, patch });
    }),
    ...collabOverrides,
  };
  const svc = new ExecutionService(
    prisma as unknown as PrismaService,
    new TopologyService(),
    validation,
    apiCaller,
    teamCredit,
    perm,
    collabDoc,
    { emitNodeStatus: vi.fn() } as any,
    { add: vi.fn() } as any,
    intentSvc,
  );
  return { svc, collabDoc, writeExecCalls, writeNodeCalls, apiCaller };
}

const statusOf = async (nodeId: string) =>
  prisma.generationIntent.findFirst({ where: { projectId: PID, nodeId }, orderBy: { createdAt: 'desc' } });

(hasDb ? describe : describe.skip)('Y0b-2 T5：真单出口+终态投影（Z44/Z65/Z95/Z99，真库）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-eps-owner', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'int-eps-team', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, TID));
    await ledger.runInTx((tx) => ledger.mutate(tx, {
      teamId: TID, operatorUserId: UID, type: 'register_grant', creditType: 'regular',
      balanceDelta: 200, frozenDelta: 0, referenceId: `it-eps-fund-${Date.now()}`,
    }));
    await prisma.canvasProject.create({ data: { id: PID, name: 'int-eps', userId: UID, teamId: TID } });
    const rule = await prisma.pricingRule.findFirst({ where: { active: true, modelId: { not: null }, creditCost: { gt: 0 } } });
    if (!rule) throw new Error('真库无 active 付费 PricingRule——seed 未跑？');
    PAID = { pricingRuleId: rule.id, modelId: rule.modelId, resolutionId: rule.resolutionId, durationId: rule.durationId, creditCost: rule.creditCost };
  }, 20_000);

  afterAll(async () => {
    await prisma.generationIntent.deleteMany({ where: { projectId: PID } });
    await prisma.canvasProject.deleteMany({ where: { id: PID } });
    await ledgerWipe(ledger, { teamId: TID });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  }, 20_000);

  it('Z99 组内 NodeBusy 降级：3 节点组 n2 在飞（真 partial unique 占位）→ n1 产物在 doc+errors 只含 n2{skipped}+n3 照常+n2 投影 skipped（改前红：整批 409 throw）', async () => {
    const n1 = textNode(`n1-${randomUUID().slice(0, 6)}`);
    const n2 = imageNode(`n2-${randomUUID().slice(0, 6)}`);
    const n3 = imageNode(`n3-${randomUUID().slice(0, 6)}`);
    // 占位在飞：异 gestureToken=异 idemKey，同 nodeId RUNNING → execute 的 claim 撞 partial unique → 真 NodeBusy
    await intentSvc.claim({
      projectId: PID, nodeId: n2.id, userId: UID, gestureToken: `occ-${randomUUID().slice(0, 8)}`,
      kind: 'image', paramsHash: `h-${randomUUID().slice(0, 8)}`, teamId: TID,
      pricing: PAID,
    });
    const { svc, writeExecCalls, writeNodeCalls } = makeExec([n1, n2, n3]);
    const r = await svc.execute(PID, undefined, UID, [n1.id, n2.id, n3.id], undefined, `eps-busy-${randomUUID().slice(0, 6)}`);
    expect(r.success).toBe(false);
    expect(r.errors).toHaveLength(1); // n1/n3 不进 errors
    expect(r.errors[0]).toMatchObject({ nodeId: n2.id, status: 'skipped' });
    expect(r.results.map((x: any) => x.nodeId)).toEqual(expect.arrayContaining([n1.id, n3.id])); // ①n1 产物+③n3 照常
    expect(writeNodeCalls.map((c) => c.nodeId)).toEqual(expect.arrayContaining([n1.id, n3.id]));
    const n2proj = writeExecCalls.filter((c) => c.nodeId === n2.id).at(-1)!;
    expect(n2proj.patch.status).toBe('skipped'); // ④投影 skipped（Z99 禁 error——别处在飞非节点失败）
    expect(typeof n2proj.patch.attempts).toBe('number'); // Z111：投影必携 attempts
  }, 30_000);

  it('请求级 4xx：UNKNOWN_NODE_IDS（nodeIds 含不存在 id）→ BusinessException 循环前 throw（改前红=静默空成功）', async () => {
    const n1 = imageNode(`n1-${randomUUID().slice(0, 6)}`);
    const { svc } = makeExec([n1]);
    const ex = await svc.execute(PID, undefined, UID, [n1.id, 'ghost-node'], undefined).catch((e: unknown) => e);
    expect(ex).toBeInstanceOf(BusinessException);
    expect((ex as BusinessException).errorCode).toBe('UNKNOWN_NODE_IDS');
  });

  it('请求级 4xx：CYCLE（组内环）→ BusinessException（改前红=Kahn 静默丢环成员=部分成功）', async () => {
    const a = imageNode(`ca-${randomUUID().slice(0, 6)}`);
    const b = imageNode(`cb-${randomUUID().slice(0, 6)}`);
    const nodes = [a, b];
    const edges = [{ source: a.id, target: b.id }, { source: b.id, target: a.id }];
    const apiCaller = new ApiCallerService(prisma as unknown as PrismaService);
    vi.spyOn(apiCaller, 'callImageGen').mockResolvedValue({ url: 'http://x/1.png' } as any);
    const svc = new ExecutionService(
      prisma as unknown as PrismaService, new TopologyService(), validation, apiCaller, teamCredit, perm,
      { readCanvas: async () => ({ nodes, edges }), isLeaseServing: () => true, writeNodeData: vi.fn(), writeExecStatus: vi.fn() } as any,
      { emitNodeStatus: vi.fn() } as any, { add: vi.fn() } as any, intentSvc,
    );
    const ex = await svc.execute(PID, undefined, UID, [a.id, b.id], undefined).catch((e: unknown) => e);
    expect(ex).toBeInstanceOf(BusinessException);
    expect((ex as BusinessException).errorCode).toBe('CYCLE');
  });

  it('请求级 4xx：EMPTY_SCOPE（nodeIds 空组）→ BusinessException（改前红=静默空成功）', async () => {
    const { svc } = makeExec([]);
    const ex = await svc.execute(PID, undefined, UID, [], undefined).catch((e: unknown) => e);
    expect(ex).toBeInstanceOf(BusinessException);
    expect((ex as BusinessException).errorCode).toBe('EMPTY_SCOPE');
  });

  it('F4+Z95：gated!==1（reaper 已 VOID）→ results 不含该节点产物+终态 error 投影+error 进 errors（改前红=success:true 无投影永挂 loading）', async () => {
    const n1 = imageNode(`n1-${randomUUID().slice(0, 6)}`);
    const { svc, writeExecCalls, writeNodeCalls } = makeExec([n1]);
    const completeSpy = vi.spyOn(intentSvc, 'complete').mockResolvedValue(0); // 模拟 reaper 先手 VOID
    try {
      const r = await svc.execute(PID, undefined, UID, [n1.id], undefined, `eps-f4-${randomUUID().slice(0, 6)}`);
      expect(r.success).toBe(false);
      expect(r.results).toHaveLength(0); // F4：门序闭=产物不进 results
      expect(r.errors[0]).toMatchObject({ nodeId: n1.id, status: 'error' });
      expect(writeNodeCalls).toHaveLength(0); // doc 零写（VOIDED 吸收）
      const proj = writeExecCalls.filter((c) => c.nodeId === n1.id).at(-1)!;
      expect(proj.patch.status).toBe('error'); // Z95 补：终态 error 投影（原缺=永挂 loading）
      expect(proj.patch.errorCode).toBe('INTENT_DEADLINE_EXCEEDED');
      expect(proj.patch).toMatchObject({ rearmable: expect.any(Boolean), attempts: expect.any(Number) });
    } finally {
      completeSpy.mockRestore();
    }
  }, 30_000);

  it('部分成功：n2 reserve 失败（余额不足注入）→ n2 error+行 VOIDED+n3 照常（改前红=整批 return n3 不执行）', async () => {
    const n1 = textNode(`n1-${randomUUID().slice(0, 6)}`);
    const n2 = imageNode(`n2-${randomUUID().slice(0, 6)}`);
    const n3 = imageNode(`n3-${randomUUID().slice(0, 6)}`);
    const { svc, writeNodeCalls } = makeExec([n1, n2, n3]);
    const orig = teamCredit.reserve.bind(teamCredit);
    let call = 0;
    const spy = vi.spyOn(teamCredit, 'reserve').mockImplementation(async (uid: string, guard: any) => {
      call++;
      return call === 2 ? { success: false, reason: 'CREDIT_INSUFFICIENT' } : orig(uid, guard);
    });
    try {
      const r = await svc.execute(PID, undefined, UID, [n1.id, n2.id, n3.id], undefined, `eps-part-${randomUUID().slice(0, 6)}`);
      expect(r.success).toBe(false);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatchObject({ nodeId: n2.id, status: 'error', errorCode: 'CREDIT_INSUFFICIENT' });
      expect((await statusOf(n2.id))!.status).toBe('VOIDED'); // 零扣费终态
      expect(writeNodeCalls.map((c) => c.nodeId)).toContain(n3.id); // n3 照常（顺序执行不阻断）
      expect(r.results.map((x: any) => x.nodeId)).toContain(n3.id);
    } finally {
      spy.mockRestore();
    }
  }, 30_000);

  it('Z106/Z112 投影分治①：无连接项目（doc 非常驻）deadline 收敛 ⇒ 退款成立∧writeExecStatus 零调用∧exec_projection_deferred_total+1（改前红=withDoc 批量装载）', async () => {
    const nodeId = `n1-${randomUUID().slice(0, 6)}`;
    const { intent } = await intentSvc.claim({
      projectId: PID, nodeId, userId: UID, gestureToken: `eps-pj-${randomUUID().slice(0, 8)}`,
      kind: 'image', paramsHash: `h-${randomUUID().slice(0, 8)}`, teamId: TID,
      pricing: PAID,
    });
    await teamCredit.reserve(UID, { intentRowId: intent.id });
    await teamCredit.settle({ intentRowId: intent.id });
    await prisma.generationIntent.update({
      where: { id: intent.id },
      data: { deadlineAt: new Date(Date.now() - 60_000), heartbeatAt: new Date(Date.now() - 120_000), startedAt: new Date(Date.now() - 180_000) },
    });
    const writeExecStatus = vi.fn(async () => {});
    const reconcile = new IntentReconcileService(
      prisma as unknown as any,
      { isDocResident: () => false, writeExecStatus, probeArtifacts: vi.fn(async () => []) } as any,
      ledger, { getJob: async () => null } as any, { getJob: async () => null } as any, {} as any, teamCredit,
    );
    const before = totalOf(execProjectionDeferredTotal);
    await reconcile.verifyActive();
    expect((await prisma.generationIntent.findUnique({ where: { id: intent.id } }))!.status).toBe('VOIDED'); // 退款成立
    expect(writeExecStatus).not.toHaveBeenCalled(); // doc 未装载——UX 投影不得成为装载源
    expect(totalOf(execProjectionDeferredTotal)).toBe(before + 1); // deferred 计数
  }, 30_000);

  it('Z106/Z112 投影分治②：doc 常驻 ⇒ 投影 error 即时可见（errorCode=INTENT_DEADLINE_EXCEEDED+rearmable+attempts 同 patch）', async () => {
    const nodeId = `n2-${randomUUID().slice(0, 6)}`;
    const { intent } = await intentSvc.claim({
      projectId: PID, nodeId, userId: UID, gestureToken: `eps-pj2-${randomUUID().slice(0, 8)}`,
      kind: 'image', paramsHash: `h-${randomUUID().slice(0, 8)}`, teamId: TID,
      pricing: PAID,
    });
    await teamCredit.reserve(UID, { intentRowId: intent.id });
    await prisma.generationIntent.update({
      where: { id: intent.id },
      data: { deadlineAt: new Date(Date.now() - 60_000), heartbeatAt: new Date(Date.now() - 120_000), startedAt: new Date(Date.now() - 180_000) },
    });
    const writeExecStatus = vi.fn(async () => {});
    const reconcile = new IntentReconcileService(
      prisma as unknown as any,
      { isDocResident: () => true, writeExecStatus, probeArtifacts: vi.fn(async () => []) } as any,
      ledger, { getJob: async () => null } as any, { getJob: async () => null } as any, {} as any, teamCredit,
    );
    await reconcile.verifyActive();
    expect((await prisma.generationIntent.findUnique({ where: { id: intent.id } }))!.status).toBe('VOIDED');
    expect(writeExecStatus).toHaveBeenCalledWith(PID, nodeId, {
      status: 'error', errorCode: 'INTENT_DEADLINE_EXCEEDED', rearmable: true, attempts: intent.attempts,
      error: expect.any(String),
    });
  }, 30_000);
});
