import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TeamService } from './team.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { DEFAULT_FOLDER_NAMES } from '../material-library/constants/material-library.constants';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('TeamService.ensureDefaultTeam', () => {
  let service: TeamService;
  let prisma: any;
  let emitter: any;
  let queue: any;
  const audit = { log: vi.fn(), logTx: vi.fn() };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: vi.fn() },
      team: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 't1', name: '张三的团队', ownerId: 'u1', isDefault: true }),
      },
      teamMember: { create: vi.fn() },
      teamBalance: { create: vi.fn() },
      teamCreditTransaction: { create: vi.fn() },
      materialFolder: { createMany: vi.fn().mockResolvedValue({ count: 5 }) },
      $transaction: vi.fn(async (fn: any) => fn(prisma)),
    };
    emitter = { emitAsync: vi.fn() };
    queue = { add: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: emitter },
        { provide: getQueueToken('team-media-cleanup'), useValue: queue },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<TeamService>(TeamService);
  });

  it('无个人团队：事务内建 Team(isDefault)+OWNER 成员+Balance(100)+register_grant 流水+默认文件夹', async () => {
    const result = await service.ensureDefaultTeam('u1', '张三');

    expect(prisma.team.findFirst).toHaveBeenCalledWith({ where: { ownerId: 'u1', isDefault: true } });
    expect(prisma.team.create).toHaveBeenCalledWith({
      data: { name: '张三的团队', ownerId: 'u1', status: 'ACTIVE', isDefault: true },
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
    expect(prisma.materialFolder.createMany).toHaveBeenCalled();
    expect(result).toEqual({ id: 't1', name: '张三的团队', ownerId: 'u1', isDefault: true });
  });

  it('userName 未传时查 user.name 兜底', async () => {
    prisma.user.findUnique.mockResolvedValue({ name: '李四' });
    prisma.team.create.mockResolvedValue({ id: 't1', name: '李四的团队' });

    await service.ensureDefaultTeam('u1');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { name: true } });
    expect(prisma.team.create).toHaveBeenCalledWith({
      data: { name: '李四的团队', ownerId: 'u1', status: 'ACTIVE', isDefault: true },
    });
  });

  it('已有个人团队（ownerId+isDefault 命中）：no-op 直接返回，不建任何行', async () => {
    prisma.team.findFirst.mockResolvedValue({ id: 't1', name: '已有', isDefault: true });

    const result = await service.ensureDefaultTeam('u1', '张三');

    expect(result).toEqual({ id: 't1', name: '已有', isDefault: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.team.create).not.toHaveBeenCalled();
  });

  it('任意时机可补建（I4 兜底）：首次建完后再次调用 no-op', async () => {
    await service.ensureDefaultTeam('u1', '张三');
    prisma.team.findFirst.mockResolvedValue({ id: 't1', isDefault: true });
    await service.ensureDefaultTeam('u1', '张三');

    expect(prisma.team.create).toHaveBeenCalledTimes(1);
  });

  it('仅以 ADMIN 成员身份存在（转让后）——个人团队与成员身份解耦，仍补建个人团队', async () => {
    prisma.team.create.mockResolvedValue({ id: 't-new', name: '某用户的团队', isDefault: true });

    const team = await service.ensureDefaultTeam('u1', '某用户');

    expect(team).toMatchObject({ id: 't-new' });
    expect(prisma.team.create).toHaveBeenCalledTimes(1);
    expect(prisma.teamBalance.create).toHaveBeenCalledTimes(1);
    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledTimes(1);
  });
});

