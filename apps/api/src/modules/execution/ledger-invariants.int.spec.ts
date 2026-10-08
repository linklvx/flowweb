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
    // id 后缀化（Y0b-1 Z37：int 残留自撞——上轮中途失败未清理时固定 id 下轮 PK 冲突=训练样本红）
    const ts = Date.now();
    const id1 = `it-pr-dup-${ts}-1`;
    const id2 = `it-pr-dup-${ts}-2`;
    const nt = await prisma.nodeType.create({ data: { id: `it-nt-${Date.now()}`, name: 'it', key: `it-nt-${Date.now()}` } });
    // modelId IS NULL 的 kind 级规则：同 nodeTypeId 两条 = 重复
    await prisma.$executeRaw`INSERT INTO "PricingRule" (id, "nodeTypeId", "modelId", "creditCost", active, "createdAt", "updatedAt")
      VALUES (${id1}, ${nt.id}, NULL, 1, true, now(), now())`;
    await expect(prisma.$executeRaw`INSERT INTO "PricingRule" (id, "nodeTypeId", "modelId", "creditCost", active, "createdAt", "updatedAt")
      VALUES (${id2}, ${nt.id}, NULL, 2, true, now(), now())`).rejects.toThrow();
    await prisma.pricingRule.deleteMany({ where: { id: { in: [id1, id2] } } });
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

describe('Y0b-1 G-2 三不变量+balanceAfter 分区链（§1.4bis）', () => {
  it('不变量①：per (teamId,creditType) Σ balanceDelta ≡ 当前池余额（零基线团队——全部变更仅经 mutate）', async () => {
    const ts = Date.now();
    const owner = await prisma.user.create({ data: { id: `it-inv-u-${ts}`, name: 'it', email: `it-inv-${ts}@x.invalid`, emailVerified: false } });
    const team = await prisma.team.create({ data: { id: `it-inv-${ts}`, name: 'it', ownerId: owner.id } });
    const { CreditLedgerService } = await import('../team/credit-ledger.service');
    const ledger = new CreditLedgerService(prisma as any);
    // 零基线=不经 teamBalance.create 设初值——钱包行经 ensureBalance 唯一口创建（0/0 零流水，Z23）；
    // 基线由 register_grant 建立（计入 Σ——lockBalance 缺行即抛，mutate 不懒建）
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, team.id));
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: team.id, type: 'register_grant', creditType: 'regular', balanceDelta: 100, frozenDelta: 0, referenceId: `it-inv-${ts}` }));
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: team.id, type: 'admin_grant', creditType: 'subscription', balanceDelta: 30, frozenDelta: 0, referenceId: `it-inv-${ts}:sub` }));
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: team.id, type: 'admin_clear', creditType: 'regular', balanceDelta: -40, frozenDelta: 0, referenceId: `it-inv-${ts}:clr` }));
    const rows = await prisma.$queryRaw<{ creditType: string; sum: bigint }[]>`
      SELECT "creditType", SUM("balanceDelta") AS sum FROM "TeamCreditTransaction"
      WHERE "teamId" = ${team.id} GROUP BY 1`;
    const bal = await prisma.teamBalance.findUniqueOrThrow({ where: { teamId: team.id } });
    const byPool = Object.fromEntries(rows.map((r) => [r.creditType, Number(r.sum)]));
    expect(byPool.regular).toBe(bal.credits);                    // 100−40=60
    expect(byPool.subscription).toBe(bal.subscriptionCredits);   // 30
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.user.delete({ where: { id: owner.id } });
  }, 20000);

  it('不变量②③：per intent Σ frozenDelta ≡ reservedCredits；终态 Σ balanceDelta ∈ {0,−creditsConsumed}（只核有台账行的意图）', async () => {
    const intents = await prisma.$queryRaw<any[]>`
      SELECT gi.id, gi."reservedCredits", gi."creditsConsumed", gi.status,
        COALESCE(SUM(t."frozenDelta"), 0) AS frozen_sum, COALESCE(SUM(t."balanceDelta"), 0) AS balance_sum
      FROM "GenerationIntent" gi JOIN "TeamCreditTransaction" t ON t."referenceId" = 'intent:' || gi.id
      WHERE gi."intentId" LIKE 'it-%' OR gi."intentId" LIKE 'led-%' GROUP BY gi.id`;
    for (const i of intents) {
      expect(Number(i.frozen_sum)).toBe(Number(i.reservedCredits));
      if (['SUCCEEDED', 'FAILED', 'VOIDED'].includes(i.status)) {
        expect([0, -Number(i.creditsConsumed)]).toContain(Number(i.balance_sum));
      }
    }
  }, 20000);

  it('balanceAfter 分区链：按 (teamId,creditType)+seq 排序——本行 balanceAfter ≡ 前行+本行 balanceDelta', async () => {
    const chains = await prisma.$queryRaw<any[]>`
      SELECT "teamId", "creditType", "balanceAfter", "balanceDelta" FROM "TeamCreditTransaction"
      WHERE "teamId" LIKE 'it-inv-%' OR "teamId" LIKE 'it-led-%' ORDER BY "teamId", "creditType", seq`;
    let prev: { k: string; after: number } | null = null;
    for (const r of chains) {
      const k = `${r.teamId}|${r.creditType}`;
      if (prev && prev.k === k) {
        expect(Number(r.balanceAfter)).toBe(prev.after + Number(r.balanceDelta));
      }
      prev = { k, after: Number(r.balanceAfter) };
    }
  }, 20000);
});
