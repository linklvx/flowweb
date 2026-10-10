// apps/api/src/modules/subscription/admin/admin-idempotency.int.spec.ts —— Y0b-2 T8（Z87/Z113）admin Idempotency-Key 真库红绿
// 第五轮形态验收：advisory 锁（pg_advisory_xact_lock 收并发窗）+前置查（findFirst 指纹比对）+回放当前两池余额
// （不回历史 balanceAfter=台账行发生时值⇒UI 显示陈旧数字）。skipDuplicates 全文清剿——重复事件真闸=
// reversesId @unique/money_in_once 抛错 backstop（Z100，末例锚）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreditLedgerService } from '../../team/credit-ledger.service';
import { AdminSubscriptionService } from './admin-subscription.service';
import { bootstrapPersonalTeam } from '../../team/team.bootstrap';
import { createIntentFixture, ledgerWipe, deleteTeamsWithPass } from '../../../test-utils/intent-fixture';

// 无 DATABASE_URL（CI 未起库）自动 skip（check-int-coverage 判据③ numPendingTests===0 约定）
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const adminSub = new AdminSubscriptionService(prisma as unknown as PrismaService, ledger);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const reg = { userIds: [] as string[], teamIds: [] as string[] };

async function mkUser(id: string) {
  await prisma.user.create({ data: { id, name: 'it-adm8', email: `${id}@x.invalid`, emailVerified: false } });
  reg.userIds.push(id);
  return id;
}

/** 带个人默认团队的被授予人（bootstrap register_grant 100——余额非零起点便于判别"余额一次"） */
async function mkGrantee(tag: string): Promise<{ userId: string; teamId: string }> {
  const userId = await mkUser(`it-adm8-${tag}-${uniq}`);
  await bootstrapPersonalTeam(prisma as any, ledger, userId, 'it-adm8');
  const team = await prisma.team.findFirstOrThrow({ where: { ownerId: userId, isDefault: true } });
  reg.teamIds.push(team.id);
  return { userId, teamId: team.id };
}

