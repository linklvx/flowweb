import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TeamRechargeService } from '../team-recharge.service';
import type { IPaymentProvider } from '../../recharge/providers/payment.provider.interface';

@Injectable()
@Processor('team-recharge-active-query')
export class TeamActiveQueryProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teamRecharge: TeamRechargeService,
    @Optional() @Inject('PAYMENT_PROVIDER') private readonly payment: IPaymentProvider | null,
  ) {
    super();
  }

  async process(job: Job<{ orderNo: string }>): Promise<void> {
    const { orderNo } = job.data;
    const order = await this.prisma.teamRechargeOrder.findUnique({ where: { outTradeNo: orderNo } });
    if (!order || order.status !== 'PENDING' || !this.payment) return;

    try {
      const q = await this.payment.queryOrder(orderNo);
      if (q.tradeState === 'SUCCESS') {
        await this.teamRecharge.completeTeamCallback({
          outTradeNo: orderNo,
          appid: process.env.WECHAT_PAY_APP_ID || '',
          mchid: process.env.WECHAT_PAY_MCH_ID || '',
          amount: q.amount ?? order.amountFen,
          tradeState: 'SUCCESS',
          transactionId: q.transactionId || '',
          payerOpenid: q.payerOpenid,
        });
      } else if (q.tradeState === 'CLOSED') {
        await this.teamRecharge.closeExpired(orderNo);
      }
    } catch {
      // 兜底任务失败由下一次 delay job 重试
    }
  }
}
