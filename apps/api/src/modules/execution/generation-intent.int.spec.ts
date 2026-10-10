import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GenerationIntentService,
  NodeBusyError,
} from './generation-intent.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { createIntentFixture, ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';

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
  gestureToken: 'int-gi-token', // Y0b-2 T6：normalizeRegenToken 严格形态 ^[0-9a-zA-Z_-]{8,64}$（旧 'i1' 两字符会 400）
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
    await deleteTeamsWithPass(prisma as unknown as PrismaService, (await prisma.team.findMany({ where: { ownerId: INT_UID }, select: { id: true } })).map((t) => t.id));
    await prisma.user.deleteMany({ where: { id: INT_UID } });
    await prisma.$disconnect();
  });

  it('同节点两个不同 idemKey → 第二个撞活跃 partial unique：P2002 meta.target 实测形态 + NodeBusy', async () => {
    // 先占住 n-meta 节点的活跃槽
    await svc.claim(input({ gestureToken: 'meta-a-tok', nodeId: 'n-meta' }));

    // 直接裸 create 复现 P2002——绕过 service catch，捕获 meta.target 原始形态（关键产出）
    let raw: any;
    try {
      await createIntentFixture(prisma as unknown as PrismaService, {
        projectId: PID, nodeId: 'n-meta', userId: INT_UID, teamId: TID, intentId: 'i-meta-b', kind: 'image', paramsHash: 'h1',
        pricingRuleId: PRICING.pricingRuleId, modelId: PRICING.modelId, resolutionId: null, durationId: null, creditCost: PRICING.creditCost,
      });
      expect.unreachable('应撞活跃 partial unique');
    } catch (e: any) {
      expect(e.code).toBe('P2002');
      raw = e;
    }
    // 实测形态原文（字符串 or 数组——service 等值分义以此为准）
    console.log('[int] P2002 meta.target 实测形态:', JSON.stringify(raw.meta?.target), '| typeof:', typeof raw.meta?.target);

    // service 分义路径：异 idemKey claim → NodeBusy（非原始 P2002 透传）
    await expect(svc.claim(input({ gestureToken: 'meta-c-tok', nodeId: 'n-meta' }))).rejects.toBeInstanceOf(NodeBusyError);
  });

  it('Y0b-1/Z33：同节点双 idemKey 并发 claim ⇒ 一 created 一 NodeBusy（非 25P02/500）', async () => {
    const base = { projectId: PID, nodeId: `conc-${Date.now()}`, userId: INT_UID, kind: 'text', paramsHash: 'h',
      teamId: TID, pricing: PRICING };
    const r = await Promise.allSettled([
      svc.claim({ ...base, gestureToken: `conc-a-${Date.now()}` }),
      svc.claim({ ...base, gestureToken: `conc-b-${Date.now()}` }), // 同 nodeId 异 idemKey——撞 active partial unique
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rej = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rej.reason).toMatchObject({ errorCode: 'NODE_BUSY' }); // aborted-tx/500=红相（Z33 缺陷形态——errorCode 断言 rename-proof）
  });

  it('Y0b-2 T1/Z109 红测①（改前红=复合唯一被吞+409/NodeBusy）：同手势 token 改参数重试 ⇒ 新行新扣费（非 409 非 NodeBusy）', async () => {
    const first = await svc.claim(input({ gestureToken: `ctx-${Date.now()}`, nodeId: 'n-ctx', paramsHash: 'h1' }));
    expect(first.created).toBe(true);
    expect(await svc.complete(first.intent.id, 'text:done')).toBe(1);   // 首跑终态（改参重试的真实前置——RUNNING 期同节点本就互斥）

    const second = await svc.claim(input({ gestureToken: first.intent.gestureKey ?? undefined, nodeId: 'n-ctx', paramsHash: 'h2' }));
    // 异 paramsHash ⇒ 异 idemKey ⇒ 走分支①新行（旧 INTENT_CONTEXT_MISMATCH 409 语义退役——改参=新意图新扣费）
    expect(second.created).toBe(true);
    expect(second.intent.id).not.toBe(first.intent.id);
    const rows = await prisma.generationIntent.findMany({ where: { projectId: PID, nodeId: 'n-ctx' } });
    expect(rows).toHaveLength(2); // 恰两行——改参重试未被吞
  });

  it('Y0b-2 T1/Z104 红测②：同 project/node/content 并发两次 claim ⇒ 恰一行、败者 NodeBusy（idemKey 唯一合取保持）', async () => {
    const nodeId = `z104-${Date.now()}`;
    const base = { projectId: PID, nodeId, userId: INT_UID, kind: 'text', paramsHash: 'h', teamId: TID, pricing: PRICING };
    const r = await Promise.allSettled([
      svc.claim({ ...base }),  // 无 token——内容键
      svc.claim({ ...base }),  // 同内容键并发（同步双击形态）
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rej = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rej.reason).toMatchObject({ errorCode: 'NODE_BUSY' });
    const rows = await prisma.generationIntent.findMany({ where: { projectId: PID, nodeId } });
    expect(rows).toHaveLength(1); // 恰一行——idemKey 唯一保证
  });

  it('Y0b-2 T1/Z109 红测③："重新生成"新手势 id=新行新扣费+无 token 路径命中内容键（服务端铸造值禁入 token 位）', async () => {
    const nodeId = `z109-${Date.now()}`;
    const base = { projectId: PID, nodeId, userId: INT_UID, kind: 'text', paramsHash: 'h', teamId: TID, pricing: PRICING };
    // 无 token 路径：内容键命中 claim②③——同 jobId 可重入/异 jobId NodeBusy
    const a = await svc.claim({ ...base, jobId: 'j-run' });
    expect(a.created).toBe(true);
    expect(a.intent.gestureKey).toBeNull(); // 无 token 行 gestureKey=null——行身份 intentId（铸造 UUID）不进 token 位
    const reentry = await svc.claim({ ...base, jobId: 'j-run' });
    expect(reentry.created).toBe(true); // ② 内容键+同 jobId 可重入
    await expect(svc.claim({ ...base, jobId: 'j-other' })).rejects.toMatchObject({ errorCode: 'NODE_BUSY' }); // ③ 异 jobId 互斥
    expect(await svc.complete(a.intent.id, 'text:done')).toBe(1);   // 重新生成的真实前置——前跑终态
    // 手势路径：新手势 id=新行（同内容不同 token）
    const regen = await svc.claim({ ...base, gestureToken: `rg-${Date.now()}` });
    expect(regen.created).toBe(true);
    expect(regen.intent.id).not.toBe(a.intent.id); // 新行新扣费
    const rows = await prisma.generationIntent.findMany({ where: { projectId: PID, nodeId } });
    expect(rows).toHaveLength(2); // 内容行+手势行
  });

  it('真库 rearm 原子性：FAILED 行并发双 claim → 恰一个 created:true 一个 NodeBusy，attempts 只 +1', async () => {
    const first = await svc.claim(input({ gestureToken: 'rearm-tok-1', nodeId: 'n-rearm' }));
    expect(first.created).toBe(true);
    await svc.fail(first.intent.id, 'boom');

    const results = await Promise.allSettled([
      svc.claim(input({ gestureToken: 'rearm-tok-1', nodeId: 'n-rearm', jobId: 'job-a' })),
      svc.claim(input({ gestureToken: 'rearm-tok-1', nodeId: 'n-rearm', jobId: 'job-b' })),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled' && r.value.created === true);
    const busy = results.filter((r) => r.status === 'rejected' && r.reason instanceof NodeBusyError);
    expect(ok.length).toBe(1);
    expect(busy.length).toBe(1);

    const after = await prisma.generationIntent.findUnique({
      where: { id: first.intent.id },
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
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);

(hasDb ? describe : describe.skip)('批 5a Task 7-1 credits 双池不变量（int）', () => {
  const INV = { uid: 'int-gi-053-inv-u', email: 'int-gi-053-inv@test.local' };
  const teamIds: string[] = [];

  afterAll(async () => {
    for (const tid of teamIds) {
      await ledgerWipe(ledger, { teamId: tid });
      await prisma.teamMember.deleteMany({ where: { teamId: tid } });
    }
    await deleteTeamsWithPass(prisma as unknown as PrismaService, teamIds);
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
    // Y0b-2（Z116/触发器）：钱包初值经台账（register_grant 两池分列——referenceId 后缀化防 money_in 撞键）
    await ledger.runInTx(async (tx) => {
      await ledger.ensureBalance(tx, team.id);
      await ledger.lockBalance(tx, team.id);
      if (credits > 0) await ledger.mutate(tx, {
        teamId: team.id, operatorUserId: INV.uid, type: 'register_grant', creditType: 'regular',
        balanceDelta: credits, frozenDelta: 0, referenceId: `it-fix-${randomUUID().slice(0, 8)}`,
      });
      if (subscriptionCredits > 0) await ledger.mutate(tx, {
        teamId: team.id, operatorUserId: INV.uid, type: 'register_grant', creditType: 'subscription',
        balanceDelta: subscriptionCredits, frozenDelta: 0, referenceId: `it-fix-${randomUUID().slice(0, 8)}`,
      });
    });
    return team.id;
  }

  it('reserve→settle：Δ双池和==creditsConsumed ∧ 终态唯一（重复 settle 零动作）', async () => {
    const tid = await mkTeam(30, 50); // amount=60 跨两池：订阅 50 全扣+常规 10（拆分路径真实发生）
    const intent = await createIntentFixture(prisma as unknown as PrismaService, {
      // Y0b-1（Z10）：金额单源 intent 行——creditCost 即 reserve 冻结额（旧显式 60 入参退役）
      projectId: PID, nodeId: 'n-credit-a', userId: INV.uid, teamId: tid, intentId: 'i-credit-a', kind: 'image', paramsHash: 'h1', creditCost: 60,
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
    const intent = await createIntentFixture(prisma as unknown as PrismaService, {
      projectId: PID, nodeId: 'n-credit-b', userId: INV.uid, teamId: tid, intentId: 'i-credit-b', kind: 'image', paramsHash: 'h1', creditCost: 15,
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
    // Y0b-2 T1：monthlyUsed 断言随列退役删除（T0 已派生化——用量读点=getBalanceView.used，本用例零消费即零用量）
    expect(row?.creditsConsumed).toBe(0);
  });
});
