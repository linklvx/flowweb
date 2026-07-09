import { Test, TestingModule } from '@nestjs/testing';
import { CreditService } from './credit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('CreditService', () => {
  let service: CreditService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      userBalance: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [CreditService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<CreditService>(CreditService);
  });

  it('should get balance for existing user', async () => {
    prisma.userBalance.findUnique.mockResolvedValue({ userId: 'u1', credits: 85, version: 3 });
    const result = await service.getBalance('u1');
    expect(result!.credits).toBe(85);
  });

  it('should create default balance for new user', async () => {
    prisma.userBalance.findUnique.mockResolvedValue(null);
    prisma.userBalance.upsert.mockResolvedValue({ userId: 'u1', credits: 100, version: 0 });
    const result = await service.getOrCreateBalance('u1');
    expect(result.credits).toBe(100);
    expect(prisma.userBalance.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', credits: 100 },
      update: {},
    });
  });

  it('should deduct credits with optimistic locking — success', async () => {
    prisma.userBalance.findUnique.mockResolvedValue({ userId: 'u1', credits: 100, version: 2 });
    prisma.userBalance.updateMany.mockResolvedValue({ count: 1 });
    const result = await service.deduct('u1', 5);
    expect(result.success).toBe(true);
    expect(result.newBalance).toBeDefined();
    expect(prisma.userBalance.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', version: 2 },
      data: { credits: { decrement: 5 }, version: { increment: 1 } },
    });
  });

  it('should return success=false on version mismatch (concurrent)', async () => {
    prisma.userBalance.findUnique.mockResolvedValue({ userId: 'u1', credits: 100, version: 2 });
    prisma.userBalance.updateMany.mockResolvedValue({ count: 0 });
    const result = await service.deduct('u1', 5);
    expect(result.success).toBe(false);
  });

  it('should return success=false when balance not found', async () => {
    prisma.userBalance.findUnique.mockResolvedValue(null);
    const result = await service.deduct('u1', 5);
    expect(result.success).toBe(false);
  });

  it('should return success=false when insufficient balance', async () => {
    prisma.userBalance.findUnique.mockResolvedValue({ userId: 'u1', credits: 3, version: 1 });
    const result = await service.deduct('u1', 5);
    expect(result.success).toBe(false);
    // updateMany should NOT be called
    expect(prisma.userBalance.updateMany).not.toHaveBeenCalled();
  });
});

// ========== Dual-account: consume & deductRegular ==========

