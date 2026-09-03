import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionService } from './subscription.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from './pricing.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

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
      userSubscription: {
        findFirst: vi.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: PrismaService, useValue: prisma },
        { provide: PricingService, useValue: mockPricing() },
      ],
    }).compile();
    service = module.get<SubscriptionService>(SubscriptionService);
  });

  describe('getPlans', () => {
    it('should return active plans sorted by sort order', async () => {
      prisma.subscriptionPlan.findMany.mockResolvedValue([
        { id: 'p1', name: '普通会员', tier: 'basic', monthlyCredits: 9800, priceMonthly: 100, priceQuarterly: 280, priceAnnually: 1000, sort: 1, isActive: true, storageLimitBytes: 53687091200n },
      ]);

      const result = await service.getPlans();
      expect(result).toHaveLength(1);
      expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { sort: 'asc' },
      });
      // BigInt 序列化回归（2026-09-03 /plans 500 最小复现）：storageLimitBytes 转 number，可过 JSON.stringify
      expect(result[0].storageLimitBytes).toBe(53687091200);
      expect(typeof result[0].storageLimitBytes).toBe('number');
      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });

  describe('getAllPlans (admin)', () => {
    it('should return all plans including inactive', async () => {
      prisma.subscriptionPlan.findMany.mockResolvedValue([
        { id: 'p0', name: '下架档', tier: 'basic', monthlyCredits: 1, priceMonthly: 1, priceQuarterly: 1, priceAnnually: 1, sort: 0, isActive: false, storageLimitBytes: 1073741824n },
      ]);
      const result = await service.getAllPlans();
      expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith({ orderBy: { sort: 'asc' } });
      expect(result[0].storageLimitBytes).toBe(1073741824);
      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });

  describe('createPlan', () => {
    it('未指定 storageLimitBytes 时默认 1GB（BigInt 入库），返回转 number', async () => {
      const dto = {
        name: 'Pro', tier: 'pro' as const, monthlyCredits: 19800,
        priceMonthly: 200, priceQuarterly: 560, priceAnnually: 2000, sort: 2,
      };
      prisma.subscriptionPlan.create.mockResolvedValue({ id: 'p2', ...dto, isActive: true, storageLimitBytes: 1073741824n });

      const result = await service.createPlan(dto);
      expect(result.name).toBe('Pro');
      expect(result.tier).toBe('pro');
      expect(prisma.subscriptionPlan.create).toHaveBeenCalledWith({
        data: { ...dto, isActive: true, storageLimitBytes: 1073741824n },
      });
      expect(result.storageLimitBytes).toBe(1073741824);
      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('显式 storageLimitBytes：BigInt 入库、返回转 number', async () => {
      prisma.subscriptionPlan.create.mockResolvedValue({ id: 'p3', storageLimitBytes: 64424509440n });
      const result = await service.createPlan({
        name: 'X', tier: 'max', monthlyCredits: 1,
        priceMonthly: 1, priceQuarterly: 1, priceAnnually: 1, storageLimitBytes: 64424509440,
      });
      expect(prisma.subscriptionPlan.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ storageLimitBytes: 64424509440n }),
      }));
      expect(result.storageLimitBytes).toBe(64424509440);
    });

    it('小数 storageLimitBytes 抛 PLAN_STORAGE_LIMIT_INVALID 且不落库', async () => {
      await expect(service.createPlan({
        name: 'X', tier: 'pro', monthlyCredits: 1,
        priceMonthly: 1, priceQuarterly: 1, priceAnnually: 1, storageLimitBytes: 107374182.4,
      })).rejects.toMatchObject({ errorCode: 'PLAN_STORAGE_LIMIT_INVALID' });
      expect(prisma.subscriptionPlan.create).not.toHaveBeenCalled();
    });
  });

  describe('updatePlan', () => {
    it('storageLimitBytes 合法值 BigInt 入库、其余字段原样透传、返回转 number', async () => {
      prisma.subscriptionPlan.update.mockResolvedValue({ id: 'p1', name: 'Updated', storageLimitBytes: 64424509440n });

      const result = await service.updatePlan('p1', { name: 'Updated', storageLimitBytes: 64424509440 });

      expect(prisma.subscriptionPlan.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { name: 'Updated', storageLimitBytes: 64424509440n },
      });
      expect(result.storageLimitBytes).toBe(64424509440);
      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('storageLimitBytes 缺省：update 入参不含该键', async () => {
      prisma.subscriptionPlan.update.mockResolvedValue({ id: 'p1', name: 'Updated', storageLimitBytes: 53687091200n });
      await service.updatePlan('p1', { name: 'Updated' });
      expect(prisma.subscriptionPlan.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { name: 'Updated' },
      });
    });

    it.each([0, -1, 107374182.4, NaN, Infinity])(
      '非法 storageLimitBytes(%s) 抛 PLAN_STORAGE_LIMIT_INVALID 且不落库',
      async (bad) => {
        await expect(service.updatePlan('p1', { storageLimitBytes: bad as number }))
          .rejects.toMatchObject({ errorCode: 'PLAN_STORAGE_LIMIT_INVALID' });
        expect(prisma.subscriptionPlan.update).not.toHaveBeenCalled();
      },
    );
  });

  describe('deletePlan', () => {
    it('should delete a plan', async () => {
      prisma.subscriptionPlan.delete.mockResolvedValue({ id: 'p1' });
      await service.deletePlan('p1');
      expect(prisma.subscriptionPlan.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    });
  });

  describe('getUpgradeAvailable', () => {
    it('返回更高档套餐，plan 行 storageLimitBytes 转 number 且可 JSON 序列化', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue({ id: 's1', userId: 'u1', tier: 'basic' });
      prisma.subscriptionPlan.findMany.mockResolvedValue([
        { id: 'p1', tier: 'basic', sort: 1, isActive: true, storageLimitBytes: 53687091200n },
        { id: 'p2', tier: 'pro', sort: 2, isActive: true, storageLimitBytes: 107374182400n },
      ]);

      const result = await service.getUpgradeAvailable('u1');

      expect(result.map((p: any) => p.tier)).toEqual(['pro']);
      expect(result[0].storageLimitBytes).toBe(107374182400);
      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });

  describe('getMySubscription', () => {
    it('有 active 订阅：嵌套 plan.storageLimitBytes 转 number 且可 JSON 序列化', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue({
        id: 's1', userId: 'u1', tier: 'pro', status: 'active',
        plan: { id: 'p2', name: 'Pro会员', tier: 'pro', storageLimitBytes: 107374182400n },
      });

      const result = await service.getMySubscription('u1');

      expect(result!.plan.storageLimitBytes).toBe(107374182400);
      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('无 active 订阅：保持 null', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(null);

      const result = await service.getMySubscription('u1');

      expect(result).toBeNull();
    });
  });
});
