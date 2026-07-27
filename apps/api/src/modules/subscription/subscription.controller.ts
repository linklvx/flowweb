import { Controller, Get, Post, Inject, Req, UnauthorizedException, Body, Query } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { OrderService } from '../order/order.service';

@Controller('api/subscription')
export class SubscriptionController {
  constructor(
    @Inject(SubscriptionService) private readonly subService: SubscriptionService,
    @Inject(OrderService) private readonly orderService: OrderService,
  ) {}

  private uid(req: any): string {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    return userId;
  }

  @Get('plans')
  async getPlans() {
    return this.subService.getPlans();
  }

  @Get('me')
  async getMe(@Req() req: any) {
    return this.subService.getMySubscription(this.uid(req));
  }

  @Post('subscribe')
  async subscribe(@Req() req: any, @Body() body: { planId: string; period: string }) {
    return this.subService.subscribe(this.uid(req), body.planId, body.period as any);
  }

  @Get('upgrade/available')
  async upgradeAvailable(@Req() req: any) {
    return this.subService.getUpgradeAvailable(this.uid(req));
  }

  @Get('upgrade/preview')
  async upgradePreview(@Req() req: any, @Query() q: { targetPlanId: string; targetPeriod: string }) {
    return this.subService.upgradePreview(this.uid(req), q.targetPlanId, q.targetPeriod);
  }

  @Post('upgrade')
  async upgrade(@Req() req: any, @Body() body: { targetPlanId: string; targetPeriod: string }) {
    return this.subService.upgrade(this.uid(req), body.targetPlanId, body.targetPeriod as any);
  }

  @Get('orders')
  async getOrders(@Req() req: any, @Query() q: { page?: string; pageSize?: string }) {
    return this.orderService.getOrders(this.uid(req), {
      page: q.page ? parseInt(q.page) : 1,
      pageSize: q.pageSize ? parseInt(q.pageSize) : 20,
    });
  }
}
