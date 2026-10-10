// apps/api/src/modules/execution/deadline-reaper.int.spec.ts —— Y0b-2 T4 红用例主件（真库）
// 心跳与 deadline 双批 reaper 验收：①长任务在飞不误杀 ②超 deadline+心跳停 ⇒ VOIDED+退款+metric{phase=call}
// ③心跳新于 deadline（轮询活着）不误杀 ④判据单源 heartbeatAt（updatedAt 旧不被 stale 批收——改前红）
// ⑤phase=queue 可达（claim 后未外呼超 deadline——改前红：heartbeatAt>createdAt 恒真=queue 永不可达）
// ⑥waiting 升级档 Z84（job waiting+超 WAITING_UPGRADE_GRACE_MS ⇒ VOIDED——改前红：A 路径零动作永久悬挂）
// ⑦jobId active 短窗零动作（A 路径禁绕过——长任务防误杀）。
// 纪律（Z73）：写过去时间戳造红——fake timers 不控 PG 时钟；BullMQ 状态查询面=可编程 mock（jobStates Map）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerationIntentService } from './generation-intent.service';
import { IntentReconcileService } from './intent-reconcile.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { intentDeadlineExceededTotal } from './exec.metrics';
import { ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';

// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamCredit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const intentSvc = new GenerationIntentService(prisma as unknown as PrismaService);

/** BullMQ 状态查询面 mock（Z84）：jobId → state 可编程——reconcile 经 queue.getJob().getState() 读 */
const jobStates = new Map<string, string>();
const queueMock: any = {
  getJob: async (id: string) => ({ getState: async () => jobStates.get(id) ?? 'active', returnvalue: null }),
};
const reconcile = new IntentReconcileService(
  prisma as unknown as any, {} as any, ledger, queueMock, queueMock, {} as any, teamCredit,
);

/** 带标签 Counter 取值 helper（prom-client 15 的 .get() 不回值——扫 hashMap 按 labels 匹配；api-caller.hardening 同款） */
const labeled = (m: any, labels: Record<string, string>): number => {
  for (const v of Object.values(m.hashMap ?? {})) {
    const hit = Object.entries(labels).every(([k, val]) => (v as any).labels?.[k] === val);
    if (hit) return (v as any).value ?? 0;
  }
  return 0;
};

const PID = `int-dr-${Date.now()}`;
const UID = `int-dr-owner-${Date.now()}`;
let TID = '';
let PRICING: { pricingRuleId: string; modelId: string | null; resolutionId: string | null; durationId: string | null; creditCost: number };

/** claim 真链（GenerationIntentService.claim）——nodeId/paramsHash/gestureToken 逐用例唯一（防 partial unique/idemKey 跨用例冲突） */
const claimIntent = async (over: Record<string, unknown> = {}) =>
  intentSvc.claim({
    projectId: PID,
    nodeId: `n-${randomUUID().slice(0, 8)}`,
    userId: UID,
    gestureToken: `dr-${randomUUID().slice(0, 8)}`,
    kind: 'text',
    paramsHash: `h-${randomUUID().slice(0, 8)}`,
    teamId: TID,
    pricing: PRICING,
    ...over,
  });

const status = async (id: string) => (await prisma.generationIntent.findUnique({ where: { id } }))!.status;

(hasDb ? describe : describe.skip)('Y0b-2 T4：心跳与 deadline（真库）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-dr-owner', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'int-dr-team', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    // 钱包唯一口：ensureBalance + register_grant 100（②用例 reserve/settle/refund 真链）
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, TID));
    await ledger.runInTx((tx) => ledger.mutate(tx, {
      teamId: TID, operatorUserId: UID, type: 'register_grant', creditType: 'regular',
      balanceDelta: 100, frozenDelta: 0, referenceId: `it-dr-fund-${Date.now()}`,
    }));
    // claim 需真 PricingRule 行（pricingRuleId FK）——取付费规则（creditCost>0：②用例冻结/退款断言前提）
    const rule = await prisma.pricingRule.findFirst({ where: { active: true, modelId: { not: null }, creditCost: { gt: 0 } } });
    if (!rule) throw new Error('真库无 active 付费 PricingRule——seed 未跑？');
    PRICING = { pricingRuleId: rule.id, modelId: rule.modelId, resolutionId: rule.resolutionId, durationId: rule.durationId, creditCost: rule.creditCost };
  }, 20_000);

  afterAll(async () => {
    await prisma.generationIntent.deleteMany({ where: { projectId: PID } });
    await ledgerWipe(ledger, { teamId: TID });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  }, 20_000);

  it('①挂起外呼+心跳持续+未超 deadline → 不 VOIDED（长任务合法在飞）', async () => {
    const { intent } = await claimIntent({ kind: 'video', jobId: 'j-alive' });
    jobStates.set('j-alive', 'active');
    // claim 已写 heartbeatAt=now + deadlineAt=未来（video 档）——两批均不收
    await reconcile.verifyActive();
    expect(await status(intent.id)).toBe('RUNNING');
  });

  it('②超 deadline+心跳停 → VOIDED+退款+intent_deadline_exceeded_total{phase=call}（startedAt 非空）', async () => {
    const { intent } = await claimIntent({ kind: 'image' });
    const r = await teamCredit.reserve(UID, { intentRowId: intent.id });
    expect(r.mayCall).toBe(true);
    await teamCredit.settle({ intentRowId: intent.id }); // 已扣无产物——三查② refund 腿
    // 写过去时间戳（Z73）：heartbeat 先于 deadline 停 = 外呼死；startedAt 非空 = call 期分诊（Z83）
    await prisma.generationIntent.update({
      where: { id: intent.id },
      data: {
        deadlineAt: new Date(Date.now() - 60_000),
        heartbeatAt: new Date(Date.now() - 120_000),
        startedAt: new Date(Date.now() - 180_000),
      },
    });
    const before = labeled(intentDeadlineExceededTotal, { kind: 'image', phase: 'call' });
    await reconcile.verifyActive();
    expect(await status(intent.id)).toBe('VOIDED');
    expect(labeled(intentDeadlineExceededTotal, { kind: 'image', phase: 'call' })).toBe(before + 1);
    const row = await prisma.generationIntent.findUnique({ where: { id: intent.id } });
    expect(row!.creditsConsumed).toBe(0); // 退款归零——重试照常扣费
    const refunds = await prisma.teamCreditTransaction.findMany({
      where: { teamId: TID, referenceId: `intent:${intent.id}`, type: 'refund' },
    });
    expect(refunds.length).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it('③心跳新于 deadline → 不误杀（外呼仍在跑——deadline 到点但轮询活着）', async () => {
    const { intent } = await claimIntent({ kind: 'image' });
    await prisma.generationIntent.update({
      where: { id: intent.id },
      data: { deadlineAt: new Date(Date.now() - 1_000), heartbeatAt: new Date() },
    });
    await reconcile.verifyActive();
    expect(await status(intent.id)).toBe('RUNNING');
  });

  it('④判据切换：heartbeatAt 新+updatedAt 旧的 RUNNING 行不被 stale 批收（改前红——旧判据读 updatedAt）', async () => {
    const { intent } = await claimIntent({ kind: 'text' });
    await prisma.generationIntent.update({
      where: { id: intent.id },
      data: { updatedAt: new Date(Date.now() - 20 * 60_000), heartbeatAt: new Date() },
    });
    await reconcile.verifyActive();
    expect(await status(intent.id)).toBe('RUNNING'); // 心跳活着——外呼在飞非孤儿
  });

  it('⑤phase=queue：claim 后未外呼（startedAt null）即超 deadline → phase=queue（改前红：heartbeatAt>createdAt 恒真=queue 永不可达）', async () => {
    const { intent } = await claimIntent({ kind: 'text' });
    await prisma.generationIntent.update({
      where: { id: intent.id },
      data: { deadlineAt: new Date(Date.now() - 1_000), heartbeatAt: new Date(Date.now() - 2_000), startedAt: null },
    });
    const before = labeled(intentDeadlineExceededTotal, { kind: 'text', phase: 'queue' });
    await reconcile.verifyActive();
    expect(labeled(intentDeadlineExceededTotal, { kind: 'text', phase: 'queue' })).toBeGreaterThanOrEqual(before + 1);
    expect(await status(intent.id)).toBe('VOIDED'); // 未扣免费放行（三查③）
  });

  it('⑥waiting 升级档（Z84）：job waiting 且超 WAITING_UPGRADE_GRACE_MS → VOIDED+release（迟归 job 走 rearm 自愈）', async () => {
    const { intent } = await claimIntent({ kind: 'video', jobId: 'j-wait' });
    jobStates.set('j-wait', 'waiting');
    await prisma.generationIntent.update({
      where: { id: intent.id },
      data: { deadlineAt: new Date(Date.now() - 40 * 60_000), heartbeatAt: new Date(Date.now() - 41 * 60_000) },
    });
    await reconcile.verifyActive();
    await expect(status(intent.id)).resolves.toBe('VOIDED'); // 改前红：A 路径 waiting 零动作永久悬挂
  });

  it('⑦jobId active 短窗 → 仍零动作（长任务防误杀——A 路径禁绕过）', async () => {
    const { intent } = await claimIntent({ kind: 'video', jobId: 'j-act' });
    jobStates.set('j-act', 'active');
    await prisma.generationIntent.update({
      where: { id: intent.id },
      data: { deadlineAt: new Date(Date.now() - 1_000), heartbeatAt: new Date(Date.now() - 2_000) },
    });
    await reconcile.verifyActive();
    expect(await status(intent.id)).toBe('RUNNING');
  });
});
