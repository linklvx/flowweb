// apps/api/src/modules/execution/ledger-invariants.int.spec.ts —— Y0b-1 资金门载体（spec §6.2 点名）
// 约束档（本 Task）：同键定价重复/reversesId 1:1（settle/release 同配同斥）/负余额 CHECK/creditCost CHECK/
// money_in partial unique/amount 派生 CHECK——对 T1a 后 schema 全红，本迁移后全绿。
// Y0b-2 T1（Z116/触发器）：直写断言的 raw INSERT/UPDATE 一律在通行证事务内跑（先过 ledger_guard 再验目标约束）；
// 钱包初值经台账；清理经 ledgerWipe/deleteTeamsWithPass；意图行经 createIntentFixture。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { createIntentFixture, ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const OWNER = `it-fund-u-${Date.now()}`;

/** 通行证包裹（Z116）：断言类直写在证内跑——ledger_guard 先放行，目标 CHECK/唯一约束才有机会红；
 *  命名=ledgerTx（窗口能力 token 同名——调用点即带证形态） */
async function ledgerTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (raw) => {
    await raw.$executeRaw`SET LOCAL app.ledger_tx = 'on'`;
    return fn(raw);
  });
}

describe('Y0b-1 DB 级资金不变量（迁移约束档）', () => {
  const T = { teamId: '', teamId2: '' };
  beforeAll(async () => {
    // Team.owner onDelete Restrict——user 必须先建（否则 FK 拒绝被吞=CHECK 用例假绿）
    await prisma.user.create({ data: { id: OWNER, name: 'it-fund', email: `${OWNER}@x.invalid`, emailVerified: false } });
    T.teamId = `it-fund-${Date.now()}-a`;
    T.teamId2 = `it-fund-${Date.now()}-b`;
    await prisma.team.create({ data: { id: T.teamId, name: 'it-fund-a', ownerId: OWNER } });
    await prisma.team.create({ data: { id: T.teamId2, name: 'it-fund-b', ownerId: OWNER } });
    // Y0b-2（触发器/Z116）：钱包初值经台账（register_grant 100——裸 createMany 被触发器拦）
    for (const tid of [T.teamId, T.teamId2]) {
      await ledger.runInTx(async (tx) => {
        await ledger.ensureBalance(tx, tid);
        await ledger.lockBalance(tx, tid);
        await ledger.mutate(tx, {
          teamId: tid, operatorUserId: OWNER, type: 'register_grant', creditType: 'regular',
          balanceDelta: 100, frozenDelta: 0, referenceId: `it-fix-${randomUUID().slice(0, 8)}`,
        });
      });
    }
  });
  afterAll(async () => {
    await ledgerWipe(ledger, { teamId: T.teamId });
    await ledgerWipe(ledger, { teamId: T.teamId2 });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [T.teamId, T.teamId2]);
    await prisma.user.deleteMany({ where: { id: OWNER } });
    await prisma.$disconnect();
  });


  it('reversesId @unique 1:1：同 reversesId 第二条冲销行 DB 拒绝（settle/release 共用此约束——Z6）', async () => {
    const mk = async (id: string, type: string, reversesId: string | null) =>
      ledgerTx((tx) => tx.$executeRaw`INSERT INTO "TeamCreditTransaction" (id, "teamId", amount, type, "creditType", "balanceDelta", "frozenDelta", "reversesId", "balanceAfter", "createdAt")
        VALUES (${id}, ${T.teamId}, -1, ${type}::"TeamCreditTransactionType", 'regular', -1, 1, ${reversesId}, -1, now())`);
    await mk('it-tx-res', 'reserve', null);
    await mk('it-tx-rel-1', 'release', 'it-tx-res');
    await expect(mk('it-tx-rel-2', 'release', 'it-tx-res')).rejects.toThrow();   // 同 reserve 行二次冲销=DB 拒
    await expect(mk('it-tx-set-1', 'settle', 'it-tx-res')).rejects.toThrow();    // 已被 release 的行再 settle=DB 拒（双花不可能）
    await ledgerTx((tx) => tx.teamCreditTransaction.deleteMany({ where: { id: { startsWith: 'it-tx-' } } }));
  });

  it('TeamBalance 非负 CHECK：credits 置负 DB 拒绝（通行证事务内——先过 ledger_guard 再验 CHECK）', async () => {
    await expect(ledgerTx((tx) => tx.teamBalance.update({ where: { teamId: T.teamId }, data: { credits: -1 } })))
      .rejects.toThrow(/balance_non_negative/);
  });

  it('PricingRule.creditCost>=0 与 GenerationIntent.creditCost>=0 CHECK', async () => {
    const nt = await prisma.nodeType.findFirst();
    if (!nt) return;
    await expect(prisma.$executeRaw`INSERT INTO "PricingRule" (id, "nodeTypeId", "creditCost", active, "createdAt", "updatedAt")
      VALUES ('it-pr-neg', ${nt.id}, -1, true, now(), now())`).rejects.toThrow();
    await expect(createIntentFixture(prisma as unknown as PrismaService, {
      projectId: 'it-p', teamId: T.teamId, nodeId: 'n', userId: OWNER, intentId: `neg-${Date.now()}`, kind: 'text', paramsHash: 'h', creditCost: -1,
    })).rejects.toThrow();
  });

  it('money_in partial unique（Z9）：同 (type,referenceId,creditType) 第二条 recharge 行 DB 拒绝', async () => {
    const ins = (id: string) => ledgerTx((tx) => tx.$executeRaw`INSERT INTO "TeamCreditTransaction" (id, "teamId", amount, type, "creditType", "balanceDelta", "frozenDelta", "referenceId", "balanceAfter", "createdAt")
      VALUES (${id}, ${T.teamId2}, 10, 'recharge', 'regular', 10, 0, 'it-order-1', 10, now())`);
    await ins('it-tx-rc-1');
    await expect(ins('it-tx-rc-2')).rejects.toThrow();
    await expect(ledgerTx((tx) => tx.$executeRaw`UPDATE "TeamCreditTransaction" SET "referenceId" = NULL WHERE "teamId" = ${T.teamId2} AND id = 'it-tx-rc-1'`)).rejects.toThrow();   // money_in 类 referenceId NOT NULL CHECK
    await ledgerTx((tx) => tx.teamCreditTransaction.deleteMany({ where: { id: { startsWith: 'it-tx-rc' } } }));
  });

  it('amount 派生 CHECK（Z8）：amount≠CASE 式 DB 拒绝', async () => {
    await expect(ledgerTx((tx) => tx.$executeRaw`INSERT INTO "TeamCreditTransaction" (id, "teamId", amount, type, "creditType", "balanceDelta", "frozenDelta", "balanceAfter", "createdAt")
      VALUES ('it-tx-amt', ${T.teamId}, 999, 'admin_grant', 'regular', 10, 0, 10, now())`)).rejects.toThrow();   // 999≠10（balanceAfter 已补列——唯此 CHECK 可拒）
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
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [team.id]);
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

describe('Y0b-1 settle 失败对账闭环（§1.5/Z17）', () => {
  // 独立 owner——文件首档 afterAll 会删共享 OWNER（Team.owner Restrict：复用则本档 team.create FK 失败）
  const CLS_OWNER = `it-cls-u-${Date.now()}`;
  beforeAll(async () => {
    await prisma.user.create({ data: { id: CLS_OWNER, name: 'it-cls', email: `${CLS_OWNER}@x.invalid`, emailVerified: false } });
  });
  const mkSvc = async (collabDoc: any = {} as any) => {
    const { IntentReconcileService } = await import('./intent-reconcile.service');
    const { TeamCreditService } = await import('../team/team-credit.service');
    const { CreditLedgerService } = await import('../team/credit-ledger.service');
    const ledger = new CreditLedgerService(prisma as any);
    const teamCredit = new TeamCreditService(prisma as any, ledger);
    return new IntentReconcileService(prisma as any, collabDoc, ledger, {} as any, {} as any, {} as any, teamCredit);
  };
  /** 夹具基线：钱包唯一口 ensureBalance + register_grant 100（计入 Σ——对齐 G-2 不变量①口径，禁裸建绕台账） */
  const fundTeam = async (teamId: string, ts: number) => {
    const { CreditLedgerService } = await import('../team/credit-ledger.service');
    const ledger = new CreditLedgerService(prisma as any);
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, teamId));
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId, type: 'register_grant', creditType: 'regular', balanceDelta: 100, frozenDelta: 0, referenceId: `it-cls-fund-${ts}` }));
    return ledger;
  };
  afterAll(async () => {
    await prisma.generationIntent.deleteMany({ where: { intentId: { startsWith: 'cls-' } } });
    // Y0b-2（触发器）：台账清账经通行证（前缀批量——ledgerWipe 单团队形态不适配，GUC 包裹等价）
    await prisma.$transaction(async (raw) => {
      await raw.$executeRaw`SET LOCAL app.ledger_tx = 'on'`;
      await raw.teamCreditTransaction.deleteMany({ where: { teamId: { startsWith: 'it-cls-' } } });
    });
    const clsTeams = await prisma.team.findMany({ where: { id: { startsWith: 'it-cls-' } }, select: { id: true } });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, clsTeams.map((t) => t.id));
    await prisma.user.deleteMany({ where: { id: CLS_OWNER } });
    await prisma.$disconnect();
  }, 20000);

  it('悬留已交付（SUCCEEDED∧reservedCredits>0∧超宽限∧探针有产物）→ settleStranded 补 settle（Y0b-2 T5 判据=判龄+ArtifactProbe——Z7/Z17/Z98/Z102）', async () => {
    const ts = Date.now();
    const team = await prisma.team.create({ data: { id: `it-cls-a-${ts}`, name: 'it', ownerId: CLS_OWNER } });
    // Y0b-2 T5：completedAt 推过 SETTLE_STRANDED_GRACE_MS（判龄=无活 worker 的结构证明）
    const intent = await createIntentFixture(prisma as unknown as PrismaService, { projectId: 'it-p', teamId: team.id, nodeId: 'n', userId: CLS_OWNER, intentId: `cls-a-${ts}`, kind: 'text', paramsHash: 'h', status: 'SUCCEEDED', creditCost: 7, reservedCredits: 7, completedAt: new Date(Date.now() - 11 * 60_000) });
    const ledger = await fundTeam(team.id, ts);
    const res = await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: team.id, type: 'reserve', creditType: 'regular', balanceDelta: -7, frozenDelta: 7, referenceId: `intent:${intent.id}` }));
    expect(res.rowId).not.toBeNull();
    const svc = await mkSvc({ probeArtifacts: async () => [{ nodeId: 'n', kind: 'text', found: true }] });
    await (svc as any).settleStranded();
    const row = await prisma.generationIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(row.reservedCredits).toBe(0);
    expect(row.creditsConsumed).toBe(7);
    const settle = await prisma.teamCreditTransaction.findFirst({ where: { teamId: team.id, type: 'settle' } });
    expect(settle?.frozenDelta).toBe(-7);
    expect(settle?.reversesId).toBe(res.rowId);
  }, 20000);

  it('悬留未交付（FAILED∧reservedCredits>0∧超宽限）→ release 归零（reversesId→reserve 行）', async () => {
    const ts = Date.now();
    const team = await prisma.team.create({ data: { id: `it-cls-c-${ts}`, name: 'it', ownerId: CLS_OWNER } });
    const intent = await createIntentFixture(prisma as unknown as PrismaService, { projectId: 'it-p', teamId: team.id, nodeId: 'n', userId: CLS_OWNER, intentId: `cls-c-${ts}`, kind: 'text', paramsHash: 'h', status: 'FAILED', creditCost: 5, reservedCredits: 5, completedAt: new Date(Date.now() - 11 * 60_000) });
    const ledger = await fundTeam(team.id, ts);
    const res = await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: team.id, type: 'reserve', creditType: 'regular', balanceDelta: -5, frozenDelta: 5, referenceId: `intent:${intent.id}` }));
    const svc = await mkSvc();
    await (svc as any).settleStranded();
    const row = await prisma.generationIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(row.reservedCredits).toBe(0);
    const rel = await prisma.teamCreditTransaction.findFirst({ where: { teamId: team.id, type: 'release' } });
    expect(rel?.reversesId).toBe(res.rowId);
  }, 20000);

  it('F7：终态∧reservedCredits>0 的 7 天行不被 cleanTerminalIntents 清理；普通终态行照清', async () => {
    const ts = Date.now();
    const old = new Date(Date.now() - 8 * 24 * 3600_000);
    const stranded = await createIntentFixture(prisma as unknown as PrismaService, { projectId: 'it-p', teamId: 'it-none', nodeId: 'n', userId: CLS_OWNER, intentId: `cls-b1-${ts}`, kind: 'text', paramsHash: 'h', status: 'FAILED', creditCost: 5, reservedCredits: 5, completedAt: old });
    const normal = await createIntentFixture(prisma as unknown as PrismaService, { projectId: 'it-p', teamId: 'it-none', nodeId: 'n2', userId: CLS_OWNER, intentId: `cls-b2-${ts}`, kind: 'text', paramsHash: 'h', status: 'SUCCEEDED', creditCost: 1, reservedCredits: 0, creditsConsumed: 1, completedAt: old });
    const svc = await mkSvc();
    await (svc as any).cleanTerminalIntents();
    expect(await prisma.generationIntent.findUnique({ where: { id: stranded.id } })).not.toBeNull();
    expect(await prisma.generationIntent.findUnique({ where: { id: normal.id } })).toBeNull();
  }, 20000);

  it('Z11 未闭合义务巡检：reserve 行未被冲销∧意图不存活∧超时 → 幂等释放', async () => {
    const ts = Date.now();
    const team = await prisma.team.create({ data: { id: `it-cls-o-${ts}`, name: 'it', ownerId: CLS_OWNER } });
    const intent = await createIntentFixture(prisma as unknown as PrismaService, { projectId: 'it-p', teamId: team.id, nodeId: 'n', userId: CLS_OWNER, intentId: `cls-o-${ts}`, kind: 'text', paramsHash: 'h', status: 'FAILED', creditCost: 6, reservedCredits: 0, creditsConsumed: 0, completedAt: new Date(Date.now() - 20 * 60_000) });
    const ledger = await fundTeam(team.id, ts);
    const res = await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: team.id, type: 'reserve', creditType: 'regular', balanceDelta: -6, frozenDelta: 6, referenceId: `intent:${intent.id}` }));
    // 孤儿谓词 15min 判龄——reserve 行造龄（Y0b-2 触发器：UPDATE 须在通行证事务内——set_config 局部等价）
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.ledger_tx', 'on', true)`;
      await tx.$executeRaw`UPDATE "TeamCreditTransaction" SET "createdAt" = now() - interval '20 minutes' WHERE "teamId" = ${team.id} AND id = ${res.rowId}`;
    });
    await prisma.generationIntent.delete({ where: { id: intent.id } });   // 模拟意图行丢失——reserve 行成为孤儿
    const svc = await mkSvc();
    const released = await (svc as any).releaseOrphanedReserves();
    expect(released).toBe(1);
    const rel = await prisma.teamCreditTransaction.findFirst({ where: { teamId: team.id, type: 'release', reversesId: res.rowId } });
    expect(rel).not.toBeNull();
    const again = await (svc as any).releaseOrphanedReserves();
    expect(again).toBe(0);   // 幂等——reversesId 唯一键保证二次调用零动作
  }, 20000);

  it('Z25 反例（防洞静默回归）：SUCCEEDED∧冻结未销的行不被 releaseOrphanedReserves 释放（settleStranded 独占——E53）', async () => {
    const ts = Date.now();
    const team = await prisma.team.create({ data: { id: `it-cls-s-${ts}`, name: 'it', ownerId: CLS_OWNER } });
    const intent = await createIntentFixture(prisma as unknown as PrismaService, { projectId: 'it-p', teamId: team.id, nodeId: 'n', userId: CLS_OWNER, intentId: `cls-s-${ts}`, kind: 'text', paramsHash: 'h', status: 'SUCCEEDED', creditCost: 8, reservedCredits: 8, completedAt: new Date(Date.now() - 20 * 60_000) });
    const ledger = await fundTeam(team.id, ts);
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: team.id, type: 'reserve', creditType: 'regular', balanceDelta: -8, frozenDelta: 8, referenceId: `intent:${intent.id}` }));
    const svc = await mkSvc();
    const released = await (svc as any).releaseOrphanedReserves();
    expect(released).toBe(0);   // 意图行存在（SUCCEEDED）——四轮 Z38 谓词 gi.id IS NULL 必零命中
    const rel = await prisma.teamCreditTransaction.count({ where: { teamId: team.id, type: 'release' } });
    expect(rel).toBe(0);
  }, 20000);
});