describe('TeamService 基础 API', () => {
  let service: TeamService;
  let prisma: any;
  let emitter: any;
  let queue: any;
  const audit = { log: vi.fn(), logTx: vi.fn() };

  beforeEach(async () => {
    prisma = {};
    emitter = { emitAsync: vi.fn().mockResolvedValue([]) };
    queue = { add: vi.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: emitter },
        { provide: getQueueToken('team-media-cleanup'), useValue: queue },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<TeamService>(TeamService);
  });

  describe('getMyTeams', () => {
    it('返回所在团队（role/成员数/余额/active 订阅摘要；含 isDefault/isOwner/createdAt）', async () => {
      prisma.teamMember = {
        findMany: vi.fn().mockResolvedValue([
          {
            role: 'OWNER',
            team: {
              id: 't1', name: '团队A', status: 'ACTIVE', ownerId: 'u1', isDefault: false,
              createdAt: new Date('2026-01-01'),
              _count: { members: 3 },
              balance: { credits: 100, subscriptionCredits: 50 },
              subscriptions: [{ status: 'active', currentPeriodEnd: new Date('2026-09-27'), plan: { name: '专业版' } }],
            },
          },
          {
            role: 'MEMBER',
            team: {
              id: 't2', name: '团队B', status: 'ACTIVE', ownerId: 'x', isDefault: false,
              createdAt: new Date('2026-02-01'),
              _count: { members: 1 },
              balance: { credits: 0, subscriptionCredits: 0 },
              subscriptions: [],
            },
          },
        ]),
      };

      const result = await service.getMyTeams('u1');

      expect(prisma.teamMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'u1' },
      }));
      expect(result).toEqual([
        {
          id: 't1', name: '团队A', role: 'OWNER', status: 'ACTIVE', isDefault: false, isOwner: true, memberCount: 3,
          createdAt: new Date('2026-01-01'),
          balance: { credits: 100, subscriptionCredits: 50 },
          subscription: { planName: '专业版', status: 'active', currentPeriodEnd: new Date('2026-09-27') },
        },
        {
          id: 't2', name: '团队B', role: 'MEMBER', status: 'ACTIVE', isDefault: false, isOwner: false, memberCount: 1,
          createdAt: new Date('2026-02-01'),
          balance: { credits: 0, subscriptionCredits: 0 },
          subscription: null,
        },
      ]);
    });
  });

  describe('getMyTeams（个人项目化）', () => {
    it('返回 isDefault/isOwner，默认团队排第一，默认团队订阅来自 UserSubscription', async () => {
      // mock findMany 返回两个成员关系：普通团队（member）+ 默认团队（owner）——故意乱序
      prisma.teamMember = {
        findMany: vi.fn().mockResolvedValue([
          {
            role: 'MEMBER',
            team: {
              id: 't-team', name: '梦幻团队', ownerId: 'someone-else', isDefault: false,
              balance: { credits: 5, subscriptionCredits: 0 },
              subscriptions: [{ plan: { name: '团队月卡' }, status: 'active', currentPeriodEnd: new Date('2026-09-30') }],
              _count: { members: 3 },
            },
          },
          {
            role: 'OWNER',
            team: {
              id: 't-default', name: 'Alice的团队', ownerId: 'u1', isDefault: true,
              balance: { credits: 100, subscriptionCredits: 50 },
              subscriptions: [],
              _count: { members: 1 },
            },
          },
        ]),
      };
      prisma.userSubscription = {
        findFirst: vi.fn().mockResolvedValue({
          plan: { tier: 'pro' }, status: 'active', currentPeriodEnd: new Date('2026-09-15'),
        }),
      };

      const result = await service.getMyTeams('u1');

      expect(result[0]).toMatchObject({ id: 't-default', isDefault: true, isOwner: true });
      expect(result[0].subscription!).toMatchObject({ planName: 'pro', status: 'active' });
      expect(result[1]).toMatchObject({ id: 't-team', isDefault: false, isOwner: false });
      expect(result[1].subscription!.planName).toBe('团队月卡');
    });

    it('非默认团队排序：我创建的（OWNER）优先于我加入的（MEMBER），同级按创建时间升序', async () => {
      prisma.teamMember = {
        findMany: vi.fn().mockResolvedValue([
          { role: 'MEMBER', team: { id: 't-join-old', ownerId: 'x', isDefault: false, createdAt: new Date('2026-01-01'), balance: null, subscriptions: [], _count: { members: 2 } } },
          { role: 'OWNER', team: { id: 't-mine-new', ownerId: 'u1', isDefault: false, createdAt: new Date('2026-06-01'), balance: null, subscriptions: [], _count: { members: 1 } } },
          { role: 'OWNER', team: { id: 't-mine-old', ownerId: 'u1', isDefault: false, createdAt: new Date('2026-03-01'), balance: null, subscriptions: [], _count: { members: 1 } } },
        ]),
      };

      const result = await service.getMyTeams('u1');

      expect(result.map((t: any) => t.id)).toEqual(['t-mine-old', 't-mine-new', 't-join-old']);
    });
  });

  describe('createTeam', () => {
    const setup = () => {
      prisma.user = { findUnique: vi.fn().mockResolvedValue({ name: '张三' }) };
      prisma.team = { create: vi.fn().mockResolvedValue({ id: 't1' }) };
      prisma.teamMember = { create: vi.fn() };
      prisma.teamBalance = { create: vi.fn() };
      prisma.teamCreditTransaction = { create: vi.fn() };
      prisma.materialFolder = { createMany: vi.fn().mockResolvedValue({ count: 5 }) };
      prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
    };

    it('主动建团：credits=0、无 register_grant 流水、创建者 OWNER、默认素材文件夹与个人项目一致', async () => {
      setup();

      const team = await service.createTeam('u1', '新团队');

      expect(prisma.team.create).toHaveBeenCalledWith({
        data: { name: '新团队', ownerId: 'u1', status: 'ACTIVE' },
      });
      expect(prisma.teamMember.create).toHaveBeenCalledWith({
        data: { teamId: 't1', userId: 'u1', role: 'OWNER' },
      });
      expect(prisma.teamBalance.create).toHaveBeenCalledWith({
        data: { teamId: 't1', credits: 0, subscriptionCredits: 0 },
      });
      expect(prisma.materialFolder.createMany).toHaveBeenCalledWith({
        data: DEFAULT_FOLDER_NAMES.map((name, i) => ({
          name, teamId: 't1', userId: 'u1', isDefault: true, sortOrder: i,
        })),
      });
      expect(prisma.teamCreditTransaction.create).not.toHaveBeenCalled();
      expect(team).toEqual({ id: 't1' });
      expect(audit.logTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        operatorId: 'u1', teamId: 't1', targetType: 'TEAM', targetId: 't1', action: 'create_team',
      }));
    });

    it('空名兜底为创建者名+的团队', async () => {
      setup();

      await service.createTeam('u1', '   ');

      expect(prisma.team.create).toHaveBeenCalledWith({
        data: { name: '张三的团队', ownerId: 'u1', status: 'ACTIVE' },
      });
    });
  });

  describe('renameTeam', () => {
    it('OWNER/ADMIN 可改名', async () => {
      prisma.teamMember = { findUnique: vi.fn().mockResolvedValue({ role: 'ADMIN' }) };
      prisma.team = { findUnique: vi.fn().mockResolvedValue({ id: 't1', status: 'ACTIVE' }), update: vi.fn().mockResolvedValue({ id: 't1', name: '新名' }) };

      await service.renameTeam('t1', 'u1', '新名');

      expect(prisma.team.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { name: '新名' } });
    });

    it('MEMBER 拒绝', async () => {
      prisma.team = { findUnique: vi.fn().mockResolvedValue(null) };
      prisma.teamMember = { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER' }) };
      await expect(service.renameTeam('t1', 'u1', 'x')).rejects.toThrow(ForbiddenException);
    });

    it('DISBANDED 拒绝', async () => {
      prisma.teamMember = { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) };
      prisma.team = { findUnique: vi.fn().mockResolvedValue({ status: 'DISBANDED' }) };
      await expect(service.renameTeam('t1', 'u1', 'x')).rejects.toThrow(BadRequestException);
    });
  });

  describe('disbandTeam（M2 时序）', () => {
    const setup = (opts: { role?: string; teamCount?: number; status?: string } = {}) => {
      prisma.teamMember = {
        findUnique: vi.fn().mockResolvedValue({ role: opts.role ?? 'OWNER' }),
        count: vi.fn().mockResolvedValue(opts.teamCount ?? 2),
      };
      prisma.team = {
        findUnique: vi.fn().mockResolvedValue({ id: 't1', status: opts.status ?? 'ACTIVE' }),
        update: vi.fn(),
        delete: vi.fn(),
      };
      prisma.user = { findUnique: vi.fn().mockResolvedValue({ name: '张三' }) };
      prisma.canvasProject = { findMany: vi.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]) };
      prisma.media = { findMany: vi.fn().mockResolvedValue([{ id: 'm1', bucket: 'flowai', key: 'k1' }]) };
      prisma.teamRechargeOrder = { updateMany: vi.fn() };
      prisma.teamCreditTransaction = { updateMany: vi.fn() };
      prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
    };

    it('时序：事务置 DISBANDED+查 projectIds/media → emitAsync 携带 payload → 物理删除+凭证置空', async () => {
      setup();

      await service.disbandTeam('t1', 'u1');

      // 阶段1：事务内置 DISBANDED + 删前查 projectIds/media
      expect(prisma.team.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { status: 'DISBANDED' } });
      expect(prisma.canvasProject.findMany).toHaveBeenCalledWith({ where: { teamId: 't1' }, select: { id: true } });
      expect(prisma.media.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { teamId: 't1' } }));
      // 阶段2：emitAsync（等监听器，payload 含 projectIds）
      expect(emitter.emitAsync).toHaveBeenCalledWith('team.disbanded', { teamId: 't1', projectIds: ['p1', 'p2'] });
      // MinIO 异步清理 job（processor Task 17）
      expect(queue.add).toHaveBeenCalledWith('team-media-cleanup', { medias: [{ id: 'm1', bucket: 'flowai', key: 'k1' }] });
      // 阶段3：凭证 SetNull 保留 + team 物理删（级联 member/request/balance/subscription/projects/media/CanvasDoc）
      expect(prisma.teamRechargeOrder.updateMany).toHaveBeenCalledWith({ where: { teamId: 't1' }, data: { teamId: null } });
      expect(prisma.teamCreditTransaction.updateMany).toHaveBeenCalledWith({ where: { teamId: 't1' }, data: { teamId: null } });
      expect(prisma.team.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
      // emitAsync 必须在物理删除之前完成
      const emitOrder = emitter.emitAsync.mock.invocationCallOrder[0];
      expect(prisma.team.delete.mock.invocationCallOrder[0]).toBeGreaterThan(emitOrder);
      // 审计在物理删除之后落库
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        teamId: 't1', targetType: 'TEAM', targetId: 't1', action: 'disband_team',
      }));
      expect(audit.log.mock.invocationCallOrder[0]).toBeGreaterThan(prisma.team.delete.mock.invocationCallOrder[0]);
    });

    it('非 OWNER 拒绝', async () => {
      setup({ role: 'ADMIN' });
      await expect(service.disbandTeam('t1', 'u1')).rejects.toThrow(ForbiddenException);
    });

    it('唯一团队禁令：仅 1 个团队时抛 BadRequest', async () => {
      setup({ teamCount: 1 });
      await expect(service.disbandTeam('t1', 'u1')).rejects.toThrow('不能解散唯一团队');
    });

    it('已 DISBANDED 拒绝重复解散', async () => {
      setup({ status: 'DISBANDED' });
      await expect(service.disbandTeam('t1', 'u1')).rejects.toThrow(BadRequestException);
    });
  });
});

