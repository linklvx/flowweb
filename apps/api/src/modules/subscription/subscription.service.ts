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
  storageLimitBytes?: number;
  sort?: number;
  isActive?: boolean;
  tier?: 'basic' | 'pro' | 'max' | 'ultra';
}

const PERIOD_DAYS: Record<string, number> = { monthly: 30, quarterly: 90, annually: 365 };

// SubscriptionPlan.storageLimitBytes 为 BigInt，无法经 Express JSON.stringify 序列化（抛 TypeError → 500），
// 响应统一转 Number（对齐 admin-team-plan.controller.ts 既有约定）。导出纯函数供 AdminSubscriptionService 复用。
export function serializeSubscriptionPlan<T extends { storageLimitBytes: bigint }>(plan: T) {
  return { ...plan, storageLimitBytes: Number(plan.storageLimitBytes) };
}

@Injectable()
export class SubscriptionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PricingService) private readonly pricing: PricingService,
  ) {}

  // ========== Plan CRUD ==========

  async getPlans() {
    const rows = await this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { sort: 'asc' },
    });
    return rows.map((p) => serializeSubscriptionPlan(p));
  }

  async getAllPlans() {
    const rows = await this.prisma.subscriptionPlan.findMany({
      orderBy: { sort: 'asc' },
    });
    return rows.map((p) => serializeSubscriptionPlan(p));
  }

  // 非有限数 / 非整数 / <=0 一律拒绝（与前端 precision=0、min=1 对齐；不留 0GB 口子，不静默截断）。
  // fallback 必须收敛 number 空间、校验通过后最后一步才转 BigInt——fallback 若为 bigint，
  // Number.isFinite 恒 false（bigint 不做类型转换），create 默认路径必抛（v3 spec 缺陷，勿回退）。
  private toStorageBytes(input: number | undefined, fallback?: number): bigint {
    const v = input ?? fallback;
    if (v == null || !Number.isFinite(v) || !Number.isInteger(v) || v <= 0)
      throw new BusinessException('PLAN_STORAGE_LIMIT_INVALID', '存储上限非法');
    return BigInt(v);
  }

  async createPlan(dto: CreatePlanDto) {
    const plan = await this.prisma.subscriptionPlan.create({
      data: { ...dto, isActive: true, storageLimitBytes: this.toStorageBytes(dto.storageLimitBytes, 1073741824) },
    });
    return serializeSubscriptionPlan(plan);
  }

  async updatePlan(id: string, dto: UpdatePlanDto) {
    const { storageLimitBytes, ...rest } = dto;
    const plan = await this.prisma.subscriptionPlan.update({
      where: { id },
      data: { ...rest, ...(storageLimitBytes != null ? { storageLimitBytes: this.toStorageBytes(storageLimitBytes) } : {}) },
    });
    return serializeSubscriptionPlan(plan);
  }

  // ========== User Subscription ==========

  async getMySubscription(userId: string) {
    const sub = await this.prisma.userSubscription.findFirst({
      where: { userId, status: 'active' },
      include: { plan: true },
    });
    return sub ? { ...sub, plan: serializeSubscriptionPlan(sub.plan) } : null;
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
    return plans.filter(p => currentOrder[p.tier] > currentOrder[sub.tier]).map(p => serializeSubscriptionPlan(p));
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
