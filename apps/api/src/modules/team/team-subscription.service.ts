import { Injectable, Inject, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TEAM_FREE_SEAT_LIMIT, TEAM_FREE_STORAGE_LIMIT_BYTES } from './team.constants';
import { generateTeamOrderNo } from './team-recharge.service';
import { AuditService } from '../../common/audit/audit.service';

@Injectable()
export class TeamSubscriptionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** 购买（Q2 月付模型）：active 期拒购（S3 不支持提前续费） */
  async createSubscriptionOrder(teamId: string, userId: string, planId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { isDefault: true } });
    if (team?.isDefault) throw new BadRequestException('个人项目不支持团队套餐订阅');

    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member || (member.role !== 'OWNER' && member.role !== 'ADMIN')) {
      throw new ForbiddenException('仅团队管理员可购买订阅');
    }

    const active = await this.prisma.teamSubscription.findFirst({
      where: { teamId, status: 'active', currentPeriodEnd: { gt: new Date() } },
    });
    if (active) throw new BadRequestException('已开通订阅，到期后才可续订');

    const plan = await this.prisma.teamPlan.findUnique({ where: { id: planId } });
    if (!plan || !plan.isActive) throw new BadRequestException('订阅档位不存在');

    return this.prisma.teamRechargeOrder.create({
      data: {
        outTradeNo: generateTeamOrderNo(),
        teamId,
        payerUserId: userId,
        amountFen: plan.priceMonthly,
        credits: plan.monthlyCredits,
        kind: 'subscription',
        planId,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    });
  }

  /** 回调入账（Q2 覆盖式）：清上期剩余 → 发放 → 建 TeamSubscription(+30d) */
  async completeSubscriptionCallback(notify: {
    outTradeNo: string; appid: string; mchid: string; amount: number;
    tradeState: string; transactionId: string; payerOpenid?: string;
  }): Promise<{ code: string; message?: string }> {
    const order = await this.prisma.teamRechargeOrder.findUnique({ where: { outTradeNo: notify.outTradeNo } });
    if (!order) return { code: 'FAIL', message: 'order not found' };
    if (order.status === 'SUCCESS' || order.status === 'CLOSED') return { code: 'SUCCESS', message: 'OK' };
    if (notify.amount !== order.amountFen) return { code: 'FAIL', message: 'amount mismatch' };
    if (notify.tradeState !== 'SUCCESS') return { code: 'FAIL', message: `trade_state: ${notify.tradeState}` };

    const plan = await this.prisma.teamPlan.findUnique({ where: { id: order.planId! } });
    if (!plan) return { code: 'FAIL', message: 'plan not found' };

    const teamId = order.teamId!;
    // 回调兜底入口：默认团队（个人项目）订单不入账（下单入口已拦，此处防御异常路径）
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { isDefault: true } });
    if (team?.isDefault) throw new BadRequestException('个人项目不支持团队套餐订阅');
    const payerName = (await this.prisma.user.findUnique({ where: { id: order.payerUserId }, select: { name: true } }))?.name ?? '未知';
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT * FROM "TeamBalance" WHERE "teamId" = ${teamId} FOR UPDATE`;

        const balance = await tx.teamBalance.findUnique({ where: { teamId } });
        const remaining = balance?.subscriptionCredits ?? 0;
        if (remaining > 0) {
          await tx.teamBalance.update({ where: { teamId }, data: { subscriptionCredits: 0 } });
          await tx.teamCreditTransaction.create({
            data: {
              teamId, operatorUserId: order.payerUserId, amount: -remaining,
              type: 'expire_clear', creditType: 'subscription',
              referenceId: order.outTradeNo, balanceAfter: 0,
            },
          });
        }

        await tx.teamBalance.update({
          where: { teamId },
          data: { subscriptionCredits: plan.monthlyCredits },
        });
        await tx.teamCreditTransaction.create({
          data: {
            teamId, operatorUserId: order.payerUserId, amount: plan.monthlyCredits,
            type: 'subscription_grant', creditType: 'subscription',
            referenceId: order.outTradeNo, balanceAfter: plan.monthlyCredits,
          },
        });

        const now = new Date();
        await tx.teamSubscription.create({
          data: {
            teamId, planId: plan.id, status: 'active', paidAmount: order.amountFen,
            currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
          },
        });

        const updated = await tx.teamRechargeOrder.updateMany({
          where: { outTradeNo: order.outTradeNo, status: 'PENDING' },
          data: { status: 'SUCCESS', paidAt: now, transactionId: notify.transactionId, payerOpenid: notify.payerOpenid },
        });
        if (updated.count === 0) throw new Error('Order already processed');

        await this.audit.logTx(tx, {
          operatorId: order.payerUserId,
          operatorName: payerName,
          teamId,
          targetType: 'TEAM',
          targetId: teamId,
          action: 'subscribe',
          afterValue: { planId: plan.id, monthlyCredits: plan.monthlyCredits },
        });
      });
      return { code: 'SUCCESS', message: 'OK' };
    } catch {
      return { code: 'FAIL', message: 'internal error' };
    }
  }

  /** team-expire processor：到期清零（充值 credits 不动） */
  async expireSubscriptions(): Promise<number> {
    const due = await this.prisma.teamSubscription.findMany({
      where: { status: 'active', currentPeriodEnd: { lte: new Date() } },
      select: { id: true, teamId: true },
    });

    for (const sub of due) {
      if (!sub.teamId) continue;
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT * FROM "TeamBalance" WHERE "teamId" = ${sub.teamId} FOR UPDATE`;
        const balance = await tx.teamBalance.findUnique({ where: { teamId: sub.teamId! } });
        const remaining = balance?.subscriptionCredits ?? 0;
        if (remaining > 0) {
          await tx.teamBalance.update({ where: { teamId: sub.teamId! }, data: { subscriptionCredits: 0 } });
          await tx.teamCreditTransaction.create({
            data: {
              teamId: sub.teamId!, operatorUserId: null, amount: -remaining,
              type: 'expire_clear', creditType: 'subscription', balanceAfter: 0,
            },
          });
        }
        await tx.teamSubscription.updateMany({
          where: { id: sub.id, status: 'active' },
          data: { status: 'expired' },
        });

        await this.audit.logTx(tx, {
          operatorId: 'system',
          operatorName: 'system',
          teamId: sub.teamId!,
          targetType: 'TEAM',
          targetId: sub.teamId!,
          action: 'expire',
          afterValue: { cleared: remaining },
        });
      });
    }
    return due.length;
  }

  /** 限额现算：active 订阅取 plan，否则免费常量 */
  async getLimits(teamId: string): Promise<{ seatLimit: number; storageLimitBytes: number }> {
    const sub = await this.prisma.teamSubscription.findFirst({
      where: { teamId, status: 'active', currentPeriodEnd: { gt: new Date() } },
      select: { plan: { select: { seatLimit: true, storageLimitBytes: true } } },
    });
    if (sub) {
      return {
        seatLimit: sub.plan.seatLimit,
        storageLimitBytes: Number(sub.plan.storageLimitBytes),
      };
    }
    return { seatLimit: TEAM_FREE_SEAT_LIMIT, storageLimitBytes: TEAM_FREE_STORAGE_LIMIT_BYTES };
  }
}