describe('TeamService 成员管理', () => {
  let service: TeamService;
  let prisma: any;
  let emitter: any;
  let queue: any;
  const audit = { log: vi.fn(), logTx: vi.fn() };

  beforeEach(async () => {
    prisma = {};
    emitter = { emitAsync: vi.fn().mockResolvedValue([]) };
    queue = { add: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: emitter },
        { provide: getQueueToken('team-media-cleanup'), useValue: queue },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<TeamService>(TeamService);
  });

  describe('listMembers', () => {
    it('分页返回 {items,total}，item 含 user 摘要/role/quota/used', async () => {
      const row = {
        id: 'm1', role: 'MEMBER', monthlyQuota: 100, monthlyUsed: 30,
        user: { id: 'u2', name: '张三', email: 'z@x.com' },
      };
      prisma.teamMember = {
        findMany: vi.fn().mockResolvedValue([row]),
        count: vi.fn().mockResolvedValue(1),
      };

      const result = await service.listMembers('t1', 1, 20);

      expect(prisma.teamMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { teamId: 't1' },
        skip: 0,
        take: 20,
      }));
      expect(result).toEqual({
        items: [{ id: 'm1', role: 'MEMBER', monthlyQuota: 100, monthlyUsed: 30, user: { id: 'u2', name: '张三', email: 'z@x.com' } }],
        total: 1,
      });
    });
  });

  describe('changeRole', () => {
    const setup = (callerRole: string, targetRole: string) => {
      prisma.user = { findUnique: vi.fn().mockResolvedValue({ name: '操作者' }) };
      prisma.team = { findUnique: vi.fn().mockResolvedValue(null) };
      prisma.teamMember = {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ userId: 'caller', role: callerRole })
          .mockResolvedValueOnce({ userId: 'target', role: targetRole }),
        update: vi.fn(),
      };
    };

    it('OWNER 可改 MEMBER→ADMIN', async () => {
      setup('OWNER', 'MEMBER');
      await service.changeRole('t1', 'caller', 'target', 'ADMIN');
      expect(prisma.teamMember.update).toHaveBeenCalledWith({
        where: { teamId_userId: { teamId: 't1', userId: 'target' } },
        data: { role: 'ADMIN' },
      });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        operatorId: 'caller', teamId: 't1', targetType: 'TEAM_MEMBER', targetId: 'target',
        action: 'change_role', beforeValue: { role: 'MEMBER' }, afterValue: { role: 'ADMIN' },
      }));
    });

    it('非 OWNER 拒绝', async () => {
      setup('ADMIN', 'MEMBER');
      await expect(service.changeRole('t1', 'caller', 'target', 'ADMIN')).rejects.toThrow(ForbiddenException);
    });

    it('不能改 OWNER 的角色', async () => {
      setup('OWNER', 'OWNER');
      await expect(service.changeRole('t1', 'caller', 'target', 'ADMIN')).rejects.toThrow(BadRequestException);
    });

    it('changeRole：传 OWNER 被拒', async () => {
      setup('OWNER', 'MEMBER');
      await expect(
        service.changeRole('t1', 'caller', 'target', 'OWNER' as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.teamMember.update).not.toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    const setup = (callerRole: string, targetRole: string) => {
      prisma.user = { findUnique: vi.fn().mockResolvedValue({ name: '操作者' }) };
      prisma.team = { findUnique: vi.fn().mockResolvedValue(null) };
      prisma.teamMember = {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ userId: 'caller', role: callerRole })
          .mockResolvedValueOnce({ userId: 'target', role: targetRole }),
        delete: vi.fn(),
      };
    };

    it('OWNER/ADMIN 可移除 MEMBER', async () => {
      setup('ADMIN', 'MEMBER');
      await service.removeMember('t1', 'caller', 'target');
      expect(prisma.teamMember.delete).toHaveBeenCalledWith({
        where: { teamId_userId: { teamId: 't1', userId: 'target' } },
      });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        operatorId: 'caller', teamId: 't1', targetType: 'TEAM_MEMBER', targetId: 'target', action: 'remove_member',
      }));
    });

    it('OWNER 不可被移除', async () => {
      setup('OWNER', 'OWNER');
      await expect(service.removeMember('t1', 'caller', 'target')).rejects.toThrow(BadRequestException);
    });

    it('MEMBER 无权移除', async () => {
      setup('MEMBER', 'MEMBER');
      await expect(service.removeMember('t1', 'caller', 'target')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('setQuota', () => {
    it('OWNER/ADMIN 设置 monthlyQuota≥0', async () => {
      prisma.user = { findUnique: vi.fn().mockResolvedValue({ name: '操作者' }) };
      prisma.team = { findUnique: vi.fn().mockResolvedValue(null) };
      prisma.teamMember = {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ role: 'ADMIN' })
          .mockResolvedValueOnce({ role: 'MEMBER', monthlyQuota: 100 }),
        update: vi.fn(),
      };
      await service.setQuota('t1', 'caller', 'target', 50);
      expect(prisma.teamMember.update).toHaveBeenCalledWith({
        where: { teamId_userId: { teamId: 't1', userId: 'target' } },
        data: { monthlyQuota: 50 },
      });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        teamId: 't1', targetType: 'TEAM_MEMBER', targetId: 'target',
        action: 'adjust_quota', beforeValue: { monthlyQuota: 100 }, afterValue: { monthlyQuota: 50 },
      }));
    });

    it('负数拒绝', async () => {
      prisma.team = { findUnique: vi.fn().mockResolvedValue(null) };
      prisma.teamMember = { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) };
      await expect(service.setQuota('t1', 'caller', 'target', -1)).rejects.toThrow(BadRequestException);
    });

    it('MEMBER 拒绝', async () => {
      prisma.team = { findUnique: vi.fn().mockResolvedValue(null) };
      prisma.teamMember = { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER' }) };
      await expect(service.setQuota('t1', 'caller', 'target', 50)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('transferOwnership', () => {
    it('事务内三写：原 OWNER→ADMIN / 目标→OWNER / Team.ownerId 同步 + logTx 审计', async () => {
      prisma.user = { findUnique: vi.fn().mockResolvedValue({ name: '老主人' }) };
      prisma.team = { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() };
      prisma.teamMember = {
        findUnique: vi.fn().mockImplementation(({ where }: any) => {
          const k = where.teamId_userId;
          if (k.userId === 'owner1') return { role: 'OWNER' };
          if (k.userId === 'u2') return { role: 'MEMBER' };
          return null;
        }),
        update: vi.fn(),
      };
      prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));

      await service.transferOwnership('t1', 'owner1', 'u2');

      expect(prisma.teamMember.update).toHaveBeenCalledWith({
        where: { teamId_userId: { teamId: 't1', userId: 'owner1' } },
        data: { role: 'ADMIN' },
      });
      expect(prisma.teamMember.update).toHaveBeenCalledWith({
        where: { teamId_userId: { teamId: 't1', userId: 'u2' } },
        data: { role: 'OWNER' },
      });
      expect(prisma.team.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { ownerId: 'u2' },
      });
      expect(audit.logTx).toHaveBeenCalledWith(prisma, expect.objectContaining({
        operatorId: 'owner1', operatorName: '老主人', teamId: 't1',
        targetType: 'TEAM_MEMBER', targetId: 'u2', action: 'transfer_ownership',
      }));
    });

    it('非 OWNER 拒绝 / 目标非成员拒绝 / 转让给自己拒绝', async () => {
      prisma.team = { findUnique: vi.fn().mockResolvedValue(null) };
      prisma.teamMember = { findUnique: vi.fn().mockResolvedValue({ role: 'ADMIN' }) };
      await expect(service.transferOwnership('t1', 'a1', 'u2')).rejects.toThrow('仅 OWNER');

      prisma.teamMember.findUnique.mockImplementation(({ where }: any) =>
        where.teamId_userId.userId === 'owner1' ? { role: 'OWNER' } : null);
      await expect(service.transferOwnership('t1', 'owner1', 'ghost')).rejects.toThrow('团队成员');
      await expect(service.transferOwnership('t1', 'owner1', 'owner1')).rejects.toThrow('自己');
    });
  });
});

