import { Injectable, Inject, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLedgerService } from './credit-ledger.service';
import { TEAM_FREE_SEAT_LIMIT, TEAM_FREE_STORAGE_LIMIT_BYTES } from './team.constants';
import { generateTeamOrderNo } from './team-recharge.service';
import { AuditService } from '../../common/audit/audit.service';

@Injectable()
export class TeamSubscriptionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CreditLedgerService) private readonly ledger: CreditLedgerService,
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
      await this.prisma.$transaction(async (raw) => {
        const tx = await this.ledger.ledgerTx(raw);   // Z89：首句取通行证（lock_timeout+app.ledger_tx 双 SET LOCAL）
        // Y0b-1（Z13/Z12）：FOR UPDATE 删——lockBalance 取代（锁序全序）；入账全经 mutate。
        await this.ledger.lockBalance(tx, teamId);

        const balance = await tx.teamBalance.findUnique({ where: { teamId } });
        const remaining = balance?.subscriptionCredits ?? 0;
        if (remaining > 0) {
          await this.ledger.mutate(tx, {
            teamId, operatorUserId: order.payerUserId, type: 'expire_clear', creditType: 'subscription',
            balanceDelta: -remaining, frozenDelta: 0, referenceId: order.outTradeNo,
          });
        }

        await this.ledger.mutate(tx, {
          teamId, operatorUserId: order.payerUserId, type: 'subscription_grant', creditType: 'subscription',
          balanceDelta: plan.monthlyCredits, frozenDelta: 0, referenceId: order.outTradeNo,
        });

        const now = new Date();
        // 先关旧 active（partial unique 是最后防线，不能替代此步：到期后 expire-job 未跑窗口续费场景）
        await tx.teamSubscription.updateMany({
          where: { teamId, status: 'active' },
          data: { status: 'expired' },
        });
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

  /** team-expire processor：到期清零（充值 credits 不动）。
   *  Y0b-1（Z9 缺口③/Z24）：sub CAS 前置 count===0 return（并发已过期零动作——防重复清零）；
   *  expire_clear 周期事件键 `${sub.id}:${周期起始日}`（同 sub 跨期各成键）；FOR UPDATE 删——lockBalance 取代。 */
  async expireSubscriptions(): Promise<number> {
    const due = await this.prisma.teamSubscription.findMany({
      where: { status: 'active', currentPeriodEnd: { lte: new Date() } },
      select: { id: true, teamId: true, currentPeriodEnd: true },
    });

    for (const sub of due) {
      if (!sub.teamId) continue;
      await this.prisma.$transaction(async (raw) => {
        const tx = await this.ledger.ledgerTx(raw);   // Z89：首句取通行证（lock_timeout+app.ledger_tx 双 SET LOCAL）
        await this.ledger.lockBalance(tx, sub.teamId!);
        const cas = await tx.teamSubscription.updateMany({
          where: { id: sub.id, status: 'active' },
          data: { status: 'expired' },
        });
        if (cas.count === 0) return; // 并发已过期——零动作
        const balance = await tx.teamBalance.findUnique({ where: { teamId: sub.teamId! } });
        const remaining = balance?.subscriptionCredits ?? 0;
        if (remaining > 0) {
          await this.ledger.mutate(tx, {
            teamId: sub.teamId!, operatorUserId: null, type: 'expire_clear', creditType: 'subscription',
            balanceDelta: -remaining, frozenDelta: 0,
            referenceId: `${sub.id}:${sub.currentPeriodEnd.toISOString().slice(0, 10)}`,
          });
        }

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

  /** 限额现算：默认团队回退个人订阅（C7），普通团队 active 订阅取 plan，否则免费常量 */
  async getLimits(teamId: string): Promise<{ seatLimit: number; storageLimitBytes: number }> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { isDefault: true, ownerId: true },
    });
    if (team?.isDefault) {
      // 默认团队永远没有 TeamSubscription（禁令），个人会员存储权益来自 UserSubscription
      const personal = await this.prisma.userSubscription.findFirst({
        where: { userId: team.ownerId, status: 'active', currentPeriodEnd: { gt: new Date() } },
        select: { plan: { select: { storageLimitBytes: true } } },
      });
      return {
        seatLimit: 1, // 默认团队恒单人（禁令保证），无席位概念
        storageLimitBytes: personal ? Number(personal.plan.storageLimitBytes) : TEAM_FREE_STORAGE_LIMIT_BYTES,
      };
    }
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
