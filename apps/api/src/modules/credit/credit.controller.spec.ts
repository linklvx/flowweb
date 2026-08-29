import { Test, TestingModule } from '@nestjs/testing';
import { CreditController } from './credit.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('CreditController getBalance', () => {
  let controller: CreditController;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      team: { findFirst: vi.fn() },
      teamBalance: { findUnique: vi.fn() },
      userSubscription: { findFirst: vi.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CreditController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    }).compile();

    controller = module.get<CreditController>(CreditController);
  });

  it('换源默认团队 TeamBalance，返回结构含 subscriptionCreditsExpiry（现读 active 订阅）', async () => {
    prisma.team.findFirst.mockResolvedValue({ id: 't-team' });
    prisma.teamBalance.findUnique.mockResolvedValue({
      credits: 100,
      subscriptionCredits: 500,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    prisma.userSubscription.findFirst.mockResolvedValue({
      currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
    });

    const result = await controller.getBalance({ user: { id: 'u1' } } as any);

    expect(prisma.team.findFirst).toHaveBeenCalledWith({ where: { ownerId: 'u1', isDefault: true } });
    expect(prisma.teamBalance.findUnique).toHaveBeenCalledWith({ where: { teamId: 't-team' } });
    expect(result).toEqual({
      credits: 100,
      subscriptionCredits: 500,
      total: 600,
      subscriptionCreditsExpiry: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('无 active 订阅时 subscriptionCreditsExpiry 为 null', async () => {
    prisma.team.findFirst.mockResolvedValue({ id: 't-team' });
    prisma.teamBalance.findUnique.mockResolvedValue({
      credits: 10,
      subscriptionCredits: 0,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    prisma.userSubscription.findFirst.mockResolvedValue(null);

    const result = await controller.getBalance({ user: { id: 'u1' } } as any);

    expect(result.subscriptionCreditsExpiry).toBeNull();
  });

  it('无个人团队抛 BadRequest（个人团队未初始化）', async () => {
    prisma.team.findFirst.mockResolvedValue(null);
    await expect(controller.getBalance({ user: { id: 'u1' } } as any)).rejects.toThrow(BadRequestException);
    await expect(controller.getBalance({ user: { id: 'u1' } } as any)).rejects.toThrow('个人团队未初始化');
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