describe('TeamService 加入申请', () => {
  let service: TeamService;
  let prisma: any;
  let emitter: any;
  let queue: any;
  const audit = { log: vi.fn(), logTx: vi.fn() };

  beforeEach(async () => {
    prisma = {};
    emitter = { emitAsync: vi.fn().mockResolvedValue([]) };
    queue = { add: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: emitter },
        { provide: getQueueToken('team-media-cleanup'), useValue: queue },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<TeamService>(TeamService);
  });

  describe('apply', () => {
    it('团队 ACTIVE 且需审批：建 PENDING 申请', async () => {
      prisma.team = { findUnique: vi.fn().mockResolvedValue({ id: 't1', status: 'ACTIVE', joinApproval: true }) };
      prisma.teamMember = { findUnique: vi.fn().mockResolvedValue(null) };
      prisma.teamJoinRequest = {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'r1', status: 'PENDING' }),
      };

      const result = await service.apply('t1', 'u2', '想加入');

      expect(prisma.teamJoinRequest.create).toHaveBeenCalledWith({
        data: { teamId: 't1', userId: 'u2', status: 'PENDING', message: '想加入' },
      });
      expect(result).toEqual({ id: 'r1', status: 'PENDING' });
    });

    it('DISBANDED 团队拒绝申请', async () => {
      prisma.team = { findUnique: vi.fn().mockResolvedValue({ status: 'DISBANDED' }) };
      await expect(service.apply('t1', 'u2')).rejects.toThrow(BadRequestException);
    });

    it('已有 PENDING 申请拒绝重复提交', async () => {
      prisma.team = { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE', joinApproval: true }) };
      prisma.teamMember = { findUnique: vi.fn().mockResolvedValue(null) };
      prisma.teamJoinRequest = { findFirst: vi.fn().mockResolvedValue({ id: 'r0' }) };
      await expect(service.apply('t1', 'u2')).rejects.toThrow('已有待处理的申请');
    });

    it('已是成员拒绝', async () => {
      prisma.team = { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE', joinApproval: true }) };
      prisma.teamMember = { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER' }) };
      await expect(service.apply('t1', 'u2')).rejects.toThrow(BadRequestException);
    });

    it('免审批开关关闭：直接入团 MEMBER', async () => {
      prisma.team = { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE', joinApproval: false }) };
      prisma.teamMember = {
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(3),
        create: vi.fn().mockResolvedValue({ id: 'm2', role: 'MEMBER' }),
      };
      prisma.teamSubscription = { findFirst: vi.fn().mockResolvedValue(null) };
      prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));

      const result = await service.apply('t1', 'u2');

      expect(prisma.teamMember.create).toHaveBeenCalledWith({
        data: { teamId: 't1', userId: 'u2', role: 'MEMBER' },
      });
      expect(result).toMatchObject({ role: 'MEMBER' });
    });
  });

  describe('approve', () => {
    const setup = (opts: { callerRole?: string; memberCount?: number; planSeatLimit?: number } = {}) => {
      prisma.user = { findUnique: vi.fn().mockResolvedValue({ name: '审批人' }) };
      prisma.team = { findUnique: vi.fn().mockResolvedValue(null) };
      prisma.teamMember = {
        findUnique: vi.fn().mockResolvedValue({ role: opts.callerRole ?? 'OWNER' }),
        count: vi.fn().mockResolvedValue(opts.memberCount ?? 3),
        create: vi.fn().mockResolvedValue({ id: 'm9' }),
      };
      prisma.teamJoinRequest = {
        findUnique: vi.fn().mockResolvedValue({ id: 'r1', teamId: 't1', userId: 'u2', status: 'PENDING' }),
        update: vi.fn(),
      };
      prisma.teamSubscription = {
        findFirst: vi.fn().mockResolvedValue(opts.planSeatLimit ? { plan: { seatLimit: opts.planSeatLimit } } : null),
      };
      prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
    };

    it('OWNER/ADMIN 批准：事务内建 MEMBER + 置 APPROVED + logTx 审计', async () => {
      setup();
      await service.approve('t1', 'caller', 'r1');
      expect(prisma.teamMember.create).toHaveBeenCalledWith({
        data: { teamId: 't1', userId: 'u2', role: 'MEMBER' },
      });
      expect(prisma.teamJoinRequest.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { status: 'APPROVED', decidedBy: 'caller', decidedAt: expect.any(Date) },
      });
      expect(audit.logTx).toHaveBeenCalledWith(prisma, expect.objectContaining({
        operatorId: 'caller', teamId: 't1', targetType: 'TEAM_MEMBER', targetId: 'u2', action: 'approve_join',
      }));
    });

    it('席位已满拒绝（免费版常量 20）', async () => {
      setup({ memberCount: 20 });
      await expect(service.approve('t1', 'caller', 'r1')).rejects.toThrow('席位已满');
      expect(prisma.teamMember.create).not.toHaveBeenCalled();
    });

    it('席位按 active 订阅 plan 现算', async () => {
      setup({ memberCount: 5, planSeatLimit: 5 });
      await expect(service.approve('t1', 'caller', 'r1')).rejects.toThrow('席位已满');
    });

    it('MEMBER 无权批准', async () => {
      setup({ callerRole: 'MEMBER' });
      await expect(service.approve('t1', 'caller', 'r1')).rejects.toThrow(ForbiddenException);
    });

    it('非 PENDING 状态拒绝', async () => {
      prisma.team = { findUnique: vi.fn().mockResolvedValue(null) };
      prisma.teamMember = { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) };
      prisma.teamJoinRequest = {
        findUnique: vi.fn().mockResolvedValue({ id: 'r1', status: 'APPROVED' }),
      };
      await expect(service.approve('t1', 'caller', 'r1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('reject / listRequests', () => {
    it('reject：置 REJECTED + decidedBy/decidedAt + 审计', async () => {
      prisma.user = { findUnique: vi.fn().mockResolvedValue({ name: '审批人' }) };
      prisma.team = { findUnique: vi.fn().mockResolvedValue(null) };
      prisma.teamMember = { findUnique: vi.fn().mockResolvedValue({ role: 'ADMIN' }) };
      prisma.teamJoinRequest = {
        findUnique: vi.fn().mockResolvedValue({ id: 'r1', teamId: 't1', userId: 'u2', status: 'PENDING' }),
        update: vi.fn(),
      };
      await service.reject('t1', 'caller', 'r1');
      expect(prisma.teamJoinRequest.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { status: 'REJECTED', decidedBy: 'caller', decidedAt: expect.any(Date) },
      });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        teamId: 't1', targetType: 'TEAM_MEMBER', targetId: 'u2', action: 'reject_join',
      }));
    });

    it('listRequests 按 status 过滤含 user 摘要', async () => {
      prisma.teamMember = { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) };
      prisma.teamJoinRequest = {
        findMany: vi.fn().mockResolvedValue([{ id: 'r1', user: { id: 'u2', name: '李四' } }]),
      };
      const result = await service.listRequests('t1', 'caller', 'PENDING');
      expect(prisma.teamJoinRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { teamId: 't1', status: 'PENDING' },
      }));
      expect(result[0].user).toEqual({ id: 'u2', name: '李四' });
    });
  });

});

