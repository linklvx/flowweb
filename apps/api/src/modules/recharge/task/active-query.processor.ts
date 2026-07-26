import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../../config/queue.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import type { IPaymentProvider } from '../providers/payment.provider.interface';

interface ActiveQueryJob {
  orderNo: string;
  userId: string;
}

@Processor(QUEUE_NAMES.RECHARGE_ACTIVE_QUERY)
export class ActiveQueryProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payment: IPaymentProvider,
  ) {
    super();
  }

  async process(job: Job<ActiveQueryJob>): Promise<void> {
    const { orderNo, userId } = job.data;

    const order = await this.prisma.rechargeOrder.findUnique({ where: { orderNo } });
    if (!order || order.status !== 'PENDING') return;

    const queryResult = await this.payment.queryOrder(orderNo);

    if (queryResult.tradeState === 'SUCCESS') {
      await this.creditOrder(order, queryResult.transactionId!, queryResult.tradeStateDesc, queryResult.amount ?? order.amount, queryResult.payerOpenid ?? '');
    } else if (queryResult.tradeState === 'CLOSED') {
      await this.prisma.rechargeOrder.updateMany({
        where: { orderNo, status: 'PENDING' },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    }
  }

  private async creditOrder(order: any, transactionId: string, tradeStateDesc: string, amount: number, payerOpenid: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT * FROM "UserBalance" WHERE "userId" = ${order.userId} FOR UPDATE`;

      const ub = await tx.userBalance.upsert({
        where: { userId: order.userId },
        update: {},
        create: { userId: order.userId, balance: 0, version: 0 },
      });

      const balanceBefore = ub.balance;
      const balanceAfter = balanceBefore + order.amount;

      await tx.userBalance.update({
        where: { userId: order.userId },
        data: { balance: balanceAfter },
      });

      await tx.userBalanceTransaction.create({
        data: {
          userId: order.userId,
          amountFen: order.amount,
          balanceBefore,
          balanceAfter,
          type: 'RECHARGE',
          bizOrderNo: order.orderNo,
        },
      });

      await tx.rechargeOrder.updateMany({
        where: { orderNo: order.orderNo, status: 'PENDING' },
        data: {
          status: 'SUCCESS',
          paidAt: new Date(),
          transactionId,
          balanceBefore,
          balanceAfter,
          notifySummary: { transactionId, tradeState: 'SUCCESS', tradeStateDesc, amount },
        },
      });
    });
  }
}
