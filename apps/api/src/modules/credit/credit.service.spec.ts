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