describe('CreditService - consume (business consumption, subscription-first)', () => {
  let service: CreditService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      userBalance: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        updateMany: vi.fn(),
      },
      userSubscription: {
        updateMany: vi.fn(),
      },
      creditTransaction: {
        create: vi.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [CreditService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<CreditService>(CreditService);
  });

  it('should deduct from subscription credits when sufficient', async () => {
    prisma.userBalance.findUnique.mockResolvedValue({
      userId: 'u1', credits: 100, subscriptionCredits: 500, subscriptionCreditsExpiry: new Date(), version: 2,
    });
    prisma.userBalance.updateMany.mockResolvedValue({ count: 1 });
    prisma.userSubscription.updateMany.mockResolvedValue({ count: 1 });

    await service.consume('u1', 50, 'exec-1');

    expect(prisma.userBalance.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', version: 2 },
      data: expect.objectContaining({
        subscriptionCredits: { decrement: 50 },
        version: { increment: 1 },
      }),
    });
    // consumedCredits should be updated
    expect(prisma.userSubscription.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', status: 'active' },
      data: { consumedCredits: { increment: 50 } },
    });
    // CreditTransaction written for subscription deduction
    expect(prisma.creditTransaction.create).toHaveBeenCalled();
  });

  it('should fall back to regular credits when subscription insufficient', async () => {
    prisma.userBalance.findUnique
      .mockResolvedValueOnce({
        userId: 'u1', credits: 100, subscriptionCredits: 20, subscriptionCreditsExpiry: new Date(), version: 1,
      })
      .mockResolvedValueOnce({
        userId: 'u1', credits: 70, subscriptionCredits: 0, subscriptionCreditsExpiry: new Date(), version: 1,
      });
    prisma.userBalance.updateMany.mockResolvedValue({ count: 1 });
    prisma.userSubscription.updateMany.mockResolvedValue({ count: 1 });

    await service.consume('u1', 50, 'exec-2');

    // Should deduct 20 from subscription + 30 from regular
    expect(prisma.userBalance.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', version: 1 },
      data: expect.objectContaining({
        subscriptionCredits: { decrement: 20 },
        credits: { decrement: 30 },
        version: { increment: 1 },
      }),
    });
    // consumedCredits should only include subscription portion (20), not regular (30)
    expect(prisma.userSubscription.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', status: 'active' },
      data: { consumedCredits: { increment: 20 } },
    });
  });

  it('should deduct only from regular when no subscription credits', async () => {
    prisma.userBalance.findUnique.mockResolvedValue({
      userId: 'u1', credits: 100, subscriptionCredits: 0, subscriptionCreditsExpiry: null, version: 1,
    });
    prisma.userBalance.updateMany.mockResolvedValue({ count: 1 });

    await service.consume('u1', 30, 'exec-3');

    expect(prisma.userBalance.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', version: 1 },
      data: expect.objectContaining({
        credits: { decrement: 30 },
        version: { increment: 1 },
      }),
    });
    // No subscription deduction → no consumedCredits update
    expect(prisma.userSubscription.updateMany).not.toHaveBeenCalled();
  });

  it('should throw when total balance insufficient', async () => {
    prisma.userBalance.findUnique.mockResolvedValue({
      userId: 'u1', credits: 10, subscriptionCredits: 5, subscriptionCreditsExpiry: new Date(), version: 1,
    });

    await expect(service.consume('u1', 100, 'exec-4')).rejects.toThrow();
    expect(prisma.userBalance.updateMany).not.toHaveBeenCalled();
  });

  it('should retry on version conflict (optimistic lock)', async () => {
    prisma.userBalance.findUnique
      .mockResolvedValueOnce({ userId: 'u1', credits: 100, subscriptionCredits: 500, subscriptionCreditsExpiry: new Date(), version: 2 })
      .mockResolvedValueOnce({ userId: 'u1', credits: 100, subscriptionCredits: 450, subscriptionCreditsExpiry: new Date(), version: 3 })
      .mockResolvedValueOnce({ userId: 'u1', credits: 100, subscriptionCredits: 400, subscriptionCreditsExpiry: new Date(), version: 3 });
    prisma.userBalance.updateMany
      .mockResolvedValueOnce({ count: 0 }) // version conflict
      .mockResolvedValueOnce({ count: 1 }); // success on retry
    prisma.userSubscription.updateMany.mockResolvedValue({ count: 1 });

    await service.consume('u1', 50, 'exec-5');

    expect(prisma.userBalance.updateMany).toHaveBeenCalledTimes(2);
    // Second call should use updated version
    expect(prisma.userBalance.updateMany.mock.calls[1][0].where.version).toBe(3);
  });

  it('should not retry on business errors (insufficient balance)', async () => {
    prisma.userBalance.findUnique.mockResolvedValue({
      userId: 'u1', credits: 0, subscriptionCredits: 0, subscriptionCreditsExpiry: null, version: 1,
    });

    await expect(service.consume('u1', 50, 'exec-6')).rejects.toThrow();
    expect(prisma.userBalance.updateMany).not.toHaveBeenCalled();
    expect(prisma.userBalance.findUnique).toHaveBeenCalledTimes(1); // no retry
  });
});

describe('CreditService - deductRegular (payment only, regular credits)', () => {
  let service: CreditService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      userBalance: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        updateMany: vi.fn(),
      },
      userSubscription: {
        updateMany: vi.fn(),
      },
      creditTransaction: {
        create: vi.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [CreditService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<CreditService>(CreditService);
  });

  it('should deduct from regular credits only', async () => {
    prisma.userBalance.findUnique.mockResolvedValue({
      userId: 'u1', credits: 200, subscriptionCredits: 500, subscriptionCreditsExpiry: new Date(), version: 1,
    });
    prisma.userBalance.updateMany.mockResolvedValue({ count: 1 });

    await service.deductRegular('u1', 100, 'order-1');

    expect(prisma.userBalance.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', version: 1, credits: { gte: 100 } },
      data: { credits: { decrement: 100 }, version: { increment: 1 } },
    });
    // Should NOT touch subscription credits or consumedCredits
    expect(prisma.userSubscription.updateMany).not.toHaveBeenCalled();
    // CreditTransaction written
    expect(prisma.creditTransaction.create).toHaveBeenCalled();
  });

  it('should throw when regular credits insufficient', async () => {
    prisma.userBalance.findUnique.mockResolvedValue({
      userId: 'u1', credits: 50, subscriptionCredits: 500, subscriptionCreditsExpiry: new Date(), version: 1,
    });

    await expect(service.deductRegular('u1', 100, 'order-2')).rejects.toThrow();
    expect(prisma.userBalance.updateMany).not.toHaveBeenCalled();
  });
});
