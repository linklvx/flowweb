import { Controller, Post, Get, Param, Query, Body, Req, Inject, UseGuards, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { RechargeService } from './recharge.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { NoTransform } from '../../common/decorators/no-transform.decorator';
import { ThrottleUserGuard } from './guards/throttle-user.guard';

const RECHARGE_TIERS_YUAN = [10, 30, 50, 100, 200, 500];

function fenToYuan(fen: number): number {
  return Math.round(fen) / 100;
}

function extractClientIp(req: any): string {
  const xff: string = req.headers?.['x-forwarded-for'] || '';
  const ips = xff.split(',').map((s: string) => s.trim());
  for (const ip of ips) {
    if (
      ip &&
      !ip.startsWith('10.') &&
      !ip.match(/^172\.(1[6-9]|2\d|3[01])\./) &&
      !ip.startsWith('192.168.')
    ) {
      return ip;
    }
  }
  return req.headers?.['x-real-ip'] || '0.0.0.0';
}

@Controller('api/recharge')
@UseGuards(AuthGuard)
export class RechargeController {
  constructor(@Inject(RechargeService) private readonly service: RechargeService) {}

  @Post('orders')
  @UseGuards(ThrottleUserGuard)
  async createOrder(@Req() req: any, @Body() body: { amount: number }) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();

    const amountYuan = Number(body.amount);
    const amountFen = Math.round(amountYuan * 100);
    if (!RECHARGE_TIERS_YUAN.includes(amountYuan)) {
      throw new BusinessException('INVALID_RECHARGE_AMOUNT', '充值金额无效，请选择预设档位');
    }

    const clientIp = extractClientIp(req);
    const order = await this.service.createOrder(userId, amountFen, clientIp);
    return {
      id: order.id,
      orderNo: order.orderNo,
      amount: fenToYuan(order.amount),
      status: order.status,
      createdAt: order.createdAt.toISOString(),
    };
  }

  @Post('orders/:orderNo/pay')
  async pay(@Req() req: any, @Param('orderNo') orderNo: string) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();

    const result = await this.service.pay(orderNo, userId);
    return {
      orderNo: result.orderNo,
      amount: fenToYuan(result.amount),
      status: result.status,
      codeUrl: result.codeUrl,
    };
  }

  @Get('orders')
  async getOrders(@Req() req: any, @Query() query: { page?: string; pageSize?: string }) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();

    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;
    const result = await this.service.getOrders(userId, page, pageSize);

    return {
      items: result.items.map((o: any) => ({
        id: o.id,
        orderNo: o.orderNo,
        amount: fenToYuan(o.amount),
        balanceBefore: fenToYuan(o.balanceBefore),
        balanceAfter: fenToYuan(o.balanceAfter),
        status: o.status,
        payChannel: o.payChannel,
        prepayId: o.prepayId,
        transactionId: o.transactionId,
        paidAt: o.paidAt?.toISOString() ?? null,
        expiredAt: o.expiredAt?.toISOString() ?? null,
        closedAt: o.closedAt?.toISOString() ?? null,
        createdAt: o.createdAt.toISOString(),
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  @Get('orders/:orderNo')
  async getOrder(@Req() req: any, @Param('orderNo') orderNo: string) {
    const order = await this.service.queryOrder(orderNo);
    return {
      orderNo: order.orderNo,
      amount: fenToYuan(order.amount),
      status: order.status,
      payChannel: order.payChannel,
      paidAt: order.paidAt?.toISOString() ?? null,
      expiredAt: order.expiredAt?.toISOString() ?? null,
      closedAt: order.closedAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
    };
  }

  @Post('orders/:orderNo/close')
  async closeOrder(@Req() req: any, @Param('orderNo') orderNo: string) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();

    await this.service.closeOrder(orderNo, userId);
    return { success: true };
  }

  @Post('notify/wechat')
  @NoTransform()
  async notify(@Req() req: any) {
    try {
      const result = await this.service.handleCallback(
        req.headers || {},
        req.rawBody || Buffer.from(JSON.stringify(req.body || {})),
      );
      return result;
    } catch (err) {
      return { code: 'FAIL', message: (err as Error).message };
    }
  }
}
