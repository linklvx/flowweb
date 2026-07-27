import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Optional, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { QUEUE_NAMES } from '../../../config/queue.constants';

@Processor(QUEUE_NAMES.SUBSCRIPTION_DAILY_RECON)
export class DailyReconProcessor extends WorkerHost {
  private readonly logger = new Logger(DailyReconProcessor.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject('PAYMENT_PROVIDER') private readonly payment?: any,
  ) {
    super();
  }

  async process(job: Job<{ date?: string }, any, string>): Promise<any> {
    const targetDate = job.data.date || this.yesterday();

    this.logger.log(JSON.stringify({
      event: 'daily_recon_started',
      date: targetDate,
    }));

    try {
      // 1. Pull WeChat trade bill for target date
      // Requires WeChat merchant platform bill download API access
      // const bill = await this.payment.downloadTradeBill(targetDate);

      // 2. Query local SUCCESS orders for the same date
      const dayStart = new Date(`${targetDate}T00:00:00+08:00`);
      const dayEnd = new Date(`${targetDate}T23:59:59+08:00`);

      const localOrders = await this.prisma.subscriptionOrder.findMany({
        where: {
          status: 'SUCCESS',
          paidAt: { gte: dayStart, lte: dayEnd },
        },
        select: {
          orderNo: true,
          transactionId: true,
          payableAmount: true,
          paidAt: true,
        },
      });

      // 3. Compare: WeChat SUCCESS + local not SUCCESS → flag anomaly
      // 4. Report: local SUCCESS + WeChat not found → flag anomaly
      // Full implementation requires bill parsing logic

      this.logger.log(JSON.stringify({
        event: 'daily_recon_completed',
        date: targetDate,
        localSuccessCount: localOrders.length,
        status: 'skeleton — bill download not yet enabled',
      }));
    } catch (err) {
      Sentry.captureException(err, (scope) => {
        scope.setTag('module', 'subscription-daily-recon');
        scope.setTag('date', targetDate);
        scope.setLevel('error');
        return scope;
      });
      this.logger.error(JSON.stringify({
        event: 'daily_recon_failed',
        date: targetDate,
        error: (err as Error).message,
      }));
      throw err;
    }
  }

  private yesterday(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
}
