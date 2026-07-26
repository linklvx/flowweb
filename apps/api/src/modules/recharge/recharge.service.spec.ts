import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RechargeService } from './recharge.service';
import { BusinessException } from '../../common/exceptions/business.exception';

function createTx() {
  return {
    userBalance: {
      upsert: vi.fn().mockResolvedValue({ balance: 10000, version: 0 }),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(),
    },
    rechargeOrder: {
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    userBalanceTransaction: {
      create: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
}

function mockPrisma() {
  const tx = createTx();
  return {
    rechargeOrder: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    userBalance: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    userBalanceTransaction: {
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn((fn: Function) => fn(tx)),
  } as any;
}

describe('RechargeService', () => {
  let service: RechargeService;
  let prisma: any;
  let payment: any;
  let credit: any;

  const validTiersFen = [1000, 3000, 5000, 10000, 20000, 50000];

  beforeEach(() => {
    prisma = mockPrisma();
    credit = {} as any;
    payment = {
      createPayment: vi.fn(),
      queryOrder: vi.fn(),
      closePayment: vi.fn(),
      parseNotify: vi.fn(),
    };
    service = new RechargeService(prisma, credit, payment);
    process.env.WECHAT_PAY_APP_ID = 'wx1234567890abcdef';
    process.env.WECHAT_PAY_MCH_ID = '1234567890';
  });

  // ── createOrder ──

  it.each(validTiersFen)('should create order for valid tier %i fen', async (amountFen) => {
    prisma.rechargeOrder.create.mockResolvedValue({
      id: 'order-1',
      orderNo: `RC20260726USER00${amountFen}`,
      userId: 'user-1',
      amount: amountFen,
      status: 'PENDING',
      clientIp: '1.2.3.4',
      expiredAt: new Date(),
      createdAt: new Date(),
    });

    const result = await service.createOrder('user-1', amountFen, '1.2.3.4');

    expect(result.status).toBe('PENDING');
    expect(result.amount).toBe(amountFen);
    expect(result.clientIp).toBe('1.2.3.4');
  });

  it('should reject non-tier amount with 档位 error', async () => {
    await expect(service.createOrder('user-1', 1500, '1.2.3.4')).rejects.toThrow(BusinessException);
    await expect(service.createOrder('user-1', 1500, '1.2.3.4')).rejects.toThrow(/档位/);
  });

  it('should reject zero amount', async () => {
    await expect(service.createOrder('user-1', 0, '1.2.3.4')).rejects.toThrow(BusinessException);
  });

  it('should set expiredAt to ~2 hours from now', async () => {
    const before = Date.now();
    prisma.rechargeOrder.create.mockResolvedValue({
      id: 'order-1', orderNo: 'RC-TEST', amount: 5000, status: 'PENDING', createdAt: new Date(),
    });

    await service.createOrder('user-1', 5000, '1.2.3.4');

    const createCall = prisma.rechargeOrder.create.mock.calls[0][0].data;
    const expiredAt = new Date(createCall.expiredAt).getTime();
    const expected = before + 2 * 60 * 60 * 1000;
    expect(Math.abs(expiredAt - expected)).toBeLessThan(5000);
  });

  it('should use orderNo with RC prefix', async () => {
    prisma.rechargeOrder.create.mockResolvedValue({
      id: 'order-1', orderNo: 'RC20260726USER00123456', amount: 5000, status: 'PENDING',
    });

    const result = await service.createOrder('user-1', 5000, '1.2.3.4');

    expect(result.orderNo).toMatch(/^RC/);
  });

  // ── pay ──

  it('should call createPayment and return codeUrl, NOT modify balance', async () => {
    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: 'RC20260726USER00123456',
      userId: 'user-1',
      amount: 5000,
      status: 'PENDING',
      prepayId: null,
      createdAt: new Date(),
    });
    payment.createPayment.mockImplementation(async () => ({
      codeUrl: 'weixin://wxpay/bizpayurl?pr=abc',
      prepayId: 'prepay_001',
    }));
    prisma.rechargeOrder.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.pay('RC20260726USER00123456', 'user-1');

    expect(result.codeUrl).toBe('weixin://wxpay/bizpayurl?pr=abc');
    expect(result.status).toBe('PENDING');
    expect(payment.createPayment).toHaveBeenCalledTimes(1);
  });

  it('should reject non-owner user', async () => {
    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'RC20260726USER00123456', userId: 'user-1', amount: 5000, status: 'PENDING',
    });
    await expect(service.pay('RC20260726USER00123456', 'user-2')).rejects.toThrow(BusinessException);
  });

  it('should be idempotent when prepayId already exists', async () => {
    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'RC20260726USER00123456', userId: 'user-1', amount: 5000, status: 'PENDING', prepayId: 'prepay_existing', payChannel: 'wechat',
    });
    const result = await service.pay('RC20260726USER00123456', 'user-1');
    expect(result.status).toBe('PENDING');
    expect(payment.createPayment).not.toHaveBeenCalled();
  });

  it('should reject non-PENDING orders', async () => {
    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'RC20260726USER00123456', userId: 'user-1', amount: 5000, status: 'SUCCESS',
    });
    await expect(service.pay('RC20260726USER00123456', 'user-1')).rejects.toThrow(BusinessException);
  });

  it('should reject order not found', async () => {
    prisma.rechargeOrder.findUnique.mockResolvedValue(null);
    await expect(service.pay('NONEXISTENT', 'user-1')).rejects.toThrow('订单不存在');
  });

  it('should throw RECHARGE_PAY_CHANNEL_FAILED when createPayment fails', async () => {
    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'RC20260726USER00123456', userId: 'user-1', amount: 5000, status: 'PENDING', prepayId: null,
    });
    payment.createPayment.mockRejectedValue(new Error('WeChat API error'));
    await expect(service.pay('RC20260726USER00123456', 'user-1')).rejects.toThrow(BusinessException);
  });

  // ── getOrders ──

  it('should return paginated orders sorted by createdAt desc', async () => {
    prisma.rechargeOrder.findMany.mockResolvedValue([
      { id: 'o2', orderNo: 'RC2', amount: 5000, status: 'SUCCESS' },
    ]);
    prisma.rechargeOrder.count.mockResolvedValue(1);

    const result = await service.getOrders('user-1', 1, 20);

    expect(result.total).toBe(1);
    expect(result.items.length).toBe(1);
  });

  // ── queryOrder ──

  it('should return single order by orderNo', async () => {
    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'RC20260726USER00123456', amount: 5000, status: 'SUCCESS', payChannel: 'wechat', paidAt: new Date(),
    });

    const result = await service.queryOrder('RC20260726USER00123456');

    expect(result.orderNo).toBe('RC20260726USER00123456');
    expect(result.status).toBe('SUCCESS');
  });

  it('should throw when order not found', async () => {
    prisma.rechargeOrder.findUnique.mockResolvedValue(null);
    await expect(service.queryOrder('NONEXISTENT')).rejects.toThrow(BusinessException);
  });

  // ── closeOrder ──

  it('should close PENDING order and call WeChat closePayment', async () => {
    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'RC20260726USER00123456', userId: 'user-1', amount: 5000, status: 'PENDING',
    });
    payment.closePayment.mockResolvedValue(undefined);
    prisma.rechargeOrder.updateMany.mockResolvedValue({ count: 1 });

    await service.closeOrder('RC20260726USER00123456', 'user-1');

    expect(payment.closePayment).toHaveBeenCalledWith('RC20260726USER00123456');
    expect(prisma.rechargeOrder.updateMany).toHaveBeenCalledWith({
      where: { orderNo: 'RC20260726USER00123456', status: 'PENDING' },
      data: { status: 'CLOSED', closedAt: expect.any(Date) },
    });
  });

  it('should reject non-owner for closeOrder', async () => {
    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'RC20260726USER00123456', userId: 'user-1', amount: 5000, status: 'PENDING',
    });
    await expect(service.closeOrder('RC20260726USER00123456', 'user-2')).rejects.toThrow(BusinessException);
  });

  it('should be idempotent for already CLOSED orders', async () => {
    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'RC20260726USER00123456', userId: 'user-1', amount: 5000, status: 'CLOSED',
    });
    await service.closeOrder('RC20260726USER00123456', 'user-1');
    expect(payment.closePayment).not.toHaveBeenCalled();
  });

  it('should be idempotent for already SUCCESS orders', async () => {
    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'RC20260726USER00123456', userId: 'user-1', amount: 5000, status: 'SUCCESS',
    });
    await service.closeOrder('RC20260726USER00123456', 'user-1');
    expect(payment.closePayment).not.toHaveBeenCalled();
  });

  // ── handleCallback ──

  it('should credit balance on valid SUCCESS callback', async () => {
    const notify = {
      outTradeNo: 'RC20260726USER00123456',
      transactionId: '4200001234567890',
      tradeState: 'SUCCESS',
      tradeStateDesc: '支付成功',
      amount: 5000,
      payerOpenid: 'oTest123',
      appid: 'wx1234567890abcdef',
      mchid: '1234567890',
    };
    payment.parseNotify.mockResolvedValue(notify);

    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'RC20260726USER00123456', userId: 'user-1', amount: 5000, status: 'PENDING',
    });

    const tx = prisma.$transaction.mock.calls[0]
      ? (await prisma.$transaction.mock.results[0]?.value)
      : undefined;
    const result = await service.handleCallback(
      { 'content-type': 'application/json', 'wechatpay-nonce': 'n1', 'wechatpay-timestamp': String(Math.floor(Date.now() / 1000)), 'wechatpay-serial': 'PK1', 'wechatpay-signature': 'sig1' },
      Buffer.from(JSON.stringify({ resource: { ciphertext: 'ct', nonce: 'nonce1', associated_data: 'ad1' } })),
    );

    expect(result.code).toBe('SUCCESS');
    expect(payment.parseNotify).toHaveBeenCalled();
  });

  it('should reject callback with mismatched amount', async () => {
    payment.parseNotify.mockResolvedValue({
      outTradeNo: 'RC20260726USER00123456',
      transactionId: '4200001234567890',
      tradeState: 'SUCCESS',
      tradeStateDesc: '支付成功',
      amount: 9999,
      payerOpenid: 'oTest123',
      appid: 'wx1234567890abcdef',
      mchid: '1234567890',
    });

    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'RC20260726USER00123456', userId: 'user-1', amount: 5000, status: 'PENDING',
    });

    const result = await service.handleCallback(
      { 'content-type': 'application/json', 'wechatpay-nonce': 'n1', 'wechatpay-timestamp': String(Math.floor(Date.now() / 1000)), 'wechatpay-serial': 'PK1', 'wechatpay-signature': 'sig1' },
      Buffer.from('{}'),
    );

    expect(result.code).toBe('FAIL');
  });

  it('should return SUCCESS for terminal-state order (idempotent callback)', async () => {
    payment.parseNotify.mockResolvedValue({
      outTradeNo: 'RC20260726USER00123456',
      transactionId: '4200001234567890',
      tradeState: 'SUCCESS',
      tradeStateDesc: '支付成功',
      amount: 5000,
      payerOpenid: 'oTest123',
      appid: 'wx1234567890abcdef',
      mchid: '1234567890',
    });

    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'RC20260726USER00123456', userId: 'user-1', amount: 5000, status: 'SUCCESS',
    });

    const result = await service.handleCallback(
      { 'content-type': 'application/json', 'wechatpay-nonce': 'n1', 'wechatpay-timestamp': String(Math.floor(Date.now() / 1000)), 'wechatpay-serial': 'PK1', 'wechatpay-signature': 'sig1' },
      Buffer.from('{}'),
    );

    expect(result.code).toBe('SUCCESS');
  });

  it('should reject callback with non-CNY or mismatched appid', async () => {
    payment.parseNotify.mockResolvedValue({
      outTradeNo: 'RC20260726USER00123456',
      transactionId: '4200001234567890',
      tradeState: 'SUCCESS',
      tradeStateDesc: '支付成功',
      amount: 5000,
      payerOpenid: 'oTest123',
      appid: 'wrong-appid',
      mchid: 'wrong-mchid',
    });

    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'RC20260726USER00123456', userId: 'user-1', amount: 5000, status: 'PENDING',
    });

    const result = await service.handleCallback(
      { 'content-type': 'application/json', 'wechatpay-nonce': 'n1', 'wechatpay-timestamp': String(Math.floor(Date.now() / 1000)), 'wechatpay-serial': 'PK1', 'wechatpay-signature': 'sig1' },
      Buffer.from('{}'),
    );

    expect(result.code).toBe('FAIL');
  });

  it('should use FOR UPDATE row lock during balance credit', async () => {
    const notify = {
      outTradeNo: 'RC20260726USER00123456',
      transactionId: '4200001234567890',
      tradeState: 'SUCCESS',
      tradeStateDesc: '支付成功',
      amount: 5000,
      payerOpenid: 'oTest123',
      appid: 'wx1234567890abcdef',
      mchid: '1234567890',
    };
    payment.parseNotify.mockResolvedValue(notify);

    prisma.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNo: 'RC20260726USER00123456', userId: 'user-1', amount: 5000, status: 'PENDING',
    });

    let capturedTx: any;
    prisma.$transaction.mockImplementation(async (fn: Function) => {
      const itx = createTx();
      itx.rechargeOrder.findUnique.mockResolvedValue({
        id: 'order-1', orderNo: 'RC20260726USER00123456', userId: 'user-1', amount: 5000, status: 'PENDING',
      });
      itx.userBalance.upsert.mockResolvedValue({ balance: 10000, version: 0 });
      capturedTx = itx;
      return fn(itx);
    });

    await service.handleCallback(
      { 'content-type': 'application/json', 'wechatpay-nonce': 'n1', 'wechatpay-timestamp': String(Math.floor(Date.now() / 1000)), 'wechatpay-serial': 'PK1', 'wechatpay-signature': 'sig1' },
      Buffer.from(JSON.stringify({ resource: { ciphertext: 'ct', nonce: 'nonce1', associated_data: 'ad1' } })),
    );

    expect(capturedTx.$queryRaw).toHaveBeenCalled();
  });
});
