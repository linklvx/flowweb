// apps/api/src/modules/team/team-lifecycle-funds.int.spec.ts —— Y0b-1 资金门载体（spec §6.2 点名）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLedgerService } from './credit-ledger.service';
import { createIntentFixture, ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamReg: string[] = [];   // Y0b-2（触发器）：登记团队 id——清理经 deleteTeamsWithPass（级联删 TeamBalance 须带证）

describe('Y0b-1 团队/项目生命周期资金门（§1.4ter/Z4）', () => {
  const S = { keeper: '' };
  beforeAll(async () => {
    const ts = Date.now();
    S.keeper = `it-lf-keeper-${ts}`;
    await prisma.user.create({ data: { id: S.keeper, name: 'k', email: `${S.keeper}@x.invalid`, emailVerified: false } });
  }, 20000);
  afterAll(async () => {
    // 清理序（Team.owner Restrict）：意图 → 台账（teamId 无 FK 行随团队消亡仍须清测试残留）→ 团队（级联）→ 用户
    await prisma.generationIntent.deleteMany({ where: { intentId: { startsWith: 'lf-' } } });
    await prisma.generationIntent.deleteMany({ where: { intentId: { startsWith: 'pf-' } } });
    for (const tid of teamReg) await ledgerWipe(ledger, { teamId: tid });
    const lfTeams = await prisma.team.findMany({ where: { id: { startsWith: 'it-lf-' } }, select: { id: true } });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, lfTeams.map((t) => t.id));
    await prisma.user.deleteMany({ where: { id: { startsWith: 'it-lf-' } } });
    await prisma.$disconnect();
  }, 20000);

  it('在飞 RUNNING∧reservedCredits>0 ⇒ 门 409 TEAM_HAS_ACTIVE_FUNDS（红=现状无门）', async () => {
    const ts = Date.now();
    const team = `it-lf-act-${ts}`;
    teamReg.push(team);
    await prisma.team.create({ data: { id: team, name: 'act', ownerId: S.keeper } });
    await prisma.teamMember.create({ data: { teamId: team, userId: S.keeper, role: 'OWNER' } });
    await ledger.runInTx(async (tx) => {
      await ledger.ensureBalance(tx, team);
      await ledger.lockBalance(tx, team);
      await ledger.mutate(tx, { teamId: team, operatorUserId: S.keeper, type: 'register_grant', creditType: 'regular', balanceDelta: 100, frozenDelta: 0, referenceId: `it-fix-${randomUUID().slice(0, 8)}` });
    });
    await createIntentFixture(prisma as unknown as PrismaService, { projectId: 'it-p', teamId: team, nodeId: 'n', userId: S.keeper, intentId: `lf-${ts}`, kind: 'text', paramsHash: 'h', status: 'RUNNING', creditCost: 5, reservedCredits: 5 });
    const { TeamFundsGateService } = await import('./team-funds-gate.service');
    const gate = new TeamFundsGateService(prisma as any);
    await expect(gate.assertSettled(prisma as any, { teamId: team })).rejects.toMatchObject({ errorCode: 'TEAM_HAS_ACTIVE_FUNDS' });
    await prisma.generationIntent.deleteMany({ where: { teamId: team } });
    await expect(gate.assertSettled(prisma as any, { teamId: team })).resolves.toBeUndefined();   // 终态后放行
    await ledgerWipe(ledger, { teamId: team });   // 先清台账再删团队（team.delete 级联 TeamBalance 须带证——ledgerWipe 先销流水与钱包）
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [team]);
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
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [team]);
  }, 20000);

  it('项目删除同门（projectId 维度）', async () => {
    const ts = Date.now();
    const team = `it-lf-prj-${ts}`;
    teamReg.push(team);
    await prisma.team.create({ data: { id: team, name: 'prj', ownerId: S.keeper } });
    await createIntentFixture(prisma as unknown as PrismaService, { projectId: `it-pj-${ts}`, teamId: team, nodeId: 'n', userId: S.keeper, intentId: `pf-${ts}`, kind: 'image', paramsHash: 'h', status: 'RUNNING', creditCost: 3, reservedCredits: 3 });
    const { TeamFundsGateService } = await import('./team-funds-gate.service');
    const gate = new TeamFundsGateService(prisma as any);
    await expect(gate.assertSettled(prisma as any, { projectId: `it-pj-${ts}` })).rejects.toMatchObject({ errorCode: 'TEAM_HAS_ACTIVE_FUNDS' });
    await prisma.generationIntent.deleteMany({ where: { projectId: `it-pj-${ts}` } });
  }, 20000);

  it('Z4 解散后审计留痕：物理删团队（级联删 balance）——台账行 teamId 仍在可 Σ（红相=旧置空行查询不可见）', async () => {
    const ts = Date.now();
    const team = `it-lf-snap-${ts}`;
    teamReg.push(team);
    await prisma.team.create({ data: { id: team, name: 'snap', ownerId: S.keeper } });
    await ledger.runInTx(async (tx) => {
      await ledger.ensureBalance(tx, team);
      await ledger.mutate(tx, { teamId: team, type: 'admin_grant', creditType: 'regular', balanceDelta: 50, frozenDelta: 0, referenceId: `lf-snap-${ts}` });
    });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [team]);   // 级联删 balance（teamId 无 FK 不级联流水）——带证删
    const sum = await prisma.$queryRaw<{ s: bigint }[]>`SELECT COALESCE(SUM("balanceDelta"), 0) AS s FROM "TeamCreditTransaction" WHERE "teamId" = ${team}`;
    expect(Number(sum[0].s)).toBe(50);   // 审计锚保留——解散后对账纯 SQL
  }, 20000);
});
