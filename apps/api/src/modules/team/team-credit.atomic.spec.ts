import { Test, TestingModule } from '@nestjs/testing';
import { TeamCreditService } from './team-credit.service';
import { CreditLedgerService } from './credit-ledger.service';
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

/** 批0.5-9 reserve→settle 两阶段扣费 + Y0b-1（Z10/Z13/Z35）台账化重写——
 *  金额单源 intent 行（creditCost）；锁序①lockBalance 先于 intent 写（Z13 单元锚）；
 *  台账写全经 ledger.mutate（真值表两列）；mayCall:false=重复外呼企图（Z35 调用方静默退出）。
 *  装置：$transaction mock 透传 tx=prisma；ledger 为 mock（lockBalance/mutate 记调用）。 */
describe('TeamCreditService reserve/settle/void_ 两阶段（批0.5-9+Y0b-1）', () => {
  let service: TeamCreditService;
  let prisma: any;
  let ledger: any;
  let txErrors: unknown[];

  beforeEach(async () => {
    txErrors = [];
    prisma = {
      teamBalance: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn() },
      teamMember: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      teamCreditTransaction: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      generationIntent: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
        try {
          return await fn(prisma);
        } catch (e) {
          txErrors.push(e);
          throw e;
        }
      }),
    };
    ledger = {
      tx: (raw: any) => raw,
      lockBalance: vi.fn().mockResolvedValue(undefined),
      ensureBalance: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn().mockResolvedValue({ rowId: 'lr-1', balanceAfter: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamCreditService,
        { provide: PrismaService, useValue: prisma },
        { provide: CreditLedgerService, useValue: ledger },
      ],
    }).compile();

    service = module.get<TeamCreditService>(TeamCreditService);
  });

  describe('reserve（外呼前冻结——余额不足在此失败；金额单源 intent 行 Z10）', () => {
    it('r1 余额不足 → success:false CREDIT_INSUFFICIENT——gate 零置位零冻结零流水（外呼前即拒）', async () => {
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue({ id: 'row-1', teamId: 't1', creditCost: 50 });
      prisma.teamBalance.findUnique.mockResolvedValue(balance(5, 0));
      prisma.teamMember.findUnique.mockResolvedValue(member(200, 0));

      const result = await service.reserve('u1', { intentRowId: 'row-1' });

      expect(result).toEqual({ success: false, reason: 'CREDIT_INSUFFICIENT' });
      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalled();
      expect(ledger.mutate).not.toHaveBeenCalled();
    });

    it('r2 成功：锁序①lockBalance 先于 gate CAS（Z13 单元锚）+ 置位 reservedCredits 0→creditCost + 两池拆分经 mutate（F1 锚 intentRowId）', async () => {
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue({ id: 'row-1', teamId: 't1', creditCost: 50 });
      prisma.teamBalance.findUnique.mockResolvedValue(balance(100, 30));
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });
      prisma.teamMember.findUnique.mockResolvedValue(member(200, 25));

      const result = await service.reserve('u1', { intentRowId: 'row-1' });

      expect(result).toEqual({ success: true, mayCall: true });
      // Z13 单元锚：lockBalance 调用序先于 gate CAS
      expect(ledger.lockBalance.mock.invocationCallOrder[0])
        .toBeLessThan(prisma.generationIntent.updateMany.mock.invocationCallOrder[0]);
      // 约束①锚：CAS 置位 reservedCredits——creditsConsumed:0 并守已 settle 行
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'row-1', reservedCredits: 0, creditsConsumed: 0 },
        data: { reservedCredits: 50 },
      });
      // 两池拆分：subscription 30 + regular 20（真值表 reserve(−c,+c)）
      expect(ledger.mutate).toHaveBeenCalledTimes(2);
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
        teamId: 't1', operatorUserId: 'u1', type: 'reserve', creditType: 'subscription',
        balanceDelta: -30, frozenDelta: 30, referenceId: 'intent:row-1',
      });
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
        teamId: 't1', operatorUserId: 'u1', type: 'reserve', creditType: 'regular',
        balanceDelta: -20, frozenDelta: 20, referenceId: 'intent:row-1',
      });
      // Y0b-2 T0：monthlyUsed CAS 退役——quota 判定改读台账派生（$queryRaw），无列写点
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.teamMember.updateMany).not.toHaveBeenCalled();
    });

    it('r3 约束① stalled 同 job 重入：CAS count===0 且行已冻结 → success+alreadyReserved+mayCall:false（Z35——禁再外呼）', async () => {
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue({ id: 'row-1', teamId: 't1', creditCost: 50 });
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });
      prisma.generationIntent.findUnique.mockResolvedValue({ reservedCredits: 50, creditsConsumed: 0 });
      prisma.teamBalance.findUnique.mockResolvedValue(balance(100, 30));
      prisma.teamMember.findUnique.mockResolvedValue(member(200, 25));

      const result = await service.reserve('u1', { intentRowId: 'row-1' });

      expect(result).toEqual({ success: true, alreadyReserved: true, mayCall: false });
      expect(ledger.mutate).not.toHaveBeenCalled();
    });

    it('r3b CAS count===0 且行已结算（creditsConsumed>0）→ success+alreadyReserved+mayCall:false（settle 后不重冻结）', async () => {
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue({ id: 'row-1', teamId: 't1', creditCost: 50 });
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });
      prisma.generationIntent.findUnique.mockResolvedValue({ reservedCredits: 0, creditsConsumed: 50 });
      prisma.teamBalance.findUnique.mockResolvedValue(balance(100, 30));
      prisma.teamMember.findUnique.mockResolvedValue(member(200, 25));

      const result = await service.reserve('u1', { intentRowId: 'row-1' });

      expect(result).toEqual({ success: true, alreadyReserved: true, mayCall: false });
      expect(ledger.mutate).not.toHaveBeenCalled();
    });

    it('r4 CAS count===0 且行归零态（无冻结无结算）→ success:false（门丢失——void 后行不得白嫖外呼）', async () => {
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue({ id: 'row-1', teamId: 't1', creditCost: 50 });
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });
      prisma.generationIntent.findUnique.mockResolvedValue({ reservedCredits: 0, creditsConsumed: 0 });
      prisma.teamBalance.findUnique.mockResolvedValue(balance(100, 30));
      prisma.teamMember.findUnique.mockResolvedValue(member(200, 25));

      const result = await service.reserve('u1', { intentRowId: 'row-1' });

      expect(result).toEqual({ success: false, reason: 'RESERVE_GATE_LOST' });
      expect(ledger.mutate).not.toHaveBeenCalled();
    });

    it('r5 零额免费（creditCost===0）：member 检查后合法放行 mayCall:true——零冻结零 gate 零流水（E1/A2）', async () => {
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue({ id: 'row-1', teamId: 't1', creditCost: 0 });
      prisma.teamBalance.findUnique.mockResolvedValue(balance(100, 30));
      prisma.teamMember.findUnique.mockResolvedValue(member(200, 25));

      const result = await service.reserve('u1', { intentRowId: 'row-1' });

      expect(result).toEqual({ success: true, mayCall: true });
      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalled();
      expect(ledger.mutate).not.toHaveBeenCalled();
    });

    it('r6 非成员 → success:false NOT_MEMBER（零额前置于 member 检查之后——防非成员免费外呼）', async () => {
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue({ id: 'row-1', teamId: 't1', creditCost: 0 });
      prisma.teamBalance.findUnique.mockResolvedValue(balance(100, 30));
      prisma.teamMember.findUnique.mockResolvedValue(null);

      const result = await service.reserve('u1', { intentRowId: 'row-1' });

      expect(result).toEqual({ success: false, reason: 'NOT_MEMBER' });
    });
  });

  describe('settle（外呼成功后核销——冻结转实扣；台账锚 intentRowId+anti-join）', () => {
    const subReserveRow = { id: 'lr-sub', teamId: 't1', amount: -30, type: 'reserve', creditType: 'subscription', referenceId: 'intent:row-1' };
    const regReserveRow = { id: 'lr-reg', teamId: 't1', amount: -20, type: 'reserve', creditType: 'regular', referenceId: 'intent:row-1' };

    it('s1 成功：锁序①+reservedCredits 清零+creditsConsumed 置位+anti-join 行逐条 settle mutate（reversesId 配对）', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue({ id: 'row-1', teamId: 't1', reservedCredits: 50, creditsConsumed: 0, userId: 'u1' });
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });
      prisma.$queryRaw.mockResolvedValue([subReserveRow, regReserveRow]);

      const result = await service.settle({ intentRowId: 'row-1' });

      expect(result).toEqual({ success: true, settled: true });
      // Z13 单元锚：lockBalance 先于 intent CAS
      expect(ledger.lockBalance.mock.invocationCallOrder[0])
        .toBeLessThan(prisma.generationIntent.updateMany.mock.invocationCallOrder[0]);
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'row-1', reservedCredits: 50 },
        data: { reservedCredits: 0, creditsConsumed: 50 },
      });
      expect(ledger.mutate).toHaveBeenCalledTimes(2);
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
        teamId: 't1', operatorUserId: 'u1', type: 'settle', creditType: 'subscription',
        balanceDelta: 0, frozenDelta: -30, referenceId: 'intent:row-1', reversesId: 'lr-sub',
      });
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
        teamId: 't1', operatorUserId: 'u1', type: 'settle', creditType: 'regular',
        balanceDelta: 0, frozenDelta: -20, referenceId: 'intent:row-1', reversesId: 'lr-reg',
      });
    });

    it('s2 CAS 后崩溃修补：reservedCredits===0∧creditsConsumed>0 且 anti-join 有未冲销行 → 补写 settle（reversesId 唯一幂等）', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue({ id: 'row-1', teamId: 't1', reservedCredits: 0, creditsConsumed: 50, userId: 'u1' });
      prisma.$queryRaw.mockResolvedValue([subReserveRow]);

      const result = await service.settle({ intentRowId: 'row-1' });

      expect(result).toEqual({ success: true, settled: true });
      expect(ledger.mutate).toHaveBeenCalledTimes(1);
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
        teamId: 't1', operatorUserId: 'u1', type: 'settle', creditType: 'subscription',
        balanceDelta: 0, frozenDelta: -30, referenceId: 'intent:row-1', reversesId: 'lr-sub',
      });
    });

    it('s2b CAS 后已结清（anti-join 空）→ settled:false 零动作（正常早退）', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue({ id: 'row-1', teamId: 't1', reservedCredits: 0, creditsConsumed: 50, userId: 'u1' });
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.settle({ intentRowId: 'row-1' });

      expect(result).toEqual({ success: true, settled: false });
      expect(ledger.mutate).not.toHaveBeenCalled();
      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalled();
    });

    it('s3 防御：reservedCredits===0 且 creditsConsumed===0（无冻结——正常链路 reserve 先行）→ success:false settled:false', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue({ id: 'row-1', teamId: 't1', reservedCredits: 0, creditsConsumed: 0, userId: 'u1' });

      const result = await service.settle({ intentRowId: 'row-1' });

      expect(result).toEqual({ success: false, settled: false });
      expect(ledger.mutate).not.toHaveBeenCalled();
    });
  });

  describe('void_（解冻——外呼失败/组执行第 N+1 放弃；Z6 正名 release 冲销）', () => {
    const subReserveRow = { id: 'lr-sub', teamId: 't1', amount: -30, type: 'reserve', creditType: 'subscription', referenceId: 'intent:row-1' };
    const regReserveRow = { id: 'lr-reg', teamId: 't1', amount: -20, type: 'reserve', creditType: 'regular', referenceId: 'intent:row-1' };

    it('v1 成功：锁序①+CAS reservedCredits>0→0+release 冲销（真值表 (+c,−c)+reversesId）——Y0b-2 T0：monthlyUsed 已派生无列回滚写点', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue({ id: 'row-1', teamId: 't1', userId: 'u1', reservedCredits: 50, creditsConsumed: 0 });
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });
      prisma.$queryRaw.mockResolvedValue([subReserveRow, regReserveRow]);

      await service.void_({ intentRowId: 'row-1' });

      // Z13 单元锚：lockBalance 先于 intent CAS
      expect(ledger.lockBalance.mock.invocationCallOrder[0])
        .toBeLessThan(prisma.generationIntent.updateMany.mock.invocationCallOrder[0]);
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'row-1', reservedCredits: { gt: 0 } },
        data: { reservedCredits: 0 },
      });
      expect(ledger.mutate).toHaveBeenCalledTimes(2);
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
        teamId: 't1', operatorUserId: 'u1', type: 'release', creditType: 'subscription',
        balanceDelta: 30, frozenDelta: -30, referenceId: 'intent:row-1', reversesId: 'lr-sub',
      });
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
        teamId: 't1', operatorUserId: 'u1', type: 'release', creditType: 'regular',
        balanceDelta: 20, frozenDelta: -20, referenceId: 'intent:row-1', reversesId: 'lr-reg',
      });
      // Y0b-2 T0：monthlyUsed 已派生——release 落行 frozen 腿自然回落，无列回滚写点
      expect(prisma.teamMember.updateMany).not.toHaveBeenCalled();
    });

    it('v2 幂等：无冻结（CAS count===0，已解冻/已结算）→ 零钱动零流水', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue({ id: 'row-1', teamId: 't1', userId: 'u1', reservedCredits: 0, creditsConsumed: 0 });
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });

      await service.void_({ intentRowId: 'row-1' });

      expect(ledger.mutate).not.toHaveBeenCalled();
      expect(prisma.teamMember.updateMany).not.toHaveBeenCalled();
    });
  });
});