(hasDb ? describe : describe.skip)('Y0b-2 T8：admin Idempotency-Key（advisory 锁+前置查+回放——Z113）', () => {
  beforeAll(async () => {}, 10_000);

  afterAll(async () => {
    const personalTeams = await prisma.team.findMany({ where: { ownerId: { in: reg.userIds }, isDefault: true }, select: { id: true } });
    for (const tid of [...reg.teamIds, ...personalTeams.map((t) => t.id)]) await ledgerWipe(ledger, { teamId: tid });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [...reg.teamIds, ...personalTeams.map((t) => t.id)]);
    await prisma.user.deleteMany({ where: { id: { in: reg.userIds } } });
    await prisma.$disconnect();
  }, 30_000);

  it('同 key 二次 grant → replayed:true+transactionId 原值+credits/subscriptionCredits=同事务当前两池（非历史 balanceAfter）+台账恰一行+余额一次', async () => {
    const { userId, teamId } = await mkGrantee('r1');
    const key = `it-adm8-k1-${randomUUID()}`;
    const r1 = await adminSub.grantCredit(userId, 10, 'regular', { idempotencyKey: key, operatorUserId: `op-${uniq}` });
    expect(r1.replayed).toBe(false);
    expect(r1.transactionId).toBeTruthy();
    // 两调用之间再入账一笔（异 key）——回放若误回历史 balanceAfter（=10+100 起点）会拿到陈旧数字
    await adminSub.grantCredit(userId, 5, 'regular', { idempotencyKey: `it-adm8-k1b-${randomUUID()}`, operatorUserId: `op-${uniq}` });
    const r2 = await adminSub.grantCredit(userId, 10, 'regular', { idempotencyKey: key, operatorUserId: `op-${uniq}` });
    expect(r2.replayed).toBe(true);
    expect(r2.transactionId).toBe(r1.transactionId);           // 原 transactionId（崩溃窗口闭合：响应丢失重试同值）
    const bal = await prisma.teamBalance.findUniqueOrThrow({ where: { teamId } });
    expect(r2.credits).toBe(bal.credits);                      // 当前两池（115=100+10+5），非行发生时 balanceAfter
    expect(r2.subscriptionCredits).toBe(bal.subscriptionCredits);
    // 台账恰一行（该 key）+余额一次（+10 只入账一次）
    expect(await prisma.teamCreditTransaction.count({ where: { teamId, idempotencyKey: key } })).toBe(1);
    expect(bal.credits).toBe(115);
  }, 30_000);

  it('同 key 改 amount 或换操作员 → 409 IDEMPOTENCY_KEY_REUSED（指纹含 operatorUserId——换操作员同 key≠重放）', async () => {
    const { userId } = await mkGrantee('r2');
    const key = `it-adm8-k2-${randomUUID()}`;
    await adminSub.grantCredit(userId, 10, 'regular', { idempotencyKey: key, operatorUserId: 'admin-a' });
    const err1 = await adminSub.grantCredit(userId, 20, 'regular', { idempotencyKey: key, operatorUserId: 'admin-a' }).catch((e: unknown) => e);
    expect(err1).toMatchObject({ errorCode: 'IDEMPOTENCY_KEY_REUSED' });
    expect((err1 as any).getStatus()).toBe(409);
    const err2 = await adminSub.grantCredit(userId, 10, 'regular', { idempotencyKey: key, operatorUserId: 'admin-b' }).catch((e: unknown) => e);
    expect(err2).toMatchObject({ errorCode: 'IDEMPOTENCY_KEY_REUSED' });
  }, 30_000);

  it('不带 key 两次 → 两行（合法重复操作面维持）', async () => {
    const { userId, teamId } = await mkGrantee('r3');
    await adminSub.grantCredit(userId, 3, 'regular');
    await adminSub.grantCredit(userId, 3, 'regular');
    expect(await prisma.teamCreditTransaction.count({ where: { teamId, type: 'admin_grant' } })).toBe(2);
    expect((await prisma.teamBalance.findUniqueOrThrow({ where: { teamId } })).credits).toBe(106);
  }, 30_000);

  it('并发同键恰一行台账+两次返回同一 transactionId（advisory 锁收并发窗——改前红=500：前置查双方 miss⇒后者撞唯一⇒事务 abort）', async () => {
    const { userId, teamId } = await mkGrantee('r4');
    const key = `it-adm8-k4-${randomUUID()}`;
    const [a, b] = await Promise.all([
      adminSub.grantCredit(userId, 10, 'regular', { idempotencyKey: key, operatorUserId: `op-${uniq}` }),
      adminSub.grantCredit(userId, 10, 'regular', { idempotencyKey: key, operatorUserId: `op-${uniq}` }),
    ]);
    expect(a.transactionId).toBe(b.transactionId);             // 同一 transactionId
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);   // 一首发一重放
    expect(await prisma.teamCreditTransaction.count({ where: { teamId, idempotencyKey: key } })).toBe(1);   // 恰一行
    expect((await prisma.teamBalance.findUniqueOrThrow({ where: { teamId } })).credits).toBe(110);          // 余额一次
  }, 30_000);

  it('Z100 backstop 保留：同 reversesId 二次入账仍抛错（skipDuplicates 全文清剿后真正的重复事件闸）', async () => {
    const owner = await mkUser(`it-adm8-bk-${uniq}`);
    const teamId = `it-adm8-bk-team-${uniq}`;
    await prisma.team.create({ data: { id: teamId, name: 'it-adm8-bk', ownerId: owner } });
    await prisma.teamMember.create({ data: { teamId, userId: owner, role: 'OWNER' } });
    reg.teamIds.push(teamId);
    const intent = await createIntentFixture(prisma as unknown as PrismaService, { projectId: 'it-adm8-bk', nodeId: 'n1', userId: owner, teamId, intentId: `it-adm8-bk-${uniq}`, kind: 'text', paramsHash: 'h', status: 'SUCCEEDED', creditCost: 3, creditsConsumed: 3 });
    await ledger.runInTx(async (tx) => {
      await ledger.ensureBalance(tx, teamId);
      await ledger.mutate(tx, { teamId, operatorUserId: owner, type: 'register_grant', creditType: 'regular', balanceDelta: 10, frozenDelta: 0, referenceId: `it-adm8-bk-fund-${uniq}` });
      await ledger.mutate(tx, { teamId, type: 'reserve', creditType: 'regular', balanceDelta: -3, frozenDelta: 3, referenceId: `intent:${intent.id}` });
    });
    const reserveId = (await prisma.teamCreditTransaction.findFirstOrThrow({ where: { teamId, type: 'reserve' } })).id;
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId, type: 'settle', creditType: 'regular', balanceDelta: 0, frozenDelta: -3, referenceId: `intent:${intent.id}`, reversesId: reserveId }));
    await expect(ledger.runInTx((tx) => ledger.mutate(tx, { teamId, type: 'settle', creditType: 'regular', balanceDelta: 0, frozenDelta: -3, referenceId: `intent:${intent.id}`, reversesId: reserveId }))).rejects.toThrow();
    await prisma.generationIntent.deleteMany({ where: { projectId: 'it-adm8-bk' } });
  }, 30_000);
});
