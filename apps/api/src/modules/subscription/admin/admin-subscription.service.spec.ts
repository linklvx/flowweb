import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminSubscriptionService } from './admin-subscription.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreditLedgerService } from '../../team/credit-ledger.service';

describe('AdminSubscriptionService（手工积分调整 → 默认团队账本，经 CreditLedgerService 唯一写入口）', () => {
  let service: AdminSubscriptionService;
  let prisma: any;
  let ledger: any;

  beforeEach(() => {
    ledger = {
      ledgerTx: async (raw: any) => raw,   // Y0b-2 Z89：tx() 已删——mock 同步换 ledgerTx（通行证装饰 mock 为直通）
      lockBalance: vi.fn().mockResolvedValue(undefined),
      ensureBalance: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn().mockResolvedValue({ rowId: 'lr-1', balanceAfter: 0 }),
    };
    prisma = {
      userSubscription: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
      team: { findFirst: vi.fn().mockResolvedValue({ id: 't-default', isDefault: true }) },
      teamBalance: { findUniqueOrThrow: vi.fn() },
      teamCreditTransaction: { findFirst: vi.fn().mockResolvedValue(null) },   // T8 幂等前置查——默认 miss
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(),
    };
    prisma.teamBalance.findUniqueOrThrow.mockResolvedValue({ credits: 0, subscriptionCredits: 0 });   // T8 回读两池默认档（cancel/grant 各用例自行覆写）
    service = new AdminSubscriptionService(prisma as unknown as PrismaService, ledger as unknown as CreditLedgerService);
  });

  describe('cancelSubscription', () => {
    it('作废：订阅置 expired + 清默认团队实时剩余（admin_clear mutate，Z9 分键 s1:clear）', async () => {
      prisma.userSubscription.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', status: 'active' });
      prisma.teamBalance.findUniqueOrThrow.mockResolvedValue({ teamId: 't-default', credits: 100, subscriptionCredits: 30 });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));

      await service.cancelSubscription('s1');

      expect(prisma.userSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 's1' },
        data: { status: 'expired' },
      }));
      // Y0b-1 Z23：懒创建收敛 ensureBalance；Z13 锁经 lockBalance
      expect(ledger.ensureBalance).toHaveBeenCalledWith(expect.anything(), 't-default');
      expect(ledger.lockBalance).toHaveBeenCalledWith(expect.anything(), 't-default');
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
        teamId: 't-default', operatorUserId: 'u1', type: 'admin_clear',
        creditType: 'subscription', balanceDelta: -30, frozenDelta: 0, referenceId: 's1:clear',
      });
    });

    it('剩余为 0 不写清零流水（无空流水），credits 池不动', async () => {
      prisma.userSubscription.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', status: 'active' });
      prisma.teamBalance.findUniqueOrThrow.mockResolvedValue({ teamId: 't-default', credits: 100, subscriptionCredits: 0 });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));

      await service.cancelSubscription('s1');

      expect(ledger.mutate).not.toHaveBeenCalled();
    });
  });

  describe('listSubscriptions', () => {
    it('items[].plan.storageLimitBytes 转 number，可 JSON 序列化', async () => {
      prisma.userSubscription.findMany.mockResolvedValue([
        { id: 's1', userId: 'u1', tier: 'pro', status: 'active', createdAt: new Date('2026-09-01'), plan: { id: 'p2', tier: 'pro', storageLimitBytes: 107374182400n } },
      ]);
      prisma.userSubscription.count.mockResolvedValue(1);

      const result = await service.listSubscriptions({});

      expect(result.items[0].plan.storageLimitBytes).toBe(107374182400);
      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });

  describe('grantCredit', () => {
    it('订阅池加正数：admin_grant mutate（ensureBalance+lockBalance 前置；referenceId=userId）', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue({ id: 's1', userId: 'u1', status: 'active' });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));

      await service.grantCredit('u1', 50, 'subscription');

      expect(ledger.ensureBalance).toHaveBeenCalledWith(expect.anything(), 't-default');
      expect(ledger.lockBalance).toHaveBeenCalledWith(expect.anything(), 't-default');
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
        teamId: 't-default', operatorUserId: 'u1', type: 'admin_grant',
        creditType: 'subscription', balanceDelta: 50, frozenDelta: 0, referenceId: 'u1',
        idempotencyKey: null,   // T8（Z100 同列）：无 key=合法重复操作面，行落 null
      });
    });

    it('订阅池扣负数：admin_clear mutate（amount=负调整量）', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue({ id: 's1', userId: 'u1', status: 'active' });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));

      await service.grantCredit('u1', -20, 'subscription');

      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
        teamId: 't-default', operatorUserId: 'u1', type: 'admin_clear',
        creditType: 'subscription', balanceDelta: -20, frozenDelta: 0, referenceId: 'u1',
        idempotencyKey: null,
      });
    });

    it('regular 池：admin_grant mutate（credits 增量）', async () => {
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));

      await service.grantCredit('u1', 30, 'regular');

      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
        teamId: 't-default', operatorUserId: 'u1', type: 'admin_grant',
        creditType: 'regular', balanceDelta: 30, frozenDelta: 0, referenceId: 'u1',
        idempotencyKey: null,
      });
    });

    it('订阅池发放需有 active 订阅，否则拒绝', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(null);
      await expect(service.grantCredit('u1', 50, 'subscription')).rejects.toThrow();
      expect(ledger.mutate).not.toHaveBeenCalled();
    });
  });

  describe('grantCredit Idempotency-Key（T8/Z113——unit 面；并发同键/advisory 真库锚在 admin-idempotency.int）', () => {
    beforeEach(() => {
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
      prisma.teamBalance.findUniqueOrThrow.mockResolvedValue({ credits: 15, subscriptionCredits: 0 });
    });

    it('带 key miss：先取 advisory 事务锁（pg_advisory_xact_lock hashtext("admin:"+key)）再 mutate 落 key', async () => {
      await service.grantCredit('u1', 10, 'regular', { idempotencyKey: 'k1', operatorUserId: 'admin-a' });
      expect(prisma.$executeRaw).toHaveBeenCalled();   // advisory 锁（tagged template——真库形态 int 锚）
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        idempotencyKey: 'k1', operatorUserId: 'admin-a',
      }));
    });

    it('带 key 命中+指纹一致 → replayed:true+transactionId 原值+当前两池（不回历史 balanceAfter）', async () => {
      prisma.teamCreditTransaction.findFirst.mockResolvedValue({
        id: 'tx-1', type: 'admin_grant', creditType: 'regular', balanceDelta: 10, operatorUserId: 'admin-a',
      });
      const r = await service.grantCredit('u1', 10, 'regular', { idempotencyKey: 'k1', operatorUserId: 'admin-a' });
      expect(r).toEqual({ replayed: true, transactionId: 'tx-1', credits: 15, subscriptionCredits: 0 });
      expect(ledger.mutate).not.toHaveBeenCalled();
    });

    it('带 key 命中+指纹不一致（amount/操作员）→ 409 IDEMPOTENCY_KEY_REUSED', async () => {
      prisma.teamCreditTransaction.findFirst.mockResolvedValue({
        id: 'tx-1', type: 'admin_grant', creditType: 'regular', balanceDelta: 10, operatorUserId: 'admin-a',
      });
      const err = await service.grantCredit('u1', 20, 'regular', { idempotencyKey: 'k1', operatorUserId: 'admin-a' }).catch((e: unknown) => e);
      expect(err).toMatchObject({ errorCode: 'IDEMPOTENCY_KEY_REUSED' });
      expect((err as any).getStatus()).toBe(409);
      await expect(service.grantCredit('u1', 10, 'regular', { idempotencyKey: 'k1', operatorUserId: 'admin-b' }))
        .rejects.toMatchObject({ errorCode: 'IDEMPOTENCY_KEY_REUSED' });
      expect(ledger.mutate).not.toHaveBeenCalled();
    });
  });
});
