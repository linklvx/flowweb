import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminSubscriptionService } from './admin-subscription.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('AdminSubscriptionService（手工积分调整 → 默认团队 TeamBalance）', () => {
  let service: AdminSubscriptionService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      userSubscription: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
      team: { findFirst: vi.fn().mockResolvedValue({ id: 't-default', isDefault: true }) },
      teamBalance: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
      teamCreditTransaction: { create: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(),
    };
    service = new AdminSubscriptionService(prisma as unknown as PrismaService);
  });

  describe('cancelSubscription', () => {
    it('作废：订阅置 expired + 清默认团队实时剩余（admin_clear 流水 amount=-剩余）', async () => {
      prisma.userSubscription.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', status: 'active' });
      prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-default', credits: 100, subscriptionCredits: 30 });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));

      await service.cancelSubscription('s1');

      expect(prisma.userSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 's1' },
        data: { status: 'expired' },
      }));
      expect(prisma.$queryRaw).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('FOR UPDATE')]),
        't-default',
      );
      expect(prisma.teamBalance.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { teamId: 't-default' },
        data: { subscriptionCredits: 0 },
      }));
      expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          teamId: 't-default', amount: -30, type: 'admin_clear',
          creditType: 'subscription', referenceId: 's1', balanceAfter: 0,
        }),
      }));
    });

    it('剩余为 0 不写清零流水（无空流水），credits 池不动', async () => {
      prisma.userSubscription.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', status: 'active' });
      prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-default', credits: 100, subscriptionCredits: 0 });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));

      await service.cancelSubscription('s1');

      expect(prisma.teamCreditTransaction.create).not.toHaveBeenCalled();
      expect(prisma.teamBalance.update).not.toHaveBeenCalled();
    });
  });

  describe('listSubscriptions', () => {
    it('items[].plan.storageLimitBytes 转 number，可 JSON 序列化', async () => {
      prisma.userSubscription.findMany.mockResolvedValue([
        { id: 's1', userId: 'u1', tier: 'pro', status: 'active', createdAt: new Date('2026-09-01'), plan: { id: 'p2', tier: 'pro', storageLimitBytes: 107374182400n } },
      ]);
      prisma.userSubscription.count.mockResolvedValue(1);

      const result = await service.listSubscriptions({});

      expect(result.items[0].plan.storageLimitBytes).toBe(107374182400);
      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });

  describe('grantCredit', () => {
    it('订阅池加正数：increment + admin_grant 流水（balanceAfter=调整后实时值）', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue({ id: 's1', userId: 'u1', status: 'active' });
      prisma.teamBalance.upsert.mockResolvedValue({ teamId: 't-default', credits: 10, subscriptionCredits: 70 });

      await service.grantCredit('u1', 50, 'subscription');

      expect(prisma.teamBalance.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { teamId: 't-default' },
        update: { subscriptionCredits: { increment: 50 } },
      }));
      expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          teamId: 't-default', amount: 50, type: 'admin_grant',
          creditType: 'subscription', referenceId: 's1', balanceAfter: 70,
        }),
      }));
    });

    it('订阅池扣负数：admin_clear 流水（amount=负调整量，balanceAfter=调整后实时值）', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue({ id: 's1', userId: 'u1', status: 'active' });
      prisma.teamBalance.upsert.mockResolvedValue({ teamId: 't-default', credits: 10, subscriptionCredits: 50 });

      await service.grantCredit('u1', -20, 'subscription');

      expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          teamId: 't-default', amount: -20, type: 'admin_clear',
          creditType: 'subscription', balanceAfter: 50,
        }),
      }));
    });

    it('regular 池：credits increment + admin_grant 流水（balanceAfter=credits）', async () => {
      prisma.teamBalance.upsert.mockResolvedValue({ teamId: 't-default', credits: 130, subscriptionCredits: 0 });

      await service.grantCredit('u1', 30, 'regular');

      expect(prisma.teamBalance.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { teamId: 't-default' },
        update: { credits: { increment: 30 } },
      }));
      expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          teamId: 't-default', amount: 30, type: 'admin_grant',
          creditType: 'regular', balanceAfter: 130,
        }),
      }));
    });

    it('订阅池发放需有 active 订阅，否则拒绝', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(null);
      await expect(service.grantCredit('u1', 50, 'subscription')).rejects.toThrow();
      expect(prisma.teamBalance.upsert).not.toHaveBeenCalled();
    });
  });
});
