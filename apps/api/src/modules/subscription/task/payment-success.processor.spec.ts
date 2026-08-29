import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentSuccessProcessor } from './payment-success.processor';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentGateway } from '../../recharge/payment.gateway';

describe('PaymentSuccessProcessor（个人订阅支付成功 → 默认团队 TeamBalance）', () => {
  let processor: PaymentSuccessProcessor;
  let prisma: any;
  let gateway: any;

  const baseOrder = {
    id: 'o1', orderNo: 'NO1', userId: 'u1', planId: 'plan1', period: 'monthly',
    payableAmount: 5600, type: 'new_purchase', status: 'PENDING', delayCloseJobId: null,
  };
  const plan = { id: 'plan1', tier: 'pro', monthlyCredits: 100 };

  beforeEach(() => {
    prisma = {
      subscriptionOrder: { findUnique: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      subscriptionPlan: { findUnique: vi.fn().mockResolvedValue(plan) },
      userSubscription: { create: vi.fn().mockResolvedValue({ id: 'new-sub-1' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      team: { findFirst: vi.fn().mockResolvedValue({ id: 't-default', isDefault: true }) },
      teamBalance: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
      teamCreditTransaction: { create: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(),
    };
    gateway = { emitSubscriptionPaymentSuccess: vi.fn() };
    processor = new PaymentSuccessProcessor(
      prisma as unknown as PrismaService,
      gateway as unknown as PaymentGateway,
    );
  });

  const run = (order: Record<string, unknown>) => {
    prisma.subscriptionOrder.findUnique.mockResolvedValue(order);
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    return processor.process({ data: { orderNo: 'NO1', transactionId: 'tx1', payerOpenid: 'openid1' } } as any);
  };

  it('新购：paidAmount 存分不除 100，before=0 直发（无清零流水，subscription_grant 设值发放）', async () => {
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-default', credits: 10, subscriptionCredits: 0 });

    await run({ ...baseOrder });

    // paidAmount：payableAmount 5600 分 → 直接存 5600（不再 /100）
    expect(prisma.userSubscription.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'u1', paidAmount: 5600, totalCredits: 100 }),
    }));
    // FOR UPDATE 锁默认团队
    expect(prisma.$queryRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('FOR UPDATE')]),
      't-default',
    );
    // before=0：仅发放流水一笔（referenceId=新订阅）
    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledTimes(1);
    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        teamId: 't-default', operatorUserId: 'u1', amount: 100,
        type: 'subscription_grant', creditType: 'subscription',
        referenceId: 'new-sub-1', balanceAfter: 100,
      }),
    }));
    expect(prisma.teamBalance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId: 't-default' },
      data: { subscriptionCredits: 100 },
    }));
  });

  it('升级：旧订阅置 upgraded + upgrade_clear 清零流水 + 新额度发放（paidAmount 存分）', async () => {
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-default', credits: 10, subscriptionCredits: 20 });

    await run({ ...baseOrder, type: 'upgrade', fromSubscriptionId: 'old-sub-1' });

    expect(prisma.userSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'old-sub-1', status: 'active' },
      data: { status: 'upgraded' },
    }));
    expect(prisma.userSubscription.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ paidAmount: 5600 }),
    }));
    // 旧池 20 > 0：先 upgrade_clear 清零流水（余额每笔变动可审计）
    expect(prisma.teamBalance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId: 't-default' },
      data: { subscriptionCredits: 0 },
    }));
    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        teamId: 't-default', amount: -20, type: 'upgrade_clear',
        creditType: 'subscription', balanceAfter: 0,
      }),
    }));
    // 再设值发放
    expect(prisma.teamBalance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId: 't-default' },
      data: { subscriptionCredits: 100 },
    }));
    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 100, type: 'subscription_grant', balanceAfter: 100 }),
    }));
  });

  it('续费 renewal：clearType=expire_clear（续费=新周期，覆盖不滚存）', async () => {
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-default', credits: 10, subscriptionCredits: 50 });

    await run({ ...baseOrder, type: 'renewal' });

    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        teamId: 't-default', amount: -50, type: 'expire_clear', balanceAfter: 0,
      }),
    }));
    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 100, type: 'subscription_grant', balanceAfter: 100 }),
    }));
  });

  it('订单已 SUCCESS 幂等跳过', async () => {
    await run({ ...baseOrder, status: 'SUCCESS' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.teamCreditTransaction.create).not.toHaveBeenCalled();
  });
});
