import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Optional } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { QUEUE_NAMES } from '../../../config/queue.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import type { IPaymentProvider } from '../providers/payment.provider.interface';

interface CloseExpiredJob {
  orderNo: string;
  userId: string;
}

@Processor(QUEUE_NAMES.RECHARGE_CLOSE_EXPIRED)
export class CloseExpiredOrderProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject('PAYMENT_PROVIDER') private readonly payment: IPaymentProvider | null,
  ) {
    super();
  }

  async process(job: Job<CloseExpiredJob>): Promise<void> {
    const { orderNo, userId } = job.data;

    try {
      const order = await this.prisma.rechargeOrder.findUnique({ where: { orderNo } });
      if (!order || order.status !== 'PENDING') return;

      if (this.payment) {
        try {
          await this.payment.closePayment(orderNo);
        } catch {
          // WeChat already closed or not found — proceed to local close
        }
      }

      await this.prisma.rechargeOrder.updateMany({
        where: { orderNo, status: 'PENDING' },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    } catch (err) {
      Sentry.withScope((scope) => {
        scope.setTag('module', 'recharge');
        scope.setTag('orderNo', orderNo);
        scope.setTag('userId', userId);
        scope.setLevel('warning');
        Sentry.captureException(err);
      });
    }
  }
}
