// apps/api/src/modules/team/ledger-trigger.int.spec.ts —— Y0b-2 T1 资金门载体
// ①ledger_guard 触发器三面（INSERT/UPDATE/DELETE）非通行证拦截+通行证放行；
// ②idemKey 唯一/三 NOT NULL 列 DB 级拒绝；
// ③Z89 五链路 money-in 真库 happy-path 冒烟（充值/团队订阅发放/到期清零/admin 授予/个人团队发放+建团队+解散——
//   改前红=LEDGER_SINGLE_WRITER：单测 mock ledger 全绿假象的 int 层证据）；
// ④Z100 backstop：同 reversesId 二次入账仍抛错+idempotencyKey 前置查 replay 短路。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLedgerService } from './credit-ledger.service';
import { TeamCreditService } from './team-credit.service';
import { TeamService } from './team.service';
import { TeamRechargeService } from './team-recharge.service';
import { TeamSubscriptionService } from './team-subscription.service';
import { AdminSubscriptionService } from '../subscription/admin/admin-subscription.service';
import { bootstrapPersonalTeam } from './team.bootstrap';
import { TeamFundsGateService } from './team-funds-gate.service';
import { createIntentFixture, ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';

const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamCredit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const fundsGate = new TeamFundsGateService(prisma as unknown as PrismaService);
const auditStub: any = { logTx: async () => {}, log: async () => {} };
const teamSvc = new TeamService(
  prisma as unknown as PrismaService,
  { emitAsync: async () => {} } as any,
  { add: async () => {} } as any,
  ledger, auditStub, fundsGate, teamCredit,
);
const teamRecharge = new TeamRechargeService(
  prisma as unknown as PrismaService, ledger,
  new TeamSubscriptionService(prisma as unknown as PrismaService, ledger, auditStub),
  auditStub, null, undefined, undefined,
);
const teamSub = new TeamSubscriptionService(prisma as unknown as PrismaService, ledger, auditStub);
const adminSub = new AdminSubscriptionService(prisma as unknown as PrismaService, ledger);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const reg = { userIds: [] as string[], teamIds: [] as string[] };

async function mkUser(id: string) {
  await prisma.user.create({ data: { id, name: 'it-trg', email: `${id}@x.invalid`, emailVerified: false } });
  reg.userIds.push(id);
  return id;
}
/** 普通团队（ACTIVE+OWNER+TeamMember）——钱包不建（各链路自建：充值/admin 经 ensureBalance） */
async function mkTeam(ownerId: string, tag: string): Promise<string> {
  const teamId = `it-trg-${tag}-${uniq}`;
  await prisma.team.create({ data: { id: teamId, name: `it-trg-${tag}`, ownerId } });
  await prisma.teamMember.create({ data: { teamId, userId: ownerId, role: 'OWNER' } });
  reg.teamIds.push(teamId);
  return teamId;
}

(hasDb ? describe : describe.skip)('Y0b-2 T1：ledger_guard 触发器（Z51/Z89）', () => {
  let TID = '';
  let UID = '';
  beforeAll(async () => {
    UID = await mkUser(`it-trg-u1-${uniq}`);
    TID = await mkTeam(UID, 'base');
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, TID));
  });
  afterAll(async () => {
    // 个人默认团队（bootstrap 链路建）先入册——Team.owner Restrict：不删团队则 user 删不掉
    const personalTeams = await prisma.team.findMany({ where: { ownerId: { in: reg.userIds }, isDefault: true }, select: { id: true } });
    for (const tid of [...reg.teamIds, ...personalTeams.map((t) => t.id)]) await ledgerWipe(ledger, { teamId: tid });
    await prisma.teamRechargeOrder.deleteMany({ where: { teamId: { in: reg.teamIds } } });
    await prisma.teamSubscription.deleteMany({ where: { teamId: { in: reg.teamIds } } });
    await prisma.teamPlan.deleteMany({ where: { id: { startsWith: `it-trg-plan-${uniq}` } } });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [...reg.teamIds, ...personalTeams.map((t) => t.id)]);
    await prisma.user.deleteMany({ where: { id: { in: reg.userIds } } });
    await prisma.$disconnect();
  }, 30000);

  it('T1：触发器拦截——非 ledger 上下文直写/直删 TeamCreditTransaction 与写 TeamBalance 抛 LEDGER_SINGLE_WRITER', async () => {
    await expect(prisma.teamCreditTransaction.create({
      data: { teamId: TID, amount: 1, type: 'recharge', creditType: 'regular', balanceDelta: 1, frozenDelta: 0, referenceId: 'it-trg-raw', balanceAfter: 1 },
    })).rejects.toThrow(/LEDGER_SINGLE_WRITER/);
    await expect(prisma.$executeRaw`UPDATE "TeamBalance" SET credits = credits WHERE true`).rejects.toThrow(/LEDGER_SINGLE_WRITER/);
    await expect(prisma.teamBalance.deleteMany({ where: { teamId: TID } })).rejects.toThrow(/LEDGER_SINGLE_WRITER/);   // DELETE 面
  });

  it('T1：ledger 上下文（SET LOCAL 通行证）放行——runInTx 内 ensureBalance 零额写+裸 set_config 事务内写也放行', async () => {
    await expect(ledger.runInTx(async (tx) => {
      await ledger.ensureBalance(tx, TID);   // INSERT ... ON CONFLICT——带证零异常
      await tx.$executeRaw`UPDATE "TeamBalance" SET credits = credits WHERE "teamId" = ${TID}`;   // 带证 UPDATE
    })).resolves.toBeUndefined();
  });

  it('T1：idemKey 唯一——同键第二行 DB 拒绝；heartbeatAt/deadlineAt 缺省插入拒绝（三 NOT NULL 列）', async () => {
    const idemKey = `it-trg-key-${randomUUID()}`;
    await createIntentFixture(prisma as unknown as PrismaService, { projectId: 'it-trg-p', nodeId: 'n1', userId: UID, teamId: TID, intentId: `it-trg-i1-${uniq}`, kind: 'text', paramsHash: 'h', creditCost: 1, idemKey });
    await expect(createIntentFixture(prisma as unknown as PrismaService, { projectId: 'it-trg-p', nodeId: 'n2', userId: UID, teamId: TID, intentId: `it-trg-i2-${uniq}`, kind: 'text', paramsHash: 'h', creditCost: 1, idemKey }))
      .rejects.toThrow();
    await expect(prisma.$executeRaw`INSERT INTO "GenerationIntent" ("id", "projectId", "nodeId", "userId", "teamId", "intentId", "kind", "paramsHash", "status", "creditCost", "createdAt", "updatedAt")
      VALUES ('it-trg-nokey', 'it-trg-p', 'n3', ${UID}, ${TID}, 'it-trg-i3', 'text', 'h', 'RUNNING', 1, now(), now())`).rejects.toThrow();   // idemKey NOT NULL
    await prisma.generationIntent.deleteMany({ where: { projectId: 'it-trg-p' } });
  });

  it('Z89 money-in 五链路真库 happy-path：充值/订阅发放/到期清零/admin 授予/个人团队发放+建团队+解散 全部经通行证零异常', async () => {
    // ①充值入账（TeamRechargeService.creditTeamBalance——支付回调事务体）
    const charger = await mkUser(`it-trg-u2-${uniq}`);
    const chargeTeam = await mkTeam(charger, 'chg');
    const order = await prisma.teamRechargeOrder.create({
      data: { outTradeNo: `TEAMTRG${Date.now()}1`, teamId: chargeTeam, payerUserId: charger, amountFen: 1000, credits: 100, kind: 'credits', status: 'PENDING', expiresAt: new Date(Date.now() + 3600_000) },
    });
    await (teamRecharge as any).creditTeamBalance(order, 'txn-trg-1', undefined);
    const charged = await prisma.teamBalance.findUniqueOrThrow({ where: { teamId: chargeTeam } });
    expect(charged.credits).toBe(100);

    // ②团队订阅发放（completeSubscriptionCallback——expire_clear+subscription_grant+TeamSubscription 建行）
    const subOwner = await mkUser(`it-trg-u3-${uniq}`);
    const subTeam = await mkTeam(subOwner, 'sub');
    const plan = await prisma.teamPlan.create({
      data: { id: `it-trg-plan-${uniq}`, name: 'it-trg-plan', monthlyCredits: 50, storageLimitBytes: 1024n, seatLimit: 3, priceMonthly: 990 },
    });
    const subOrder = await prisma.teamRechargeOrder.create({
      data: { outTradeNo: `TEAMTRG${Date.now()}2`, teamId: subTeam, payerUserId: subOwner, amountFen: 990, credits: 50, kind: 'subscription', planId: plan.id, status: 'PENDING', expiresAt: new Date(Date.now() + 3600_000) },
    });
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, subTeam));   // 生产形态=建团即有钱包（createTeam ensureBalance）——订阅链 lockBalance 前置
    const r2 = await teamSub.completeSubscriptionCallback({ outTradeNo: subOrder.outTradeNo, appid: 'a', mchid: 'm', amount: 990, tradeState: 'SUCCESS', transactionId: 'txn-trg-2' });
    expect(r2.code).toBe('SUCCESS');
    const subBal = await prisma.teamBalance.findUniqueOrThrow({ where: { teamId: subTeam } });
    expect(subBal.subscriptionCredits).toBe(50);

    // ③到期清零（expireSubscriptions——periodEnd 已过 ⇒ expired+expire_clear）
    await prisma.teamSubscription.update({
      where: { id: (await prisma.teamSubscription.findFirstOrThrow({ where: { teamId: subTeam } })).id },
      data: { currentPeriodEnd: new Date(Date.now() - 60_000) },
    });
    await teamSub.expireSubscriptions();
    const cleared = await prisma.teamBalance.findUniqueOrThrow({ where: { teamId: subTeam } });
    expect(cleared.subscriptionCredits).toBe(0);

    // ④admin 授予（AdminSubscriptionService.grantCredit——个人默认团队）
    const grantee = await mkUser(`it-trg-u4-${uniq}`);
    await bootstrapPersonalTeam(prisma as any, ledger, grantee, 'it-trg');
    await adminSub.grantCredit(grantee, 7, 'regular');
    const personal = await prisma.team.findFirstOrThrow({ where: { ownerId: grantee, isDefault: true } });
    expect((await prisma.teamBalance.findUniqueOrThrow({ where: { teamId: personal.id } })).credits).toBe(107);   // register 100+admin 7

    // ⑤建团队+解散（TeamService.createTeam/disbandTeam——team.delete 级联删 TeamBalance 触发行级触发器，事务持证）
    const owner5 = await mkUser(`it-trg-u5-${uniq}`);
    await bootstrapPersonalTeam(prisma as any, ledger, owner5, 'it-trg');   // 保底第二团队（"不能解散唯一团队"守卫）
    const created = await teamSvc.createTeam(owner5, 'it-trg-five');
    reg.teamIds.push(created.id);
    await expect(teamSvc.disbandTeam(created.id, owner5)).resolves.toBeUndefined();   // 级联删 balance 带证零异常
  }, 60000);

  it('Z100 backstop：同 reversesId 二次入账仍抛错（money_in_once/reversesId 唯一兜底——禁 skipDuplicates）', async () => {
    const owner = await mkUser(`it-trg-u6-${uniq}`);
    const tid = await mkTeam(owner, 'bk');
    const intent = await createIntentFixture(prisma as unknown as PrismaService, { projectId: 'it-trg-bk', nodeId: 'n1', userId: owner, teamId: tid, intentId: `it-trg-bk-${uniq}`, kind: 'text', paramsHash: 'h', status: 'SUCCEEDED', creditCost: 3, creditsConsumed: 3 });
    await ledger.runInTx(async (tx) => {
      await ledger.ensureBalance(tx, tid);
      await ledger.mutate(tx, { teamId: tid, operatorUserId: owner, type: 'register_grant', creditType: 'regular', balanceDelta: 10, frozenDelta: 0, referenceId: `it-trg-bk-fund-${uniq}` });
      await ledger.mutate(tx, { teamId: tid, type: 'reserve', creditType: 'regular', balanceDelta: -3, frozenDelta: 3, referenceId: `intent:${intent.id}` });
    });
    const reserveId = (await prisma.teamCreditTransaction.findFirstOrThrow({ where: { teamId: tid, type: 'reserve' } })).id;
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: tid, type: 'settle', creditType: 'regular', balanceDelta: 0, frozenDelta: -3, referenceId: `intent:${intent.id}`, reversesId: reserveId }));
    // 同 reversesId 二次 settle——reversesId @unique DB 拒（Z6 三配对 1:1 结构性拦截保留）
    await expect(ledger.runInTx((tx) => ledger.mutate(tx, { teamId: tid, type: 'settle', creditType: 'regular', balanceDelta: 0, frozenDelta: -3, referenceId: `intent:${intent.id}`, reversesId: reserveId }))).rejects.toThrow();
    await prisma.generationIntent.deleteMany({ where: { projectId: 'it-trg-bk' } });
  }, 30000);

  it('Z100 前置查：idempotencyKey 命中 ⇒ replayed:true 零新行零变池；miss ⇒ 原样入账', async () => {
    const owner = await mkUser(`it-trg-u7-${uniq}`);
    const tid = await mkTeam(owner, 'idem');
    const key = `it-trg-idem-${randomUUID()}`;
    await ledger.runInTx(async (tx) => {
      await ledger.ensureBalance(tx, tid);
      await ledger.mutate(tx, { teamId: tid, type: 'recharge', creditType: 'regular', balanceDelta: 10, frozenDelta: 0, referenceId: `it-trg-rc-${uniq}`, idempotencyKey: key });
    });
    const replay = await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: tid, type: 'recharge', creditType: 'regular', balanceDelta: 10, frozenDelta: 0, referenceId: `it-trg-rc-${uniq}`, idempotencyKey: key }));
    expect(replay.replayed).toBe(true);
    expect((await prisma.teamBalance.findUniqueOrThrow({ where: { teamId: tid } })).credits).toBe(10);   // 零变池
    expect(await prisma.teamCreditTransaction.count({ where: { teamId: tid, type: 'recharge' } })).toBe(1);   // 零新行
    // 无键路径不受影响（miss=原样 create——旧行为保持）
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: tid, type: 'recharge', creditType: 'regular', balanceDelta: 5, frozenDelta: 0, referenceId: `it-trg-rc2-${uniq}` }));
    expect((await prisma.teamBalance.findUniqueOrThrow({ where: { teamId: tid } })).credits).toBe(15);
  }, 30000);
});
