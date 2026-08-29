import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { Inject } from '@nestjs/common';
import { clearPersonalTeamSubscription } from './personal-team-ledger';

@Processor('subscription-expire')
export class ExpireSubscriptionProcessor extends WorkerHost {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const batchSize = 100;
    let lastId: string | undefined;

    while (true) {
      const subs = await this.prisma.userSubscription.findMany({
        where: {
          status: 'active',
          currentPeriodEnd: { lte: this.todayUtc() },
          ...(lastId ? { id: { gt: lastId } } : {}),
        },
        orderBy: { id: 'asc' },
        take: batchSize,
      });

      if (subs.length === 0) break;

      for (const sub of subs) {
        lastId = sub.id; // 复查 continue 跳过的记录也推进游标，避免错位漏扫
        // Re-verify still active (defensive check after grant processor may have changed state)
        const current = await this.prisma.userSubscription.findUnique({ where: { id: sub.id } });
        if (current?.status !== 'active') continue;

        await this.prisma.$transaction(async (tx) => {
          await tx.userSubscription.update({
            where: { id: sub.id },
            data: { status: 'expired' as any },
          });

          // 清零默认团队实时剩余订阅积分（禁 totalCredits-consumedCredits 推算），无剩余不写流水
          await clearPersonalTeamSubscription(tx, sub.userId, 'expire_clear', sub.id);
        });
      }
    }
  }

  private todayUtc(): Date {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}
