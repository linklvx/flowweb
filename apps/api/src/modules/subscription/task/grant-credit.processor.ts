import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { Inject, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { CreditLedgerService } from '../../team/credit-ledger.service';
import { grantToPersonalTeam } from './personal-team-ledger';

@Processor('subscription-grant-credit')
export class GrantCreditProcessor extends WorkerHost {
  private readonly logger = new Logger(GrantCreditProcessor.name);

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
          nextGrantDate: { lte: this.todayUtc() },
          ...(lastId ? { id: { gt: lastId } } : {}),
        },
        orderBy: { id: 'asc' },
        take: batchSize,
      });

      if (subs.length === 0) break;

      for (const sub of subs) {
        lastId = sub.id; // continue 跳过的记录也推进游标，避免错位漏发
        try {
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

            // 周期覆盖不滚存：旧池有剩余先清零（expire_clear 流水）再设值发放。
            // Y0b-1（三轮 Z24）：周期事件 id——回滚后 nextGrantDate 不变 ⇒ 同键重试天然幂等；下一期新键
            const periodKey = sub.nextGrantDate.toISOString().slice(0, 10);
            await grantToPersonalTeam(this.ledger, tx, sub.userId, plan.monthlyCredits, 'expire_clear', `${sub.id}:${periodKey}`);
          });
        } catch (err) {
          // 单个用户失败不得中止当日扫描（bootstrap 失败用户会拖垮全体）
          Sentry.captureException(err);
          this.logger.error(`[grant-credit] failed for subscription ${sub.id}: ${err instanceof Error ? err.message : err}`);
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
