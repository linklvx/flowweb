import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { TeamCreditService } from './team-credit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const period = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

describe('TeamCreditService', () => {
  let service: TeamCreditService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      teamBalance: { findUnique: vi.fn(), updateMany: vi.fn() },
      teamMember: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      teamCreditTransaction: { create: vi.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TeamCreditService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<TeamCreditService>(TeamCreditService);
  });

  describe('getBalanceView', () => {
    it('返回双池+总额+成员 quota/used', async () => {
      prisma.teamBalance.findUnique.mockResolvedValue({ credits: 100, subscriptionCredits: 50 });
      prisma.teamMember.findUnique.mockResolvedValue({
        id: 'm1', monthlyQuota: 200, monthlyPeriod: period(), monthlyUsed: 30,
      });

      const result = await service.getBalanceView('t1', 'u1');

      expect(result).toEqual({
        credits: 100, subscriptionCredits: 50, total: 150, quota: 200, used: 30,
      });
    });

    it('惰性重置：monthlyPeriod 非当月先清零再返回', async () => {
      prisma.teamBalance.findUnique.mockResolvedValue({ credits: 100, subscriptionCredits: 0 });
      prisma.teamMember.findUnique.mockResolvedValue({
        id: 'm1', monthlyQuota: 200, monthlyPeriod: '2026-01', monthlyUsed: 150,
      });
      prisma.teamMember.update.mockResolvedValue({
        id: 'm1', monthlyQuota: 200, monthlyPeriod: period(), monthlyUsed: 0,
      });

      const result = await service.getBalanceView('t1', 'u1');

      expect(prisma.teamMember.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { monthlyPeriod: period(), monthlyUsed: 0 },
      });
      expect(result.used).toBe(0);
    });

    it('非成员 403', async () => {
      prisma.teamMember.findUnique.mockResolvedValue(null);
      await expect(service.getBalanceView('t1', 'u1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('consume 校验顺序（D5）', () => {
    const balance = (credits: number, subscriptionCredits: number, version = 0) =>
      ({ credits, subscriptionCredits, version });

    it('① 总额不足：拒且不动 monthlyUsed、不写流水', async () => {
      prisma.teamBalance.findUnique.mockResolvedValue(balance(10, 5));
      prisma.teamMember.findUnique.mockResolvedValue({
        id: 'm1', monthlyQuota: 0, monthlyPeriod: period(), monthlyUsed: 0,
      });

      const result = await service.consume('t1', 'u1', 20, 'ref-1');

      expect(result.success).toBe(false);
      expect(prisma.teamMember.updateMany).not.toHaveBeenCalled();
      expect(prisma.teamBalance.updateMany).not.toHaveBeenCalled();
      expect(prisma.teamCreditTransaction.create).not.toHaveBeenCalled();
    });

    it('② quota 超限：拒且不动池、不写流水', async () => {
      prisma.teamBalance.findUnique.mockResolvedValue(balance(100, 50));
      prisma.teamMember.findUnique.mockResolvedValue({
        id: 'm1', monthlyQuota: 30, monthlyPeriod: period(), monthlyUsed: 25,
      });

      const result = await service.consume('t1', 'u1', 10, 'ref-1');

      expect(result.success).toBe(false);
      expect(prisma.teamBalance.updateMany).not.toHaveBeenCalled();
      expect(prisma.teamCreditTransaction.create).not.toHaveBeenCalled();
    });

    it('③④ 成功：订阅优先拆分扣减+乐观锁；monthlyUsed 原子累加（quota 并入 where）；跨池两条流水', async () => {
      prisma.teamBalance.findUnique
        .mockResolvedValueOnce(balance(100, 30))
        .mockResolvedValueOnce(balance(100, 30))
        .mockResolvedValueOnce(balance(70, 10));
      prisma.teamBalance.updateMany.mockResolvedValue({ count: 1 });
      prisma.teamMember.findUnique.mockResolvedValue({
        id: 'm1', monthlyQuota: 200, monthlyPeriod: period(), monthlyUsed: 25,
      });
      prisma.teamMember.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.consume('t1', 'u1', 50, 'ref-1');

      expect(result.success).toBe(true);
      expect(prisma.teamBalance.updateMany).toHaveBeenCalledWith({
        where: { teamId: 't1', version: 0 },
        data: {
          version: { increment: 1 },
          subscriptionCredits: { decrement: 30 },
          credits: { decrement: 20 },
        },
      });
      expect(prisma.teamMember.updateMany).toHaveBeenCalledWith({
        where: { id: 'm1', monthlyPeriod: period(), monthlyUsed: { lte: 200 - 50 } },
        data: { monthlyUsed: { increment: 50 }, monthlyPeriod: period() },
      });
      expect(prisma.teamCreditTransaction.create).toHaveBeenCalledTimes(2);
      expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith({
        data: {
          teamId: 't1', operatorUserId: 'u1', amount: -30, type: 'consumption',
          creditType: 'subscription', referenceId: 'ref-1', balanceAfter: 10,
        },
      });
      expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith({
        data: {
          teamId: 't1', operatorUserId: 'u1', amount: -20, type: 'consumption',
          creditType: 'regular', referenceId: 'ref-1', balanceAfter: 70,
        },
      });
    });

    it('quota=0 不限额：monthlyUsed where 无上限条件', async () => {
      prisma.teamBalance.findUnique
        .mockResolvedValue(balance(100, 0))
        .mockResolvedValue(balance(100, 0))
        .mockResolvedValue(balance(50, 0));
      prisma.teamBalance.updateMany.mockResolvedValue({ count: 1 });
      prisma.teamMember.findUnique.mockResolvedValue({
        id: 'm1', monthlyQuota: 0, monthlyPeriod: period(), monthlyUsed: 999,
      });
      prisma.teamMember.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.consume('t1', 'u1', 50, 'ref-1');

      expect(result.success).toBe(true);
      expect(prisma.teamMember.updateMany).toHaveBeenCalledWith({
        where: { id: 'm1', monthlyPeriod: period() },
        data: { monthlyUsed: { increment: 50 }, monthlyPeriod: period() },
      });
    });

    it('③ 并发版本冲突：重试 3 次后失败返回 {success:false}', async () => {
      prisma.teamBalance.findUnique.mockResolvedValue(balance(100, 0));
      prisma.teamBalance.updateMany.mockResolvedValue({ count: 0 });
      prisma.teamMember.findUnique.mockResolvedValue({
        id: 'm1', monthlyQuota: 0, monthlyPeriod: period(), monthlyUsed: 0,
      });

      const result = await service.consume('t1', 'u1', 10, 'ref-1');

      expect(result.success).toBe(false);
      expect(prisma.teamBalance.updateMany.mock.calls.length).toBeLessThanOrEqual(3);
      expect(prisma.teamCreditTransaction.create).not.toHaveBeenCalled();
    });

    it('④ monthlyUsed 原子校验失败（并发超限）：不入账', async () => {
      prisma.teamBalance.findUnique
        .mockResolvedValueOnce(balance(100, 0))
        .mockResolvedValueOnce(balance(100, 0))
        .mockResolvedValue(balance(90, 0));
      prisma.teamBalance.updateMany.mockResolvedValue({ count: 1 });
      prisma.teamMember.findUnique.mockResolvedValue({
        id: 'm1', monthlyQuota: 200, monthlyPeriod: period(), monthlyUsed: 25,
      });
      prisma.teamMember.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.consume('t1', 'u1', 10, 'ref-1');

      expect(result.success).toBe(false);
      expect(prisma.teamCreditTransaction.create).not.toHaveBeenCalled();
    });
  });
});
