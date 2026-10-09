import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { Inject, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { CreditLedgerService } from '../../team/credit-ledger.service';
import { clearPersonalTeamSubscription } from './personal-team-ledger';

@Processor('subscription-expire')
export class ExpireSubscriptionProcessor extends WorkerHost {
  private readonly logger = new Logger(ExpireSubscriptionProcessor.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CreditLedgerService) private readonly ledger: CreditLedgerService,
  ) {
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
        try {
          // Re-verify still active (defensive check after grant processor may have changed state)
          const current = await this.prisma.userSubscription.findUnique({ where: { id: sub.id } });
          if (current?.status !== 'active') continue;

          await this.prisma.$transaction(async (raw) => {
            const tx = await this.ledger.ledgerTx(raw);   // Z89：首句取通行证（lock_timeout+app.ledger_tx 双 SET LOCAL）
            await tx.userSubscription.update({
              where: { id: sub.id },
              data: { status: 'expired' as any },
            });

            // 清零默认团队实时剩余订阅积分（禁 totalCredits-consumedCredits 推算），无剩余不写流水。
            // Y0b-1（三轮 Z24）：周期事件键 `${sub.id}:${周期末日}`（同 sub 跨期各成键）
            await clearPersonalTeamSubscription(
              this.ledger, tx, sub.userId, 'expire_clear',
              `${sub.id}:${sub.currentPeriodEnd.toISOString().slice(0, 10)}`,
            );
          });
        } catch (err) {
          // 单个用户失败不得中止当日扫描（bootstrap 失败用户会拖垮全体）
          Sentry.captureException(err);
          this.logger.error(`[expire-subscription] failed for subscription ${sub.id}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  }

  private todayUtc(): Date {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}
