import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GrantCreditProcessor } from './grant-credit.processor';
import { PrismaService } from '../../../prisma/prisma.service';

describe('GrantCreditProcessor（个人订阅周期发放 → 默认团队 TeamBalance）', () => {
  let processor: GrantCreditProcessor;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      userSubscription: { findMany: vi.fn(), update: vi.fn() },
      subscriptionPlan: { findUnique: vi.fn() },
      team: { findFirst: vi.fn() },
      teamBalance: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
      teamCreditTransaction: { create: vi.fn() },
      $queryRaw: vi.fn(),
      $transaction: vi.fn(),
    };
    processor = new GrantCreditProcessor(prisma as unknown as PrismaService);
  });

  it('周期发放写入默认团队 TeamBalance（FOR UPDATE + 先清零流水再发放流水）', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.userSubscription.findMany
      .mockResolvedValueOnce([
        { id: 's1', userId: 'u1', planId: 'plan1', period: 'monthly', grantCount: 0, nextGrantDate: new Date() },
      ])
      .mockResolvedValueOnce([]); // 游标推进后无更多记录（mock 不做 gt 过滤，需显式终止）
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: 'plan1', monthlyCredits: 100 });
    prisma.team.findFirst.mockResolvedValue({ id: 't-default', isDefault: true });
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-default', credits: 10, subscriptionCredits: 20, version: 1 });

    await processor.process({ data: { subscriptionId: 's1' } } as any);

    expect(prisma.$queryRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('FOR UPDATE')]), // SELECT ... FOR UPDATE 行锁
      't-default',
    );
    // 旧池剩余 20 > 0：先清零 + expire_clear 流水（覆盖不滚存 + 账务完整）
    expect(prisma.teamBalance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId: 't-default' },
      data: { subscriptionCredits: 0 },
    }));
    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        teamId: 't-default', operatorUserId: 'u1', amount: -20,
        type: 'expire_clear', creditType: 'subscription', referenceId: 's1', balanceAfter: 0,
      }),
    }));
    // 再设值发放 + subscription_grant 流水（非 increment）
    expect(prisma.teamBalance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId: 't-default' },
      data: { subscriptionCredits: 100 },
    }));
    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        teamId: 't-default', amount: 100, type: 'subscription_grant',
        creditType: 'subscription', balanceAfter: 100,
      }),
    }));
  });

  it('旧池为 0 时跳过清零段（无空流水）', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.userSubscription.findMany
      .mockResolvedValueOnce([
        { id: 's1', userId: 'u1', planId: 'plan1', period: 'monthly', grantCount: 0, nextGrantDate: new Date() },
      ])
      .mockResolvedValueOnce([]);
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: 'plan1', monthlyCredits: 100 });
    prisma.team.findFirst.mockResolvedValue({ id: 't-default', isDefault: true });
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-default', credits: 0, subscriptionCredits: 0 });

    await processor.process({ data: { subscriptionId: 's1' } } as any);

    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledTimes(1); // 仅发放流水
    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'subscription_grant' }),
    }));
  });

  it('cursor 分页：continue 跳过的记录也推进 lastId（修复 skip 分页错位漏发）', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.team.findFirst.mockResolvedValue({ id: 't-default', isDefault: true });
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-default', credits: 0, subscriptionCredits: 0 });
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
    }));
    expect(prisma.userSubscription.findMany).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: expect.objectContaining({ id: { gt: 'b1' } }),
    }));
  });
});
