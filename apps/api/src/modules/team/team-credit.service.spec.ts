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
      teamCreditTransaction: { create: vi.fn(), createMany: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma)),
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

});
