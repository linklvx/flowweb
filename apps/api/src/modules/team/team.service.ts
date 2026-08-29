import { Injectable, Inject, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TEAM_FREE_SEAT_LIMIT } from './team.constants';
import { AuditService } from '../../common/audit/audit.service';
import { bootstrapPersonalTeam } from './team.bootstrap';
import { DEFAULT_FOLDER_NAMES } from '../material-library/constants/material-library.constants';

@Injectable()
export class TeamService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly eventEmitter: EventEmitter2,
    @InjectQueue('team-media-cleanup') private readonly cleanupQueue: Queue,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** 审计 operatorName：调用点无现成名字时一次 user 查询兜底 */
  private async userName(userId: string): Promise<string> {
    return (await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? '未知';
  }

  /** 默认团队（个人项目）服务端不变量：操作禁令入口统一拦截 */
  private async assertNotPersonalTeam(teamId: string, action: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { isDefault: true } });
    if (team?.isDefault) throw new BadRequestException(`个人项目不支持此操作：${action}`);
  }

  /** 幂等：无个人团队用户任意时机调用可补建（注册钩子 / 历史用户兜底）。
   * 判据 = ownerId+isDefault（个人团队与成员身份解耦，加入他人团队不影响补建）。 */
  async ensureDefaultTeam(userId: string, userName?: string) {
    const name =
      userName ??
      (await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ??
      '用户';
    return bootstrapPersonalTeam(this.prisma, userId, name);
  }

  /** 主动建团 credits=0、无流水（注册赠送只给默认团队一次，防刷） */
  async createTeam(userId: string, name: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: { name: name.trim() || `${user?.name ?? '用户'}的团队`, ownerId: userId, status: 'ACTIVE' },
      });
      await tx.teamMember.create({ data: { teamId: team.id, userId, role: 'OWNER' } });
      // 与个人项目体验一致：建团即有默认素材文件夹
      await tx.materialFolder.createMany({
        data: DEFAULT_FOLDER_NAMES.map((folderName, i) => ({
          name: folderName, teamId: team.id, userId, isDefault: true, sortOrder: i,
        })),
      });
      await tx.teamBalance.create({ data: { teamId: team.id, credits: 0, subscriptionCredits: 0 } });
      await this.audit.logTx(tx, {
        operatorId: userId,
        operatorName: user?.name ?? '用户',
        teamId: team.id,
        targetType: 'TEAM',
        targetId: team.id,
        action: 'create_team',
      });
      return team;
    });
  }

  async getMyTeams(userId: string) {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      include: {
        team: {
          include: {
            balance: true,
            // Task 1 起 Team 侧为 subscriptions[]（一对多）：取最新 active 一条
            subscriptions: {
              where: { status: 'active' },
              orderBy: { currentPeriodEnd: 'desc' },
              take: 1,
              include: { plan: { select: { name: true } } },
            },
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { team: { createdAt: 'asc' } },
    });
    const rows = await Promise.all(memberships.map(async (m) => {
      // 订阅状态分叉：默认团队查个人订阅（UserSubscription），普通团队查 TeamSubscription
      let subscription: { planName: string; status: string; currentPeriodEnd: Date } | null = null;
      if (m.team.isDefault) {
        const personal = await this.prisma.userSubscription.findFirst({
          where: { userId, status: 'active' },
          orderBy: { currentPeriodEnd: 'desc' },
          include: { plan: { select: { tier: true } } },
        });
        if (personal) {
          subscription = { planName: personal.plan.tier, status: personal.status, currentPeriodEnd: personal.currentPeriodEnd };
        }
      } else if (m.team.subscriptions[0]) {
        const teamSub = m.team.subscriptions[0];
        subscription = {
          planName: teamSub.plan.name,
          status: teamSub.status,
          currentPeriodEnd: teamSub.currentPeriodEnd,
        };
      }
      return {
        id: m.team.id,
        name: m.team.name,
        role: m.role,
        status: m.team.status,
        isDefault: m.team.isDefault,
        isOwner: m.team.ownerId === userId,
        memberCount: m.team._count.members,
        createdAt: m.team.createdAt,
        balance: {
          credits: m.team.balance?.credits ?? 0,
          subscriptionCredits: m.team.balance?.subscriptionCredits ?? 0,
        },
        subscription,
      };
    }));
    // 排序规则：默认团队固定第一（前端 ?? teams[0] 缺省不得落到真实团队）
    // → 我创建的（OWNER）优先于我加入的（MEMBER）→ 同级按创建时间升序
    return rows.sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        Number(b.isOwner) - Number(a.isOwner) ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  async renameTeam(teamId: string, userId: string, name: string) {
    await this.assertNotPersonalTeam(teamId, '重命名');
    await this.assertEditable(teamId, userId);
    return this.prisma.team.update({ where: { id: teamId }, data: { name } });
  }

  /** OWNER/ADMIN 且团队 ACTIVE（改名/后续管理操作共用校验） */
  private async assertEditable(teamId: string, userId: string) {
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member || (member.role !== 'OWNER' && member.role !== 'ADMIN')) {
      throw new ForbiddenException('仅团队管理员可操作');
    }
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { status: true } });
    if (!team || team.status === 'DISBANDED') throw new BadRequestException('团队已解散');
  }

  async listMembers(teamId: string, page = 1, pageSize = 20) {
    const [rows, total] = await Promise.all([
      this.prisma.teamMember.findMany({
        where: { teamId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { joinedAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.teamMember.count({ where: { teamId } }),
    ]);
    return { items: rows, total };
  }

  private async requireMember(teamId: string, userId: string) {
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) throw new ForbiddenException('非团队成员');
    return member;
  }

  async changeRole(teamId: string, callerId: string, targetUserId: string, role: 'ADMIN' | 'MEMBER') {
    await this.assertNotPersonalTeam(teamId, '调整角色');
    // 运行时白名单：controller 无 ValidationPipe，类型限定仅编译期生效，透传 'OWNER' 可铸出双 OWNER 破坏 ownerId 不变式
    if (role !== 'ADMIN' && role !== 'MEMBER') throw new BadRequestException('成员角色仅可设为 ADMIN 或 MEMBER');
    const caller = await this.requireMember(teamId, callerId);
    if (caller.role !== 'OWNER') throw new ForbiddenException('仅 OWNER 可调整角色');
    const target = await this.requireMember(teamId, targetUserId);
    if (target.role === 'OWNER') throw new BadRequestException('不能修改 OWNER 的角色');
    const updated = await this.prisma.teamMember.update({
      where: { teamId_userId: { teamId, userId: targetUserId } },
      data: { role },
    });
    await this.audit.log({
      operatorId: callerId,
      operatorName: await this.userName(callerId),
      teamId,
      targetType: 'TEAM_MEMBER',
      targetId: targetUserId,
      action: 'change_role',
      beforeValue: { role: target.role },
      afterValue: { role },
    });
    return updated;
  }

  async removeMember(teamId: string, callerId: string, targetUserId: string) {
    await this.assertNotPersonalTeam(teamId, '移除成员');
    const caller = await this.requireMember(teamId, callerId);
    if (caller.role !== 'OWNER' && caller.role !== 'ADMIN') {
      throw new ForbiddenException('仅团队管理员可移除成员');
    }
    const target = await this.requireMember(teamId, targetUserId);
    if (target.role === 'OWNER') throw new BadRequestException('OWNER 不可被移除');
    const removed = await this.prisma.teamMember.delete({
      where: { teamId_userId: { teamId, userId: targetUserId } },
    });
    await this.audit.log({
      operatorId: callerId,
      operatorName: await this.userName(callerId),
      teamId,
      targetType: 'TEAM_MEMBER',
      targetId: targetUserId,
      action: 'remove_member',
    });
    return removed;
  }

  async setQuota(teamId: string, callerId: string, targetUserId: string, monthlyQuota: number) {
    await this.assertNotPersonalTeam(teamId, '调整配额');
    if (monthlyQuota < 0) throw new BadRequestException('配额不能为负数');
    const caller = await this.requireMember(teamId, callerId);
    if (caller.role !== 'OWNER' && caller.role !== 'ADMIN') {
      throw new ForbiddenException('仅团队管理员可配置额度');
    }
    const target = await this.requireMember(teamId, targetUserId);
    const updated = await this.prisma.teamMember.update({
      where: { teamId_userId: { teamId, userId: targetUserId } },
      data: { monthlyQuota },
    });
    await this.audit.log({
      operatorId: callerId,
      operatorName: await this.userName(callerId),
      teamId,
      targetType: 'TEAM_MEMBER',
      targetId: targetUserId,
      action: 'adjust_quota',
      beforeValue: { monthlyQuota: target.monthlyQuota },
      afterValue: { monthlyQuota },
    });
    return updated;
  }

  /** spec 1.3：事务内 原 OWNER→ADMIN / 目标→OWNER / Team.ownerId 同步 + logTx 审计 */
  async transferOwnership(teamId: string, callerId: string, targetUserId: string) {
    await this.assertNotPersonalTeam(teamId, '转让');
    const caller = await this.requireMember(teamId, callerId);
    if (caller.role !== 'OWNER') throw new ForbiddenException('仅 OWNER 可转让团队');
    if (targetUserId === callerId) throw new BadRequestException('不能转让给自己');
    const target = await this.requireMember(teamId, targetUserId);
    const operatorName = await this.userName(callerId);
    return this.prisma.$transaction(async (tx) => {
      await tx.teamMember.update({
        where: { teamId_userId: { teamId, userId: callerId } },
        data: { role: 'ADMIN' },
      });
      await tx.teamMember.update({
        where: { teamId_userId: { teamId, userId: targetUserId } },
        data: { role: 'OWNER' },
      });
      const team = await tx.team.update({ where: { id: teamId }, data: { ownerId: targetUserId } });
      await this.audit.logTx(tx, {
        operatorId: callerId,
        operatorName,
        teamId,
        targetType: 'TEAM_MEMBER',
        targetId: targetUserId,
        action: 'transfer_ownership',
      });
      return team;
    });
  }

  /** 席位上限现算：active 订阅取 plan，否则免费常量（Task 10 getLimits 统一封装） */
  private async getSeatLimit(teamId: string): Promise<number> {
    const sub = await this.prisma.teamSubscription.findFirst({
      where: { teamId, status: 'active', currentPeriodEnd: { gt: new Date() } },
      select: { plan: { select: { seatLimit: true } } },
    });
    return sub?.plan.seatLimit ?? TEAM_FREE_SEAT_LIMIT;
  }

  async apply(teamId: string, userId: string, message?: string) {
    await this.assertNotPersonalTeam(teamId, '申请加入');
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { status: true, joinApproval: true },
    });
    if (!team || team.status !== 'ACTIVE') throw new BadRequestException('团队不存在或已解散');

    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (member) throw new BadRequestException('已是团队成员');

    if (!team.joinApproval) {
      return this.prisma.teamMember.create({ data: { teamId, userId, role: 'MEMBER' } });
    }

    const pending = await this.prisma.teamJoinRequest.findFirst({
      where: { teamId, userId, status: 'PENDING' },
    });
    if (pending) throw new BadRequestException('已有待处理的申请');

    return this.prisma.teamJoinRequest.create({
      data: { teamId, userId, status: 'PENDING', message },
    });
  }

  async approve(teamId: string, callerId: string, requestId: string) {
    await this.assertNotPersonalTeam(teamId, '审批加入申请');
    const caller = await this.requireMember(teamId, callerId);
    if (caller.role !== 'OWNER' && caller.role !== 'ADMIN') {
      throw new ForbiddenException('仅团队管理员可审批');
    }
    const request = await this.prisma.teamJoinRequest.findUnique({ where: { id: requestId } });
    if (!request || request.teamId !== teamId) throw new BadRequestException('申请不存在');
    if (request.status !== 'PENDING') throw new BadRequestException('申请已处理');

    const memberCount = await this.prisma.teamMember.count({ where: { teamId } });
    const seatLimit = await this.getSeatLimit(teamId);
    if (memberCount >= seatLimit) throw new BadRequestException('席位已满');

    const operatorName = await this.userName(callerId);
    return this.prisma.$transaction(async (tx) => {
      await tx.teamMember.create({ data: { teamId, userId: request.userId, role: 'MEMBER' } });
      const approved = await tx.teamJoinRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', decidedBy: callerId, decidedAt: new Date() },
      });
      await this.audit.logTx(tx, {
        operatorId: callerId,
        operatorName,
        teamId,
        targetType: 'TEAM_MEMBER',
        targetId: request.userId,
        action: 'approve_join',
      });
      return approved;
    });
  }

  async reject(teamId: string, callerId: string, requestId: string) {
    await this.assertNotPersonalTeam(teamId, '审批加入申请');
    const caller = await this.requireMember(teamId, callerId);
    if (caller.role !== 'OWNER' && caller.role !== 'ADMIN') {
      throw new ForbiddenException('仅团队管理员可审批');
    }
    const request = await this.prisma.teamJoinRequest.findUnique({ where: { id: requestId } });
    if (!request || request.teamId !== teamId) throw new BadRequestException('申请不存在');
    if (request.status !== 'PENDING') throw new BadRequestException('申请已处理');
    const rejected = await this.prisma.teamJoinRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', decidedBy: callerId, decidedAt: new Date() },
    });
    await this.audit.log({
      operatorId: callerId,
      operatorName: await this.userName(callerId),
      teamId,
      targetType: 'TEAM_MEMBER',
      targetId: request.userId,
      action: 'reject_join',
    });
    return rejected;
  }

  async listRequests(teamId: string, callerId: string, status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    const caller = await this.requireMember(teamId, callerId);
    if (caller.role !== 'OWNER' && caller.role !== 'ADMIN') {
      throw new ForbiddenException('仅团队管理员可查看申请');
    }
    return this.prisma.teamJoinRequest.findMany({
      where: status ? { teamId, status } : { teamId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listAuditLogs(teamId: string, callerId: string, page = 1, pageSize = 20) {
    const caller = await this.requireMember(teamId, callerId);
    if (caller.role !== 'OWNER' && caller.role !== 'ADMIN') throw new ForbiddenException('仅团队管理员可查看审计日志');
    const where = { teamId };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }

  /** 解散时序（M2）：事务置 DISBANDED+删前查 projectIds/media → emitAsync（等 collab 关连接）→ 物理删除+凭证置空 */
  async disbandTeam(teamId: string, userId: string) {
    await this.assertNotPersonalTeam(teamId, '解散');
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member || member.role !== 'OWNER') throw new ForbiddenException('仅 OWNER 可解散团队');

    const myTeamCount = await this.prisma.teamMember.count({ where: { userId } });
    if (myTeamCount <= 1) throw new BadRequestException('不能解散唯一团队');

    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { status: true } });
    if (!team || team.status === 'DISBANDED') throw new BadRequestException('团队已解散');

    const { projectIds, medias } = await this.prisma.$transaction(async (tx) => {
      await tx.team.update({ where: { id: teamId }, data: { status: 'DISBANDED' } });
      const projects = await tx.canvasProject.findMany({ where: { teamId }, select: { id: true } });
      const medias = await tx.media.findMany({
        where: { teamId },
        select: { id: true, bucket: true, key: true },
      });
      return { projectIds: projects.map((p) => p.id), medias };
    });

    await this.eventEmitter.emitAsync('team.disbanded', { teamId, projectIds });

    // TODO(Task17): team-media-cleanup processor 批量删 MinIO 对象
    await this.cleanupQueue.add('team-media-cleanup', { medias });

    await this.prisma.$transaction(async (tx) => {
      // 支付凭证保留（P2）：订单/流水 teamId 置空（订阅 teamId 非空，随团队级联删除）
      await tx.teamRechargeOrder.updateMany({ where: { teamId }, data: { teamId: null } });
      await tx.teamCreditTransaction.updateMany({ where: { teamId }, data: { teamId: null } });
      // 级联物理删除：members/joinRequests/balance/subscriptions/projects(CanvasDoc)/media
      await tx.team.delete({ where: { id: teamId } });
    });

    // 审计在物理删除后落库（AuditLog.teamId 无 FK，行随审计保留）
    await this.audit.log({
      operatorId: userId,
      operatorName: await this.userName(userId),
      teamId,
      targetType: 'TEAM',
      targetId: teamId,
      action: 'disband_team',
    });
  }
}
