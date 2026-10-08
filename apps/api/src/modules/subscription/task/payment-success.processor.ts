import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Inject, Optional, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentGateway } from '../../recharge/payment.gateway';
import { CreditLedgerService } from '../../team/credit-ledger.service';
import { QUEUE_NAMES } from '../../../config/queue.constants';
import { grantToPersonalTeam } from './personal-team-ledger';

interface PaymentSuccessJob {
  orderNo: string;
  transactionId: string;
  payerOpenid: string;
}

@Processor(QUEUE_NAMES.SUBSCRIPTION_PAYMENT_SUCCESS)
export class PaymentSuccessProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentSuccessProcessor.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentGateway) private readonly gateway: PaymentGateway,
    @Inject(CreditLedgerService) private readonly ledger: CreditLedgerService,
    @Optional() @InjectQueue(QUEUE_NAMES.SUBSCRIPTION_CLOSE_EXPIRED)
    private readonly closeExpiredQueue?: Queue,
  ) {
    super();
  }

  async process(job: Job<PaymentSuccessJob, any, string>): Promise<any> {
    const { orderNo, transactionId, payerOpenid } = job.data;

    const order = await this.prisma.subscriptionOrder.findUnique({
      where: { orderNo },
    });

    if (!order) return;
    if (order.status === 'SUCCESS') return;

    try {
      await this.prisma.$transaction(async (tx) => {
        // 1) Update order to SUCCESS (optimistic lock — only if still PENDING)
        const updated = await tx.subscriptionOrder.updateMany({
          where: { id: order.id, status: 'PENDING' },
          data: {
            status: 'SUCCESS',
            transactionId,
            payerOpenid,
            paidAt: new Date(),
          },
        });

        if (updated.count === 0) return; // Already processed by another worker / timeout close

        // 2) Get plan details
        const plan = await tx.subscriptionPlan.findUnique({
          where: { id: order.planId },
        });

        if (!plan) throw new Error(`Plan not found: ${order.planId}`);

        const periodMonths = order.period === 'monthly' ? 1 : order.period === 'quarterly' ? 3 : 12;
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + periodMonths);
        const nextGrant = new Date(now);
        nextGrant.setMonth(nextGrant.getMonth() + 1);

        let newSub: any;

        if (order.type === 'new_purchase') {
          // 3a) Create new subscription
          newSub = await tx.userSubscription.create({
            data: {
              userId: order.userId,
              planId: order.planId,
              tier: plan.tier,
              period: order.period,
              status: 'active',
              paidAmount: order.payableAmount!,
              totalCredits: plan.monthlyCredits * periodMonths,
              totalDays: periodMonths * 30,
              subscribedAt: now,
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
              nextGrantDate: nextGrant,
              grantCount: 1,
            },
          });
        } else if (order.type === 'upgrade') {
          // 3b) Mark old subscription upgraded, create new one
          if (order.fromSubscriptionId) {
            await tx.userSubscription.updateMany({
              where: { id: order.fromSubscriptionId, status: 'active' },
              data: { status: 'upgraded' },
            });
          }

          newSub = await tx.userSubscription.create({
            data: {
              userId: order.userId,
              planId: order.planId,
              tier: plan.tier,
              period: order.period,
              status: 'active',
              paidAmount: order.payableAmount!,
              totalCredits: plan.monthlyCredits * periodMonths,
              totalDays: periodMonths * 30,
              subscribedAt: now,
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
              nextGrantDate: nextGrant,
              grantCount: 1,
              previousSubId: order.fromSubscriptionId,
            },
          });
        }

        // 4) Grant first month subscription credits to personal team ledger
        // 升级先清旧池（upgrade_clear）/ 续费=新周期（expire_clear）；旧池有剩余必有清零流水。
        // Y0b-1（三轮 Z24/禁实体 id）：referenceId 统一 order.id（订单号=事件 id，续费订单各不相同天然周期安全）
        const clearType = order.type === 'upgrade' ? 'upgrade_clear' : 'expire_clear';
        await grantToPersonalTeam(this.ledger, tx, order.userId, plan.monthlyCredits, clearType, order.id);
      });

      // 5) Remove delayed close task (best-effort)
      if (order.delayCloseJobId && this.closeExpiredQueue) {
        try {
          await this.closeExpiredQueue.remove(order.delayCloseJobId);
        } catch { /* job already executed or not found */ }
      }

      // 6) Push Socket.io event
      try {
        this.gateway.emitSubscriptionPaymentSuccess(orderNo, order.payableAmount!);
      } catch { /* best-effort */ }
    } catch (err) {
      Sentry.captureException(err, (scope) => {
        scope.setTag('module', 'subscription-payment-success');
        scope.setTag('orderNo', orderNo);
        scope.setLevel('fatal');
        return scope;
      });
      this.logger.error(JSON.stringify({
        event: 'subscription_payment_activation_failed',
        orderNo,
        error: (err as Error).message,
      }));
      throw err; // Let BullMQ retry
    }
  }
}
