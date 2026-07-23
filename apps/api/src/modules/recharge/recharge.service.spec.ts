import { Test, TestingModule } from '@nestjs/testing';
import { RechargeService } from './recharge.service';
import { CreditService } from '../credit/credit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Helpers ──

function mockTx() {
  return {
    userBalance: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
    rechargeOrder: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
  };
}

// ── Tests ──

describe('RechargeService', () => {
  let service: RechargeService;
  let prisma: any;
  let payment: any;
  let credit: any;

  beforeEach(async () => {
    payment = { pay: vi.fn() };
    credit = { getOrCreateBalance: vi.fn() };

    prisma = {
      rechargeOrder: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RechargeService,
        { provide: PrismaService, useValue: prisma },
        { provide: 'PAYMENT_PROVIDER', useValue: payment },
        { provide: CreditService, useValue: credit },
      ],
    }).compile();
    service = module.get<RechargeService>(RechargeService);
  });

  // ── createOrder ──

  it('should create order with RC prefix, PENDING status, and defaults for balance snapshots', async () => {
    prisma.rechargeOrder.create.mockResolvedValue({
      id: 'o1',
      orderNo: 'RC20260723USER123456',
      userId: 'u1',
      amount: 10000,
      balanceBefore: 0,
      balanceAfter: 0,
      status: 'PENDING',
    });

    const result = await service.createOrder('u1', 10000);

    expect(result.orderNo.startsWith('RC')).toBe(true);
    expect(result.status).toBe('PENDING');
    expect(result.balanceBefore).toBe(0);
    expect(result.balanceAfter).toBe(0);
    expect(prisma.rechargeOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        amount: 10000,
        status: 'PENDING',
      }),
    });
  });

  // ── pay: success ──

  it('should pay successfully: lock balance, increment, write snapshots', async () => {
    const tx = mockTx();
    prisma.$transaction.mockImplementation((cb: Function) => cb(tx));
    payment.pay.mockResolvedValue({ success: true, tradeNo: 'MOCK_RC20260723USER123456' });

    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'o1',
      orderNo: 'RC20260723USER123456',
      userId: 'u1',
      amount: 10000,
      status: 'PENDING',
    });

    tx.userBalance.upsert.mockResolvedValue({ balance: 50000 });
    tx.rechargeOrder.updateMany.mockResolvedValue({ count: 1 });
    tx.rechargeOrder.findUnique.mockResolvedValue({
      id: 'o1',
      orderNo: 'RC20260723USER123456',
      userId: 'u1',
      amount: 10000,
      balanceBefore: 50000,
      balanceAfter: 60000,
      status: 'SUCCESS',
      paidAt: new Date(),
      payChannel: 'mock',
      tradeNo: 'MOCK_RC20260723USER123456',
    });

    const result = await service.pay('RC20260723USER123456', 'u1');

    expect(result.status).toBe('SUCCESS');
    expect(result.balanceBefore).toBe(50000);
    expect(result.balanceAfter).toBe(60000);

    // verify row lock via upsert
    expect(tx.userBalance.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      update: { updatedAt: expect.any(Date) },
      create: { userId: 'u1', balance: 0, version: 0 },
    });
    // verify atomic increment
    expect(tx.userBalance.update).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { balance: { increment: 10000 } },
    });
    // verify conditional order update
    expect(tx.rechargeOrder.updateMany).toHaveBeenCalledWith({
      where: { orderNo: 'RC20260723USER123456', status: 'PENDING' },
      data: expect.objectContaining({
        status: 'SUCCESS',
        balanceBefore: 50000,
        balanceAfter: 60000,
        tradeNo: 'MOCK_RC20260723USER123456',
      }),
    });
    // payment called outside transaction
    expect(payment.pay).toHaveBeenCalledWith({
      orderNo: 'RC20260723USER123456',
      amount: 10000,
      userId: 'u1',
    });
  });

  // ── pay: idempotent (terminal state) ──

  it('should return existing result without payment call when already SUCCESS', async () => {
    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'o1',
      orderNo: 'RC20260723USER123456',
      userId: 'u1',
      amount: 10000,
      balanceBefore: 50000,
      balanceAfter: 60000,
      status: 'SUCCESS',
    });

    const result = await service.pay('RC20260723USER123456', 'u1');

    expect(result.status).toBe('SUCCESS');
    expect(payment.pay).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ── pay: idempotent (concurrent, updateMany count 0) ──

  it('should re-read and return when concurrent transaction beat us (updateMany count 0)', async () => {
    const tx = mockTx();
    prisma.$transaction.mockImplementation((cb: Function) => cb(tx));
    payment.pay.mockResolvedValue({ success: true, tradeNo: 'MOCK_RC20260723USER123456' });

    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'o1',
      orderNo: 'RC20260723USER123456',
      userId: 'u1',
      amount: 10000,
      status: 'PENDING',
    });

    tx.userBalance.upsert.mockResolvedValue({ balance: 50000 });
    // concurrent already processed → count 0
    tx.rechargeOrder.updateMany.mockResolvedValue({ count: 0 });
    // re-read returns the committed result from concurrent tx
    tx.rechargeOrder.findUnique.mockResolvedValue({
      id: 'o1',
      orderNo: 'RC20260723USER123456',
      userId: 'u1',
      amount: 10000,
      balanceBefore: 40000,
      balanceAfter: 50000,
      status: 'SUCCESS',
    });

    const result = await service.pay('RC20260723USER123456', 'u1');

    expect(result.status).toBe('SUCCESS');
    // balance NOT incremented to 60000 — concurrent tx's result returned
    expect(result.balanceAfter).toBe(50000);
  });

  // ── pay: order not found ──

  it('should throw RECHARGE_ORDER_NOT_FOUND when order does not exist', async () => {
    prisma.rechargeOrder.findUnique.mockResolvedValue(null);

    await expect(service.pay('NONEXISTENT', 'u1')).rejects.toThrow('订单不存在');
  });

  // ── pay: wrong user ──

  it('should throw RECHARGE_ORDER_NOT_FOUND when order belongs to another user', async () => {
    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'o1',
      orderNo: 'RC20260723USER123456',
      userId: 'other_user',
      amount: 10000,
      status: 'PENDING',
    });

    await expect(service.pay('RC20260723USER123456', 'u1')).rejects.toThrow('订单不存在');
  });

  // ── pay: payment channel failure ──

  it('should mark FAILED and throw when payment channel returns failure', async () => {
    payment.pay.mockResolvedValue({ success: false, tradeNo: '' });
    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'o1',
      orderNo: 'RC20260723USER123456',
      userId: 'u1',
      amount: 10000,
      status: 'PENDING',
    });

    await expect(service.pay('RC20260723USER123456', 'u1')).rejects.toThrow('支付渠道返回失败');
    expect(prisma.rechargeOrder.updateMany).toHaveBeenCalledWith({
      where: { orderNo: 'RC20260723USER123456', status: 'PENDING' },
      data: { status: 'FAILED' },
    });
  });

  // ── pay: transaction failure → FAILED ──

  it('should mark FAILED outside transaction when DB error occurs', async () => {
    payment.pay.mockResolvedValue({ success: true, tradeNo: 'MOCK_RC20260723USER123456' });
    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'o1',
      orderNo: 'RC20260723USER123456',
      userId: 'u1',
      amount: 10000,
      status: 'PENDING',
    });

    prisma.$transaction.mockRejectedValue(new Error('DB connection lost'));

    await expect(service.pay('RC20260723USER123456', 'u1')).rejects.toThrow('余额更新事务执行失败');
    // Must be called outside transaction
    expect(prisma.rechargeOrder.updateMany).toHaveBeenCalledWith({
      where: { orderNo: 'RC20260723USER123456', status: 'PENDING' },
      data: { status: 'FAILED' },
    });
  });

  // ── getOrders ──

  it('should paginate orders sorted by createdAt desc', async () => {
    prisma.rechargeOrder.findMany.mockResolvedValue([
      { id: 'o2', orderNo: 'RC2', amount: 20000, status: 'SUCCESS' },
      { id: 'o1', orderNo: 'RC1', amount: 10000, status: 'SUCCESS' },
    ]);
    prisma.rechargeOrder.count.mockResolvedValue(5);

    const result = await service.getOrders('u1', 1, 20);

    expect(result.total).toBe(5);
    expect(result.items.length).toBe(2);
    expect(prisma.rechargeOrder.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
  });

  // ── amount validation ──

  it('should throw INVALID_RECHARGE_AMOUNT for amount below range', async () => {
    await expect(service.createOrder('u1', 50)).rejects.toThrow('金额范围 1~10000 元');
  });

  it('should throw INVALID_RECHARGE_AMOUNT for amount above range', async () => {
    await expect(service.createOrder('u1', 2000000)).rejects.toThrow('金额范围 1~10000 元');
  });
});
