// ========== Enums (mirrors Prisma schema) ==========

export type SubscriptionTier = 'basic' | 'pro' | 'max' | 'ultra';

export type SubscriptionPeriod = 'monthly' | 'quarterly' | 'annually';

export type SubscriptionStatus = 'active' | 'expired' | 'upgraded' | 'cancelled';

export type SubscriptionOrderType = 'new_purchase' | 'upgrade' | 'renewal';

// ========== DTO Types ==========

export interface SubscribeBody {
  planId: string;
  period: SubscriptionPeriod;
}

export interface UpgradeBody {
  targetPlanId: string;
  targetPeriod: SubscriptionPeriod;
}

export interface GrantCreditBody {
  userId: string;
  amount: number;
  creditType: 'regular' | 'subscription';
}

// ========== Response Types ==========

export interface PlansResponse {
  id: string;
  name: string;
  tier: SubscriptionTier;
  monthlyCredits: number;
  priceMonthly: number;
  priceQuarterly: number;
  priceAnnually: number;
  sort: number;
}

export interface SubscriptionMeResponse {
  id: string;
  planId: string;
  planName: string;
  tier: SubscriptionTier;
  period: SubscriptionPeriod;
  status: SubscriptionStatus;
  paidAmount: number;
  totalCredits: number;
  totalDays: number;
  consumedCredits: number;
  subscribedAt: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextGrantDate: string;
  grantCount: number;
  autoRenew: boolean;
  cancelledAt: string | null;
  previousSubId: string | null;
}

export interface UpgradePricingSnapshot {
  sourcePaidAmount: number;
  remainTimeRatio: number;
  remainPointsRatio: number;
  finalRatio: number;
  targetOriginalPrice: number;
  deductibleAmount: number;
  payableAmount: number;
}

export interface UpgradePreviewResponse {
  currentTier: SubscriptionTier;
  currentPeriod: SubscriptionPeriod;
  targetTier: SubscriptionTier;
  targetPeriod: SubscriptionPeriod;
  originalPrice: number;
  deductibleAmount: number;
  payableAmount: number;
  targetEndDate: string;
  firstMonthCredits: number;
  snapshot: UpgradePricingSnapshot;
}

export interface CreditBalanceResponse {
  credits: number;
  subscriptionCredits: number;
  subscriptionCreditsExpiry: string | null;
}

// ========== Filter Types ==========

export interface SubscriptionFilter {
  userId?: string;
  planId?: string;
  status?: SubscriptionStatus;
  page?: number;
  pageSize?: number;
}

export interface OrderFilter {
  userId?: string;
  type?: SubscriptionOrderType;
  status?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

export interface TransactionFilter {
  userId?: string;
  type?: string;
  creditType?: 'regular' | 'subscription';
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

// ========== Paginated Response ==========

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
