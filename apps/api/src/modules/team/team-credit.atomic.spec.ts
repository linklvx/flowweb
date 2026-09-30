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

/** 批0.5-9 reserve→settle 两阶段扣费（spec F1 落地后首个 P1）——消灭两个沉没成本面：
 *  ①余额不足在外呼之后才发现（白付外呼）→ reserve 前置，不足即拒=零外呼；
 *  ②组执行前 N 已扣、第 N+1 不足整批 return → 每节点独立 reserve/settle。
 *  记账法：reserve=扣余额+type=reserve 流水（amount 负）；settle=补 settle 正账流水+意图行迁移；
 *  void=反向加回+反向 reserve 流水（约束②：非 refund 补记）。
 *  装置同款：$transaction mock 透传 tx=prisma。 */
describe('TeamCreditService reserve/settle/void_ 两阶段（批0.5-9）', () => {
  let service: TeamCreditService;
  let prisma: any;
  let txErrors: unknown[];

  beforeEach(async () => {
    txErrors = [];
    prisma = {
      teamBalance: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn() },
      teamMember: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      teamCreditTransaction: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      generationIntent: { findUnique: vi.fn(), updateMany: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
        try {
          return await fn(prisma);
        } catch (e) {
          txErrors.push(e);
          throw e;
        }
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TeamCreditService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<TeamCreditService>(TeamCreditService);
  });

  describe('reserve（外呼前冻结——余额不足在此失败）', () => {
    it('r1 余额不足 → success:false CREDIT_INSUFFICIENT——CAS 零置位零扣减零流水（外呼前即拒）', async () => {
      prisma.teamBalance.findUnique.mockResolvedValue(balance(5, 0));
      prisma.teamMember.findUnique.mockResolvedValue(member(200, 0));

      const result = await service.reserve('t1', 'u1', 50, { intentRowId: 'row-1', intentId: 'it-1' });

      expect(result).toEqual({ success: false, reason: 'CREDIT_INSUFFICIENT' });
      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalled();
      expect(prisma.teamBalance.updateMany).not.toHaveBeenCalled();
      expect(prisma.teamCreditTransaction.createMany).not.toHaveBeenCalled();
    });

    it('r2 成功：事务内置位 reservedCredits 0→amount（约束① CAS 锚）+ 两池扣减 + type=reserve 流水（amount 负）', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });
      prisma.teamBalance.findUnique
        .mockResolvedValueOnce(balance(100, 30)) // 预检
        .mockResolvedValueOnce(balance(100, 30)) // 乐观循环重读
        .mockResolvedValue(balance(70, 10));     // 扣后读
      prisma.teamBalance.updateMany.mockResolvedValue({ count: 1 });
      prisma.teamMember.findUnique.mockResolvedValue(member(200, 25));
      prisma.teamMember.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.reserve('t1', 'u1', 50, { intentRowId: 'row-1', intentId: 'it-1' });

      expect(result).toEqual({ success: true });
      // 约束①锚：CAS 置位 reservedCredits（非 PENDING 状态、非 creditsConsumed）——creditsConsumed:0 并守已 settle 行
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'row-1', reservedCredits: 0, creditsConsumed: 0 },
        data: { reservedCredits: 50 },
      });
      expect(prisma.teamBalance.updateMany).toHaveBeenCalledWith({
        where: { teamId: 't1', version: 0 },
        data: { version: { increment: 1 }, subscriptionCredits: { decrement: 30 }, credits: { decrement: 20 } },
      });
      expect(prisma.teamCreditTransaction.createMany).toHaveBeenCalledWith({
        data: [
          {
            teamId: 't1', operatorUserId: 'u1', amount: -30, type: 'reserve',
            creditType: 'subscription', referenceId: 'intent:it-1', balanceAfter: 10,
          },
          {
            teamId: 't1', operatorUserId: 'u1', amount: -20, type: 'reserve',
            creditType: 'regular', referenceId: 'intent:it-1', balanceAfter: 70,
          },
        ],
      });
    });

    it('r3 约束① stalled 同 job 重入：CAS count===0 且行已冻结（reservedCredits>0）→ success:true alreadyReserved 零扣减零流水（双冻结被拒）', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });
      prisma.generationIntent.findUnique.mockResolvedValue({ reservedCredits: 50, creditsConsumed: 0 });
      prisma.teamBalance.findUnique.mockResolvedValue(balance(100, 30));
      prisma.teamMember.findUnique.mockResolvedValue(member(200, 25));

      const result = await service.reserve('t1', 'u1', 50, { intentRowId: 'row-1', intentId: 'it-1' });

      expect(result).toEqual({ success: true, alreadyReserved: true });
      expect(prisma.teamBalance.updateMany).not.toHaveBeenCalled();
      expect(prisma.teamCreditTransaction.createMany).not.toHaveBeenCalled();
    });

    it('r3b CAS count===0 且行已结算（creditsConsumed>0）→ success:true alreadyReserved（settle 后不重冻结）', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });
      prisma.generationIntent.findUnique.mockResolvedValue({ reservedCredits: 0, creditsConsumed: 50 });
      prisma.teamBalance.findUnique.mockResolvedValue(balance(100, 30));
      prisma.teamMember.findUnique.mockResolvedValue(member(200, 25));

      const result = await service.reserve('t1', 'u1', 50, { intentRowId: 'row-1', intentId: 'it-1' });

      expect(result).toEqual({ success: true, alreadyReserved: true });
      expect(prisma.teamBalance.updateMany).not.toHaveBeenCalled();
    });

    it('r4 CAS count===0 且行归零态（无冻结无结算）→ success:false（门丢失——void 后行不得白嫖外呼）', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });
      prisma.generationIntent.findUnique.mockResolvedValue({ reservedCredits: 0, creditsConsumed: 0 });
      prisma.teamBalance.findUnique.mockResolvedValue(balance(100, 30));
      prisma.teamMember.findUnique.mockResolvedValue(member(200, 25));

      const result = await service.reserve('t1', 'u1', 50, { intentRowId: 'row-1', intentId: 'it-1' });

      expect(result).toEqual({ success: false, reason: 'RESERVE_GATE_LOST' });
      expect(prisma.teamBalance.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('settle（外呼成功后核销——冻结转实扣）', () => {
    const subReserveRow = { teamId: 't1', amount: -30, type: 'reserve', creditType: 'subscription', referenceId: 'intent:it-1' };
    const regReserveRow = { teamId: 't1', amount: -20, type: 'reserve', creditType: 'regular', referenceId: 'intent:it-1' };

    it('s1 成功：reservedCredits 清零+creditsConsumed 置位+镜像 reserve 行拆分的 settle 流水', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue({ id: 'row-1', reservedCredits: 50, creditsConsumed: 0, userId: 'u1' });
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });
      prisma.teamCreditTransaction.findMany.mockResolvedValue([subReserveRow, regReserveRow]);
      prisma.teamBalance.findUnique.mockResolvedValue({ credits: 70, subscriptionCredits: 10 });

      const result = await service.settle({ intentRowId: 'row-1', intentId: 'it-1' });

      expect(result).toEqual({ success: true, settled: true });
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'row-1', reservedCredits: 50 },
        data: { reservedCredits: 0, creditsConsumed: 50 },
      });
      const settleRows = prisma.teamCreditTransaction.create.mock.calls.map((c: any[]) => c[0].data);
      expect(settleRows).toHaveLength(2);
      expect(settleRows).toContainEqual(expect.objectContaining({
        teamId: 't1', operatorUserId: 'u1', amount: -30, type: 'settle', creditType: 'subscription', balanceAfter: 10,
      }));
      expect(settleRows).toContainEqual(expect.objectContaining({
        teamId: 't1', operatorUserId: 'u1', amount: -20, type: 'settle', creditType: 'regular', balanceAfter: 70,
      }));
    });

    it('s2 幂等：reservedCredits===0 且 creditsConsumed>0 ⇒ 已 settle → settled:false 零行写零流水（stalled 重入只结一次）', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue({ id: 'row-1', reservedCredits: 0, creditsConsumed: 50, userId: 'u1' });

      const result = await service.settle({ intentRowId: 'row-1', intentId: 'it-1' });

      expect(result).toEqual({ success: true, settled: false });
      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalled();
      expect(prisma.teamCreditTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('void_（解冻——外呼失败/组执行第 N+1 放弃）', () => {
    const subReserveRow = { teamId: 't1', amount: -30, type: 'reserve', creditType: 'subscription', referenceId: 'intent:it-1' };
    const regReserveRow = { teamId: 't1', amount: -20, type: 'reserve', creditType: 'regular', referenceId: 'intent:it-1' };

    it('v1 成功：reservedCredits 清零+两池加回+反向 reserve 流水（约束②：type=reserve 非 refund）+monthlyUsed 回滚', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue({ id: 'row-1', intentId: 'it-1', userId: 'u1', reservedCredits: 50, creditsConsumed: 0 });
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });
      prisma.teamCreditTransaction.findMany.mockResolvedValue([subReserveRow, regReserveRow]);
      prisma.teamBalance.findUnique.mockResolvedValue({ credits: 80, subscriptionCredits: 40 });

      await service.void_({ intentRowId: 'row-1', intentId: 'it-1' });

      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'row-1', reservedCredits: { gt: 0 } },
        data: { reservedCredits: 0 },
      });
      expect(prisma.teamBalance.update).toHaveBeenCalledWith({ where: { teamId: 't1' }, data: { subscriptionCredits: { increment: 30 } } });
      expect(prisma.teamBalance.update).toHaveBeenCalledWith({ where: { teamId: 't1' }, data: { credits: { increment: 20 } } });
      const reverseRows = prisma.teamCreditTransaction.create.mock.calls.map((c: any[]) => c[0].data);
      expect(reverseRows).toHaveLength(2);
      for (const r of reverseRows) {
        expect(r.type).toBe('reserve'); // 约束②锚：反向 reserve 流水——不得 refund 正向记账
        expect(r.amount).toBeGreaterThan(0);
        expect(r.referenceId).toBe('intent:it-1');
      }
      expect(reverseRows).toContainEqual(expect.objectContaining({ amount: 30, creditType: 'subscription', balanceAfter: 40 }));
      expect(reverseRows).toContainEqual(expect.objectContaining({ amount: 20, creditType: 'regular', balanceAfter: 80 }));
      expect(prisma.teamMember.updateMany).toHaveBeenCalledWith({
        where: { teamId: 't1', userId: 'u1', monthlyPeriod: period() },
        data: { monthlyUsed: { decrement: 50 } },
      });
    });

    it('v2 幂等：无冻结（CAS count===0，已解冻/已结算）→ 零钱动零流水', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue({ id: 'row-1', intentId: 'it-1', userId: 'u1', reservedCredits: 0, creditsConsumed: 0 });
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });

      await service.void_({ intentRowId: 'row-1', intentId: 'it-1' });

      expect(prisma.teamBalance.update).not.toHaveBeenCalled();
      expect(prisma.teamCreditTransaction.create).not.toHaveBeenCalled();
      expect(prisma.teamMember.updateMany).not.toHaveBeenCalled();
    });
  });
});
