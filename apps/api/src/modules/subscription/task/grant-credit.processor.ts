import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { Inject } from '@nestjs/common';

@Processor('subscription-grant-credit')
export class GrantCreditProcessor extends WorkerHost {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const batchSize = 100;
    let page = 0;

    while (true) {
      const subs = await this.prisma.userSubscription.findMany({
        where: { status: 'active', nextGrantDate: { lte: this.todayUtc() } },
        skip: page * batchSize,
        take: batchSize,
      });

      if (subs.length === 0) break;

      for (const sub of subs) {
        const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: sub.planId } });
        if (!plan) continue;

        const maxGrants = sub.period === 'monthly' ? 1 : sub.period === 'quarterly' ? 3 : 12;
        if (sub.grantCount >= maxGrants) continue;

        await this.prisma.$transaction(async (tx) => {
          const nextGrant = new Date(sub.nextGrantDate.getTime() + 30 * 86400000);
          nextGrant.setUTCHours(0, 0, 0, 0);

          await tx.userSubscription.update({
            where: { id: sub.id },
            data: { nextGrantDate: nextGrant, grantCount: { increment: 1 } },
          });

          const balance = await tx.userBalance.findUnique({ where: { userId: sub.userId } });
          const newBal = (balance?.subscriptionCredits ?? 0) + plan.monthlyCredits;

          await tx.userBalance.update({
            where: { userId: sub.userId },
            data: { subscriptionCredits: { increment: plan.monthlyCredits } },
          });

          await tx.creditTransaction.create({
            data: {
              userId: sub.userId, amount: plan.monthlyCredits,
              type: 'subscription_grant', creditType: 'subscription',
              referenceId: sub.id, referenceType: 'subscription', balanceAfter: newBal,
            },
          });
        });
      }

      page++;
    }
  }

  private todayUtc(): Date {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}
