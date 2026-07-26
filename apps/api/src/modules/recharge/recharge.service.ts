import { Injectable, Inject, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { generateRechargeOrderNo } from '../../common/utils/order-no';
import { QUEUE_NAMES } from '../../config/queue.constants';
import type { IPaymentProvider } from './providers/payment.provider.interface';
import { PaymentGateway } from './payment.gateway';
import { MetricsService } from '../../metrics/metrics.service';

const RECHARGE_TIERS_FEN = [1000, 3000, 5000, 10000, 20000, 50000];

@Injectable()
export class RechargeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject('PAYMENT_PROVIDER') private readonly payment: IPaymentProvider,
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis,
    @Optional() @InjectQueue(QUEUE_NAMES.RECHARGE_CLOSE_EXPIRED) private readonly closeExpiredQueue?: Queue,
    @Optional() @InjectQueue(QUEUE_NAMES.RECHARGE_ACTIVE_QUERY) private readonly activeQueryQueue?: Queue,
    @Inject(PaymentGateway) private readonly gateway?: PaymentGateway,
  ) {}

  async createOrder(userId: string, amountFen: number, clientIp: string) {
    if (!RECHARGE_TIERS_FEN.includes(amountFen)) {
      throw new BusinessException('INVALID_RECHARGE_AMOUNT', '充值金额无效，请选择预设档位');
    }

    const expiredAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const orderNo = generateRechargeOrderNo(userId);

    const order = await this.prisma.rechargeOrder.create({
      data: { orderNo, userId, amount: amountFen, status: 'PENDING', clientIp, expiredAt },
    });

    this.metrics.ordersCreatedTotal.inc({ amount_tier: String(amountFen / 100) });

    // Dispatch BullMQ tasks (fire-and-forget, failures handled by retry + daily scan)
    try {
      this.closeExpiredQueue?.add('close-expired-order', { orderNo, userId }, { delay: 2 * 60 * 60 * 1000 });
      this.activeQueryQueue?.add('active-query', { orderNo, userId }, { delay: 5 * 60 * 1000 });
      this.activeQueryQueue?.add('active-query', { orderNo, userId }, { delay: 15 * 60 * 1000 });
      this.activeQueryQueue?.add('active-query', { orderNo, userId }, { delay: 30 * 60 * 1000 });
    } catch {
      // Fire-and-forget: daily scan will catch any missed orders
    }

    return order;
  }

  async pay(orderNo: string, userId: string) {
    const order = await this.prisma.rechargeOrder.findUnique({ where: { orderNo } });
    if (!order || order.userId !== userId) {
      throw new BusinessException('RECHARGE_ORDER_NOT_FOUND', '订单不存在');
    }

    if (order.status !== 'PENDING') {
      throw new BusinessException('RECHARGE_ORDER_STATUS_ERROR', '订单状态不允许支付');
    }

    if (order.prepayId) {
      return {
        orderNo: order.orderNo,
        amount: order.amount,
        status: order.status,
        codeUrl: null as string | null,
      };
    }

    if (!this.payment) {
      throw new BusinessException('RECHARGE_UNAVAILABLE', '充值服务暂未配置，请稍后重试');
    }

    const endTimer = this.metrics.wechatApiDurationSeconds.startTimer({ api: 'create_payment' });

    try {
      const amountYuan = order.amount / 100;
      const description = `Flow123 AI创作平台充值 - ${amountYuan}元`;
      const timeExpire = formatTimeExpire(new Date(order.createdAt.getTime() + 2 * 60 * 60 * 1000));

      const payResult = await this.payment.createPayment({
        orderNo: order.orderNo,
        amount: order.amount,
        userId,
        description,
        notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL || `${process.env.CORS_ORIGIN}/api/recharge/notify/wechat`,
        timeExpire,
      });
      endTimer();

      await this.prisma.rechargeOrder.updateMany({
        where: { orderNo, status: 'PENDING' },
        data: {
          payChannel: 'wechat',
          prepayId: payResult.prepayId,
        },
      });

      return {
        orderNo: order.orderNo,
        amount: order.amount,
        status: order.status,
        codeUrl: payResult.codeUrl,
      };
    } catch (err) {
      endTimer();
      if (err instanceof BusinessException) throw err;

      Sentry.captureException(err, (scope) => {
        scope.setTag('module', 'recharge');
        scope.setTag('orderNo', orderNo);
        scope.setTag('userId', userId);
        scope.setLevel('error');
        return scope;
      });

      throw new BusinessException('RECHARGE_PAY_CHANNEL_FAILED', '支付渠道暂时不可用，请稍后重试');
    }
  }

  async getOrders(userId: string, page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;
    const where = { userId };

    const [items, total] = await Promise.all([
      this.prisma.rechargeOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.rechargeOrder.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async queryOrder(orderNo: string) {
    const order = await this.prisma.rechargeOrder.findUnique({ where: { orderNo } });
    if (!order) {
      throw new BusinessException('RECHARGE_ORDER_NOT_FOUND', '订单不存在');
    }
    return order;
  }

  async closeOrder(orderNo: string, userId: string) {
    const order = await this.prisma.rechargeOrder.findUnique({ where: { orderNo } });
    if (!order || order.userId !== userId) {
      throw new BusinessException('RECHARGE_ORDER_NOT_FOUND', '订单不存在');
    }

    // Idempotent: terminal states return immediately
    if (order.status === 'CLOSED' || order.status === 'SUCCESS') {
      return;
    }

    // Try to close on WeChat side
    try {
      const endTimer = this.metrics.wechatApiDurationSeconds.startTimer({ api: 'close_payment' });
      await this.payment.closePayment(orderNo);
      endTimer();
    } catch {
      // If WeChat says already paid, check the actual status
      const queryResult = await this.payment.queryOrder(orderNo);
      if (queryResult.tradeState === 'SUCCESS') {
        // Don't force close — let the callback/query handle it
        return;
      }
      this.metrics.ordersClosedTotal.inc({ reason: 'api_fail' });
      // Otherwise force-close locally (WeChat already closed or not found)
    }

    await this.prisma.rechargeOrder.updateMany({
      where: { orderNo, status: 'PENDING' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });

    this.metrics.ordersClosedTotal.inc({ reason: 'expired' });
  }

  async handleCallback(headers: Record<string, string>, rawBody: Buffer) {
    const endDuration = this.metrics.callbackDurationSeconds.startTimer();

    const contentType = headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      endDuration({ result: 'error' });
      return { code: 'FAIL', message: 'Invalid Content-Type' };
    }

    // Nonce dedup via Redis
    const nonce = headers['wechatpay-nonce'];
    if (nonce && this.redis) {
      const key = `wechat:pay:notify:nonce:${nonce}`;
      const exists = await this.redis.get(key);
      if (exists) {
        endDuration({ result: 'success' });
        return { code: 'SUCCESS', message: 'OK' };
      }
      await this.redis.set(key, '1', 'EX', 300);
    }

    // Parse and verify signature
    let notify;
    try {
      notify = await this.payment.parseNotify(headers, rawBody);
    } catch (err) {
      this.metrics.callbackTotal.inc({ result: 'sig_fail' });
      endDuration({ result: 'sig_fail' });

      Sentry.captureException(err, (scope) => {
        scope.setTag('module', 'recharge');
        scope.setLevel('error');
        return scope;
      });

      return { code: 'FAIL', message: 'signature verification failed' };
    }

    // Load order
    const order = await this.prisma.rechargeOrder.findUnique({
      where: { orderNo: notify.outTradeNo },
    });

    if (!order) {
      endDuration({ result: 'error' });
      return { code: 'FAIL', message: 'order not found' };
    }

    // Idempotent: terminal state
    if (order.status === 'SUCCESS' || order.status === 'CLOSED') {
      endDuration({ result: 'success' });
      return { code: 'SUCCESS', message: 'OK' };
    }

    // Business validation: appid, mchid, amount
    if (
      notify.appid !== process.env.WECHAT_PAY_APP_ID ||
      notify.mchid !== process.env.WECHAT_PAY_MCH_ID
    ) {
      this.metrics.callbackTotal.inc({ result: 'amount_mismatch' });
      endDuration({ result: 'amount_mismatch' });
      return { code: 'FAIL', message: 'appid/mchid mismatch' };
    }

    if (notify.amount !== order.amount) {
      this.metrics.callbackTotal.inc({ result: 'amount_mismatch' });
      endDuration({ result: 'amount_mismatch' });
      return { code: 'FAIL', message: 'amount mismatch' };
    }

    if (notify.tradeState !== 'SUCCESS') {
      endDuration({ result: 'error' });
      return { code: 'FAIL', message: `trade_state: ${notify.tradeState}` };
    }

    // Complete order via shared method
    try {
      const balanceAfter = await this.completeOrderInTransaction(
        order.orderNo,
        order.userId,
        order.amount,
        'callback',
        notify.transactionId,
        notify.payerOpenid,
        {
          transactionId: notify.transactionId,
          tradeState: notify.tradeState,
          tradeStateDesc: notify.tradeStateDesc,
          amount: notify.amount,
        },
      );

      this.metrics.callbackTotal.inc({ result: 'success' });
      endDuration({ result: 'success' });

      // Emit payment success via Socket.io
      try {
        this.gateway?.emitPaymentSuccess(notify.outTradeNo, notify.amount, balanceAfter);
      } catch {
        // Socket emit is best-effort
      }

      return { code: 'SUCCESS', message: 'OK' };
    } catch (err) {
      this.metrics.callbackTotal.inc({ result: 'error' });
      endDuration({ result: 'error' });

      Sentry.captureException(err, (scope) => {
        scope.setTag('module', 'recharge');
        scope.setTag('orderNo', notify.outTradeNo);
        scope.setTag('userId', order.userId);
        scope.setLevel('fatal');
        return scope;
      });

      console.error(`[Callback] Transaction failed for ${notify.outTradeNo}:`, (err as Error).message);
      this.gateway?.emitPaymentFailed(notify.outTradeNo);
      return { code: 'FAIL', message: 'internal error' };
    }
  }

  private async completeOrderInTransaction(
    orderNo: string,
    userId: string,
    amount: number,
    channel: 'callback' | 'active_query',
    transactionId: string,
    payerOpenid?: string,
    notifySummary?: object,
  ): Promise<number> {
    let balanceAfter = 0;

    await this.prisma.$transaction(async (tx) => {
      // FOR UPDATE row lock
      await tx.$queryRaw`
        SELECT * FROM "UserBalance"
        WHERE "userId" = ${userId}
        FOR UPDATE
      `;

      const ub = await tx.userBalance.upsert({
        where: { userId },
        update: {},
        create: { userId, balance: 0, version: 0 },
      });

      const balanceBefore = ub.balance;
      balanceAfter = balanceBefore + amount;

      await tx.userBalance.update({
        where: { userId },
        data: { balance: balanceAfter },
      });

      await tx.userBalanceTransaction.create({
        data: {
          userId,
          amountFen: amount,
          balanceBefore,
          balanceAfter,
          type: 'RECHARGE',
          bizOrderNo: orderNo,
        },
      });

      const updateResult = await tx.rechargeOrder.updateMany({
        where: { orderNo, status: 'PENDING' },
        data: {
          status: 'SUCCESS',
          paidAt: new Date(),
          transactionId,
          payerOpenid,
          balanceBefore,
          balanceAfter,
          notifySummary,
        },
      });

      if (updateResult.count === 0) {
        throw new Error('Order already processed in concurrent request');
      }
    });

    // Metrics consistently counted regardless of which path completes the order
    this.metrics.ordersCompletedTotal.inc({ channel });
    this.metrics.amountFenTotal.inc(amount);

    return balanceAfter;
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
