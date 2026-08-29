import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TeamSubscriptionService } from './team-subscription.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('TeamSubscriptionService', () => {
  let service: TeamSubscriptionService;
  let prisma: any;
  const audit = { log: vi.fn(), logTx: vi.fn() };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ name: '付款人' }) },
      teamMember: { findUnique: vi.fn() },
      teamSubscription: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
      teamPlan: { findUnique: vi.fn() },
      teamBalance: { findUnique: vi.fn(), update: vi.fn() },
      teamCreditTransaction: { create: vi.fn() },
      teamRechargeOrder: { findUnique: vi.fn() },
      $queryRaw: vi.fn(),
      $transaction: vi.fn(async (fn: any) => fn({
        $queryRaw: prisma.$queryRaw,
        teamBalance: prisma.teamBalance,
        teamCreditTransaction: prisma.teamCreditTransaction,
        teamSubscription: prisma.teamSubscription,
        teamRechargeOrder: prisma.teamRechargeOrder,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamSubscriptionService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<TeamSubscriptionService>(TeamSubscriptionService);
  });

  describe('createSubscriptionOrder（Q2/S3：active 期拒购）', () => {
    const plan = { id: 'plan1', name: '专业版', monthlyCredits: 500, priceMonthly: 9900, seatLimit: 30, storageLimitBytes: BigInt(20 * 1024 ** 3), isActive: true };

    it('创建 kind=subscription 订单（PENDING+planId+credits=plan.monthlyCredits）', async () => {
      prisma.teamMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.teamSubscription.findFirst.mockResolvedValue(null);
      prisma.teamPlan.findUnique.mockResolvedValue(plan);
      prisma.teamRechargeOrder.findUnique = vi.fn();
      const createSpy = vi.fn().mockImplementation(({ data }: any) => ({ ...data }));
      (prisma as any).teamRechargeOrder.create = createSpy;

      const order = await service.createSubscriptionOrder('t1', 'u1', 'plan1');

      expect(order.kind).toBe('subscription');
      expect(order.planId).toBe('plan1');
      expect(order.amountFen).toBe(9900);
      expect(order.credits).toBe(500);
      expect(order.status).toBe('PENDING');
    });

    it('存在 active 订阅直接拒绝', async () => {
      prisma.teamMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.teamSubscription.findFirst.mockResolvedValue({ id: 's1', status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) });
      await expect(service.createSubscriptionOrder('t1', 'u1', 'plan1')).rejects.toThrow('已开通');
    });

    it('非管理员拒绝', async () => {
      prisma.teamMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
      await expect(service.createSubscriptionOrder('t1', 'u1', 'plan1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('completeSubscriptionCallback（Q2：覆盖式发放）', () => {
    const order = {
      outTradeNo: 'TEAM9', teamId: 't1', payerUserId: 'u1', amountFen: 9900,
      credits: 500, kind: 'subscription', planId: 'plan1', status: 'PENDING',
    };

    it('上期剩余清零（expire_clear 负值流水）→ 覆盖发放 500（subscription_grant）→ 建 TeamSubscription(+30d)', async () => {
      prisma.teamRechargeOrder.findUnique.mockResolvedValue(order);
      prisma.teamPlan.findUnique.mockResolvedValue({ id: 'plan1', monthlyCredits: 500 });
      prisma.teamBalance.findUnique.mockResolvedValue({ credits: 100, subscriptionCredits: 120 });
      prisma.teamSubscription.findFirst.mockResolvedValue(null);
      prisma.teamRechargeOrder.updateMany = vi.fn().mockResolvedValue({ count: 1 });

      const result = await service.completeSubscriptionCallback({
        outTradeNo: 'TEAM9', appid: '', mchid: '', amount: 9900, tradeState: 'SUCCESS', transactionId: 'tx9',
      } as any);

      expect(result.code).toBe('SUCCESS');
      expect(prisma.teamBalance.update).toHaveBeenCalledWith({ where: { teamId: 't1' }, data: { subscriptionCredits: 0 } });
      expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ amount: -120, type: 'expire_clear', creditType: 'subscription', balanceAfter: 0 }),
      });
      expect(prisma.teamBalance.update).toHaveBeenCalledWith({ where: { teamId: 't1' }, data: { subscriptionCredits: 500 } });
      expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ amount: 500, type: 'subscription_grant', creditType: 'subscription', balanceAfter: 500 }),
      });
      expect(prisma.teamSubscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          teamId: 't1', planId: 'plan1', status: 'active', paidAmount: 9900,
          currentPeriodStart: expect.any(Date), currentPeriodEnd: expect.any(Date),
        }),
      });
      expect(audit.logTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        operatorId: 'u1', operatorName: '付款人', teamId: 't1', targetType: 'TEAM', targetId: 't1',
        action: 'subscribe', afterValue: { planId: 'plan1', monthlyCredits: 500 },
      }));
    });

    it('金额不匹配 FAIL', async () => {
      prisma.teamRechargeOrder.findUnique.mockResolvedValue({ ...order, amountFen: 1 });
      const result = await service.completeSubscriptionCallback({
        outTradeNo: 'TEAM9', appid: '', mchid: '', amount: 9900, tradeState: 'SUCCESS', transactionId: 'tx',
      } as any);
      expect(result.code).toBe('FAIL');
    });
  });

  describe('expireSubscriptions（team-expire processor 逻辑）', () => {
    it('到期：置 expired + 清零 subscriptionCredits + expire_clear 流水（credits 不动）', async () => {
      prisma.teamSubscription.findMany.mockResolvedValue([
        { id: 's1', teamId: 't1', status: 'active' },
      ]);
      prisma.teamBalance.findUnique.mockResolvedValue({ credits: 100, subscriptionCredits: 80 });
      prisma.teamSubscription.updateMany.mockResolvedValue({ count: 1 });
      prisma.teamBalance.update = vi.fn();

      const count = await service.expireSubscriptions();

      expect(count).toBe(1);
      expect(prisma.teamSubscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's1', status: 'active' }, data: { status: 'expired' } }),
      );
      expect(prisma.teamBalance.update).toHaveBeenCalledWith({ where: { teamId: 't1' }, data: { subscriptionCredits: 0 } });
      expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ teamId: 't1', amount: -80, type: 'expire_clear', creditType: 'subscription', balanceAfter: 0 }),
      });
      expect(audit.logTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        operatorId: 'system', teamId: 't1', targetType: 'TEAM', targetId: 't1',
        action: 'expire', afterValue: { cleared: 80 },
      }));
    });
  });

  describe('getLimits', () => {
    it('active 订阅取 plan 限额', async () => {
      prisma.teamSubscription.findFirst.mockResolvedValue({
        plan: { seatLimit: 30, storageLimitBytes: BigInt(20 * 1024 ** 3) },
      });
      const limits = await service.getLimits('t1');
      expect(limits).toEqual({ seatLimit: 30, storageLimitBytes: 20 * 1024 ** 3 });
    });

    it('无订阅回落免费常量（20 席位/6GiB）', async () => {
      prisma.teamSubscription.findFirst.mockResolvedValue(null);
      const limits = await service.getLimits('t1');
      expect(limits).toEqual({ seatLimit: 20, storageLimitBytes: 6 * 1024 ** 3 });
    });
  });
});
