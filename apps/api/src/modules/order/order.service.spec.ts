import { Test, TestingModule } from '@nestjs/testing';
import { OrderService } from './order.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('OrderService', () => {
  let service: OrderService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      subscriptionOrder: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<OrderService>(OrderService);
  });

  it('should create order with SUB prefix', async () => {
    prisma.subscriptionOrder.create.mockResolvedValue({
      id: 'o1', orderNo: 'SUB12345678901234567890', userId: 'u1',
      planId: 'p1', period: 'monthly', type: 'new_purchase', amount: 100, originalPrice: 100, deductibleAmount: 0,
    });

    const result = await service.createOrder({
      userId: 'u1', planId: 'p1', period: 'monthly', type: 'new_purchase', amount: 100, originalPrice: 100,
    });
    expect(result.orderNo.startsWith('SUB')).toBe(true);
    expect(result.amount).toBe(100);
    expect(prisma.subscriptionOrder.create).toHaveBeenCalled();
  });

  it('should create upgrade order with pricing snapshot', async () => {
    prisma.subscriptionOrder.create.mockResolvedValue({
      id: 'o2', orderNo: 'SUB123', userId: 'u1', planId: 'p2', period: 'quarterly',
      type: 'upgrade', amount: 300, originalPrice: 560, deductibleAmount: 260,
      originalSubscriptionId: 'sub-1',
      pricingSnapshot: { sourcePaidAmount: 280, remainTimeRatio: 0.93, remainPointsRatio: 0.5, finalRatio: 0.5, targetOriginalPrice: 560, deductibleAmount: 260, payableAmount: 300 },
    });

    const result = await service.createOrder({
      userId: 'u1', planId: 'p2', period: 'quarterly', type: 'upgrade', amount: 300, originalPrice: 560,
      deductibleAmount: 260, originalSubscriptionId: 'sub-1',
      pricingSnapshot: { sourcePaidAmount: 280, remainTimeRatio: 0.93, remainPointsRatio: 0.5, finalRatio: 0.5, targetOriginalPrice: 560, deductibleAmount: 260, payableAmount: 300 },
    });
    expect(result.type).toBe('upgrade');
    expect(result.pricingSnapshot).toBeDefined();
  });

  it('should paginate orders', async () => {
    prisma.subscriptionOrder.findMany.mockResolvedValue([]);
    prisma.subscriptionOrder.count.mockResolvedValue(0);
    const result = await service.getOrders('u1', { page: 1, pageSize: 20 });
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });
});
