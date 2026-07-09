import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BusinessException } from '../../../common/exceptions/business.exception';

@Injectable()
export class AdminSubscriptionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listSubscriptions(filter: { userId?: string; planId?: string; status?: string; page?: number; pageSize?: number }) {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    const where: Record<string, unknown> = {};
    if (filter.userId) where.userId = filter.userId;
    if (filter.planId) where.planId = filter.planId;
    if (filter.status) where.status = filter.status;

    const [items, total] = await Promise.all([
      this.prisma.userSubscription.findMany({
        where,
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.userSubscription.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async getSubscription(id: string) {
    return this.prisma.userSubscription.findUnique({ where: { id }, include: { plan: true } });
  }

  async cancelSubscription(id: string) {
    const sub = await this.prisma.userSubscription.findUnique({ where: { id } });
    if (!sub) throw new BusinessException('SUBSCRIPTION_NOT_FOUND');

    const TERMINAL = new Set(['expired', 'upgraded', 'cancelled']);
    if (TERMINAL.has(sub.status)) throw new BusinessException('STATE_MACHINE_TERMINAL', '终态订阅不可作废');
    if (sub.status !== 'active') throw new BusinessException('SUBSCRIPTION_STATUS_INVALID');

    await this.prisma.$transaction(async (tx) => {
      await tx.userSubscription.update({
        where: { id },
        data: { status: 'cancelled', autoRenew: false, cancelledAt: new Date() },
      });
      await tx.userBalance.updateMany({
        where: { userId: sub.userId },
        data: { subscriptionCredits: 0, subscriptionCreditsExpiry: null },
      });
      await tx.creditTransaction.create({
        data: {
          userId: sub.userId, amount: 0, type: 'admin_clear',
          creditType: 'subscription', referenceId: id, referenceType: 'subscription', balanceAfter: 0,
        },
      });
    });
  }

  async grantCredit(userId: string, amount: number, creditType: 'regular' | 'subscription') {
    if (creditType === 'subscription') {
      const sub = await this.prisma.userSubscription.findFirst({
        where: { userId, status: 'active' },
      });
      if (!sub) throw new BusinessException('GRANT_NO_ACTIVE_SUB', '无生效订阅，不可发放订阅积分');

      const balance = await this.prisma.userBalance.findUnique({ where: { userId } });
      const newBal = (balance?.subscriptionCredits ?? 0) + amount;

      await this.prisma.userBalance.update({
        where: { userId },
        data: { subscriptionCredits: { increment: amount } },
      });
      await this.prisma.creditTransaction.create({
        data: {
          userId, amount, type: 'admin_grant', creditType: 'subscription',
          referenceId: sub.id, referenceType: 'subscription', balanceAfter: newBal,
        },
      });
    } else {
      const balance = await this.prisma.userBalance.findUnique({ where: { userId } });
      const newBal = (balance?.credits ?? 0) + amount;

      await this.prisma.userBalance.upsert({
        where: { userId },
        create: { userId, credits: amount },
        update: { credits: { increment: amount } },
      });
      // For regular credits, referenceType=admin, referenceId will be set to audit log (handled by audit decorator)
      await this.prisma.creditTransaction.create({
        data: {
          userId, amount, type: 'admin_grant', creditType: 'regular',
          referenceType: 'admin', balanceAfter: newBal,
        },
      });
    }
  }
}
