import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GenerationIntentService,
  NodeBusyError,
  IntentContextMismatchError,
} from './generation-intent.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';

// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
// 本地真库可能有开发数据——全部测试行收拢到专属 projectId，清理只删该前缀
const PID = 'int-gi-053';
const INT_UID = 'int-gi-053-owner';

const svc = new GenerationIntentService(prisma as unknown as PrismaService);

// Y0b-1：claim 需真团队行（FOR SHARE 准入谓词）与真 PricingRule 行（pricingRuleId FK）——beforeAll 建夹具
let TID = '';
let PRICING: { pricingRuleId: string; modelId: string | null; resolutionId: string | null; durationId: string | null; creditCost: number };

const input = (over: Record<string, unknown> = {}) => ({
  projectId: PID,
  nodeId: 'n1',
  userId: INT_UID,
  intentId: 'i1',
  kind: 'image',
  paramsHash: 'h1',
  teamId: TID,
  pricing: PRICING,
  ...over,
});

(hasDb ? describe : describe.skip)('GenerationIntent 真库并发行为（int）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: INT_UID },
      create: { id: INT_UID, name: 'int-gi-053-owner', email: 'int-gi-053-owner@test.local', emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'int-gi-053-team', ownerId: INT_UID } });
    TID = team.id;
    const rule = await prisma.pricingRule.findFirst({ where: { active: true, modelId: { not: null } }, orderBy: { creditCost: 'asc' } });
    if (!rule) throw new Error('真库无 active PricingRule——T1b 迁移未 apply？');
    PRICING = { pricingRuleId: rule.id, modelId: rule.modelId, resolutionId: rule.resolutionId, durationId: rule.durationId, creditCost: rule.creditCost };
  });

  afterAll(async () => {
    await prisma.generationIntent.deleteMany({ where: { projectId: PID } });
    await prisma.team.deleteMany({ where: { ownerId: INT_UID } });
    await prisma.user.deleteMany({ where: { id: INT_UID } });
    await prisma.$disconnect();
  });

  it('同节点两个不同 intentId → 第二个撞活跃 partial unique：P2002 meta.target 实测形态 + NodeBusy', async () => {
    // 先占住 n-meta 节点的活跃槽
    await svc.claim(input({ intentId: 'i-meta-a', nodeId: 'n-meta' }));

    // 直接裸 create 复现 P2002——绕过 service catch，捕获 meta.target 原始形态（关键产出）
    let raw: any;
    try {
      await prisma.generationIntent.create({
        data: { projectId: PID, nodeId: 'n-meta', userId: INT_UID, teamId: TID, intentId: 'i-meta-b', kind: 'image', paramsHash: 'h1',
          pricingRuleId: PRICING.pricingRuleId, modelId: PRICING.modelId, resolutionId: null, durationId: null, creditCost: PRICING.creditCost },
      });
      expect.unreachable('应撞活跃 partial unique');
    } catch (e: any) {
      expect(e.code).toBe('P2002');
      raw = e;
    }
    // 实测形态原文（字符串 or 数组——service 等值分义以此为准）
    console.log('[int] P2002 meta.target 实测形态:', JSON.stringify(raw.meta?.target), '| typeof:', typeof raw.meta?.target);

    // service 分义路径：异 intentId claim → NodeBusy（非原始 P2002 透传）
    await expect(svc.claim(input({ intentId: 'i-meta-c', nodeId: 'n-meta' }))).rejects.toBeInstanceOf(NodeBusyError);
  });

  it('Y0b-1/Z33：同节点双 intentId 并发 claim ⇒ 一 created 一 NodeBusy（非 25P02/500）', async () => {
    const base = { projectId: PID, nodeId: `conc-${Date.now()}`, userId: INT_UID, kind: 'text', paramsHash: 'h',
      teamId: TID, pricing: PRICING };
    const r = await Promise.allSettled([
      svc.claim({ ...base, intentId: `conc-a-${Date.now()}` }),
      svc.claim({ ...base, intentId: `conc-b-${Date.now()}` }), // 同 nodeId 异 intentId——撞 active partial unique
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rej = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rej.reason).toMatchObject({ errorCode: 'NODE_BUSY' }); // aborted-tx/500=红相（Z33 缺陷形态——errorCode 断言 rename-proof）
  });

  it('同 intentId 异参数第二次 claim → INTENT_CONTEXT_MISMATCH（真库复合唯一命中路径）', async () => {
    await svc.claim(input({ intentId: 'i-ctx', nodeId: 'n-ctx', paramsHash: 'h1' }));

    await expect(
      svc.claim(input({ intentId: 'i-ctx', nodeId: 'n-ctx', paramsHash: 'h2' })),
    ).rejects.toBeInstanceOf(IntentContextMismatchError);
  });

  it('真库 rearm 原子性：FAILED 行并发双 claim → 恰一个 created:true 一个 NodeBusy，attempts 只 +1', async () => {
    const first = await svc.claim(input({ intentId: 'i-rearm', nodeId: 'n-rearm' }));
    expect(first.created).toBe(true);
    await svc.fail(first.intent.id, 'boom');

    const results = await Promise.allSettled([
      svc.claim(input({ intentId: 'i-rearm', nodeId: 'n-rearm', jobId: 'job-a' })),
      svc.claim(input({ intentId: 'i-rearm', nodeId: 'n-rearm', jobId: 'job-b' })),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled' && r.value.created === true);
    const busy = results.filter((r) => r.status === 'rejected' && r.reason instanceof NodeBusyError);
    expect(ok.length).toBe(1);
    expect(busy.length).toBe(1);

    const after = await prisma.generationIntent.findUnique({
      where: { projectId_intentId: { projectId: PID, intentId: 'i-rearm' } },
    });
    expect(after?.status).toBe('RUNNING');
    expect(after?.attempts).toBe(2); // 双并发只赢一次——守卫式 updateMany 原子性
  });
});

// 批 5a Task 7-1（plan 5a）：扣费不变量——增量式断言（共享库上绝对值不稳），fixture 隔离+测后清理。
// 弱化点（显式登记）：GenerationIntent 无 creditType 列（池归属只存在于 TeamCreditTransaction）——
// intent↔balance 对账面只能双池和式：验总量守恒（抓扣费遗漏/重复扣费），不验池归属。
// 池级断言路径=TeamCreditTransaction 按 referenceId=intent:* 分组求和（下方补充覆盖）。
// Y0b-1（Z10/Z12）：写路径经 CreditLedgerService——两参构造（台账唯一写入口）
const creditSvc = new TeamCreditService(prisma as unknown as PrismaService, new CreditLedgerService(prisma as unknown as PrismaService));

(hasDb ? describe : describe.skip)('批 5a Task 7-1 credits 双池不变量（int）', () => {
  const INV = { uid: 'int-gi-053-inv-u', email: 'int-gi-053-inv@test.local' };
  const teamIds: string[] = [];

  afterAll(async () => {
    for (const tid of teamIds) {
      await prisma.teamCreditTransaction.deleteMany({ where: { teamId: tid } });
      await prisma.teamBalance.deleteMany({ where: { teamId: tid } });
      await prisma.teamMember.deleteMany({ where: { teamId: tid } });
      await prisma.team.deleteMany({ where: { id: tid } });
    }
    await prisma.generationIntent.deleteMany({ where: { projectId: PID, nodeId: { in: ['n-credit-a', 'n-credit-b'] } } });
    await prisma.user.deleteMany({ where: { id: INV.uid } });
  });

  async function mkTeam(credits: number, subscriptionCredits: number): Promise<string> {
    await prisma.user.upsert({
      where: { id: INV.uid },
      create: { id: INV.uid, name: 'int-inv', email: INV.email, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: `int-gi-053-inv-team-${teamIds.length}`, ownerId: INV.uid } });
    teamIds.push(team.id);
    await prisma.teamMember.create({ data: { teamId: team.id, userId: INV.uid, role: 'OWNER', monthlyQuota: 0 } });
    await prisma.teamBalance.create({ data: { teamId: team.id, credits, subscriptionCredits } });
    return team.id;
  }

  it('reserve→settle：Δ双池和==creditsConsumed ∧ 终态唯一（重复 settle 零动作）', async () => {
    const tid = await mkTeam(30, 50); // amount=60 跨两池：订阅 50 全扣+常规 10（拆分路径真实发生）
    const intent = await prisma.generationIntent.create({
      // Y0b-1（Z10）：金额单源 intent 行——creditCost 即 reserve 冻结额（旧显式 60 入参退役）
      data: { projectId: PID, nodeId: 'n-credit-a', userId: INV.uid, teamId: tid, intentId: 'i-credit-a', kind: 'image', paramsHash: 'h1', creditCost: 60 },
    });
    const before = await prisma.teamBalance.findUnique({ where: { teamId: tid } });

    const r = await creditSvc.reserve(INV.uid, { intentRowId: intent.id });
    expect(r.success).toBe(true);
    const s = await creditSvc.settle({ intentRowId: intent.id });
    expect(s).toEqual({ success: true, settled: true });

    const after = await prisma.teamBalance.findUnique({ where: { teamId: tid } });
    const row = await prisma.generationIntent.findUnique({ where: { id: intent.id } });
    expect(row?.creditsConsumed).toBe(60); // TDD 牙齿验证后翻正（红值 61 实测 expected 60 to be 61）
    expect(row?.reservedCredits).toBe(0);
    // 主断言（和式——intent 侧无池维度，唯一可落形态）
    expect((before!.credits - after!.credits) + (before!.subscriptionCredits - after!.subscriptionCredits)).toBe(row!.creditsConsumed);

    // 池级补充对账（Δ分池 == reserve 负流水分池合计；settle 流水是记账镜像不动余额）
    const dReg = before!.credits - after!.credits;
    const dSub = before!.subscriptionCredits - after!.subscriptionCredits;
    const negs = await prisma.teamCreditTransaction.findMany({
      where: { teamId: tid, type: 'reserve', amount: { lt: 0 }, referenceId: `intent:${intent.id}` }, // F1 锚：intent 行 id 非 intentId
    });
    const sum = (t: string) => negs.filter((x) => x.creditType === t).reduce((a, x) => a + Math.abs(x.amount), 0);
    expect(dReg).toBe(sum('regular'));
    expect(dSub).toBe(sum('subscription'));

    // 终态唯一：重复 settle 零动作（幂等）——settle 型流水不增
    const again = await creditSvc.settle({ intentRowId: intent.id });
    expect(again).toEqual({ success: true, settled: false });
    const settleCount = await prisma.teamCreditTransaction.count({ where: { teamId: tid, type: 'settle' } });
    expect(settleCount).toBe(2); // 两池镜像恰两条
  });

  it('reserve→void_：余额复原 ∧ creditsConsumed==0（不变量零侧：Σ==Δ==0）', async () => {
    const tid = await mkTeam(20, 0); // 单池场景
    const intent = await prisma.generationIntent.create({
      data: { projectId: PID, nodeId: 'n-credit-b', userId: INV.uid, teamId: tid, intentId: 'i-credit-b', kind: 'image', paramsHash: 'h1', creditCost: 15 },
    });
    const before = await prisma.teamBalance.findUnique({ where: { teamId: tid } });

    const r = await creditSvc.reserve(INV.uid, { intentRowId: intent.id });
    expect(r.success).toBe(true);
    await creditSvc.void_({ intentRowId: intent.id });

    const after = await prisma.teamBalance.findUnique({ where: { teamId: tid } });
    const row = await prisma.generationIntent.findUnique({ where: { id: intent.id } });
    expect(row?.creditsConsumed).toBe(0);
    expect(row?.reservedCredits).toBe(0);
    expect((before!.credits - after!.credits) + (before!.subscriptionCredits - after!.subscriptionCredits)).toBe(0);
    expect(after!.credits).toBe(20);
    expect(after!.subscriptionCredits).toBe(0);
    const member = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: tid, userId: INV.uid } } });
    expect(member?.monthlyUsed).toBe(0); // void 连带回滚月度用量
  });
});
