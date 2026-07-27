import { Injectable, Inject, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from './pricing.service';
import { MetricsService } from '../../metrics/metrics.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { generateOrderNo } from '../../common/utils/order-no';
import { QUEUE_NAMES } from '../../config/queue.constants';

const TIER_ORDER: Record<string, number> = { basic: 0, pro: 1, max: 2, ultra: 3 };

interface CreateOrderDto {
  planId: string;
  period: string;
  type: 'new_purchase' | 'upgrade';
}

const PRICE_FIELD: Record<string, string> = {
  monthly: 'priceMonthly',
  quarterly: 'priceQuarterly',
  annually: 'priceAnnually',
};

@Injectable()
export class SubscriptionOrderService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis,
    @Optional() @Inject('PAYMENT_PROVIDER') private readonly payment?: any,
    @Optional() @InjectQueue(QUEUE_NAMES.SUBSCRIPTION_CLOSE_EXPIRED)
    private readonly closeExpiredQueue?: Queue,
    @Optional() @InjectQueue(QUEUE_NAMES.SUBSCRIPTION_PAYMENT_SUCCESS)
    private readonly paymentSuccessQueue?: Queue,
  ) {}

  async createOrder(userId: string, dto: CreateOrderDto) {
    // Lock
    const lockKey = `lock:subscription:order:${userId}`;
    if (this.redis) {
      const locked = await this.redis.set(lockKey, '1', 'EX', 10, 'NX');
      if (!locked) throw new BusinessException('SUBSCRIPTION_DUPLICATE_ORDER', '请稍后再试');
    }

    try {
      // Validate plan
      const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: dto.planId } });
      if (!plan) throw new BusinessException('PLAN_NOT_FOUND', '套餐不存在');

      // Pre-condition check
      const activeSub = await this.prisma.userSubscription.findFirst({
        where: { userId, status: 'active' },
      });

      if (dto.type === 'new_purchase' && activeSub) {
        throw new BusinessException('SUBSCRIPTION_ALREADY_ACTIVE', '已有有效订阅，请使用升级功能');
      }

      if (dto.type === 'upgrade') {
        if (!activeSub) throw new BusinessException('SUBSCRIPTION_NO_ACTIVE', '没有有效订阅');
        if (TIER_ORDER[plan.tier] <= TIER_ORDER[activeSub.tier]) {
          throw new BusinessException('UPGRADE_INVALID_TIER', '只能升级到更高等级套餐');
        }
      }

      // Calculate price (all values below in fen)
      let originalAmount: number;
      let payableAmount: number;
      let prorationAmount: number | undefined;
      let fromSubscriptionId: string | undefined;
      let fromPlanId: string | undefined;
      let pricingSnapshot: any = undefined;

      if (dto.type === 'new_purchase') {
        const priceField = PRICE_FIELD[dto.period] || 'priceMonthly';
        const priceYuan = (plan as any)[priceField] as number || plan.priceMonthly;
        originalAmount = priceYuan * 100;
        payableAmount = priceYuan * 100;
      } else {
        const priceField = PRICE_FIELD[dto.period] || 'priceMonthly';
        const targetPrice = (plan as any)[priceField] as number || plan.priceMonthly;
        const calc = this.pricing.calculate(activeSub!, plan.tier, dto.period, targetPrice);
        originalAmount = calc.targetOriginalPrice * 100;
        payableAmount = calc.payableAmount * 100;
        prorationAmount = calc.deductibleAmount * 100;
        fromSubscriptionId = activeSub!.id;
        fromPlanId = activeSub!.planId;
        pricingSnapshot = {
          currentTier: activeSub!.tier,
          currentPeriod: activeSub!.period,
          targetTier: plan.tier,
          targetPeriod: dto.period,
          sourcePaidAmount: calc.sourcePaidAmount,
          remainTimeRatio: calc.remainTimeRatio,
          remainPointsRatio: calc.remainPointsRatio,
          finalRatio: calc.finalRatio,
          targetOriginalPrice: calc.targetOriginalPrice,
          deductibleAmount: calc.deductibleAmount,
          payableAmount: calc.payableAmount,
          calculatedAt: new Date().toISOString(),
        };
      }

      // Clean ALL old PENDING orders (bulk cleanup, avoid residual orders)
      const oldPendingOrders = await this.prisma.subscriptionOrder.findMany({
        where: { userId, status: 'PENDING' },
      });

      for (const old of oldPendingOrders) {
        if (old.prepayId && this.payment) {
          try {
            await this.payment.closePayment(old.orderNo);
          } catch {
            // Degrade: close locally even if WeChat API fails
          }
        }
        await this.prisma.subscriptionOrder.update({
          where: { id: old.id },
          data: { status: 'CLOSED', closedAt: new Date() },
        });
      }

      // Create order
      const orderNo = generateOrderNo();
      const expiredAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

      const order = await this.prisma.subscriptionOrder.create({
        data: {
          orderNo,
          userId,
          planId: dto.planId,
          period: dto.period as any,
          type: dto.type as any,
          originalAmount,
          payableAmount,
          prorationAmount,
          fromSubscriptionId,
          fromPlanId,
          pricingSnapshot,
          status: 'PENDING',
          payChannel: 'wechat',
          expiredAt,
        },
      });

      this.metrics.subOrdersCreatedTotal?.inc({
        plan_tier: plan.tier,
        type: dto.type,
      });

      // Dispatch delayed close task
      if (this.closeExpiredQueue) {
        const jobId = `sub_close:${orderNo}`;
        try {
          const job = await this.closeExpiredQueue.add(
            'close-expired-sub-order',
            { orderNo, userId },
            { delay: 2 * 60 * 60 * 1000, jobId },
          );
          await this.prisma.subscriptionOrder.update({
            where: { id: order.id },
            data: { delayCloseJobId: job.id },
          });
        } catch {
          // Fire-and-forget: timeout close task will scan PENDING orders
        }
      }

      return { orderNo: order.orderNo, amount: payableAmount, expiredAt: order.expiredAt!.toISOString() };
    } finally {
      if (this.redis) await this.redis.del(lockKey);
    }
  }

  async pay(orderNo: string, userId: string) {
    const order = await this.prisma.subscriptionOrder.findUnique({ where: { orderNo } });
    if (!order) throw new BusinessException('SUBSCRIPTION_ORDER_NOT_FOUND', '订单不存在');
    if (order.userId !== userId) throw new BusinessException('SUBSCRIPTION_ORDER_NOT_OWNER', '订单不属于当前用户');
    if (order.status !== 'PENDING') throw new BusinessException('SUBSCRIPTION_ORDER_STATUS_INVALID', '订单状态不允许支付');
    if (order.expiredAt && order.expiredAt <= new Date()) {
      throw new BusinessException('SUBSCRIPTION_ORDER_EXPIRED', '订单已过期，请重新下单');
    }

    // Idempotent: return existing codeUrl if prepayId exists
    if (order.prepayId && this.payment) {
      try {
        const wxOrder = await this.payment.queryOrder(orderNo);
        if (wxOrder.tradeState === 'NOTPAY') {
          return {
            orderNo: order.orderNo,
            amount: order.payableAmount,
            codeUrl: wxOrder.codeUrl || null,
          };
        }
        // WeChat order already closed, mark local as FAILED
        await this.prisma.subscriptionOrder.update({
          where: { id: order.id },
          data: { status: 'FAILED', closedAt: new Date() },
        });
        throw new BusinessException('SUBSCRIPTION_ORDER_STATUS_INVALID', '微信订单已关闭，请重新下单');
      } catch (err) {
        if (err instanceof BusinessException) throw err;
        // Query failed, try to create new prepay
      }
    }

    if (!this.payment) {
      throw new BusinessException('PAYMENT_NOT_CONFIGURED', '支付服务暂未配置');
    }

    this.metrics.subPaymentsInitiatedTotal?.inc();

    try {
      const result = await this.payment.createPayment({
        orderNo,
        amount: order.payableAmount,
        userId: order.userId,
        description: '会员订阅',
        notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL || `${process.env.CORS_ORIGIN}/api/recharge/notify/wechat`,
        timeExpire: formatTimeExpire(new Date(Date.now() + 2 * 60 * 60 * 1000)),
      });

      await this.prisma.subscriptionOrder.update({
        where: { id: order.id },
        data: { prepayId: result.prepayId },
      });

      return {
        orderNo: order.orderNo,
        amount: order.payableAmount,
        codeUrl: result.codeUrl,
      };
    } catch (err) {
      await this.prisma.subscriptionOrder.update({
        where: { id: order.id },
        data: { status: 'FAILED' },
      });
      throw err;
    }
  }

  async query(orderNo: string, userId: string) {
    const order = await this.prisma.subscriptionOrder.findUnique({
      where: { orderNo },
      select: { orderNo: true, payableAmount: true, status: true, payChannel: true, paidAt: true, userId: true },
    });

    if (!order) throw new BusinessException('SUBSCRIPTION_ORDER_NOT_FOUND', '订单不存在');
    if (order.userId !== userId) throw new BusinessException('SUBSCRIPTION_ORDER_NOT_OWNER', '订单不属于当前用户');

    return {
      orderNo: order.orderNo,
      amount: order.payableAmount,
      status: order.status,
      payChannel: order.payChannel,
      paidAt: order.paidAt,
    };
  }

  async close(orderNo: string, userId: string) {
    const order = await this.prisma.subscriptionOrder.findUnique({ where: { orderNo } });
    if (!order) throw new BusinessException('SUBSCRIPTION_ORDER_NOT_FOUND', '订单不存在');
    if (order.userId !== userId) throw new BusinessException('SUBSCRIPTION_ORDER_NOT_OWNER', '订单不属于当前用户');

    // Idempotent
    if (order.status === 'CLOSED' || order.status === 'SUCCESS') return { success: true };
    if (order.status !== 'PENDING') {
      throw new BusinessException('SUBSCRIPTION_ORDER_STATUS_INVALID', '订单状态不允许关闭');
    }

    // Close WeChat order if prepayId exists
    if (order.prepayId && this.payment) {
      try { await this.payment.closePayment(orderNo); } catch { /* degrade */ }
    }

    // Remove delayed close task
    if (order.delayCloseJobId && this.closeExpiredQueue) {
      try { await this.closeExpiredQueue.remove(order.delayCloseJobId); } catch { /* job already done */ }
    }

    await this.prisma.subscriptionOrder.update({
      where: { id: order.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });

    return { success: true };
  }

  async processPaymentCallback(notify: any) {
    const order = await this.prisma.subscriptionOrder.findUnique({
      where: { orderNo: notify.outTradeNo },
    });

    if (!order) return { code: 'FAIL', message: 'order not found' };

    // Idempotent: already terminal state
    if (order.status === 'SUCCESS') return { code: 'SUCCESS', message: 'OK' };
    if (order.status === 'CLOSED' || order.status === 'FAILED') {
      return { code: 'FAIL', message: 'order already terminated' };
    }

    // Business validation
    if (notify.tradeState !== 'SUCCESS') {
      return { code: 'FAIL', message: `trade_state: ${notify.tradeState}` };
    }

    // Mandatory: amount must match exactly (both in fen, integer comparison)
    if (notify.amount !== order.payableAmount) {
      return { code: 'FAIL', message: 'amount mismatch' };
    }

    // Store raw notification
    await this.prisma.subscriptionOrder.update({
      where: { id: order.id },
      data: {
        notifySummary: {
          transactionId: notify.transactionId,
          tradeState: notify.tradeState,
          tradeStateDesc: notify.tradeStateDesc,
          amount: notify.amount,
          payerOpenid: notify.payerOpenid,
        },
      },
    });

    // Dispatch async activation task
    if (this.paymentSuccessQueue) {
      await this.paymentSuccessQueue.add('process-payment-success', {
        orderNo: notify.outTradeNo,
        transactionId: notify.transactionId,
        payerOpenid: notify.payerOpenid,
      });
    }

    this.metrics.subPaymentsSucceededTotal?.inc();

    return { code: 'SUCCESS', message: 'OK' };
  }
}

function formatTimeExpire(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}+08:00`;
}
