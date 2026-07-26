import { Injectable, Inject, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditService } from '../credit/credit.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { generateRechargeOrderNo } from '../../common/utils/order-no';
import { QUEUE_NAMES } from '../../config/queue.constants';
import type { IPaymentProvider } from './providers/payment.provider.interface';
import { PaymentGateway } from './payment.gateway';

const RECHARGE_TIERS_FEN = [1000, 3000, 5000, 10000, 20000, 50000];

@Injectable()
export class RechargeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CreditService) private readonly credit: CreditService,
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
      if (err instanceof BusinessException) throw err;
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
      await this.payment.closePayment(orderNo);
    } catch {
      // If WeChat says already paid, check the actual status
      const queryResult = await this.payment.queryOrder(orderNo);
      if (queryResult.tradeState === 'SUCCESS') {
        // Don't force close — let the callback/query handle it
        return;
      }
      // Otherwise force-close locally (WeChat already closed or not found)
    }

    await this.prisma.rechargeOrder.updateMany({
      where: { orderNo, status: 'PENDING' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
  }

  async handleCallback(headers: Record<string, string>, rawBody: Buffer) {
    const contentType = headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return { code: 'FAIL', message: 'Invalid Content-Type' };
    }

    // Nonce dedup via Redis
    const nonce = headers['wechatpay-nonce'];
    if (nonce && this.redis) {
      const key = `wechat:pay:notify:nonce:${nonce}`;
      const exists = await this.redis.get(key);
      if (exists) {
        return { code: 'SUCCESS', message: 'OK' };
      }
      await this.redis.set(key, '1', 'EX', 300);
    }

    // Parse and verify signature
    let notify;
    try {
      notify = await this.payment.parseNotify(headers, rawBody);
    } catch {
      return { code: 'FAIL', message: 'signature verification failed' };
    }

    // Load order
    const order = await this.prisma.rechargeOrder.findUnique({
      where: { orderNo: notify.outTradeNo },
    });

    if (!order) {
      return { code: 'FAIL', message: 'order not found' };
    }

    // Idempotent: terminal state
    if (order.status === 'SUCCESS' || order.status === 'CLOSED') {
      return { code: 'SUCCESS', message: 'OK' };
    }

    // Business validation: appid, mchid, amount
    if (
      notify.appid !== process.env.WECHAT_PAY_APP_ID ||
      notify.mchid !== process.env.WECHAT_PAY_MCH_ID
    ) {
      return { code: 'FAIL', message: 'appid/mchid mismatch' };
    }

    if (notify.amount !== order.amount) {
      return { code: 'FAIL', message: 'amount mismatch' };
    }

    if (notify.tradeState !== 'SUCCESS') {
      return { code: 'FAIL', message: `trade_state: ${notify.tradeState}` };
    }

    // Credit balance in transaction
    let balanceAfter = 0;
    try {
      await this.prisma.$transaction(async (tx) => {
        // FOR UPDATE row lock
        await tx.$queryRaw`
          SELECT * FROM "UserBalance"
          WHERE "userId" = ${order.userId}
          FOR UPDATE
        `;

        const ub = await tx.userBalance.upsert({
          where: { userId: order.userId },
          update: {},
          create: { userId: order.userId, balance: 0, version: 0 },
        });

        const balanceBefore = ub.balance;
        balanceAfter = balanceBefore + order.amount;

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

        const updateResult = await tx.rechargeOrder.updateMany({
          where: { orderNo: notify.outTradeNo, status: 'PENDING' },
          data: {
            status: 'SUCCESS',
            paidAt: new Date(),
            transactionId: notify.transactionId,
            payerOpenid: notify.payerOpenid,
            balanceBefore,
            balanceAfter,
            notifySummary: {
              transactionId: notify.transactionId,
              tradeState: notify.tradeState,
              tradeStateDesc: notify.tradeStateDesc,
              amount: notify.amount,
            },
          },
        });

        if (updateResult.count === 0) {
          throw new Error('Order already processed in concurrent request');
        }
      });

      // Emit payment success via Socket.io
      try {
        this.gateway?.emitPaymentSuccess(notify.outTradeNo, notify.amount, balanceAfter);
      } catch {
        // Socket emit is best-effort
      }

      return { code: 'SUCCESS', message: 'OK' };
    } catch (err) {
      console.error(`[Callback] Transaction failed for ${notify.outTradeNo}:`, (err as Error).message);
      this.gateway?.emitPaymentFailed(notify.outTradeNo);
      return { code: 'FAIL', message: 'internal error' };
    }
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
