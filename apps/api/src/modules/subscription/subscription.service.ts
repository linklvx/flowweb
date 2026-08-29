import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PricingService } from './pricing.service';

export interface CreatePlanDto {
  name: string;
  tier: 'basic' | 'pro' | 'max' | 'ultra';
  monthlyCredits: number;
  priceMonthly: number;
  originalPriceMonthly?: number;
  priceQuarterly: number;
  originalPriceQuarterly?: number;
  priceAnnually: number;
  originalPriceAnnually?: number;
  sort?: number;
  storageLimitBytes?: number;
}

export interface UpdatePlanDto {
  name?: string;
  monthlyCredits?: number;
  priceMonthly?: number;
  originalPriceMonthly?: number;
  priceQuarterly?: number;
  originalPriceQuarterly?: number;
  priceAnnually?: number;
  originalPriceAnnually?: number;
  sort?: number;
  isActive?: boolean;
  tier?: 'basic' | 'pro' | 'max' | 'ultra';
}

const PERIOD_DAYS: Record<string, number> = { monthly: 30, quarterly: 90, annually: 365 };

@Injectable()
export class SubscriptionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PricingService) private readonly pricing: PricingService,
  ) {}

  // ========== Plan CRUD ==========

  async getPlans() {
    return this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { sort: 'asc' },
    });
  }

  async getAllPlans() {
    return this.prisma.subscriptionPlan.findMany({
      orderBy: { sort: 'asc' },
    });
  }

  async createPlan(dto: CreatePlanDto) {
    return this.prisma.subscriptionPlan.create({
      // storageLimitBytes 必填（BigInt）：未指定时默认 1GB 免费档
      data: { ...dto, isActive: true, storageLimitBytes: dto.storageLimitBytes ?? 1073741824 },
    });
  }

  async updatePlan(id: string, dto: UpdatePlanDto) {
    return this.prisma.subscriptionPlan.update({
      where: { id },
      data: dto,
    });
  }

  async deletePlan(id: string) {
    return this.prisma.subscriptionPlan.delete({ where: { id } });
  }

  // ========== User Subscription ==========

  async getMySubscription(userId: string) {
    return this.prisma.userSubscription.findFirst({
      where: { userId, status: 'active' },
      include: { plan: true },
    });
  }

  // ========== Upgrade ==========

  async getUpgradeAvailable(userId: string) {
    const sub = await this.prisma.userSubscription.findFirst({
      where: { userId, status: 'active' },
    });
    if (!sub) return [];

    const currentOrder: Record<string, number> = { basic: 0, pro: 1, max: 2, ultra: 3 };
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { sort: 'asc' },
    });
    return plans.filter(p => currentOrder[p.tier] > currentOrder[sub.tier]);
  }

  async upgradePreview(userId: string, targetPlanId: string, targetPeriod: string) {
    const sub = await this.prisma.userSubscription.findFirst({
      where: { userId, status: 'active' },
    });
    if (!sub) throw new BusinessException('SUBSCRIPTION_NOT_ACTIVE', '无生效订阅');

    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: targetPlanId } });
    if (!plan || !plan.isActive) throw new BusinessException('SUBSCRIPTION_PLAN_NOT_FOUND');

    const priceKey = targetPeriod === 'monthly' ? plan.priceMonthly : targetPeriod === 'quarterly' ? plan.priceQuarterly : plan.priceAnnually;
    const snap = this.pricing.calculate(sub, plan.tier, targetPeriod, priceKey);
    const days = PERIOD_DAYS[targetPeriod];
    const targetEndDate = new Date(Date.now() + days * 86400000);

    return {
      currentTier: sub.tier,
      currentPeriod: sub.period,
      targetTier: plan.tier,
      targetPeriod,
      originalPrice: priceKey,
      deductibleAmount: snap.deductibleAmount,
      payableAmount: snap.payableAmount,
      targetEndDate: targetEndDate.toISOString(),
      firstMonthCredits: plan.monthlyCredits,
      snapshot: snap,
    };
  }
}
