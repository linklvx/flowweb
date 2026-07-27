import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionOrderService } from './subscription-order.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from './pricing.service';
import { MetricsService } from '../../metrics/metrics.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

function mockPricing() {
  return {
    calculate: vi.fn().mockReturnValue({
      sourcePaidAmount: 560,
      remainTimeRatio: 0.67,
      remainPointsRatio: 0.7,
      finalRatio: 0.67,
      targetOriginalPrice: 900,
      deductibleAmount: 375,
      payableAmount: 525,
    }),
  };
}

function mockMetrics() {
  return {
    subOrdersCreatedTotal: { inc: vi.fn() },
    subPaymentsInitiatedTotal: { inc: vi.fn() },
    subPaymentsSucceededTotal: { inc: vi.fn() },
    subPaymentDurationSeconds: { observe: vi.fn() },
    subCallbackLatencySeconds: { observe: vi.fn() },
  };
}

const mockPlan = {
  id: 'plan-pro',
  name: 'Pro',
  tier: 'pro',
  monthlyCredits: 19800,
  priceMonthly: 200,
  priceQuarterly: 560,
  priceAnnually: 2000,
  firstPriceMonthly: 0,
  firstPriceQuarterly: 0,
  firstPriceAnnually: 0,
  sort: 1,
  isActive: true,
};

describe('SubscriptionOrderService - createOrder', () => {
  let service: SubscriptionOrderService;
  let prisma: any;
  let pricing: any;

  beforeEach(async () => {
    pricing = mockPricing();
    prisma = {
      subscriptionPlan: {
        findUnique: vi.fn().mockResolvedValue(mockPlan),
      },
      subscriptionOrder: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((args: any) =>
          Promise.resolve({ id: 'order-1', ...args.data }),
        ),
        update: vi.fn().mockImplementation((args: any) =>
          Promise.resolve({ id: 'order-1', ...args.data }),
        ),
      },
      userSubscription: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionOrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: PricingService, useValue: pricing },
        { provide: MetricsService, useValue: mockMetrics() },
      ],
    }).compile();
    service = module.get<SubscriptionOrderService>(SubscriptionOrderService);
  });

  describe('createOrder - new_purchase', () => {
    it('should create a new purchase order with correct amount in fen', async () => {
      const result = await service.createOrder('u1', {
        planId: 'plan-pro',
        period: 'monthly',
        type: 'new_purchase',
      });

      expect(result.orderNo).toMatch(/^SUB/);
      expect(result.amount).toBe(20000); // 200元 = 20000分
      expect(prisma.subscriptionOrder.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          planId: 'plan-pro',
          period: 'monthly',
          type: 'new_purchase',
          payableAmount: 20000,
          originalAmount: 20000,
          status: 'PENDING',
          payChannel: 'wechat',
        }),
      });
    });

    it('should reject new_purchase when user already has active subscription', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue({
        id: 'sub-1', status: 'active', tier: 'pro',
      });

      await expect(
        service.createOrder('u1', { planId: 'plan-pro', period: 'monthly', type: 'new_purchase' }),
      ).rejects.toThrow('已有有效订阅');
    });

    it('should throw when plan not found', async () => {
      prisma.subscriptionPlan.findUnique.mockResolvedValue(null);

      await expect(
        service.createOrder('u1', { planId: 'nonexistent', period: 'monthly', type: 'new_purchase' }),
      ).rejects.toThrow();
    });

    it('should set expiredAt to 2 hours from now', async () => {
      const before = Date.now();
      await service.createOrder('u1', {
        planId: 'plan-pro', period: 'monthly', type: 'new_purchase',
      });

      const callData = prisma.subscriptionOrder.create.mock.calls[0][0].data;
      const expiredAt = callData.expiredAt;
      const diffMs = expiredAt.getTime() - before;
      expect(diffMs).toBeGreaterThan(2 * 60 * 60 * 1000 - 5000);
      expect(diffMs).toBeLessThan(2 * 60 * 60 * 1000 + 5000);
    });
  });

  describe('createOrder - upgrade', () => {
    it('should create upgrade order with proration calculated by PricingService', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue({
        id: 'sub-old',
        planId: 'plan-basic',
        tier: 'basic',
        period: 'monthly',
        status: 'active',
        paidAmount: 560,
      });

      const result = await service.createOrder('u1', {
        planId: 'plan-pro',
        period: 'monthly',
        type: 'upgrade',
      });

      expect(pricing.calculate).toHaveBeenCalled();
      expect(result.amount).toBe(52500); // 525元 payableAmount = 52500分
      expect(prisma.subscriptionOrder.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'upgrade',
          payableAmount: 52500,
          originalAmount: 90000,
          prorationAmount: 37500,
          fromSubscriptionId: 'sub-old',
          pricingSnapshot: expect.any(Object),
        }),
      });
    });

    it('should reject upgrade when no active subscription', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(null);

      await expect(
        service.createOrder('u1', { planId: 'plan-pro', period: 'monthly', type: 'upgrade' }),
      ).rejects.toThrow('没有有效订阅');
    });

    it('should reject upgrade to lower or same tier', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        tier: 'pro',
        status: 'active',
        paidAmount: 900,
      });

      await expect(
        service.createOrder('u1', { planId: 'plan-basic', period: 'monthly', type: 'upgrade' }),
      ).rejects.toThrow();
    });
  });

  describe('createOrder - duplicate protection', () => {
    it('should close old PENDING orders before creating new one', async () => {
      prisma.subscriptionOrder.findMany.mockResolvedValue([{
        id: 'old-order',
        orderNo: 'SUB_old',
        status: 'PENDING',
        prepayId: 'wx_prepay_old',
      }]);

      await service.createOrder('u1', { planId: 'plan-pro', period: 'monthly', type: 'new_purchase' });

      expect(prisma.subscriptionOrder.update).toHaveBeenCalledWith({
        where: { id: 'old-order' },
        data: { status: 'CLOSED', closedAt: expect.any(Date) },
      });
    });
  });
});

