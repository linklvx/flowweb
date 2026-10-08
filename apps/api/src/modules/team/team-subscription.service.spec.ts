import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TeamSubscriptionService } from './team-subscription.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLedgerService } from './credit-ledger.service';
import { AuditService } from '../../common/audit/audit.service';
import { TEAM_FREE_STORAGE_LIMIT_BYTES } from './team.constants';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('TeamSubscriptionService', () => {
  let service: TeamSubscriptionService;
  let prisma: any;
  let ledger: any;
  const audit = { log: vi.fn(), logTx: vi.fn() };

  beforeEach(async () => {
    ledger = {
      tx: (raw: any) => raw,
      lockBalance: vi.fn().mockResolvedValue(undefined),
      ensureBalance: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn().mockResolvedValue({ rowId: 'lr-1', balanceAfter: 0 }),
    };
    prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ name: '付款人' }) },
      team: { findUnique: vi.fn().mockResolvedValue({ isDefault: false }) },
      teamMember: { findUnique: vi.fn() },
      teamSubscription: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
      teamPlan: { findUnique: vi.fn() },
      teamBalance: { findUnique: vi.fn() },
      teamRechargeOrder: { findUnique: vi.fn(), updateMany: vi.fn() },
      userSubscription: { findFirst: vi.fn() },
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn(),
      $transaction: vi.fn(async (fn: any) => fn({
        $executeRaw: prisma.$executeRaw,
        $queryRaw: prisma.$queryRaw,
        teamBalance: prisma.teamBalance,
        teamSubscription: prisma.teamSubscription,
        teamRechargeOrder: prisma.teamRechargeOrder,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamSubscriptionService,
        { provide: PrismaService, useValue: prisma },
        { provide: CreditLedgerService, useValue: ledger },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<TeamSubscriptionService>(TeamSubscriptionService);
  });

  describe('createSubscriptionOrder（Q2/S3：active 期拒购）', () => {
    const plan = { id: 'plan1', name: '专业版', monthlyCredits: 500, priceMonthly: 9900, seatLimit: 30, storageLimitBytes: BigInt(20 * 1024 ** 3), isActive: true };

    it('创建 kind=subscription 订单（PENDING+planId+credits=plan.monthlyCredits）', async () => {
      prisma.teamMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.teamSubscription.findFirst.mockResolvedValue(null);
      prisma.teamPlan.findUnique.mockResolvedValue(plan);
      prisma.teamRechargeOrder.findUnique = vi.fn();
      const createSpy = vi.fn().mockImplementation(({ data }: any) => ({ ...data }));
      (prisma as any).teamRechargeOrder.create = createSpy;

      const order = await service.createSubscriptionOrder('t1', 'u1', 'plan1');

      expect(order.kind).toBe('subscription');
      expect(order.planId).toBe('plan1');
      expect(order.amountFen).toBe(9900);
      expect(order.credits).toBe(500);
      expect(order.status).toBe('PENDING');
    });

    it('存在 active 订阅直接拒绝', async () => {
      prisma.teamMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.teamSubscription.findFirst.mockResolvedValue({ id: 's1', status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) });
      await expect(service.createSubscriptionOrder('t1', 'u1', 'plan1')).rejects.toThrow('已开通');
    });

    it('非管理员拒绝', async () => {
      prisma.teamMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
      await expect(service.createSubscriptionOrder('t1', 'u1', 'plan1')).rejects.toThrow(ForbiddenException);
    });

    it('默认团队（个人项目）拒绝购买订阅', async () => {
      prisma.team.findUnique.mockResolvedValue({ isDefault: true });
      await expect(service.createSubscriptionOrder('t1', 'u1', 'plan1')).rejects.toThrow('个人项目不支持');
      expect(prisma.teamMember.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('completeSubscriptionCallback（Q2：覆盖式发放）', () => {
    const order = {
      outTradeNo: 'TEAM9', teamId: 't1', payerUserId: 'u1', amountFen: 9900,
      credits: 500, kind: 'subscription', planId: 'plan1', status: 'PENDING',
    };

    it('上期剩余清零（expire_clear mutate）→ 覆盖发放 500（subscription_grant mutate）→ 建 TeamSubscription(+30d)', async () => {
      prisma.teamRechargeOrder.findUnique.mockResolvedValue(order);
      prisma.teamPlan.findUnique.mockResolvedValue({ id: 'plan1', monthlyCredits: 500 });
      prisma.teamBalance.findUnique.mockResolvedValue({ credits: 100, subscriptionCredits: 120 });
      prisma.teamSubscription.findFirst.mockResolvedValue(null);
      prisma.teamRechargeOrder.updateMany = vi.fn().mockResolvedValue({ count: 1 });

      const result = await service.completeSubscriptionCallback({
        outTradeNo: 'TEAM9', appid: '', mchid: '', amount: 9900, tradeState: 'SUCCESS', transactionId: 'tx9',
      } as any);

      expect(result.code).toBe('SUCCESS');
      // Y0b-1 Z13：lockBalance 取代裸 FOR UPDATE（锁序全序）；入账全经 mutate（Z9 ref=order.outTradeNo）
      expect(ledger.lockBalance).toHaveBeenCalledWith(expect.anything(), 't1');
      expect(ledger.mutate).toHaveBeenCalledTimes(2);
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
        teamId: 't1', operatorUserId: 'u1', type: 'expire_clear', creditType: 'subscription',
        balanceDelta: -120, frozenDelta: 0, referenceId: 'TEAM9',
      });
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
        teamId: 't1', operatorUserId: 'u1', type: 'subscription_grant', creditType: 'subscription',
        balanceDelta: 500, frozenDelta: 0, referenceId: 'TEAM9',
      });
      expect(prisma.teamSubscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          teamId: 't1', planId: 'plan1', status: 'active', paidAmount: 9900,
          currentPeriodStart: expect.any(Date), currentPeriodEnd: expect.any(Date),
        }),
      });
      expect(audit.logTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        operatorId: 'u1', operatorName: '付款人', teamId: 't1', targetType: 'TEAM', targetId: 't1',
        action: 'subscribe', afterValue: { planId: 'plan1', monthlyCredits: 500 },
      }));
    });

    it('金额不匹配 FAIL', async () => {
      prisma.teamRechargeOrder.findUnique.mockResolvedValue({ ...order, amountFen: 1 });
      const result = await service.completeSubscriptionCallback({
        outTradeNo: 'TEAM9', appid: '', mchid: '', amount: 9900, tradeState: 'SUCCESS', transactionId: 'tx',
      } as any);
      expect(result.code).toBe('FAIL');
    });

    it('默认团队回调兜底拒绝（个人项目）', async () => {
      prisma.teamRechargeOrder.findUnique.mockResolvedValue(order);
      prisma.teamPlan.findUnique.mockResolvedValue({ id: 'plan1', monthlyCredits: 500 });
      prisma.team.findUnique.mockResolvedValue({ isDefault: true });
      await expect(service.completeSubscriptionCallback({
        outTradeNo: 'TEAM9', appid: '', mchid: '', amount: 9900, tradeState: 'SUCCESS', transactionId: 'tx9',
      } as any)).rejects.toThrow('个人项目不支持');
    });

    it('回调 create 前先关闭旧 active 订阅（到期未过期 job 窗口续费）', async () => {
      prisma.teamRechargeOrder.findUnique.mockResolvedValue({
        id: 'o1', outTradeNo: 'TEAM1', teamId: 't1', payerUserId: 'u1', amountFen: 3000,
        credits: 300, kind: 'subscription', planId: 'plan1', status: 'PENDING',
      });
      prisma.teamPlan.findUnique.mockResolvedValue({ id: 'plan1', monthlyCredits: 300, isActive: true });
      prisma.teamBalance.findUnique.mockResolvedValue({ subscriptionCredits: 50 });
      prisma.teamSubscription.updateMany.mockResolvedValue({ count: 1 });
      prisma.teamSubscription.create.mockResolvedValue({ id: 's-new' });
      prisma.teamRechargeOrder.updateMany = vi.fn().mockResolvedValue({ count: 1 });

      const result = await service.completeSubscriptionCallback({
        outTradeNo: 'TEAM1', appid: '', mchid: '', amount: 3000, tradeState: 'SUCCESS', transactionId: 'tx1',
      } as any);

      expect(result.code).toBe('SUCCESS');
      // 先关旧（updateMany 在 create 之前调用）
      const closeIdx = prisma.teamSubscription.updateMany.mock.invocationCallOrder[0];
      const createIdx = prisma.teamSubscription.create.mock.invocationCallOrder[0];
      expect(closeIdx).toBeLessThan(createIdx);
      expect(prisma.teamSubscription.updateMany).toHaveBeenCalledWith({
        where: { teamId: 't1', status: 'active' },
        data: { status: 'expired' },
      });
    });
  });

  describe('expireSubscriptions（team-expire processor 逻辑）', () => {
    it('到期：CAS 前置（count===0 零动作）+ 置 expired + expire_clear mutate（Z24 周期事件键 sub.id:periodEnd）（credits 不动）', async () => {
      prisma.teamSubscription.findMany.mockResolvedValue([
        { id: 's1', teamId: 't1', status: 'active', currentPeriodEnd: new Date('2026-01-31T00:00:00Z') },
      ]);
      prisma.teamBalance.findUnique.mockResolvedValue({ credits: 100, subscriptionCredits: 80 });
      prisma.teamSubscription.updateMany.mockResolvedValue({ count: 1 });

      const count = await service.expireSubscriptions();

      expect(count).toBe(1);
      expect(ledger.lockBalance).toHaveBeenCalledWith(expect.anything(), 't1');
      expect(prisma.teamSubscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's1', status: 'active' }, data: { status: 'expired' } }),
      );
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
        teamId: 't1', operatorUserId: null, type: 'expire_clear', creditType: 'subscription',
        balanceDelta: -80, frozenDelta: 0, referenceId: 's1:2026-01-31',
      });
      expect(audit.logTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        operatorId: 'system', teamId: 't1', targetType: 'TEAM', targetId: 't1',
        action: 'expire', afterValue: { cleared: 80 },
      }));
    });
  });

  describe('getLimits', () => {
    it('active 订阅取 plan 限额', async () => {
      prisma.teamSubscription.findFirst.mockResolvedValue({
        plan: { seatLimit: 30, storageLimitBytes: BigInt(20 * 1024 ** 3) },
      });
      const limits = await service.getLimits('t1');
      expect(limits).toEqual({ seatLimit: 30, storageLimitBytes: 20 * 1024 ** 3 });
    });

    it('无订阅回落免费常量（20 席位/6GiB）', async () => {
      prisma.teamSubscription.findFirst.mockResolvedValue(null);
      const limits = await service.getLimits('t1');
      expect(limits).toEqual({ seatLimit: 20, storageLimitBytes: 6 * 1024 ** 3 });
    });
  });

  describe('getLimits 个人订阅回退（C7）', () => {
    it('默认团队 + 个人 pro 会员 → plan.storageLimitBytes、seatLimit=1', async () => {
      prisma.team.findUnique.mockResolvedValue({ isDefault: true, ownerId: 'u1' });
      prisma.userSubscription.findFirst.mockResolvedValue({ plan: { storageLimitBytes: 21474836480n } });
      const limits = await service.getLimits('t-default');
      expect(limits).toEqual({ seatLimit: 1, storageLimitBytes: 21474836480 });
    });

    it('默认团队 + 无个人订阅 → 免费档', async () => {
      prisma.team.findUnique.mockResolvedValue({ isDefault: true, ownerId: 'u1' });
      prisma.userSubscription.findFirst.mockResolvedValue(null);
      const limits = await service.getLimits('t-default');
      expect(limits.storageLimitBytes).toBe(TEAM_FREE_STORAGE_LIMIT_BYTES);
    });

    it('普通团队走 TeamSubscription（现状不变）', async () => {
      prisma.team.findUnique.mockResolvedValue({ isDefault: false, ownerId: 'u1' });
      prisma.teamSubscription.findFirst.mockResolvedValue({ plan: { seatLimit: 5, storageLimitBytes: 107374182400n } });
      const limits = await service.getLimits('t-team');
      expect(limits).toEqual({ seatLimit: 5, storageLimitBytes: 107374182400 });
    });
  });
});
