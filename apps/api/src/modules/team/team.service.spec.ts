import { Test, TestingModule } from '@nestjs/testing';
import { TeamService } from './team.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('TeamService.ensureDefaultTeam', () => {
  let service: TeamService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      team: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      teamMember: { create: vi.fn() },
      teamBalance: { create: vi.fn() },
      teamCreditTransaction: { create: vi.fn() },
      $transaction: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TeamService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<TeamService>(TeamService);
  });

  it('无团队：事务内建 Team(ACTIVE)+OWNER 成员+Balance(credits=100)+register_grant 流水', async () => {
    prisma.team.create.mockResolvedValue({ id: 't1', name: '张三的团队', ownerId: 'u1' });
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));

    const result = await service.ensureDefaultTeam('u1', '张三');

    expect(prisma.team.create).toHaveBeenCalledWith({
      data: { name: '张三的团队', ownerId: 'u1', status: 'ACTIVE' },
    });
    expect(prisma.teamMember.create).toHaveBeenCalledWith({
      data: { teamId: 't1', userId: 'u1', role: 'OWNER' },
    });
    expect(prisma.teamBalance.create).toHaveBeenCalledWith({
      data: { teamId: 't1', credits: 100 },
    });
    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith({
      data: {
        teamId: 't1',
        operatorUserId: 'u1',
        amount: 100,
        type: 'register_grant',
        creditType: 'regular',
        balanceAfter: 100,
      },
    });
    expect(result).toEqual({ id: 't1', name: '张三的团队', ownerId: 'u1' });
  });

  it('已有团队：no-op 直接返回，不建任何行', async () => {
    prisma.team.findFirst.mockResolvedValue({ id: 't1', name: '已有' });

    const result = await service.ensureDefaultTeam('u1', '张三');

    expect(result).toEqual({ id: 't1', name: '已有' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.team.create).not.toHaveBeenCalled();
  });

  it('任意时机可补建（I4 兜底）：注册钩子失败/历史用户后续调用同逻辑，首次建完后再次调用 no-op', async () => {
    prisma.team.create.mockResolvedValue({ id: 't1' });
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));

    await service.ensureDefaultTeam('u1', '张三');
    prisma.team.findFirst.mockResolvedValue({ id: 't1' });
    await service.ensureDefaultTeam('u1', '张三');

    expect(prisma.team.create).toHaveBeenCalledTimes(1);
  });
});
