import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { TeamRechargeService } from './team-recharge.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentGateway } from '../recharge/payment.gateway';
import { TeamSubscriptionService } from './team-subscription.service';
import { CreditLedgerService } from './credit-ledger.service';
import { AuditService } from '../../common/audit/audit.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('TeamRechargeService', () => {
  let service: TeamRechargeService;
  let prisma: any;
  let payment: any;
  let gateway: any;
  let closeQueue: any;
  let subscriptionService: any;
  let ledger: any;
  const audit = { log: vi.fn(), logTx: vi.fn() };

  beforeEach(async () => {
    ledger = {
      tx: (raw: any) => raw,
      lockBalance: vi.fn().mockResolvedValue(undefined),
      ensureBalance: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn().mockResolvedValue({ rowId: 'lr-1', balanceAfter: 300 }),
    };
    prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ name: '付款人' }) },
      teamRechargeOrder: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
      teamBalance: { findUnique: vi.fn() },
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn(),
      $transaction: vi.fn(async (fn: any) => fn({
        $executeRaw: prisma.$executeRaw,
        $queryRaw: prisma.$queryRaw,
        teamBalance: prisma.teamBalance,
        teamRechargeOrder: prisma.teamRechargeOrder,
      })),
    };
    payment = { createPayment: vi.fn(), closePayment: vi.fn(), queryOrder: vi.fn() };
    gateway = { emitPaymentSuccess: vi.fn(), emitPaymentFailed: vi.fn() };
    closeQueue = { add: vi.fn() };
    subscriptionService = { completeSubscriptionCallback: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamRechargeService,
        { provide: PrismaService, useValue: prisma },
        { provide: 'PAYMENT_PROVIDER', useValue: payment },
        { provide: PaymentGateway, useValue: gateway },
        { provide: TeamSubscriptionService, useValue: subscriptionService },
        { provide: CreditLedgerService, useValue: ledger },
        { provide: getQueueToken('team-recharge-close-expired'), useValue: closeQueue },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<TeamRechargeService>(TeamRechargeService);
  });

  describe('createTeamOrder', () => {
    it('档位校验 + TEAM 前缀单号 + credits 换算(1元=10积分) + PENDING/expiresAt 2h + 投递关单 job', async () => {
      prisma.teamRechargeOrder.create.mockImplementation(({ data }: any) => data);

      const order = await service.createTeamOrder('t1', 'u1', 3000);

      expect(order.outTradeNo).toMatch(/^TEAM\d{19}$/);
      expect(order.credits).toBe(300);
      expect(order.status).toBe('PENDING');
      expect(Date.now() - (order.expiresAt.getTime() - 2 * 60 * 60 * 1000)).toBeLessThan(5000);
      expect(closeQueue.add).toHaveBeenCalledWith('team-close-expired', expect.objectContaining({ orderNo: order.outTradeNo }), expect.anything());
    });

    it('非法档位拒绝', async () => {
      await expect(service.createTeamOrder('t1', 'u1', 1500)).rejects.toThrow();
    });
  });

  describe('payTeamOrder', () => {
    it('无 prepayId：调 createPayment 并落 prepayId 返回 codeUrl', async () => {
      prisma.teamRechargeOrder.findUnique.mockResolvedValue({
        outTradeNo: 'TEAM1', teamId: 't1', payerUserId: 'u1', amountFen: 3000,
        status: 'PENDING', prepayId: null, createdAt: new Date(),
      });
      payment.createPayment.mockResolvedValue({ codeUrl: 'weixin://x', prepayId: 'pp1' });

      const result = await service.payTeamOrder('TEAM1', 'u1');

      expect(payment.createPayment).toHaveBeenCalledWith(expect.objectContaining({ orderNo: 'TEAM1', amount: 3000 }));
      expect(result.codeUrl).toBe('weixin://x');
      expect(prisma.teamRechargeOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ prepayId: 'pp1' }) }),
      );
    });

    it('已有 prepayId：幂等直接返回不重复下单', async () => {
      prisma.teamRechargeOrder.findUnique.mockResolvedValue({
        outTradeNo: 'TEAM1', payerUserId: 'u1', status: 'PENDING', prepayId: 'pp0', amountFen: 3000,
      });

      await service.payTeamOrder('TEAM1', 'u1');

      expect(payment.createPayment).not.toHaveBeenCalled();
    });
  });

  describe('completeTeamCallback（kind=credits）', () => {
    const notify = {
      outTradeNo: 'TEAM1', appid: process.env.WECHAT_PAY_APP_ID, mchid: process.env.WECHAT_PAY_MCH_ID,
      amount: 3000, tradeState: 'SUCCESS', transactionId: 'tx1', payerOpenid: 'o1',
    };
    const order = {
      outTradeNo: 'TEAM1', teamId: 't1', payerUserId: 'u1', amountFen: 3000, credits: 300,
      status: 'PENDING', kind: 'credits',
    };

    it('成功：ensureBalance+lockBalance（取代裸 FOR UPDATE）+入账经 ledger.mutate(recharge)+订单 CAS+推送', async () => {
      prisma.teamRechargeOrder.findUnique.mockResolvedValue(order);
      prisma.teamBalance.findUnique.mockResolvedValue({ credits: 0, subscriptionCredits: 0 });
      prisma.teamRechargeOrder.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.completeTeamCallback(notify as any);

      expect(result.code).toBe('SUCCESS');
      // Y0b-1 Z23：收钱路径钱包缺失自愈经 ensureBalance；Z13 锁经 lockBalance
      expect(ledger.ensureBalance).toHaveBeenCalledWith(expect.anything(), 't1');
      expect(ledger.lockBalance).toHaveBeenCalledWith(expect.anything(), 't1');
      // Z9 money_in：referenceId=outTradeNo（幂等键）
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
        teamId: 't1', operatorUserId: 'u1', type: 'recharge', creditType: 'regular',
        balanceDelta: 300, frozenDelta: 0, referenceId: 'TEAM1',
      });
      expect(prisma.teamRechargeOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { outTradeNo: 'TEAM1', status: 'PENDING' } }),
      );
      expect(audit.logTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        operatorId: 'u1', operatorName: '付款人', teamId: 't1', targetType: 'TEAM', targetId: 't1',
        action: 'recharge', afterValue: { credits: 300 },
      }));
      expect(gateway.emitPaymentSuccess).toHaveBeenCalledWith('TEAM1', 3000, 300);
    });

    it('订单不存在 FAIL', async () => {
      prisma.teamRechargeOrder.findUnique.mockResolvedValue(null);
      const result = await service.completeTeamCallback(notify as any);
      expect(result.code).toBe('FAIL');
    });

    it('终态幂等 SUCCESS', async () => {
      prisma.teamRechargeOrder.findUnique.mockResolvedValue({ ...order, status: 'SUCCESS' });
      const result = await service.completeTeamCallback(notify as any);
      expect(result.code).toBe('SUCCESS');
      expect(ledger.mutate).not.toHaveBeenCalled();
    });

    it('金额不匹配 FAIL', async () => {
      prisma.teamRechargeOrder.findUnique.mockResolvedValue({ ...order, amountFen: 9999 });
      const result = await service.completeTeamCallback(notify as any);
      expect(result.code).toBe('FAIL');
    });

    it('并发幂等：updateMany count=0 时推送失败但不重复入账报错', async () => {
      prisma.teamRechargeOrder.findUnique.mockResolvedValue(order);
      prisma.teamBalance.findUnique.mockResolvedValue({ credits: 0, subscriptionCredits: 0 });
      prisma.teamRechargeOrder.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.completeTeamCallback(notify as any);

      expect(result.code).toBe('FAIL');
      expect(gateway.emitPaymentFailed).toHaveBeenCalledWith('TEAM1');
    });
  });

  describe('completeTeamCallback（kind=subscription）', () => {
    const notify = {
      outTradeNo: 'TEAM1', appid: process.env.WECHAT_PAY_APP_ID, mchid: process.env.WECHAT_PAY_MCH_ID,
      amount: 3000, tradeState: 'SUCCESS', transactionId: 'tx1', payerOpenid: 'o1',
    };
    const order = {
      outTradeNo: 'TEAM1', teamId: 't1', payerUserId: 'u1', amountFen: 3000, credits: 300,
      status: 'PENDING', kind: 'subscription',
    };

    it('回调成功：透传 completeSubscriptionCallback 并推送 payment:success（团队订单无轮询兜底，socket 是前端 modal 唯一通道）', async () => {
      prisma.teamRechargeOrder.findUnique.mockResolvedValue(order);
      subscriptionService.completeSubscriptionCallback.mockResolvedValue({ code: 'SUCCESS', message: 'OK' });

      const result = await service.completeTeamCallback(notify as any);

      expect(result.code).toBe('SUCCESS');
      expect(subscriptionService.completeSubscriptionCallback).toHaveBeenCalledWith(notify);
      // 前端 WeChatQRModal 不读 payload，credits 传 0
      expect(gateway.emitPaymentSuccess).toHaveBeenCalledWith('TEAM1', 3000, 0);
    });

    it('回调 FAIL（completeSubscriptionCallback 内部吞错只返回 code）：不推送 success', async () => {
      prisma.teamRechargeOrder.findUnique.mockResolvedValue(order);
      subscriptionService.completeSubscriptionCallback.mockResolvedValue({ code: 'FAIL', message: 'internal error' });

      const result = await service.completeTeamCallback(notify as any);

      expect(result.code).toBe('FAIL');
      expect(gateway.emitPaymentSuccess).not.toHaveBeenCalled();
    });
  });

  describe('listOrders', () => {
    it('where 含 teamId + kind 过滤 + 分页（createdAt desc）', async () => {
      prisma.teamRechargeOrder.findMany = vi.fn().mockResolvedValue([{ id: 'o1' }]);
      prisma.teamRechargeOrder.count = vi.fn().mockResolvedValue(1);

      const result = await service.listOrders('t1', 2, 10, 'subscription');

      expect(result).toEqual({ items: [{ id: 'o1' }], total: 1 });
      expect(prisma.teamRechargeOrder.findMany).toHaveBeenCalledWith({
        where: { teamId: 't1', kind: 'subscription' },
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 10,
      });
      expect(prisma.teamRechargeOrder.count).toHaveBeenCalledWith({ where: { teamId: 't1', kind: 'subscription' } });
    });

    it('无 kind 过滤时 where 仅 teamId', async () => {
      prisma.teamRechargeOrder.findMany = vi.fn().mockResolvedValue([]);
      prisma.teamRechargeOrder.count = vi.fn().mockResolvedValue(0);

      await service.listOrders('t1');

      expect(prisma.teamRechargeOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { teamId: 't1' } }),
      );
    });
  });
});