describe('SubscriptionOrderService - pay', () => {
  let service: SubscriptionOrderService;
  let prisma: any;
  let payment: any;

  const mockOrder = {
    id: 'order-1',
    orderNo: 'SUB1753596000000a3B7x9Yz',
    userId: 'u1',
    payableAmount: 20000,
    status: 'PENDING',
    prepayId: null,
    expiredAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    createdAt: new Date(),
  };

  beforeEach(async () => {
    payment = {
      createPayment: vi.fn().mockResolvedValue({ codeUrl: 'weixin://wxpay/bizpayurl?pr=abc123', prepayId: 'wx_prepay_1' }),
      queryOrder: vi.fn(),
    };
    prisma = {
      subscriptionOrder: {
        findUnique: vi.fn().mockResolvedValue(mockOrder),
        update: vi.fn().mockImplementation((args: any) =>
          Promise.resolve({ ...mockOrder, ...args.data })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionOrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: PricingService, useValue: mockPricing() },
        { provide: MetricsService, useValue: mockMetrics() },
        { provide: 'PAYMENT_PROVIDER', useValue: payment },
      ],
    }).compile();
    service = module.get<SubscriptionOrderService>(SubscriptionOrderService);
  });

  it('should create wechat payment and return codeUrl', async () => {
    const result = await service.pay('SUB1753596000000a3B7x9Yz', 'u1');

    expect(result.codeUrl).toBe('weixin://wxpay/bizpayurl?pr=abc123');
    expect(payment.createPayment).toHaveBeenCalledWith(expect.objectContaining({
      orderNo: 'SUB1753596000000a3B7x9Yz',
      amount: 20000,
      description: '会员订阅',
    }));
  });

  it('should return existing codeUrl when prepayId already exists (idempotent)', async () => {
    prisma.subscriptionOrder.findUnique.mockResolvedValue({
      ...mockOrder,
      prepayId: 'wx_prepay_existing',
    });
    payment.queryOrder.mockResolvedValue({ tradeState: 'NOTPAY', codeUrl: 'weixin://wxpay/existing' });

    const result = await service.pay('SUB1753596000000a3B7x9Yz', 'u1');

    expect(payment.createPayment).not.toHaveBeenCalled();
    expect(result.codeUrl).toBeDefined();
  });

  it('should reject pay when order userId mismatch', async () => {
    await expect(
      service.pay('SUB1753596000000a3B7x9Yz', 'u2'),
    ).rejects.toThrow('订单不属于当前用户');
  });

  it('should reject pay when order is not PENDING', async () => {
    prisma.subscriptionOrder.findUnique.mockResolvedValue({
      ...mockOrder,
      status: 'SUCCESS',
    });

    await expect(
      service.pay('SUB1753596000000a3B7x9Yz', 'u1'),
    ).rejects.toThrow('订单状态不允许支付');
  });

  it('should reject pay when order expired', async () => {
    prisma.subscriptionOrder.findUnique.mockResolvedValue({
      ...mockOrder,
      expiredAt: new Date(Date.now() - 1000),
    });

    await expect(
      service.pay('SUB1753596000000a3B7x9Yz', 'u1'),
    ).rejects.toThrow('订单已过期');
  });

  it('should mark FAILED when wechat createPayment fails', async () => {
    payment.createPayment.mockRejectedValue(new Error('WeChat API error'));

    await expect(
      service.pay('SUB1753596000000a3B7x9Yz', 'u1'),
    ).rejects.toThrow();

    expect(prisma.subscriptionOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({ status: 'FAILED' }),
    });
  });
});

