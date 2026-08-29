// ========== Enums (mirrors Prisma schema) ==========

export type SubscriptionTier = 'basic' | 'pro' | 'max' | 'ultra';

export type SubscriptionPeriod = 'monthly' | 'quarterly' | 'annually';

export type SubscriptionStatus = 'active' | 'expired' | 'upgraded';

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
  total: number;
  updatedAt: string;
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

// ── Banner ──

/** 用户端 Banner 返回数据（字段裁剪，无内部配置字段） */
export interface PublicBannerData {
  /** Banner 标题文字 */
  title: string;
  /** Banner 副标题文字 */
  subtitle: string;
  /** MinIO 对象存储 Key（优先），通过文件代理接口访问 */
  backgroundImageKey: string | null;
  /** 外部图片 URL（降级），仅允许 http/https 协议 */
  backgroundImageUrl: string | null;
  /** 倒计时截止时间 ISO 8601 UTC；null 时不展示倒计时 */
  countdownEndAt: string | null;
}

/** Admin 端 Banner 完整配置（含内部字段） */
export interface AdminBannerData {
  id: string;
  title: string;
  subtitle: string;
  backgroundImageKey: string | null;
  backgroundImageUrl: string | null;
  countdownEndAt: string | null;
  autoExtend: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Admin 部分更新 Banner 的请求体 */
export interface UpdateBannerDto {
  title?: string;
  subtitle?: string;
  backgroundImageKey?: string | null;
  backgroundImageUrl?: string | null;
  countdownEndAt?: string | null;
  autoExtend?: boolean;
  isActive?: boolean;
}
