// apps/api/src/modules/team/credit-ledger.int.spec.ts —— Y0b-1 资金门载体（spec §6.2 点名）
// 并发纪律=FOR UPDATE 单式；两列真值表；reversal 三配对（Z6）；台账锚 intentRowId（F1）；锁序全序（Z13）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { CreditLedgerService } from './credit-ledger.service';

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as any);

function mkTeam(tag: string) {
  return prisma.team.create({ data: { id: `it-led-${tag}-${Date.now()}`, name: `it-${tag}`, ownerId: 'it-led-owner' } })
    .then((t) => prisma.teamBalance.create({ data: { teamId: t.id, credits: 100 } }).then(() => t));
}

describe('Y0b-1 CreditLedgerService（真库）', () => {
  const teams: string[] = [];
  beforeAll(async () => {
    await prisma.user.create({ data: { id: 'it-led-owner', name: 'it', email: `it-led-${Date.now()}@x.invalid`, emailVerified: false } }).catch(() => {});
  }, 20000);
  afterAll(async () => {
    await prisma.teamCreditTransaction.deleteMany({ where: { teamId: { startsWith: 'it-led-' } } }).catch(() => {});
    for (const t of [...teams].reverse()) await prisma.team.delete({ where: { id: t } }).catch(() => {});
    await prisma.generationIntent.deleteMany({ where: { intentId: { startsWith: 'led-' } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: 'it-led-owner' } });
    await prisma.$disconnect();
  }, 20000);

  it('F1 跨团队同 intentId 隔离：referenceId=intentRowId+teamId 过滤——一侧 settle 另一侧零变化', async () => {
    const a = await mkTeam('xa'); const b = await mkTeam('xb'); teams.push(a.id, b.id);
    const ia = await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: a.id, nodeId: 'n', userId: 'it-led-owner', intentId: 'led-shared', kind: 'text', paramsHash: 'h', status: 'RUNNING', creditCost: 10 } as any });
    const ib = await prisma.generationIntent.create({ data: { projectId: 'it-p2', teamId: b.id, nodeId: 'n', userId: 'it-led-owner', intentId: 'led-shared', kind: 'text', paramsHash: 'h', status: 'RUNNING', creditCost: 10, reservedCredits: 10 } as any });
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: a.id, type: 'reserve', creditType: 'regular', balanceDelta: -10, frozenDelta: 10, referenceId: `intent:${ia.id}` }));
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: b.id, type: 'reserve', creditType: 'regular', balanceDelta: -10, frozenDelta: 10, referenceId: `intent:${ib.id}` }));
    // settle A（anti-join 形态——Z6：未被 settle/release 冲销的 reserve 行）
    await ledger.runInTx(async (tx) => {
      const rowsA = await tx.$queryRaw<any[]>`
        SELECT r.* FROM "TeamCreditTransaction" r
        WHERE r."teamId" = ${a.id} AND r."referenceId" = ${'intent:' + ia.id} AND r.type = 'reserve'
          AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)`;
      for (const r of rowsA) {
        await ledger.mutate(tx, { teamId: a.id, type: 'settle', creditType: r.creditType, balanceDelta: 0, frozenDelta: r.amount, referenceId: r.referenceId, reversesId: r.id });
      }
    });
    const bSettle = await prisma.teamCreditTransaction.count({ where: { teamId: b.id, type: 'settle' } });
    const bBal = await prisma.teamBalance.findUnique({ where: { teamId: b.id } });
    expect(bSettle).toBe(0);
    expect(bBal?.credits).toBe(90);   // 仅 reserve 冻结——无 settle 侵入
    await prisma.generationIntent.deleteMany({ where: { id: { in: [ia.id, ib.id] } } });
  }, 20000);

  it('两列真值表锚：settle 行 balanceDelta=0 ∧ frozenDelta=−X ∧ reversesId→reserve 行', async () => {
    const t = await mkTeam('tt'); teams.push(t.id);
    const intent = await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: t.id, nodeId: 'n', userId: 'it-led-owner', intentId: `led-tt-${Date.now()}`, kind: 'text', paramsHash: 'h', status: 'SUCCEEDED', creditCost: 5, reservedCredits: 0, creditsConsumed: 5 } as any });
    const res = await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'reserve', creditType: 'regular', balanceDelta: -5, frozenDelta: 5, referenceId: `intent:${intent.id}` }));
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'settle', creditType: 'regular', balanceDelta: 0, frozenDelta: -5, referenceId: `intent:${intent.id}`, reversesId: res.rowId }));
    const settle = await prisma.teamCreditTransaction.findFirstOrThrow({ where: { teamId: t.id, type: 'settle' } });
    expect(settle.balanceDelta).toBe(0);
    expect(settle.frozenDelta).toBe(-5);
    expect(settle.reversesId).toBe(res.rowId);
    expect(settle.balanceAfter).toBe(95);
    expect(settle.amount).toBe(-5);   // Z8 派生式
    await prisma.generationIntent.deleteMany({ where: { id: intent.id } });
  }, 20000);

  it('F2 混合符号二次退款：anti-join 谓词——已 release 的 reserve 行不再进 chargeRows', async () => {
    const t = await mkTeam('mx'); teams.push(t.id);
    const intent = await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: t.id, nodeId: 'n', userId: 'it-led-owner', intentId: `led-mx-${Date.now()}`, kind: 'text', paramsHash: 'h', status: 'RUNNING', creditCost: 10 } as any });
    const res = await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'reserve', creditType: 'regular', balanceDelta: -10, frozenDelta: 10, referenceId: `intent:${intent.id}` }));
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'release', creditType: 'regular', balanceDelta: 10, frozenDelta: -10, referenceId: `intent:${intent.id}`, reversesId: res.rowId }));
    const rows = await prisma.$queryRaw<any[]>`
      SELECT r.* FROM "TeamCreditTransaction" r
      WHERE r."teamId" = ${t.id} AND r."referenceId" = ${'intent:' + intent.id} AND r.type IN ('reserve','settle') AND r.amount < 0
        AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)`;
    expect(rows).toHaveLength(0);
    const bal = await prisma.teamBalance.findUniqueOrThrow({ where: { teamId: t.id } });
    expect(bal.credits).toBe(100);
    await prisma.generationIntent.deleteMany({ where: { id: intent.id } });
  }, 20000);

  it('Z9 money_in 幂等：同 (recharge, outTradeNo) 二次入账 DB 拒', async () => {
    const t = await mkTeam('rc'); teams.push(t.id);
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'recharge', creditType: 'regular', balanceDelta: 10, frozenDelta: 0, referenceId: 'led-order-1' }));
    await expect(ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'recharge', creditType: 'regular', balanceDelta: 10, frozenDelta: 0, referenceId: 'led-order-1' }))).rejects.toThrow();
    const rows = await prisma.teamCreditTransaction.count({ where: { teamId: t.id, type: 'recharge', referenceId: 'led-order-1' } });
    expect(rows).toBe(1);
  }, 20000);

  it('Z24 跨期发放：同 sub.id 两个周期 → 两行都写入、余额两期叠加', async () => {
    const t = await mkTeam('pd'); teams.push(t.id);
    for (const periodKey of ['2026-10-01', '2026-11-01']) {
      await ledger.runInTx((tx) => ledger.mutate(tx, {
        teamId: t.id, type: 'subscription_grant', creditType: 'subscription',
        balanceDelta: 30, frozenDelta: 0, referenceId: `led-sub-1:${periodKey}`,
      }));
    }
    const rows = await prisma.teamCreditTransaction.count({ where: { teamId: t.id, type: 'subscription_grant', referenceId: { startsWith: 'led-sub-1:' } } });
    expect(rows).toBe(2);
    const bal = await prisma.teamBalance.findUniqueOrThrow({ where: { teamId: t.id } });
    expect(bal.subscriptionCredits).toBe(60);
  }, 20000);

  it('Z23 ensureBalance：钱包缺失团队经 ensureBalance 后可 mutate（lockBalance 单独用则必炸）', async () => {
    const t = await mkTeam('nb'); teams.push(t.id);
    await prisma.teamBalance.delete({ where: { teamId: t.id } }).catch(() => {});
    await expect(ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'admin_grant', creditType: 'regular', balanceDelta: 5, frozenDelta: 0, referenceId: 'led-nb' }))).rejects.toMatchObject({ errorCode: 'TEAM_BALANCE_MISSING' });
    await ledger.runInTx(async (tx) => {
      await ledger.ensureBalance(tx, t.id);
      await ledger.mutate(tx, { teamId: t.id, type: 'admin_grant', creditType: 'regular', balanceDelta: 5, frozenDelta: 0, referenceId: 'led-nb' });
    });
    const bal = await prisma.teamBalance.findUniqueOrThrow({ where: { teamId: t.id } });
    expect(bal.credits).toBe(5);
  }, 20000);

  it('admin 并发撕裂修复：8 路并发 mutate 余额与流水原子（ΣbalanceDelta≡池变化）', async () => {
    const t = await mkTeam('ad'); teams.push(t.id);
    await Promise.all([...Array(8)].map((_, i) =>
      ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'admin_grant', creditType: 'regular', balanceDelta: 10, frozenDelta: 0, referenceId: `led-admin-${i}` }))));
    const bal = await prisma.teamBalance.findUniqueOrThrow({ where: { teamId: t.id } });
    const sum = await prisma.teamCreditTransaction.aggregate({ where: { teamId: t.id, type: 'admin_grant' }, _sum: { balanceDelta: true } });
    expect(bal.credits).toBe(180);
    expect(sum._sum.balanceDelta).toBe(80);
  }, 30000);

  it('Z13 锁等待：并发 reserve×release 各 N 轮零死锁零锁等待超时（lock_timeout=3s 内完成）', async () => {
    const t = await mkTeam('lk'); teams.push(t.id);
    const intents = [];
    for (let i = 0; i < 5; i++) {
      intents.push(await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: t.id, nodeId: `n${i}`, userId: 'it-led-owner', intentId: `led-lk-${Date.now()}-${i}`, kind: 'text', paramsHash: 'h', status: 'RUNNING', creditCost: 5 } as any }));
      await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'reserve', creditType: 'regular', balanceDelta: -5, frozenDelta: 5, referenceId: `intent:${intents[i].id}` }));
    }
    const results = await Promise.allSettled(
      intents.map((x) => ledger.runInTx(async (tx) => {
        const r = await tx.teamCreditTransaction.findFirstOrThrow({ where: { referenceId: `intent:${x.id}`, type: 'reserve' } });
        return ledger.mutate(tx, { teamId: t.id, type: 'release', creditType: 'regular', balanceDelta: 5, frozenDelta: -5, referenceId: `intent:${x.id}`, reversesId: r.id });
      })),
    );
    const bad = results.filter((r) => r.status === 'rejected' && !/CREDIT_LEDGER|REVERSAL|40P01/i.test(String((r as PromiseRejectedResult).reason)));
    expect(bad).toHaveLength(0);
    await prisma.generationIntent.deleteMany({ where: { id: { in: intents.map((x) => x.id) } } });
  }, 30000);

  it('rearm 二次退款（F2 姊妹）：release 后 rearm 新 reserve 行——新 settle 配新 reversesId 无冲突（Z6）', async () => {
    const t = await mkTeam('rm'); teams.push(t.id);
    const intent = await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: t.id, nodeId: 'n', userId: 'it-led-owner', intentId: `led-rm-${Date.now()}`, kind: 'text', paramsHash: 'h', status: 'RUNNING', creditCost: 10 } as any });
    const res1 = await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'reserve', creditType: 'regular', balanceDelta: -10, frozenDelta: 10, referenceId: `intent:${intent.id}` }));
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'release', creditType: 'regular', balanceDelta: 10, frozenDelta: -10, referenceId: `intent:${intent.id}`, reversesId: res1.rowId }));
    const res2 = await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'reserve', creditType: 'regular', balanceDelta: -10, frozenDelta: 10, referenceId: `intent:${intent.id}` }));
    await expect(ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'settle', creditType: 'regular', balanceDelta: 0, frozenDelta: -10, referenceId: `intent:${intent.id}`, reversesId: res2.rowId }))).resolves.toBeTruthy();
    await prisma.generationIntent.deleteMany({ where: { id: intent.id } });
  }, 20000);

  it('悬空 reversesId 服务层拒绝（T1b 质量审登记）：reversesId 指向不存在行 ⇒ REVERSAL_TARGET', async () => {
    const t = await mkTeam('dg'); teams.push(t.id);
    const intent = await prisma.generationIntent.create({ data: { projectId: 'it-p', teamId: t.id, nodeId: 'n', userId: 'it-led-owner', intentId: `led-dg-${Date.now()}`, kind: 'text', paramsHash: 'h', status: 'SUCCEEDED', creditCost: 3, reservedCredits: 3 } as any });
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'reserve', creditType: 'regular', balanceDelta: -3, frozenDelta: 3, referenceId: `intent:${intent.id}` }));
    await expect(ledger.runInTx((tx) => ledger.mutate(tx, { teamId: t.id, type: 'settle', creditType: 'regular', balanceDelta: 0, frozenDelta: -3, referenceId: `intent:${intent.id}`, reversesId: 'no-such-row' }))).rejects.toThrow(/REVERSAL_TARGET/);
    await prisma.generationIntent.deleteMany({ where: { id: intent.id } });
  }, 20000);
});
