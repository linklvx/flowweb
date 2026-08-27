import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TeamService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 幂等：无团队用户任意时机调用可补建（注册钩子 / 历史用户兜底） */
  async ensureDefaultTeam(userId: string, userName: string) {
    const existing = await this.prisma.team.findFirst({ where: { ownerId: userId } });
    if (existing) return existing;
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: { name: `${userName}的团队`, ownerId: userId, status: 'ACTIVE' },
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
}
