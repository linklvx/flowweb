import { Controller, Post, Get, Inject, Req, Body, Param, Query, UnauthorizedException } from '@nestjs/common';
import { SubscriptionOrderService } from './subscription-order.service';

@Controller('api/subscription')
export class SubscriptionOrderController {
  constructor(@Inject(SubscriptionOrderService) private readonly orderService: SubscriptionOrderService) {}

  private uid(req: any): string {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    return userId;
  }

  @Post('orders')
  async createOrder(
    @Req() req: any,
    @Body() body: { planId: string; period: string; type: string },
  ) {
    return this.orderService.createOrder(this.uid(req), {
      planId: body.planId,
      period: body.period,
      type: body.type as 'new_purchase' | 'upgrade',
    });
  }

  @Post('orders/:orderNo/pay')
  async pay(@Param('orderNo') orderNo: string, @Req() req: any) {
    return this.orderService.pay(orderNo, this.uid(req));
  }

  @Get('orders/:orderNo')
  async query(@Param('orderNo') orderNo: string, @Req() req: any) {
    return this.orderService.query(orderNo, this.uid(req));
  }

  @Post('orders/:orderNo/close')
  async close(@Param('orderNo') orderNo: string, @Req() req: any) {
    return this.orderService.close(orderNo, this.uid(req));
  }

  @Get('orders')
  async list(
    @Req() req: any,
    @Query() query: { status?: string; page?: string; pageSize?: string },
  ) {
    return this.orderService.list(this.uid(req), {
      status: query.status,
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 20,
    });
  }
}
