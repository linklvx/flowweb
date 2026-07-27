import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionOrderController } from './subscription-order.controller';
import { SubscriptionOrderService } from './subscription-order.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

function mockOrderService() {
  return {
    createOrder: vi.fn(),
    pay: vi.fn(),
    query: vi.fn(),
    close: vi.fn(),
  };
}

describe('SubscriptionOrderController', () => {
  let controller: SubscriptionOrderController;
  let service: ReturnType<typeof mockOrderService>;

  beforeEach(async () => {
    service = mockOrderService();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionOrderController],
      providers: [
        { provide: SubscriptionOrderService, useValue: service },
      ],
    }).compile();
    controller = module.get<SubscriptionOrderController>(SubscriptionOrderController);
  });

  describe('POST /api/subscription/orders', () => {
    it('should create order and return orderNo', async () => {
      service.createOrder.mockResolvedValue({
        orderNo: 'SUB1753596000000a3B7x9Yz',
        amount: 20000,
        expiredAt: new Date().toISOString(),
      });

      const result = await controller.createOrder(
        { user: { id: 'u1' } },
        { planId: 'plan-pro', period: 'monthly', type: 'new_purchase' },
      );

      expect(result.orderNo).toMatch(/^SUB/);
      expect(service.createOrder).toHaveBeenCalledWith('u1', {
        planId: 'plan-pro', period: 'monthly', type: 'new_purchase',
      });
    });

    it('should throw 401 when not authenticated', async () => {
      await expect(
        controller.createOrder({ user: null }, { planId: 'p1', period: 'monthly', type: 'new_purchase' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('POST /api/subscription/orders/:orderNo/pay', () => {
    it('should return codeUrl', async () => {
      service.pay.mockResolvedValue({
        orderNo: 'SUB_xxx', amount: 20000, codeUrl: 'weixin://...',
      });

      const result = await controller.pay('SUB_xxx', { user: { id: 'u1' } });
      expect(result.codeUrl).toBeDefined();
      expect(service.pay).toHaveBeenCalledWith('SUB_xxx', 'u1');
    });
  });

  describe('GET /api/subscription/orders/:orderNo', () => {
    it('should return order status', async () => {
      service.query.mockResolvedValue({
        orderNo: 'SUB_xxx', amount: 20000, status: 'PENDING', payChannel: 'wechat', paidAt: null,
      });
      const result = await controller.query('SUB_xxx', { user: { id: 'u1' } });
      expect(result.status).toBe('PENDING');
    });
  });

  describe('POST /api/subscription/orders/:orderNo/close', () => {
    it('should close order', async () => {
      service.close.mockResolvedValue({ success: true });
      const result = await controller.close('SUB_xxx', { user: { id: 'u1' } });
      expect(result.success).toBe(true);
    });
  });
});
