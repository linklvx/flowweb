// apps/api/src/modules/execution/ledger-invariants.int.spec.ts —— Y0b-1 资金门载体（spec §6.2 点名）
// 约束档（本 Task）：同键定价重复/reversesId 1:1（settle/release 同配同斥）/负余额 CHECK/creditCost CHECK/
// money_in partial unique/amount 派生 CHECK——对 T1a 后 schema 全红，本迁移后全绿。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const OWNER = `it-fund-u-${Date.now()}`;

describe('Y0b-1 DB 级资金不变量（迁移约束档）', () => {
  const T = { teamId: '', teamId2: '' };
  beforeAll(async () => {
    // Team.owner onDelete Restrict——user 必须先建（否则 FK 拒绝被吞=CHECK 用例假绿）
    await prisma.user.create({ data: { id: OWNER, name: 'it-fund', email: `${OWNER}@x.invalid`, emailVerified: false } });
    T.teamId = `it-fund-${Date.now()}-a`;
    T.teamId2 = `it-fund-${Date.now()}-b`;
    await prisma.team.create({ data: { id: T.teamId, name: 'it-fund-a', ownerId: OWNER } });
    await prisma.team.create({ data: { id: T.teamId2, name: 'it-fund-b', ownerId: OWNER } });
    await prisma.teamBalance.createMany({ data: [{ teamId: T.teamId, credits: 100 }, { teamId: T.teamId2, credits: 100 }] });
  });
  afterAll(async () => {
    await prisma.teamCreditTransaction.deleteMany({ where: { teamId: { in: [T.teamId, T.teamId2] } } }).catch(() => {});
    await prisma.team.deleteMany({ where: { id: { in: [T.teamId, T.teamId2] } } });
    await prisma.user.deleteMany({ where: { id: OWNER } });
    await prisma.$disconnect();
  });

  it('同键定价规则 DB 拒绝（NULLS NOT DISTINCT——可空列同 null 视为重复；含 modelId IS NULL 的 kind 级行）', async () => {
    const nt = await prisma.nodeType.create({ data: { id: `it-nt-${Date.now()}`, name: 'it', key: `it-nt-${Date.now()}` } });
    // modelId IS NULL 的 kind 级规则：同 nodeTypeId 两条 = 重复
    await prisma.$executeRaw`INSERT INTO "PricingRule" (id, "nodeTypeId", "modelId", "creditCost", active, "createdAt", "updatedAt")
      VALUES ('it-pr-dup-1', ${nt.id}, NULL, 1, true, now(), now())`;
    await expect(prisma.$executeRaw`INSERT INTO "PricingRule" (id, "nodeTypeId", "modelId", "creditCost", active, "createdAt", "updatedAt")
      VALUES ('it-pr-dup-2', ${nt.id}, NULL, 2, true, now(), now())`).rejects.toThrow();
    await prisma.pricingRule.deleteMany({ where: { id: { in: ['it-pr-dup-1', 'it-pr-dup-2'] } } });
    await prisma.nodeType.deleteMany({ where: { id: nt.id } });
  });

  it('reversesId @unique 1:1：同 reversesId 第二条冲销行 DB 拒绝（settle/release 共用此约束——Z6）', async () => {
    const mk = async (id: string, type: string, reversesId: string | null) =>
      prisma.$executeRaw`INSERT INTO "TeamCreditTransaction" (id, "teamId", amount, type, "creditType", "balanceDelta", "frozenDelta", "reversesId", "balanceAfter", "createdAt")
        VALUES (${id}, ${T.teamId}, -1, ${type}::"TeamCreditTransactionType", 'regular', -1, 1, ${reversesId}, -1, now())`;
    await mk('it-tx-res', 'reserve', null);
    await mk('it-tx-rel-1', 'release', 'it-tx-res');
    await expect(mk('it-tx-rel-2', 'release', 'it-tx-res')).rejects.toThrow();   // 同 reserve 行二次冲销=DB 拒
    await expect(mk('it-tx-set-1', 'settle', 'it-tx-res')).rejects.toThrow();    // 已被 release 的行再 settle=DB 拒（双花不可能）
    await prisma.teamCreditTransaction.deleteMany({ where: { id: { startsWith: 'it-tx-' } } });
  });

  it('TeamBalance 非负 CHECK：credits 置负 DB 拒绝', async () => {
    await expect(prisma.teamBalance.update({ where: { teamId: T.teamId }, data: { credits: -1 } })).rejects.toThrow();
  });

  it('PricingRule.creditCost>=0 与 GenerationIntent.creditCost>=0 CHECK', async () => {
    const nt = await prisma.nodeType.findFirst();
    if (!nt) return;
    await expect(prisma.$executeRaw`INSERT INTO "PricingRule" (id, "nodeTypeId", "creditCost", active, "createdAt", "updatedAt")
      VALUES ('it-pr-neg', ${nt.id}, -1, true, now(), now())`).rejects.toThrow();
    await expect(prisma.generationIntent.create({
      data: { projectId: 'it-p', teamId: T.teamId, nodeId: 'n', userId: OWNER, intentId: `neg-${Date.now()}`, kind: 'text', paramsHash: 'h', creditCost: -1 } as any,
    })).rejects.toThrow();
  });

  it('money_in partial unique（Z9）：同 (type,referenceId,creditType) 第二条 recharge 行 DB 拒绝', async () => {
    const ins = (id: string) => prisma.$executeRaw`INSERT INTO "TeamCreditTransaction" (id, "teamId", amount, type, "creditType", "balanceDelta", "frozenDelta", "referenceId", "balanceAfter", "createdAt")
      VALUES (${id}, ${T.teamId2}, 10, 'recharge', 'regular', 10, 0, 'it-order-1', 10, now())`;
    await ins('it-tx-rc-1');
    await expect(ins('it-tx-rc-2')).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE "TeamCreditTransaction" SET "referenceId" = NULL WHERE id = 'it-tx-rc-1'`).rejects.toThrow();   // money_in 类 referenceId NOT NULL CHECK
    await prisma.teamCreditTransaction.deleteMany({ where: { id: { startsWith: 'it-tx-rc' } } });
  });

  it('amount 派生 CHECK（Z8）：amount≠CASE 式 DB 拒绝', async () => {
    await expect(prisma.$executeRaw`INSERT INTO "TeamCreditTransaction" (id, "teamId", amount, type, "creditType", "balanceDelta", "frozenDelta", "balanceAfter", "createdAt")
      VALUES ('it-tx-amt', ${T.teamId}, 999, 'admin_grant', 'regular', 10, 0, 10, now())`).rejects.toThrow();   // 999≠10（balanceAfter 已补列——唯此 CHECK 可拒）
    await prisma.teamCreditTransaction.deleteMany({ where: { id: 'it-tx-amt' } }).catch(() => {});
  });
});
