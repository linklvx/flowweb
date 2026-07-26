import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
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
    private readonly payment: IPaymentProvider,
  ) {
    super();
  }

  async process(job: Job<CloseExpiredJob>): Promise<void> {
    const { orderNo } = job.data;

    const order = await this.prisma.rechargeOrder.findUnique({ where: { orderNo } });
    if (!order || order.status !== 'PENDING') return;

    try {
      await this.payment.closePayment(orderNo);
    } catch {
      // WeChat already closed or not found — proceed to local close
    }

    await this.prisma.rechargeOrder.updateMany({
      where: { orderNo, status: 'PENDING' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
  }
}
