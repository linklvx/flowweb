import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { TeamCreditService } from './team-credit.service';
import { CreditLedgerService } from './credit-ledger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('TeamCreditService', () => {
  let service: TeamCreditService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      teamBalance: { findUnique: vi.fn(), updateMany: vi.fn() },
      teamMember: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      teamCreditTransaction: { create: vi.fn(), createMany: vi.fn() },
      // Y0b-2 T0：used 改道台账派生（$queryRaw 两腿聚合）——默认零命中=used 0
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamCreditService,
        { provide: PrismaService, useValue: prisma },
        { provide: CreditLedgerService, useValue: { tx: (r: any) => r, lockBalance: vi.fn(), ensureBalance: vi.fn(), mutate: vi.fn() } },
      ],
    }).compile();

    service = module.get<TeamCreditService>(TeamCreditService);
  });

  describe('getBalanceView', () => {
    it('返回双池+总额+成员 quota/used（used 台账派生——旧列值不再被读，惰性重置随写点消失）', async () => {
      prisma.teamBalance.findUnique.mockResolvedValue({ credits: 100, subscriptionCredits: 50 });
      prisma.teamMember.findUnique.mockResolvedValue({
        id: 'm1', monthlyQuota: 200, monthlyPeriod: '2026-01', monthlyUsed: 30,
      });

      const result = await service.getBalanceView('t1', 'u1');

      expect(result).toEqual({
        credits: 100, subscriptionCredits: 50, total: 150, quota: 200, used: 0,
      });
      expect(prisma.$queryRaw).toHaveBeenCalled();   // 派生读已改道
      expect(prisma.teamMember.update).not.toHaveBeenCalled();   // 惰性重置退役
    });

    it('非成员 403', async () => {
      prisma.teamMember.findUnique.mockResolvedValue(null);
      await expect(service.getBalanceView('t1', 'u1')).rejects.toThrow(ForbiddenException);
    });
  });

});
