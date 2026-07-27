import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { Inject } from '@nestjs/common';

@Processor('subscription-expire')
export class ExpireSubscriptionProcessor extends WorkerHost {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const batchSize = 100;
    let page = 0;

    while (true) {
      const subs = await this.prisma.userSubscription.findMany({
        where: { status: 'active', currentPeriodEnd: { lte: this.todayUtc() } },
        skip: page * batchSize,
        take: batchSize,
      });

      if (subs.length === 0) break;

      for (const sub of subs) {
        // Re-verify still active (defensive check after grant processor may have changed state)
        const current = await this.prisma.userSubscription.findUnique({ where: { id: sub.id } });
        if (current?.status !== 'active') continue;

        const newStatus = 'expired';

        await this.prisma.$transaction(async (tx) => {
          await tx.userSubscription.update({
            where: { id: sub.id },
            data: { status: newStatus as any },
          });

          await tx.userBalance.updateMany({
            where: { userId: sub.userId },
            data: { subscriptionCredits: 0, subscriptionCreditsExpiry: null },
          });

          await tx.creditTransaction.create({
            data: {
              userId: sub.userId, amount: -(current.totalCredits - current.consumedCredits),
              type: 'expire_clear', creditType: 'subscription',
              referenceId: sub.id, referenceType: 'subscription', balanceAfter: 0,
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