describe('SubscriptionOrderService - query', () => {
  let service: SubscriptionOrderService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      subscriptionOrder: {
        findUnique: vi.fn().mockResolvedValue({
          orderNo: 'SUB_xxx',
          payableAmount: 20000,
          status: 'PENDING',
          payChannel: 'wechat',
          paidAt: null,
          userId: 'u1',
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionOrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: PricingService, useValue: mockPricing() },
        { provide: MetricsService, useValue: mockMetrics() },
      ],
    }).compile();
    service = module.get<SubscriptionOrderService>(SubscriptionOrderService);
  });

  it('should return order details for owner', async () => {
    const result = await service.query('SUB_xxx', 'u1');
    expect(result.status).toBe('PENDING');
    expect(result.amount).toBe(20000);
  });

  it('should throw when not owner', async () => {
    await expect(
      service.query('SUB_xxx', 'u2'),
    ).rejects.toThrow('订单不属于当前用户');
  });

  it('should throw when order not found', async () => {
    prisma.subscriptionOrder.findUnique.mockResolvedValue(null);
    await expect(
      service.query('SUB_nonexistent', 'u1'),
    ).rejects.toThrow('订单不存在');
  });
});

describe('SubscriptionOrderService - close', () => {
  let service: SubscriptionOrderService;
  let prisma: any;
  let payment: any;

  beforeEach(async () => {
    payment = {
      closePayment: vi.fn().mockResolvedValue(undefined),
    };
    prisma = {
      subscriptionOrder: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'order-1',
          orderNo: 'SUB_xxx',
          userId: 'u1',
          status: 'PENDING',
          prepayId: 'wx_prepay_1',
          delayCloseJobId: null,
        }),
        update: vi.fn().mockImplementation((args: any) =>
          Promise.resolve({ id: 'order-1', ...args.data })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionOrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: PricingService, useValue: mockPricing() },
        { provide: MetricsService, useValue: mockMetrics() },
        { provide: 'PAYMENT_PROVIDER', useValue: payment },
      ],
    }).compile();
    service = module.get<SubscriptionOrderService>(SubscriptionOrderService);
  });

  it('should close PENDING order and call wechat close API', async () => {
    const result = await service.close('SUB_xxx', 'u1');
    expect(result.success).toBe(true);
    expect(payment.closePayment).toHaveBeenCalledWith('SUB_xxx');
    expect(prisma.subscriptionOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: 'CLOSED', closedAt: expect.any(Date) },
    });
  });

  it('should return success if already closed (idempotent)', async () => {
    prisma.subscriptionOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: 'SUB_xxx',
      userId: 'u1',
      status: 'CLOSED',
      prepayId: null,
    });

    const result = await service.close('SUB_xxx', 'u1');
    expect(result.success).toBe(true);
    // Should not call wechat closePayment for already-closed orders
    expect(payment.closePayment).not.toHaveBeenCalled();
  });

  it('should throw when not owner', async () => {
    await expect(
      service.close('SUB_xxx', 'u2'),
    ).rejects.toThrow('订单不属于当前用户');
  });
});