describe('listAuditLogs', () => {
  let service: TeamService;
  let prisma: any;
  let emitter: any;
  let queue: any;
  const audit = { log: vi.fn(), logTx: vi.fn() };

  beforeEach(async () => {
    prisma = {
      teamMember: { findUnique: vi.fn() },
      auditLog: { findMany: vi.fn(), count: vi.fn() },
    };
    emitter = { emitAsync: vi.fn().mockResolvedValue([]) };
    queue = { add: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: emitter },
        { provide: getQueueToken('team-media-cleanup'), useValue: queue },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<TeamService>(TeamService);
  });

  it('listAuditLogs：按 teamId 分页倒序；非 OWNER/ADMIN 拒绝', async () => {
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    await expect(service.listAuditLogs('t1', 'u1', 1, 20)).rejects.toThrow('仅团队管理员');
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(0);
    await expect(service.listAuditLogs('t1', 'u1', 1, 20)).resolves.toEqual({ items: [], total: 0 });
    expect(prisma.auditLog.count).toHaveBeenCalledWith({ where: { teamId: 't1' } });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: { teamId: 't1' },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
  });

  it('ADMIN 可查看', async () => {
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(0);
    await expect(service.listAuditLogs('t1', 'u1', 1, 20)).resolves.toEqual({ items: [], total: 0 });
  });
});

