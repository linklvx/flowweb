import { Controller, Post, Get, Param, Query, Body, Req, Inject, UseGuards, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { RechargeService } from './recharge.service';
import { BusinessException } from '../../common/exceptions/business.exception';

function fenToYuan(fen: number): number {
  return Math.round(fen) / 100;
}

@Controller('api/recharge')
@UseGuards(AuthGuard)
export class RechargeController {
  constructor(@Inject(RechargeService) private readonly service: RechargeService) {}

  @Post('orders')
  async createOrder(@Req() req: any, @Body() body: { amount: number }) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();

    const amountStr = String(body.amount);
    if (!/^\d+(\.\d{1,2})?$/.test(amountStr)) {
      throw new BusinessException('INVALID_RECHARGE_AMOUNT', '金额最多两位小数');
    }
    const amountYuan = Number(body.amount);
    const amountFen = Math.round(amountYuan * 100);
    if (amountFen < 100 || amountFen > 1000000) {
      throw new BusinessException('INVALID_RECHARGE_AMOUNT', '金额范围 1~10000 元');
    }

    const order = await this.service.createOrder(userId, amountFen);
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

    const order = await this.service.pay(orderNo, userId);
    if (!order) throw new UnauthorizedException();
    return {
      orderNo: order.orderNo,
      amount: fenToYuan(order.amount),
      balanceBefore: fenToYuan(order.balanceBefore),
      balanceAfter: fenToYuan(order.balanceAfter),
      status: order.status,
      paidAt: order.paidAt?.toISOString() ?? null,
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
        paidAt: o.paidAt?.toISOString() ?? null,
        createdAt: o.createdAt.toISOString(),
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }
}
