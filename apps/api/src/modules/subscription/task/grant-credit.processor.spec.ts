import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GrantCreditProcessor } from './grant-credit.processor';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreditLedgerService } from '../../team/credit-ledger.service';

vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));
import * as Sentry from '@sentry/nestjs';

describe('GrantCreditProcessor（个人订阅周期发放 → 默认团队账本，经 grantToPersonalTeam）', () => {
  let processor: GrantCreditProcessor;
  let prisma: any;
  let ledger: any;

  beforeEach(() => {
    ledger = {
      tx: (raw: any) => raw,
      lockBalance: vi.fn().mockResolvedValue(undefined),
      ensureBalance: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn().mockResolvedValue({ rowId: 'lr-1', balanceAfter: 0 }),
    };
    prisma = {
      userSubscription: { findMany: vi.fn(), update: vi.fn() },
      subscriptionPlan: { findUnique: vi.fn() },
      team: { findFirst: vi.fn() },
      teamBalance: { findUniqueOrThrow: vi.fn() },
      $executeRaw: vi.fn().mockResolvedValue(0), // SET LOCAL lock_timeout（真实 tx 有）
      $transaction: vi.fn(),
    };
    processor = new GrantCreditProcessor(
      prisma as unknown as PrismaService,
      ledger as unknown as CreditLedgerService,
    );
  });

  it('周期发放写入默认团队（lockBalance 锁 + 旧池 20>0 先清零 mutate 再发放 mutate，Z24 分键 :clear/:grant）', async () => {
    const nextGrantDate = new Date();
    const periodKey = nextGrantDate.toISOString().slice(0, 10);
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.userSubscription.findMany
      .mockResolvedValueOnce([
        { id: 's1', userId: 'u1', planId: 'plan1', period: 'monthly', grantCount: 0, nextGrantDate },
      ])
      .mockResolvedValueOnce([]); // 游标推进后无更多记录（mock 不做 gt 过滤，需显式终止）
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: 'plan1', monthlyCredits: 100 });
    prisma.team.findFirst.mockResolvedValue({ id: 't-default', isDefault: true });
    prisma.teamBalance.findUniqueOrThrow.mockResolvedValue({ teamId: 't-default', credits: 10, subscriptionCredits: 20 });

    await processor.process({ data: { subscriptionId: 's1' } } as any);

    // Y0b-1 Z23/Z13：懒创建收敛 ensureBalance；FOR UPDATE 改 lockBalance
    expect(ledger.ensureBalance).toHaveBeenCalledWith(expect.anything(), 't-default');
    expect(ledger.lockBalance).toHaveBeenCalledWith(expect.anything(), 't-default');
    // 旧池剩余 20 > 0：先清零（expire_clear）+ 再发放（subscription_grant），referenceId 周期事件键分后缀
    expect(ledger.mutate).toHaveBeenCalledTimes(2);
    expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
      teamId: 't-default', operatorUserId: 'u1', type: 'expire_clear', creditType: 'subscription',
      balanceDelta: -20, frozenDelta: 0, referenceId: `s1:${periodKey}:clear`,
    });
    expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
      teamId: 't-default', operatorUserId: 'u1', type: 'subscription_grant', creditType: 'subscription',
      balanceDelta: 100, frozenDelta: 0, referenceId: `s1:${periodKey}:grant`,
    });
  });

  it('旧池为 0 时跳过清零段（无空流水）', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.userSubscription.findMany
      .mockResolvedValueOnce([
        { id: 's1', userId: 'u1', planId: 'plan1', period: 'monthly', grantCount: 0, nextGrantDate: new Date() },
      ])
      .mockResolvedValueOnce([]);
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: 'plan1', monthlyCredits: 100 });
    prisma.team.findFirst.mockResolvedValue({ id: 't-default', isDefault: true });
    prisma.teamBalance.findUniqueOrThrow.mockResolvedValue({ teamId: 't-default', credits: 0, subscriptionCredits: 0 });

    await processor.process({ data: { subscriptionId: 's1' } } as any);

    expect(ledger.mutate).toHaveBeenCalledTimes(1); // 仅发放流水
    expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'subscription_grant',
    }));
  });

  it('兜底建账本行：bootstrap 失败用户经 ensureBalance 补建后再正常发放', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.userSubscription.findMany
      .mockResolvedValueOnce([
        { id: 's1', userId: 'u1', planId: 'plan1', period: 'monthly', grantCount: 0, nextGrantDate: new Date() },
      ])
      .mockResolvedValueOnce([]);
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: 'plan1', monthlyCredits: 100 });
    prisma.team.findFirst.mockResolvedValue({ id: 't-default', isDefault: true });
    prisma.teamBalance.findUniqueOrThrow.mockResolvedValue({ teamId: 't-default', credits: 0, subscriptionCredits: 0 });

    await processor.process({ data: {} } as any);

    // 兜底补建（防裸 update P2025）——唯一建行口 ensureBalance
    expect(ledger.ensureBalance).toHaveBeenCalledWith(expect.anything(), 't-default');
    // 补建后发放正常
    expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'subscription_grant', balanceDelta: 100,
    }));
  });

  it('单用户默认团队缺失不中止当日扫描（第二项仍发放 + Sentry 上报）', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.userSubscription.findMany
      .mockResolvedValueOnce([
        { id: 's1', userId: 'u1', planId: 'plan1', period: 'monthly', grantCount: 0, nextGrantDate: new Date() },
        { id: 's2', userId: 'u2', planId: 'plan1', period: 'monthly', grantCount: 0, nextGrantDate: new Date() },
      ])
      .mockResolvedValueOnce([]);
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: 'plan1', monthlyCredits: 100 });
    prisma.team.findFirst
      .mockResolvedValueOnce(null) // s1: bootstrap 失败用户默认团队缺失
      .mockResolvedValue({ id: 't-default', isDefault: true }); // s2 正常
    prisma.teamBalance.findUniqueOrThrow.mockResolvedValue({ teamId: 't-default', credits: 0, subscriptionCredits: 0 });

    await expect(processor.process({ data: {} } as any)).resolves.toBeUndefined();

    // 第二项仍被发放
    expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      operatorUserId: 'u2', type: 'subscription_grant', balanceDelta: 100,
    }));
    // 失败信号上报（BullMQ 作业失败不自动上报 Sentry）
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('cursor 分页：continue 跳过的记录也推进 lastId（修复 skip 分页错位漏发）', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.team.findFirst.mockResolvedValue({ id: 't-default', isDefault: true });
    prisma.teamBalance.findUniqueOrThrow.mockResolvedValue({ teamId: 't-default', credits: 0, subscriptionCredits: 0 });
    prisma.subscriptionPlan.findUnique
      .mockResolvedValueOnce({ id: 'plan1', monthlyCredits: 10 }) // a1 可发放
      .mockResolvedValueOnce(null) // a2 plan 缺失 → continue
      .mockResolvedValue({ id: 'plan1', monthlyCredits: 10 }); // b1 可发放
    prisma.userSubscription.findMany
      .mockResolvedValueOnce([
        { id: 'a1', userId: 'u1', planId: 'plan1', period: 'monthly', grantCount: 0, nextGrantDate: new Date() },
        { id: 'a2', userId: 'u1', planId: 'plan-x', period: 'monthly', grantCount: 0, nextGrantDate: new Date() },
      ])
      .mockResolvedValueOnce([
        { id: 'b1', userId: 'u1', planId: 'plan1', period: 'monthly', grantCount: 0, nextGrantDate: new Date() },
      ])
      .mockResolvedValueOnce([]);

    await processor.process({ data: {} } as any);

    // 第二页从 a2 之后继续（a2 虽然 continue 但 lastId 已推进，不会重扫错位）
    expect(prisma.userSubscription.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: { gt: 'a2' } }),
      orderBy: { id: 'asc' }, // 键集分页语义依赖稳定排序，防 orderBy 被删后静默错位
      take: 100,
    }));
    expect(prisma.userSubscription.findMany).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: expect.objectContaining({ id: { gt: 'b1' } }),
      orderBy: { id: 'asc' },
      take: 100,
    }));
  });
});