describe('TeamService 默认团队操作禁令（个人项目不变量）', () => {
  let service: TeamService;
  let prisma: any;
  let emitter: any;
  let queue: any;
  const audit = { log: vi.fn(), logTx: vi.fn() };

  beforeEach(async () => {
    prisma = {};
    emitter = { emitAsync: vi.fn().mockResolvedValue([]) };
    queue = { add: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: emitter },
        { provide: getQueueToken('team-media-cleanup'), useValue: queue },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<TeamService>(TeamService);
  });

  const defaultTeam = () => {
    prisma.team = { findUnique: vi.fn().mockResolvedValue({ id: 't1', status: 'ACTIVE', isDefault: true }) };
  };

  it('apply 对默认团队抛「个人项目不支持」', async () => {
    defaultTeam();
    await expect(service.apply('t1', 'u2')).rejects.toThrow('个人项目不支持');
  });

  it('approve/reject 对默认团队抛「个人项目不支持」', async () => {
    defaultTeam();
    await expect(service.approve('t1', 'u1', 'r1')).rejects.toThrow('个人项目不支持');
    await expect(service.reject('t1', 'u1', 'r1')).rejects.toThrow('个人项目不支持');
  });

  it('renameTeam/changeRole/removeMember/setQuota 对默认团队抛「个人项目不支持」', async () => {
    defaultTeam();
    await expect(service.renameTeam('t1', 'u1', 'x')).rejects.toThrow('个人项目不支持');
    await expect(service.changeRole('t1', 'u1', 'u2', 'ADMIN')).rejects.toThrow('个人项目不支持');
    await expect(service.removeMember('t1', 'u1', 'u2')).rejects.toThrow('个人项目不支持');
    await expect(service.setQuota('t1', 'u1', 'u2', 100)).rejects.toThrow('个人项目不支持');
  });

  it('disbandTeam/transferOwnership 对默认团队抛「个人项目不支持」', async () => {
    defaultTeam();
    await expect(service.disbandTeam('t1', 'u1')).rejects.toThrow('个人项目不支持');
    await expect(service.transferOwnership('t1', 'u1', 'u2')).rejects.toThrow('个人项目不支持');
  });

  it('普通团队不受影响：apply 正常走 joinApproval 分支', async () => {
    prisma.team = { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE', joinApproval: true, isDefault: false }) };
    prisma.teamMember = { findUnique: vi.fn().mockResolvedValue(null) };
    prisma.teamJoinRequest = {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'r1', status: 'PENDING' }),
    };

    const result = await service.apply('t1', 'u2', '想加入');

    expect(prisma.teamJoinRequest.create).toHaveBeenCalledWith({
      data: { teamId: 't1', userId: 'u2', status: 'PENDING', message: '想加入' },
    });
    expect(result).toEqual({ id: 'r1', status: 'PENDING' });
  });
});
