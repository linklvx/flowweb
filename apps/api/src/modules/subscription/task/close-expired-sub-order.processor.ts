import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { QUEUE_NAMES } from '../../../config/queue.constants';

@Processor(QUEUE_NAMES.SUBSCRIPTION_CLOSE_EXPIRED)
export class CloseExpiredSubOrderProcessor extends WorkerHost {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject('PAYMENT_PROVIDER') private readonly payment?: any,
  ) {
    super();
  }

  async process(job: Job<{ orderNo: string; userId: string }, any, string>): Promise<any> {
    const { orderNo } = job.data;

    const order = await this.prisma.subscriptionOrder.findUnique({
      where: { orderNo },
    });

    if (!order) return;
    if (order.status !== 'PENDING') return;

    // Clock skew protection: don't close if not actually expired yet
    if (order.expiredAt && order.expiredAt > new Date()) return;

    // Close WeChat order
    if (order.prepayId && this.payment) {
      try { await this.payment.closePayment(orderNo); } catch { /* degrade */ }
    }

    await this.prisma.subscriptionOrder.update({
      where: { id: order.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
  }
}
