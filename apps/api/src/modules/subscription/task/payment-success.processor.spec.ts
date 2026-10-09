import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentSuccessProcessor } from './payment-success.processor';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentGateway } from '../../recharge/payment.gateway';
import { CreditLedgerService } from '../../team/credit-ledger.service';

describe('PaymentSuccessProcessor（个人订阅支付成功 → 默认团队账本，经 grantToPersonalTeam）', () => {
  let processor: PaymentSuccessProcessor;
  let prisma: any;
  let gateway: any;
  let ledger: any;

  const baseOrder = {
    id: 'o1', orderNo: 'NO1', userId: 'u1', planId: 'plan1', period: 'monthly',
    payableAmount: 5600, type: 'new_purchase', status: 'PENDING', delayCloseJobId: null,
  };
  const plan = { id: 'plan1', tier: 'pro', monthlyCredits: 100 };

  beforeEach(() => {
    ledger = {
      ledgerTx: async (raw: any) => raw,   // Y0b-2 Z89：tx() 已删——mock 同步换 ledgerTx（通行证装饰 mock 为直通）
      lockBalance: vi.fn().mockResolvedValue(undefined),
      ensureBalance: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn().mockResolvedValue({ rowId: 'lr-1', balanceAfter: 0 }),
    };
    prisma = {
      subscriptionOrder: { findUnique: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      subscriptionPlan: { findUnique: vi.fn().mockResolvedValue(plan) },
      userSubscription: { create: vi.fn().mockResolvedValue({ id: 'new-sub-1' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      team: { findFirst: vi.fn().mockResolvedValue({ id: 't-default', isDefault: true }) },
      teamBalance: { findUniqueOrThrow: vi.fn() },
      $executeRaw: vi.fn().mockResolvedValue(0), // SET LOCAL lock_timeout（真实 tx 有）
      $transaction: vi.fn(),
    };
    gateway = { emitSubscriptionPaymentSuccess: vi.fn() };
    processor = new PaymentSuccessProcessor(
      prisma as unknown as PrismaService,
      gateway as unknown as PaymentGateway,
      ledger as unknown as CreditLedgerService,
    );
  });

  const run = (order: Record<string, unknown>) => {
    prisma.subscriptionOrder.findUnique.mockResolvedValue(order);
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    return processor.process({ data: { orderNo: 'NO1', transactionId: 'tx1', payerOpenid: 'openid1' } } as any);
  };

  it('新购：paidAmount 存分不除 100，before=0 直发（无清零流水；Z24 referenceId=order.id 分键 :grant）', async () => {
    prisma.teamBalance.findUniqueOrThrow.mockResolvedValue({ teamId: 't-default', credits: 10, subscriptionCredits: 0 });

    await run({ ...baseOrder });

    // paidAmount：payableAmount 5600 分 → 直接存 5600（不再 /100）
    expect(prisma.userSubscription.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'u1', paidAmount: 5600, totalCredits: 100 }),
    }));
    // Y0b-1 Z13/Z23：lockBalance 锁默认团队 + ensureBalance 懒创建
    expect(ledger.lockBalance).toHaveBeenCalledWith(expect.anything(), 't-default');
    expect(ledger.ensureBalance).toHaveBeenCalledWith(expect.anything(), 't-default');
    // before=0：仅发放流水一笔（referenceId=order.id 分键）
    expect(ledger.mutate).toHaveBeenCalledTimes(1);
    expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
      teamId: 't-default', operatorUserId: 'u1',
      type: 'subscription_grant', creditType: 'subscription',
      balanceDelta: 100, frozenDelta: 0, referenceId: 'o1:grant',
    });
  });

  it('升级：旧订阅置 upgraded + upgrade_clear 清零 mutate + 新额度发放（paidAmount 存分）', async () => {
    prisma.teamBalance.findUniqueOrThrow.mockResolvedValue({ teamId: 't-default', credits: 10, subscriptionCredits: 20 });

    await run({ ...baseOrder, type: 'upgrade', fromSubscriptionId: 'old-sub-1' });

    expect(prisma.userSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'old-sub-1', status: 'active' },
      data: { status: 'upgraded' },
    }));
    expect(prisma.userSubscription.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ paidAmount: 5600 }),
    }));
    // 旧池 20 > 0：先 upgrade_clear 清零流水（余额每笔变动可审计）再发放
    expect(ledger.mutate).toHaveBeenCalledTimes(2);
    expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      teamId: 't-default', operatorUserId: 'u1',
      type: 'upgrade_clear', creditType: 'subscription', balanceDelta: -20, referenceId: 'o1:clear',
    }));
    expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'subscription_grant', balanceDelta: 100, referenceId: 'o1:grant',
    }));
  });

  it('续费 renewal：clearType=expire_clear（续费=新周期，覆盖不滚存）', async () => {
    prisma.teamBalance.findUniqueOrThrow.mockResolvedValue({ teamId: 't-default', credits: 10, subscriptionCredits: 50 });

    await run({ ...baseOrder, type: 'renewal' });

    expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'expire_clear', balanceDelta: -50, referenceId: 'o1:clear',
    }));
    expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'subscription_grant', balanceDelta: 100, referenceId: 'o1:grant',
    }));
  });

  it('订单已 SUCCESS 幂等跳过', async () => {
    await run({ ...baseOrder, status: 'SUCCESS' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(ledger.mutate).not.toHaveBeenCalled();
  });
});
