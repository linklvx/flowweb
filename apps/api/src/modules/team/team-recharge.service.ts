import { Injectable, Inject, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import type { IPaymentProvider } from '../recharge/providers/payment.provider.interface';
import { PaymentGateway } from '../recharge/payment.gateway';
import { TeamSubscriptionService } from './team-subscription.service';
import { AuditService } from '../../common/audit/audit.service';

const TEAM_TIERS_FEN = [1000, 3000, 5000, 10000, 20000, 50000];
const FEN_PER_CREDIT = 10; // 1 元 = 10 积分

export function generateTeamOrderNo(): string {
  const ts = Date.now().toString();
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  return `TEAM${ts}${random}`;
}

function formatTimeExpire(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

@Injectable()
export class TeamRechargeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TeamSubscriptionService) private readonly subscriptionService: TeamSubscriptionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject('PAYMENT_PROVIDER') private readonly payment: IPaymentProvider | null,
    @Inject(PaymentGateway) private readonly gateway?: PaymentGateway,
    @Optional() @InjectQueue('team-recharge-close-expired') private readonly closeQueue?: Queue,
  ) {}

  async createTeamOrder(teamId: string, payerUserId: string, amountFen: number) {
    if (!TEAM_TIERS_FEN.includes(amountFen)) {
      throw new BusinessException('INVALID_RECHARGE_AMOUNT', '充值金额无效，请选择预设档位');
    }

    const outTradeNo = generateTeamOrderNo();
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

    const order = await this.prisma.teamRechargeOrder.create({
      data: {
        outTradeNo,
        teamId,
        payerUserId,
        amountFen,
        credits: amountFen / FEN_PER_CREDIT,
        status: 'PENDING',
        expiresAt,
      },
    });

    try {
      this.closeQueue?.add('team-close-expired', { orderNo: outTradeNo }, { delay: 2 * 60 * 60 * 1000 });
    } catch {
      // fire-and-forget：漏投由 active-query 兜底
    }

    return order;
  }

  async payTeamOrder(orderNo: string, payerUserId: string) {
    const order = await this.prisma.teamRechargeOrder.findUnique({ where: { outTradeNo: orderNo } });
    if (!order || order.payerUserId !== payerUserId) {
      throw new BusinessException('RECHARGE_ORDER_NOT_FOUND', '订单不存在');
    }
    if (order.status !== 'PENDING') {
      throw new BusinessException('RECHARGE_ORDER_STATUS_ERROR', '订单状态不允许支付');
    }
    if (order.prepayId) {
      return { orderNo: order.outTradeNo, amount: order.amountFen, status: order.status, codeUrl: null };
    }
    if (!this.payment) {
      throw new BusinessException('RECHARGE_UNAVAILABLE', '充值服务暂未配置，请稍后重试');
    }

    const payResult = await this.payment.createPayment({
      orderNo: order.outTradeNo,
      amount: order.amountFen,
      userId: payerUserId,
      description: `Flow123 团队积分充值 - ${order.amountFen / 100}元`,
      notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL || `${process.env.CORS_ORIGIN}/api/recharge/notify/wechat`,
      timeExpire: formatTimeExpire(new Date(order.createdAt.getTime() + 2 * 60 * 60 * 1000)),
    });

    await this.prisma.teamRechargeOrder.updateMany({
      where: { outTradeNo: orderNo, status: 'PENDING' },
      data: { prepayId: payResult.prepayId },
    });

    return { orderNo: order.outTradeNo, amount: order.amountFen, status: order.status, codeUrl: payResult.codeUrl };
  }

  /** TEAM* 回调入口（签名/nonce 去重已在 RechargeService.handleCallback 统一处理）；kind 分支结构 Task 10 扩展 subscription */
  async completeTeamCallback(notify: {
    outTradeNo: string; appid: string; mchid: string; amount: number;
    tradeState: string; transactionId: string; payerOpenid?: string;
  }): Promise<{ code: string; message?: string }> {
    const order = await this.prisma.teamRechargeOrder.findUnique({ where: { outTradeNo: notify.outTradeNo } });
    if (!order) return { code: 'FAIL', message: 'order not found' };
    if (order.status === 'SUCCESS' || order.status === 'CLOSED') return { code: 'SUCCESS', message: 'OK' };

    if (
      (process.env.WECHAT_PAY_APP_ID && notify.appid !== process.env.WECHAT_PAY_APP_ID) ||
      (process.env.WECHAT_PAY_MCH_ID && notify.mchid !== process.env.WECHAT_PAY_MCH_ID)
    ) {
      return { code: 'FAIL', message: 'appid/mchid mismatch' };
    }
    if (notify.amount !== order.amountFen) return { code: 'FAIL', message: 'amount mismatch' };
    if (notify.tradeState !== 'SUCCESS') return { code: 'FAIL', message: `trade_state: ${notify.tradeState}` };

    if ((order as any).kind === 'subscription') {
      const result = await this.subscriptionService.completeSubscriptionCallback(notify);
      // 团队订单无单查端点（WeChatQRModal 无轮询兜底），socket 是前端关弹窗唯一通道；前端不读 payload，credits 传 0
      if (result.code === 'SUCCESS') this.gateway?.emitPaymentSuccess(notify.outTradeNo, notify.amount, 0);
      return result;
    }

    try {
      await this.creditTeamBalance(order, notify.transactionId, notify.payerOpenid);
      this.gateway?.emitPaymentSuccess(notify.outTradeNo, notify.amount, order.credits);
      return { code: 'SUCCESS', message: 'OK' };
    } catch {
      this.gateway?.emitPaymentFailed(notify.outTradeNo);
      return { code: 'FAIL', message: 'internal error' };
    }
  }

  private async creditTeamBalance(
    order: { outTradeNo: string; teamId: string | null; payerUserId: string; credits: number },
    transactionId: string,
    payerOpenid?: string,
  ): Promise<void> {
    const teamId = order.teamId!;
    let balanceAfter = 0;
    const payerName = (await this.prisma.user.findUnique({ where: { id: order.payerUserId }, select: { name: true } }))?.name ?? '未知';

    await this.prisma.$transaction(async (tx) => {
      // FOR UPDATE 行锁（对齐个人版幂等模式）
      await tx.$queryRaw`
        SELECT * FROM "TeamBalance"
        WHERE "teamId" = ${teamId}
        FOR UPDATE
      `;

      const balance = await tx.teamBalance.findUnique({ where: { teamId } });
      if (!balance) {
        await tx.teamBalance.create({ data: { teamId, credits: 0 } });
      }
      balanceAfter = (balance?.credits ?? 0) + order.credits;

      await tx.teamBalance.update({
        where: { teamId },
        data: { credits: { increment: order.credits } },
      });

      await tx.teamCreditTransaction.create({
        data: {
          teamId,
          operatorUserId: order.payerUserId,
          amount: order.credits,
          type: 'recharge',
          creditType: 'regular',
          referenceId: order.outTradeNo,
          balanceAfter,
        },
      });

      const updated = await tx.teamRechargeOrder.updateMany({
        where: { outTradeNo: order.outTradeNo, status: 'PENDING' },
        data: {
          status: 'SUCCESS',
          paidAt: new Date(),
          transactionId,
          payerOpenid,
        },
      });
      if (updated.count === 0) throw new Error('Order already processed in concurrent request');

      await this.audit.logTx(tx, {
        operatorId: order.payerUserId,
        operatorName: payerName,
        teamId,
        targetType: 'TEAM',
        targetId: teamId,
        action: 'recharge',
        afterValue: { credits: order.credits },
      });
    });
  }

  /** 订单列表（成员可查，controller TeamGuard） */
  async listOrders(teamId: string, page = 1, pageSize = 20, kind?: 'credits' | 'subscription') {
    const where: any = { teamId };
    if (kind) where.kind = kind;
    const [items, total] = await Promise.all([
      this.prisma.teamRechargeOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.teamRechargeOrder.count({ where }),
    ]);
    return { items, total };
  }

  /** 过期关单（close-expired / active-query CLOSED 共用） */
  async closeExpired(orderNo: string): Promise<void> {
    const order = await this.prisma.teamRechargeOrder.findUnique({ where: { outTradeNo: orderNo } });
    if (!order || order.status !== 'PENDING') return;

    if (this.payment) {
      try {
        await this.payment.closePayment(orderNo);
      } catch {
        // 微信侧已关或不存在——继续本地关单
      }
    }
    await this.prisma.teamRechargeOrder.updateMany({
      where: { outTradeNo: orderNo, status: 'PENDING' },
      data: { status: 'CLOSED' },
    });
  }
}
