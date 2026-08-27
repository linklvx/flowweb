import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const MAX_RETRIES = 3;

export function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class TeamCreditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 双池+总额+该成员 quota/used（惰性重置：monthlyPeriod 非当月先清零） */
  async getBalanceView(teamId: string, userId: string) {
    const balance = await this.prisma.teamBalance.findUnique({ where: { teamId } });
    let member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) throw new ForbiddenException('非团队成员');

    const period = currentPeriod();
    if (member.monthlyPeriod !== period) {
      member = await this.prisma.teamMember.update({
        where: { id: member.id },
        data: { monthlyPeriod: period, monthlyUsed: 0 },
      });
    }

    const credits = balance?.credits ?? 0;
    const subscriptionCredits = balance?.subscriptionCredits ?? 0;
    return {
      credits,
      subscriptionCredits,
      total: credits + subscriptionCredits,
      quota: member.monthlyQuota,
      used: member.monthlyUsed,
    };
  }

  /** 校验顺序（D5）：总额 → quota → 扣减（订阅优先+乐观锁）→ monthlyUsed 原子累加 → 流水 */
  async consume(
    teamId: string,
    userId: string,
    cost: number,
    referenceId: string,
  ): Promise<{ success: boolean; reason?: string }> {
    const balance = await this.prisma.teamBalance.findUnique({ where: { teamId } });
    if (!balance) return { success: false, reason: 'TEAM_BALANCE_MISSING' };
    if (balance.credits + balance.subscriptionCredits < cost) {
      return { success: false, reason: 'CREDIT_INSUFFICIENT' };
    }

    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) return { success: false, reason: 'NOT_MEMBER' };

    const period = currentPeriod();
    const inPeriod = member.monthlyPeriod === period;
    const used = inPeriod ? member.monthlyUsed : 0;
    if (member.monthlyQuota > 0 && used + cost > member.monthlyQuota) {
      return { success: false, reason: 'QUOTA_EXCEEDED' };
    }

    let retries = 0;
    while (retries < MAX_RETRIES) {
      const current = await this.prisma.teamBalance.findUnique({ where: { teamId } });
      if (!current) return { success: false, reason: 'TEAM_BALANCE_MISSING' };
      if (current.credits + current.subscriptionCredits < cost) {
        return { success: false, reason: 'CREDIT_INSUFFICIENT' };
      }

      const subDeduct = Math.min(current.subscriptionCredits, cost);
      const regDeduct = cost - subDeduct;

      const updateData: Record<string, unknown> = { version: { increment: 1 } };
      if (subDeduct > 0) updateData.subscriptionCredits = { decrement: subDeduct };
      if (regDeduct > 0) updateData.credits = { decrement: regDeduct };

      const result = await this.prisma.teamBalance.updateMany({
        where: { teamId, version: current.version },
        data: updateData,
      });
      if (result.count === 0) {
        retries++;
        continue;
      }

      // monthlyUsed 原子累加，禁止读-改-写；quota 并入 where 防同成员并发超限
      const usedWhere: Record<string, unknown> = { id: member.id };
      if (inPeriod) {
        usedWhere.monthlyPeriod = period;
        if (member.monthlyQuota > 0) usedWhere.monthlyUsed = { lte: member.monthlyQuota - cost };
      } else {
        usedWhere.OR = [{ monthlyPeriod: { not: period } }, { monthlyPeriod: null }];
      }
      const usedResult = await this.prisma.teamMember.updateMany({
        where: usedWhere,
        data: { monthlyUsed: { increment: cost }, monthlyPeriod: period },
      });
      if (usedResult.count === 0) return { success: false, reason: 'QUOTA_EXCEEDED' };

      const updated = await this.prisma.teamBalance.findUnique({ where: { teamId } });
      if (subDeduct > 0) {
        await this.prisma.teamCreditTransaction.create({
          data: {
            teamId, operatorUserId: userId, amount: -subDeduct, type: 'consumption',
            creditType: 'subscription', referenceId, balanceAfter: updated!.subscriptionCredits,
          },
        });
      }
      if (regDeduct > 0) {
        await this.prisma.teamCreditTransaction.create({
          data: {
            teamId, operatorUserId: userId, amount: -regDeduct, type: 'consumption',
            creditType: 'regular', referenceId, balanceAfter: updated!.credits,
          },
        });
      }
      return { success: true };
    }
    return { success: false, reason: 'RETRY_EXHAUSTED' };
  }
}
