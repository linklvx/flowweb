import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditService } from '../credit/credit.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { generateRechargeOrderNo } from '../../common/utils/order-no';
import type { IPaymentProvider } from './providers/payment.provider.interface';

const AMOUNT_MIN_FEN = 100;      // 1 元
const AMOUNT_MAX_FEN = 1000000;  // 10000 元

@Injectable()
export class RechargeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CreditService) private readonly credit: CreditService,
    @Inject('PAYMENT_PROVIDER') private readonly payment: IPaymentProvider,
  ) {}

  async createOrder(userId: string, amountFen: number) {
    if (amountFen < AMOUNT_MIN_FEN || amountFen > AMOUNT_MAX_FEN) {
      throw new BusinessException('INVALID_RECHARGE_AMOUNT', '金额范围 1~10000 元');
    }

    return this.prisma.rechargeOrder.create({
      data: {
        orderNo: generateRechargeOrderNo(userId),
        userId,
        amount: amountFen,
        status: 'PENDING',
      },
    });
  }

  async pay(orderNo: string, userId: string) {
    // ===== 前置校验 =====
    const order = await this.prisma.rechargeOrder.findUnique({ where: { orderNo } });
    if (!order || order.userId !== userId) {
      throw new BusinessException('RECHARGE_ORDER_NOT_FOUND', '订单不存在');
    }
    // 终态订单幂等返回
    if (order.status !== 'PENDING') {
      return order;
    }

    // ===== 调用支付渠道（事务外） =====
    const payResult = await this.payment.pay({ orderNo, amount: order.amount, userId });
    if (!payResult.success) {
      await this.prisma.rechargeOrder.updateMany({
        where: { orderNo, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
      throw new BusinessException('RECHARGE_PAY_CHANNEL_FAILED', '支付渠道返回失败');
    }

    // ===== 数据库事务 =====
    try {
      return await this.prisma.$transaction(async (tx) => {
        // ① 行锁读取余额（upsert + update: { updatedAt } 触发 PostgreSQL 行级排他锁）
        const ub = await tx.userBalance.upsert({
          where: { userId },
          update: { updatedAt: new Date() },
          create: { userId, balance: 0, version: 0 },
        });
        const balanceBefore = ub.balance;
        const balanceAfter = balanceBefore + order.amount;

        // ② 原子递增余额
        await tx.userBalance.update({
          where: { userId },
          data: { balance: { increment: order.amount } },
        });

        // ③ 条件更新订单（并发兜底）
        const updated = await tx.rechargeOrder.updateMany({
          where: { orderNo, status: 'PENDING' },
          data: {
            status: 'SUCCESS',
            paidAt: new Date(),
            payChannel: 'mock',
            tradeNo: payResult.tradeNo,
            balanceBefore,
            balanceAfter,
          },
        });

        if (updated.count === 0) {
          return tx.rechargeOrder.findUnique({ where: { orderNo } });
        }

        return tx.rechargeOrder.findUnique({ where: { orderNo } });
      });
    } catch (err) {
      if (err instanceof BusinessException) throw err;
      await this.prisma.rechargeOrder.updateMany({
        where: { orderNo, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
      throw new BusinessException('RECHARGE_BALANCE_UPDATE_FAILED', '余额更新事务执行失败');
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
}
