import { Controller, Get, Post, Patch, Body, Param, Query, Inject } from '@nestjs/common';
import { AdminSubscriptionService } from './admin-subscription.service';
import { SubscriptionService } from '../subscription.service';

@Controller('api/admin/subscription')
export class AdminSubscriptionController {
  constructor(
    @Inject(AdminSubscriptionService) private readonly adminService: AdminSubscriptionService,
    @Inject(SubscriptionService) private readonly subService: SubscriptionService,
  ) {}

  // Plans
  @Get('plans')
  async getAllPlans() {
    return this.subService.getAllPlans();
  }

  @Post('plans')
  async createPlan(@Body() body: any) {
    return this.subService.createPlan(body);
  }

  @Patch('plans/:id')
  async updatePlan(@Param('id') id: string, @Body() body: any) {
    return this.subService.updatePlan(id, body);
  }

  // Subscriptions
  @Get('subscriptions')
  async listSubscriptions(@Query() q: any) {
    return this.adminService.listSubscriptions({
      userId: q.userId, planId: q.planId, status: q.status,
      page: q.page ? parseInt(q.page) : 1,
      pageSize: q.pageSize ? parseInt(q.pageSize) : 20,
    });
  }

  @Patch('subscriptions/:id')
  async updateSubscription(@Param('id') id: string, @Body() body: any) {
    if (body.status === 'expired') {
      return this.adminService.cancelSubscription(id);
    }
    return { message: '仅支持作废操作' };
  }

  // Credits
  @Post('credits/grant')
  async grantCredit(@Body() body: { userId: string; amount: number; creditType: string }) {
    return this.adminService.grantCredit(body.userId, body.amount, body.creditType as any);
  }

  // Orders / Transactions — delegate to shared services
  @Get('orders')
  async listOrders(@Query() q: any) {
    // simplified: return empty paginated
    return { items: [], total: 0, page: 1, pageSize: 20 };
  }

  @Get('transactions')
  async listTransactions(@Query() q: any) {
    return { items: [], total: 0, page: 1, pageSize: 20 };
  }
}
