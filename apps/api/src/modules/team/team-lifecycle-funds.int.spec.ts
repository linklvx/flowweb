// apps/api/src/modules/team/team-lifecycle-funds.int.spec.ts —— Y0b-1 资金门载体（spec §6.2 点名）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Y0b-1 团队/项目生命周期资金门（§1.4ter/Z4）', () => {
  const S = { keeper: '' };
  beforeAll(async () => {
    const ts = Date.now();
    S.keeper = `it-lf-keeper-${ts}`;
    await prisma.user.create({ data: { id: S.keeper, name: 'k', email: `${S.keeper}@x.invalid`, emailVerified: false } });
    await prisma.team.create({ data: { id: `it-lf-t1-${ts}`, name: 't1', ownerId: S.keeper } });
    await prisma.team.create({ data: { id: `it-lf-t2-${ts}`, name: 't2', ownerId: S.keeper } });   // 多团队（解散合法性前提）
    await prisma.teamMember.createMany({ data: [
      { teamId: `it-lf-t1-${ts}`, userId: S.keeper, role: 'OWNER' },
      { teamId: `it-lf-t2-${ts}`, userId: S.keeper, role: 'OWNER' },
    ] });
  }, 20000);
  afterAll(async () => {
    // 清理序（Team.owner Restrict）：意图 → 台账（teamId 无 FK 行随团队消亡仍须清测试残留）→ 团队（级联）→ 用户
    await prisma.generationIntent.deleteMany({ where: { intentId: { startsWith: 'lf-' } } }).catch(() => {});
    await prisma.generationIntent.deleteMany({ where: { intentId: { startsWith: 'pf-' } } }).catch(() => {});
    await prisma.teamCreditTransaction.deleteMany({ where: { teamId: { startsWith: 'it-lf-' } } }).catch(() => {});
    await prisma.team.deleteMany({ where: { id: { startsWith: 'it-lf-' } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { startsWith: 'it-lf-' } } }).catch(() => {});
    await prisma.$disconnect();
  }, 20000);

  it('在飞 RUNNING∧reservedCredits>0 ⇒ 门 409 TEAM_HAS_ACTIVE_FUNDS（红=现状无门）', async () => {
    const ts = Date.now();
    const team = `it-lf-act-${ts}`;
    await prisma.team.create({ data: { id: team, name: 'act', ownerId: S.keeper } });
    await prisma.teamMember.create({ data: { teamId: team, userId: S.keeper, role: 'OWNER' } });
    await prisma.teamBalance.create({ data: { teamId: team, credits: 100 } });
    await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: team, nodeId: 'n', userId: S.keeper, intentId: `lf-${ts}`, kind: 'text', paramsHash: 'h', status: 'RUNNING', creditCost: 5, reservedCredits: 5 } as any });
    const { TeamFundsGateService } = await import('./team-funds-gate.service');
    const gate = new TeamFundsGateService(prisma as any);
    await expect(gate.assertSettled(prisma as any, { teamId: team })).rejects.toMatchObject({ errorCode: 'TEAM_HAS_ACTIVE_FUNDS' });
    await prisma.generationIntent.deleteMany({ where: { teamId: team } });
    await expect(gate.assertSettled(prisma as any, { teamId: team })).resolves.toBeUndefined();   // 终态后放行
    await prisma.team.delete({ where: { id: team } });
  }, 20000);

  it('Z4 准入谓词：DISBANDED 团队的 claim ⇒ 409 TEAM_CLOSED（已在 T3 落地——守护回归）', async () => {
    const ts = Date.now();
    const team = `it-lf-dis-${ts}`;
    await prisma.team.create({ data: { id: team, name: 'dis', ownerId: S.keeper, status: 'DISBANDED' } });
    const { GenerationIntentService } = await import('../execution/generation-intent.service');
    const svc = new GenerationIntentService(prisma as any);
    await expect(svc.claim({
      projectId: 'it-p', nodeId: 'n', userId: S.keeper, intentId: `lf-dis-${ts}`, kind: 'text', paramsHash: 'h',
      teamId: team, pricing: { pricingRuleId: 'pr', modelId: null, resolutionId: null, durationId: null, creditCost: 1 },
    } as any)).rejects.toMatchObject({ errorCode: 'TEAM_CLOSED' });
    await prisma.team.delete({ where: { id: team } });
  }, 20000);

  it('项目删除同门（projectId 维度）', async () => {
    const ts = Date.now();
    const team = `it-lf-prj-${ts}`;
    await prisma.team.create({ data: { id: team, name: 'prj', ownerId: S.keeper } });
    await prisma.generationIntent.create({ data: { projectId: `it-pj-${ts}`, teamId: team, nodeId: 'n', userId: S.keeper, intentId: `pf-${ts}`, kind: 'image', paramsHash: 'h', status: 'RUNNING', creditCost: 3, reservedCredits: 3 } as any });
    const { TeamFundsGateService } = await import('./team-funds-gate.service');
    const gate = new TeamFundsGateService(prisma as any);
    await expect(gate.assertSettled(prisma as any, { projectId: `it-pj-${ts}` })).rejects.toMatchObject({ errorCode: 'TEAM_HAS_ACTIVE_FUNDS' });
    await prisma.generationIntent.deleteMany({ where: { projectId: `it-pj-${ts}` } });
  }, 20000);

  it('Z4 解散后审计留痕：物理删团队（级联删 balance）——台账行 teamId 仍在可 Σ（红相=旧置空行查询不可见）', async () => {
    const ts = Date.now();
    const team = `it-lf-snap-${ts}`;
    await prisma.team.create({ data: { id: team, name: 'snap', ownerId: S.keeper } });
    const { CreditLedgerService } = await import('./credit-ledger.service');
    const ledger = new CreditLedgerService(prisma as any);
    await ledger.runInTx(async (tx) => {
      await ledger.ensureBalance(tx, team);
      await ledger.mutate(tx, { teamId: team, type: 'admin_grant', creditType: 'regular', balanceDelta: 50, frozenDelta: 0, referenceId: `lf-snap-${ts}` });
    });
    await prisma.team.delete({ where: { id: team } });   // 级联删 balance（teamId 无 FK 不级联流水）
    const sum = await prisma.$queryRaw<{ s: bigint }[]>`SELECT COALESCE(SUM("balanceDelta"), 0) AS s FROM "TeamCreditTransaction" WHERE "teamId" = ${team}`;
    expect(Number(sum[0].s)).toBe(50);   // 审计锚保留——解散后对账纯 SQL
  }, 20000);
});
