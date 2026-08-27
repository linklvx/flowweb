import { Injectable, Inject, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class TeamService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly eventEmitter: EventEmitter2,
    @InjectQueue('team-media-cleanup') private readonly cleanupQueue: Queue,
  ) {}

  /** 幂等：无团队用户任意时机调用可补建（注册钩子 / 历史用户兜底） */
  async ensureDefaultTeam(userId: string, userName?: string) {
    const existing = await this.prisma.team.findFirst({ where: { ownerId: userId } });
    if (existing) return existing;
    const name =
      userName ??
      (await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ??
      '用户';
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: { name: `${name}的团队`, ownerId: userId, status: 'ACTIVE' },
      });
      await tx.teamMember.create({ data: { teamId: team.id, userId, role: 'OWNER' } });
      await tx.teamBalance.create({ data: { teamId: team.id, credits: 100 } });
      await tx.teamCreditTransaction.create({
        data: {
          teamId: team.id,
          operatorUserId: userId,
          amount: 100,
          type: 'register_grant',
          creditType: 'regular',
          balanceAfter: 100,
        },
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
            subscription: { include: { plan: { select: { name: true } } } },
            _count: { select: { members: true } },
          },
        },
      },
    });
    return memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      role: m.role,
      status: m.team.status,
      memberCount: m.team._count.members,
      balance: {
        credits: m.team.balance?.credits ?? 0,
        subscriptionCredits: m.team.balance?.subscriptionCredits ?? 0,
      },
      subscription: m.team.subscription
        ? {
            planName: m.team.subscription.plan.name,
            status: m.team.subscription.status,
            currentPeriodEnd: m.team.subscription.currentPeriodEnd,
          }
        : null,
    }));
  }

  async renameTeam(teamId: string, userId: string, name: string) {
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

  /** 解散时序（M2）：事务置 DISBANDED+删前查 projectIds/media → emitAsync（等 collab 关连接）→ 物理删除+凭证置空 */
  async disbandTeam(teamId: string, userId: string) {
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
      // 支付凭证保留（P2）：订单/流水/订阅 teamId 置空
      await tx.teamRechargeOrder.updateMany({ where: { teamId }, data: { teamId: null } });
      await tx.teamCreditTransaction.updateMany({ where: { teamId }, data: { teamId: null } });
      await tx.teamSubscription.updateMany({ where: { teamId }, data: { teamId: null } });
      // 级联物理删除：members/joinRequests/balance/projects(CanvasDoc)/media
      await tx.team.delete({ where: { id: teamId } });
    });
  }
}
