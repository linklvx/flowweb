import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Optional } from '@nestjs/common';
import { QUEUE_NAMES } from '../../../config/queue.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import type { IPaymentProvider } from '../providers/payment.provider.interface';

const BATCH_SIZE = 100;

@Processor(QUEUE_NAMES.RECHARGE_DAILY_SCAN)
export class DailyScanProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject('PAYMENT_PROVIDER') private readonly payment: IPaymentProvider | null,
  ) {
    super();
  }

  async process(): Promise<void> {
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const orders = await this.prisma.rechargeOrder.findMany({
        where: { status: 'PENDING', expiredAt: { lt: new Date() } },
        select: { orderNo: true },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (orders.length === 0) {
        hasMore = false;
        break;
      }

      for (const order of orders) {
        if (this.payment) {
          try {
            await this.payment.closePayment(order.orderNo);
          } catch {
            // Already closed on WeChat side
          }
        }
        await this.prisma.rechargeOrder.updateMany({
          where: { orderNo: order.orderNo, status: 'PENDING' },
          data: { status: 'CLOSED', closedAt: new Date() },
        });
      }

      cursor = orders[orders.length - 1].orderNo;
      if (orders.length < BATCH_SIZE) hasMore = false;
    }
  }
}
