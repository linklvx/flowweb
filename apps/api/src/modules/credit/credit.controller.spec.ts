import { Test, TestingModule } from '@nestjs/testing';
import { CreditController } from './credit.controller';
import { CreditService } from './credit.service';
import { UnauthorizedException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('CreditController', () => {
  let controller: CreditController;
  let service: {
    getOrCreateBalance: ReturnType<typeof vi.fn>;
    getBalance: ReturnType<typeof vi.fn>;
    deduct: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      getOrCreateBalance: vi.fn().mockResolvedValue({
        userId: 'u1',
        credits: 100,
        subscriptionCredits: 0,
        subscriptionCreditsExpiry: null,
        version: 0,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      getBalance: vi.fn(),
      deduct: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CreditController],
      providers: [{ provide: CreditService, useValue: service }],
    }).compile();

    controller = module.get<CreditController>(CreditController);
  });

  it('should return balance for authenticated user via req.user.id', async () => {
    service.getOrCreateBalance.mockResolvedValue({
      userId: 'u1',
      credits: 100,
      subscriptionCredits: 500,
      subscriptionCreditsExpiry: new Date('2026-02-01T00:00:00.000Z'),
      version: 0,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const req = { user: { id: 'u1' } };
    const result = await controller.getBalance(req as any);
    expect(result).toEqual({
      credits: 100,
      subscriptionCredits: 500,
      subscriptionCreditsExpiry: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(service.getOrCreateBalance).toHaveBeenCalledWith('u1');
  });

  it('should throw UnauthorizedException when req.user is missing', async () => {
    const req = {} as any;
    await expect(controller.getBalance(req)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when req.user.id is missing', async () => {
    const req = { user: {} } as any;
    await expect(controller.getBalance(req)).rejects.toThrow(UnauthorizedException);
  });
});
