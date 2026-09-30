import { Test, TestingModule } from '@nestjs/testing';
import { TeamCreditService } from './team-credit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const period = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const balance = (credits: number, subscriptionCredits: number, version = 0) =>
  ({ credits, subscriptionCredits, version });

const member = (monthlyQuota: number, monthlyUsed: number) =>
  ({ id: 'm1', monthlyQuota, monthlyPeriod: period(), monthlyUsed });

/** F13 批0.5-4：consume $transaction 原子化 + CAS 扣费门 + 流水键 intent: 维度。
 *  装置：$transaction mock 直接执行回调透传 tx=prisma（照既有 team-credit 测试 mock 骨架）；
 *  真实 Prisma 下回调 throw=整体回滚——透传 mock 以 txErrors 捕获回调 throw 证明回滚语义被触发。 */
describe('TeamCreditService.consume 原子化（F13 批0.5-4）', () => {
  let service: TeamCreditService;
  let prisma: any;
  let txErrors: unknown[];

  beforeEach(async () => {
    txErrors = [];
    prisma = {
      teamBalance: { findUnique: vi.fn(), updateMany: vi.fn() },
      teamMember: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      teamCreditTransaction: { create: vi.fn(), createMany: vi.fn() },
      generationIntent: { updateMany: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
        try {
          return await fn(prisma);
        } catch (e) {
          txErrors.push(e); // 真实 $transaction 此处即回滚——throw 本身就是回滚语义
          throw e;
        }
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TeamCreditService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<TeamCreditService>(TeamCreditService);
  });

  it('① 配额复验失败：tx 内 throw 整体回滚——余额不变+零流水，返回 QUOTA_EXCEEDED', async () => {
    prisma.teamBalance.findUnique
      .mockResolvedValueOnce(balance(100, 0)) // 预检
      .mockResolvedValueOnce(balance(100, 0)) // 乐观循环重读
      .mockResolvedValue(balance(90, 0));     // 扣后读（本路径不可达——复验已 throw）
    prisma.teamBalance.updateMany.mockResolvedValue({ count: 1 }); // 余额扣减成功
    prisma.teamMember.findUnique.mockResolvedValue(member(200, 25));
    prisma.teamMember.updateMany.mockResolvedValue({ count: 0 }); // 配额复验失败（并发超限）

    const result = await service.consume('t1', 'u1', 10, 'ref-1');

    expect(result).toEqual({ success: false, reason: 'QUOTA_EXCEEDED' });
    expect(txErrors).toHaveLength(1); // 现状 return 前余额已扣无补偿——必 throw 才有回滚
    expect(prisma.teamCreditTransaction.createMany).not.toHaveBeenCalled();
    expect(prisma.teamCreditTransaction.create).not.toHaveBeenCalled();
  });

  it('② 正常成功：扣减+两行记账同一 tx（$transaction 透传上下文，显式超时参数）', async () => {
    prisma.teamBalance.findUnique
      .mockResolvedValueOnce(balance(100, 30))
      .mockResolvedValueOnce(balance(100, 30))
      .mockResolvedValue(balance(70, 10));
    prisma.teamBalance.updateMany.mockResolvedValue({ count: 1 });
    prisma.teamMember.findUnique.mockResolvedValue(member(200, 25));
    prisma.teamMember.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.consume('t1', 'u1', 50, 'ref-1');

    expect(result).toEqual({ success: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // 交互式事务默认 5s——乐观锁重试争用下会假失败，显式拉长
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({ timeout: 10_000, maxWait: 5_000 });
    expect(prisma.teamBalance.updateMany).toHaveBeenCalledWith({
      where: { teamId: 't1', version: 0 },
      data: {
        version: { increment: 1 },
        subscriptionCredits: { decrement: 30 },
        credits: { decrement: 20 },
      },
    });
    expect(prisma.teamCreditTransaction.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.teamCreditTransaction.createMany).toHaveBeenCalledWith({
      data: [
        {
          teamId: 't1', operatorUserId: 'u1', amount: -30, type: 'consumption',
          creditType: 'subscription', referenceId: 'ref-1', balanceAfter: 10,
        },
        {
          teamId: 't1', operatorUserId: 'u1', amount: -20, type: 'consumption',
          creditType: 'regular', referenceId: 'ref-1', balanceAfter: 70,
        },
      ],
    });
  });

  it('③ CAS 扣费门 count===0：已扣过——不扣余额零流水，返回 alreadyCharged 续产物', async () => {
    prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });
    prisma.teamBalance.findUnique.mockResolvedValue(balance(100, 30));
    prisma.teamMember.findUnique.mockResolvedValue(member(200, 25));

    const result = await service.consume('t1', 'u1', 50, 'node:n1', {
      intentRowId: 'row-1',
      intentId: 'it-1',
    });

    expect(result).toEqual({ success: true, alreadyCharged: true });
    expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
      where: { id: 'row-1', creditsConsumed: 0 },
      data: { creditsConsumed: 50 },
    });
    expect(prisma.teamBalance.updateMany).not.toHaveBeenCalled();
    expect(prisma.teamMember.updateMany).not.toHaveBeenCalled();
    expect(prisma.teamCreditTransaction.createMany).not.toHaveBeenCalled();
    expect(txErrors).toHaveLength(0);
  });

  it('④ CAS 扣费门 count===1：正常扣费，流水 referenceId = `intent:${intentId}`（intent: 维度）', async () => {
    prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });
    prisma.teamBalance.findUnique
      .mockResolvedValueOnce(balance(100, 30))
      .mockResolvedValueOnce(balance(100, 30))
      .mockResolvedValue(balance(70, 10));
    prisma.teamBalance.updateMany.mockResolvedValue({ count: 1 });
    prisma.teamMember.findUnique.mockResolvedValue(member(200, 25));
    prisma.teamMember.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.consume('t1', 'u1', 50, 'node:n1', {
      intentRowId: 'row-9',
      intentId: 'it-abc',
    });

    expect(result).toEqual({ success: true });
    expect(prisma.teamBalance.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.teamCreditTransaction.createMany).toHaveBeenCalledTimes(1);
    const rows = prisma.teamCreditTransaction.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.referenceId).toBe('intent:it-abc');
  });
});
