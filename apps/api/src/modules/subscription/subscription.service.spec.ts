import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionService } from './subscription.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditService } from '../credit/credit.service';
import { OrderService } from '../order/order.service';
import { PricingService } from './pricing.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

function mockCredit() {
  return { deductRegular: vi.fn().mockResolvedValue(undefined) };
}

function mockOrder() {
  return { createOrder: vi.fn(), getOrders: vi.fn() };
}

function mockPricing() {
  return {
    calculate: vi.fn().mockReturnValue({
      sourcePaidAmount: 560, remainTimeRatio: 0.67, remainPointsRatio: 0.7,
      finalRatio: 0.67, targetOriginalPrice: 900, deductibleAmount: 375, payableAmount: 525,
    }),
  };
}

describe('SubscriptionService - Plan CRUD', () => {
  let service: SubscriptionService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      subscriptionPlan: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: PrismaService, useValue: prisma },
        { provide: CreditService, useValue: mockCredit() },
        { provide: OrderService, useValue: mockOrder() },
        { provide: PricingService, useValue: mockPricing() },
      ],
    }).compile();
    service = module.get<SubscriptionService>(SubscriptionService);
  });

  describe('getPlans', () => {
    it('should return active plans sorted by sort order', async () => {
      prisma.subscriptionPlan.findMany.mockResolvedValue([
        { id: 'p1', name: '普通会员', tier: 'basic', monthlyCredits: 9800, priceMonthly: 100, priceQuarterly: 280, priceAnnually: 1000, sort: 1, isActive: true },
      ]);

      const result = await service.getPlans();
      expect(result).toHaveLength(1);
      expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { sort: 'asc' },
      });
    });
  });

  describe('getAllPlans (admin)', () => {
    it('should return all plans including inactive', async () => {
      prisma.subscriptionPlan.findMany.mockResolvedValue([]);
      const result = await service.getAllPlans();
      expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith({ orderBy: { sort: 'asc' } });
    });
  });

  describe('createPlan', () => {
    it('should create a plan with all fields', async () => {
      const dto = {
        name: 'Pro', tier: 'pro' as const, monthlyCredits: 19800,
        priceMonthly: 200, priceQuarterly: 560, priceAnnually: 2000, sort: 2,
      };
      prisma.subscriptionPlan.create.mockResolvedValue({ id: 'p2', ...dto, isActive: true });

      const result = await service.createPlan(dto);
      expect(result.name).toBe('Pro');
      expect(result.tier).toBe('pro');
      expect(prisma.subscriptionPlan.create).toHaveBeenCalledWith({
        data: { ...dto, isActive: true },
      });
    });
  });

  describe('updatePlan', () => {
    it('should update plan fields', async () => {
      prisma.subscriptionPlan.update.mockResolvedValue({ id: 'p1', name: 'Updated' });
      const result = await service.updatePlan('p1', { name: 'Updated' });
      expect(prisma.subscriptionPlan.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { name: 'Updated' },
      });
    });
  });

  describe('deletePlan', () => {
    it('should delete a plan', async () => {
      prisma.subscriptionPlan.delete.mockResolvedValue({ id: 'p1' });
      await service.deletePlan('p1');
      expect(prisma.subscriptionPlan.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    });
  });
});

describe('SubscriptionService - Subscribe', () => {
  let service: SubscriptionService;
  let prisma: any;
  let credit: any;
  let txMock: any;

  const mockPlan = {
    id: 'p1', name: 'Pro', tier: 'pro' as const, monthlyCredits: 19800,
    priceMonthly: 200, priceQuarterly: 560, priceAnnually: 2000,
    sort: 1, isActive: true,
  };

  beforeEach(async () => {
    credit = mockCredit();
    txMock = {
      subscriptionOrder: { create: vi.fn().mockResolvedValue({ id: 'order-1' }) },
      userSubscription: { create: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: 'sub-1', ...a.data })) },
      creditTransaction: { create: vi.fn() },
      userBalance: { update: vi.fn(), findUnique: vi.fn().mockResolvedValue({ balance: 50000 }) },
    };
    prisma = {
      subscriptionPlan: { findMany: vi.fn(), findUnique: vi.fn().mockResolvedValue(mockPlan), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      userSubscription: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
      $transaction: vi.fn().mockImplementation(async (cb: Function) => cb(txMock)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: PrismaService, useValue: prisma },
        { provide: CreditService, useValue: credit },
        { provide: OrderService, useValue: mockOrder() },
        { provide: PricingService, useValue: mockPricing() },
      ],
    }).compile();
    service = module.get<SubscriptionService>(SubscriptionService);
  });

  it('should subscribe a user to a monthly plan (pay with balance)', async () => {
    prisma.userSubscription.findFirst.mockResolvedValue(null);

    const result = await service.subscribe('u1', 'p1', 'monthly');

    expect(result).toBeDefined();
    expect(result.tier).toBe('pro');
    expect(result.grantCount).toBe(1);
    // Should NOT call credit.deductRegular
    expect(credit.deductRegular).not.toHaveBeenCalled();
    // Should deduct balance (200 yuan = 20000 fen) + grant subscription credits
    expect(txMock.userBalance.update).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: expect.objectContaining({
        balance: { decrement: 20000 },
        subscriptionCredits: { increment: 19800 },
      }),
    });
  });

  it('should throw when balance insufficient for subscription', async () => {
    txMock.userBalance.findUnique.mockResolvedValue({ balance: 100 }); // only 1 yuan
    prisma.userSubscription.findFirst.mockResolvedValue(null);

    await expect(service.subscribe('u1', 'p1', 'monthly')).rejects.toThrow('余额不足');
  });

  it('should return existing subscription when already active (idempotent)', async () => {
    prisma.userSubscription.findFirst.mockResolvedValue({ id: 'sub-1', status: 'active', tier: 'pro' });

    const result = await service.subscribe('u1', 'p1', 'monthly');
    expect(result.status).toBe('active');
    expect(credit.deductRegular).not.toHaveBeenCalled();
  });

  it('should throw when plan not found', async () => {
    prisma.userSubscription.findFirst.mockResolvedValue(null);
    prisma.subscriptionPlan.findUnique.mockResolvedValue(null);

    await expect(service.subscribe('u1', 'invalid-plan', 'monthly')).rejects.toThrow();
  });
});
