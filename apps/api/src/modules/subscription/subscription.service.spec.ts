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
      prisma.subscriptionPlan.create.mockResolvedValue({ id: 'p2', ...dto, isActive: true, storageLimitBytes: 1073741824 });

      const result = await service.createPlan(dto);
      expect(result.name).toBe('Pro');
      expect(result.tier).toBe('pro');
      // 未指定 storageLimitBytes 时默认 1GB 免费档
      expect(prisma.subscriptionPlan.create).toHaveBeenCalledWith({
        data: { ...dto, isActive: true, storageLimitBytes: 1073741824 },
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
