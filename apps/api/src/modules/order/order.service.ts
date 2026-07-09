import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { generateOrderNo } from '../../common/utils/order-no';
import type { Prisma } from '@prisma/client';

export interface CreateOrderParams {
  userId: string;
  planId: string;
  period: 'monthly' | 'quarterly' | 'annually';
  type: 'new_purchase' | 'upgrade';
  amount: number;
  originalPrice: number;
  deductibleAmount?: number;
  originalSubscriptionId?: string;
  pricingSnapshot?: Prisma.InputJsonValue;
}

export interface OrderFilter {
  page?: number;
  pageSize?: number;
}

@Injectable()
export class OrderService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createOrder(params: CreateOrderParams) {
    return this.prisma.subscriptionOrder.create({
      data: {
        orderNo: generateOrderNo(),
        userId: params.userId,
        planId: params.planId,
        period: params.period,
        type: params.type,
        amount: params.amount,
        originalPrice: params.originalPrice,
        deductibleAmount: params.deductibleAmount ?? 0,
        originalSubscriptionId: params.originalSubscriptionId,
        pricingSnapshot: params.pricingSnapshot ?? undefined,
      },
    });
  }

  async getOrders(userId: string, filter: OrderFilter) {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    const where = { userId };

    const [items, total] = await Promise.all([
      this.prisma.subscriptionOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.subscriptionOrder.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }
}
