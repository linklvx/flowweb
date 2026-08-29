import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExpireSubscriptionProcessor } from './expire-subscription.processor';
import { PrismaService } from '../../../prisma/prisma.service';

vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));
import * as Sentry from '@sentry/nestjs';

describe('ExpireSubscriptionProcessor（个人订阅过期清零 → 默认团队 TeamBalance）', () => {
  let processor: ExpireSubscriptionProcessor;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      userSubscription: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      team: { findFirst: vi.fn() },
      teamBalance: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
      teamCreditTransaction: { create: vi.fn() },
      $queryRaw: vi.fn(),
      $transaction: vi.fn(),
    };
    processor = new ExpireSubscriptionProcessor(prisma as unknown as PrismaService);
  });

  it('过期清零 amount = 实时剩余订阅积分（非 totalCredits-consumedCredits 推算）', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.userSubscription.findMany
      .mockResolvedValueOnce([{ id: 's1', userId: 'u1' }])
      .mockResolvedValueOnce([]); // mock 不做 gt 过滤，需显式终止
    prisma.userSubscription.findUnique.mockResolvedValue({
      id: 's1', userId: 'u1', status: 'active', totalCredits: 500, consumedCredits: 100, // 推算值 -400 ≠ 实时 -37
    });
    prisma.team.findFirst.mockResolvedValue({ id: 't-default', isDefault: true });
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-default', subscriptionCredits: 37 });

    await processor.process({ data: {} } as any);

    expect(prisma.userSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 's1' },
      data: { status: 'expired' },
    }));
    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ teamId: 't-default', amount: -37, type: 'expire_clear', balanceAfter: 0 }),
    }));
    expect(prisma.teamBalance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId: 't-default' },
      data: { subscriptionCredits: 0 },
    }));
  });

  it('实时剩余为 0 时不写清零流水（无空流水）', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.userSubscription.findMany
      .mockResolvedValueOnce([{ id: 's1', userId: 'u1' }])
      .mockResolvedValueOnce([]);
    prisma.userSubscription.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', status: 'active' });
    prisma.team.findFirst.mockResolvedValue({ id: 't-default', isDefault: true });
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-default', subscriptionCredits: 0 });

    await processor.process({ data: {} } as any);

    expect(prisma.teamCreditTransaction.create).not.toHaveBeenCalled();
    expect(prisma.teamBalance.update).not.toHaveBeenCalled();
  });

  it('复查非 active 跳过（防御 grant processor 已改状态）', async () => {
    prisma.userSubscription.findMany
      .mockResolvedValueOnce([{ id: 's1', userId: 'u1' }])
      .mockResolvedValueOnce([]);
    prisma.userSubscription.findUnique.mockResolvedValue({ id: 's1', status: 'upgraded' });

    await processor.process({ data: {} } as any);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.userSubscription.update).not.toHaveBeenCalled();
  });

  it('单用户默认团队缺失不中止当日扫描（第二项仍过期清零 + Sentry 上报）', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.userSubscription.findMany
      .mockResolvedValueOnce([{ id: 's1', userId: 'u1' }, { id: 's2', userId: 'u2' }])
      .mockResolvedValueOnce([]);
    prisma.userSubscription.findUnique
      .mockResolvedValueOnce({ id: 's1', userId: 'u1', status: 'active' })
      .mockResolvedValueOnce({ id: 's2', userId: 'u2', status: 'active' });
    prisma.team.findFirst
      .mockResolvedValueOnce(null) // s1: bootstrap 失败用户默认团队缺失
      .mockResolvedValue({ id: 't-default', isDefault: true }); // s2 正常
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-default', subscriptionCredits: 37 });

    await expect(processor.process({ data: {} } as any)).resolves.toBeUndefined();

    // 第二项仍被过期清零
    expect(prisma.userSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 's2' },
      data: { status: 'expired' },
    }));
    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ teamId: 't-default', amount: -37, type: 'expire_clear' }),
    }));
    // 失败信号上报（BullMQ 作业失败不自动上报 Sentry）
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('cursor 分页：复查跳过的记录也推进 lastId（修复 skip 分页漏扫）', async () => {
    prisma.team.findFirst.mockResolvedValue({ id: 't-default', isDefault: true });
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-default', subscriptionCredits: 0 });
    prisma.userSubscription.findMany
      .mockResolvedValueOnce([{ id: 'a1', userId: 'u1' }, { id: 'a2', userId: 'u1' }])
      .mockResolvedValueOnce([{ id: 'b1', userId: 'u1' }])
      .mockResolvedValueOnce([]);
    // a1 复查通过，a2 复查失败 continue
    prisma.userSubscription.findUnique
      .mockResolvedValueOnce({ id: 'a1', userId: 'u1', status: 'active' })
      .mockResolvedValueOnce({ id: 'a2', status: 'upgraded' })
      .mockResolvedValueOnce({ id: 'b1', userId: 'u1', status: 'active' });
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([]);

    await processor.process({ data: {} } as any);

    // 第二页从 a2 之后继续（a2 虽 continue 但 lastId 已推进）
    expect(prisma.userSubscription.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: { gt: 'a2' } }),
      orderBy: { id: 'asc' }, // 键集分页语义依赖稳定排序，防 orderBy 被删后静默漏扫
      take: 100,
    }));
    expect(prisma.userSubscription.findMany).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: expect.objectContaining({ id: { gt: 'b1' } }),
      orderBy: { id: 'asc' },
      take: 100,
    }));
  });
});
