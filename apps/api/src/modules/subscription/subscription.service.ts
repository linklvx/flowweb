import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditService } from '../credit/credit.service';
import { OrderService } from '../order/order.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PricingService } from './pricing.service';

export interface CreatePlanDto {
  name: string;
  tier: 'basic' | 'pro' | 'max' | 'ultra';
  monthlyCredits: number;
  priceMonthly: number;
  priceQuarterly: number;
  priceAnnually: number;
  sort?: number;
}

export interface UpdatePlanDto {
  name?: string;
  monthlyCredits?: number;
  priceMonthly?: number;
  priceQuarterly?: number;
  priceAnnually?: number;
  sort?: number;
  isActive?: boolean;
  tier?: 'basic' | 'pro' | 'max' | 'ultra';
}

const PERIOD_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annually: 12 };
const PERIOD_DAYS: Record<string, number> = { monthly: 30, quarterly: 90, annually: 365 };

@Injectable()
export class SubscriptionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CreditService) private readonly credit: CreditService,
    @Inject(OrderService) private readonly orderService: OrderService,
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
      data: { ...dto, isActive: true },
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

  async subscribe(userId: string, planId: string, period: 'monthly' | 'quarterly' | 'annually') {
    // Step 1: idempotency check
    const existing = await this.prisma.userSubscription.findFirst({
      where: { userId, status: 'active' },
    });
    if (existing) return existing;

    // Load plan
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan || !plan.isActive) throw new BusinessException('SUBSCRIPTION_PLAN_NOT_FOUND', '套餐不存在或已下架');

    const priceKey = period === 'monthly' ? plan.priceMonthly : period === 'quarterly' ? plan.priceQuarterly : plan.priceAnnually;
    const months = PERIOD_MONTHS[period];
    const days = PERIOD_DAYS[period];
    const totalCredits = plan.monthlyCredits * months;

    return this.prisma.$transaction(async (tx) => {
      // Step 2: create order
      const order = await tx.subscriptionOrder.create({
        data: {
          orderNo: this.generateOrderNo(),
          userId,
          planId,
          period,
          type: 'new_purchase',
          amount: priceKey,
          originalPrice: priceKey,
          deductibleAmount: 0,
        },
      });

      // Step 3: deduct regular credits (calls internal CreditTransaction write)
      await this.credit.deductRegular(userId, priceKey, order.id);

      // Step 4: create subscription
      const now = new Date();
      const currentPeriodEnd = new Date(now.getTime() + days * 86400000);
      const nextGrantDate = this.nextGrantUtc(now, 30);

      const sub = await tx.userSubscription.create({
        data: {
          userId,
          planId,
          tier: plan.tier,
          period,
          paidAmount: priceKey,
          totalCredits,
          totalDays: days,
          subscribedAt: now,
          currentPeriodStart: now,
          currentPeriodEnd,
          nextGrantDate,
          grantCount: 1,
        },
      });

      // Step 5: grant first month credits + write transaction
      await tx.creditTransaction.create({
        data: {
          userId,
          amount: plan.monthlyCredits,
          type: 'subscription_grant',
          creditType: 'subscription',
          referenceId: sub.id,
          referenceType: 'subscription',
          balanceAfter: plan.monthlyCredits,
        },
      });

      // Step 6: update balance with subscription credits + expiry
      await tx.userBalance.update({
        where: { userId },
        data: {
          subscriptionCredits: { increment: plan.monthlyCredits },
          subscriptionCreditsExpiry: currentPeriodEnd,
        },
      });

      return sub;
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

  async upgrade(userId: string, targetPlanId: string, targetPeriod: string) {
    const sub = await this.prisma.userSubscription.findFirst({
      where: { userId, status: 'active' },
    });
    if (!sub) throw new BusinessException('SUBSCRIPTION_NOT_ACTIVE');
    if (sub.status === 'upgraded') return sub; // idempotent

    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: targetPlanId } });
    if (!plan || !plan.isActive) throw new BusinessException('SUBSCRIPTION_PLAN_NOT_FOUND');

    const priceKey = targetPeriod === 'monthly' ? plan.priceMonthly : targetPeriod === 'quarterly' ? plan.priceQuarterly : plan.priceAnnually;
    const snap = this.pricing.calculate(sub, plan.tier, targetPeriod, priceKey);
    const months = PERIOD_MONTHS[targetPeriod];
    const days = PERIOD_DAYS[targetPeriod];
    const totalCredits = plan.monthlyCredits * months;

    return this.prisma.$transaction(async (tx) => {
      // Create upgrade order
      const order = await tx.subscriptionOrder.create({
        data: {
          orderNo: this.generateOrderNo(), userId, planId: targetPlanId, period: targetPeriod as any,
          type: 'upgrade', amount: snap.payableAmount, originalPrice: priceKey,
          deductibleAmount: snap.deductibleAmount, originalSubscriptionId: sub.id,
          pricingSnapshot: snap as any,
        },
      });

      // Deduct payable (only if > 0)
      if (snap.payableAmount > 0) {
        await this.credit.deductRegular(userId, snap.payableAmount, order.id);
      }

      // Mark old subscription as upgraded (row-level condition)
      const updated = await tx.userSubscription.updateMany({
        where: { id: sub.id, status: 'active' },
        data: { status: 'upgraded' },
      });
      if (updated.count === 0) throw new BusinessException('SUBSCRIPTION_STATUS_INVALID', '订阅已被变更');

      // Clear old subscription credits + expiry
      await tx.userBalance.updateMany({
        where: { userId },
        data: { subscriptionCredits: 0, subscriptionCreditsExpiry: null },
      });
      await tx.creditTransaction.create({
        data: {
          userId, amount: -sub.totalCredits, type: 'upgrade_clear',
          creditType: 'subscription', referenceId: sub.id, referenceType: 'subscription',
          balanceAfter: 0,
        },
      });

      // Create new subscription
      const now = new Date();
      const currentPeriodEnd = new Date(now.getTime() + days * 86400000);
      const nextGrantDate = this.nextGrantUtc(now, 30);

      const newSub = await tx.userSubscription.create({
        data: {
          userId, planId: targetPlanId, tier: plan.tier, period: targetPeriod as any,
          paidAmount: snap.payableAmount, totalCredits, totalDays: days,
          subscribedAt: now, currentPeriodStart: now, currentPeriodEnd,
          nextGrantDate, grantCount: 1, previousSubId: sub.id,
        },
      });

      // Grant first month credits
      await tx.creditTransaction.create({
        data: {
          userId, amount: plan.monthlyCredits, type: 'subscription_grant',
          creditType: 'subscription', referenceId: newSub.id, referenceType: 'subscription',
          balanceAfter: plan.monthlyCredits,
        },
      });
      await tx.userBalance.update({
        where: { userId },
        data: {
          subscriptionCredits: { increment: plan.monthlyCredits },
          subscriptionCreditsExpiry: currentPeriodEnd,
        },
      });

      return newSub;
    });
  }

  // ========== Auto-Renew ==========

  async cancelAutoRenew(userId: string) {
    const updated = await this.prisma.userSubscription.updateMany({
      where: { userId, status: 'active' },
      data: { autoRenew: false, cancelledAt: new Date() },
    });
    if (updated.count === 0) throw new BusinessException('SUBSCRIPTION_NOT_ACTIVE');
  }

  async enableAutoRenew(userId: string) {
    const updated = await this.prisma.userSubscription.updateMany({
      where: { userId, status: 'active' },
      data: { autoRenew: true, cancelledAt: null },
    });
    if (updated.count === 0) throw new BusinessException('SUBSCRIPTION_NOT_ACTIVE');
  }

  // ========== Helpers ==========

  private generateOrderNo(): string {
    const ts = Date.now().toString();
    const rand = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    return `SUB${ts}${rand}`;
  }

  private nextGrantUtc(from: Date, addDays: number): Date {
    const d = new Date(from.getTime() + addDays * 86400000);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}
