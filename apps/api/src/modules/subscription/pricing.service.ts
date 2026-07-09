import { Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import type { UpgradePricingSnapshot } from '@flowweb/shared';

const TIER_ORDER: Record<string, number> = { basic: 0, pro: 1, max: 2, ultra: 3 };

export interface SubscriptionForPricing {
  tier: string;
  period: string;
  status: string;
  paidAmount: number;
  totalCredits: number;
  totalDays: number;
  consumedCredits: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

@Injectable()
export class PricingService {
  /**
   * Pure function: calculate upgrade pricing with no side effects.
   * Formula: deductible = paidAmount × min(remainingTimeRatio, remainingPointsRatio)
   * payable = max(0, targetPrice - deductible)
   */
  calculate(
    sub: SubscriptionForPricing,
    targetTier: string,
    targetPeriod: string,
    targetPrice: number,
    now: Date = new Date(),
  ): UpgradePricingSnapshot {
    // Validate: only upgrade (higher tier)
    const currentTierOrder = TIER_ORDER[sub.tier] ?? -1;
    const targetTierOrder = TIER_ORDER[targetTier] ?? -1;

    if (sub.status !== 'active') {
      throw new BusinessException('SUBSCRIPTION_STATUS_INVALID', '当前订阅非生效状态');
    }
    if (targetTierOrder <= currentTierOrder) {
      throw new BusinessException('UPGRADE_INVALID_TIER', '仅支持向上升级');
    }

    // Calculate ratios
    const remainingMs = sub.currentPeriodEnd.getTime() - now.getTime();
    const totalMs = sub.totalDays * 86400000;
    const remainTimeRatio = Math.max(0, Math.min(1, remainingMs / totalMs));

    const remainingPoints = sub.totalCredits - sub.consumedCredits;
    const remainPointsRatio = sub.totalCredits > 0
      ? Math.max(0, Math.min(1, remainingPoints / sub.totalCredits))
      : 0;

    const finalRatio = Math.min(remainTimeRatio, remainPointsRatio);
    const deductibleAmount = Math.floor(sub.paidAmount * finalRatio);
    const payableAmount = Math.max(0, targetPrice - deductibleAmount);

    return {
      sourcePaidAmount: sub.paidAmount,
      remainTimeRatio: Math.round(remainTimeRatio * 10000) / 10000,
      remainPointsRatio: Math.round(remainPointsRatio * 10000) / 10000,
      finalRatio: Math.round(finalRatio * 10000) / 10000,
      targetOriginalPrice: targetPrice,
      deductibleAmount,
      payableAmount,
    };
  }
}
