import { apiFetch } from './client';
import type { PublicBannerData, AdminBannerData, UpdateBannerDto } from '@flowweb/shared';

export interface SubscriptionPlan {
  id: string; name: string; tier: string; monthlyCredits: number;
  priceMonthly: number; originalPriceMonthly: number;
  priceQuarterly: number; originalPriceQuarterly: number;
  priceAnnually: number; originalPriceAnnually: number;
  sort: number;
}

export interface MySubscription {
  id: string; planId: string; tier: string; period: string; status: string;
  paidAmount: number; totalCredits: number; totalDays: number;
  consumedCredits: number; currentPeriodEnd: string; nextGrantDate: string;
  grantCount: number;
  plan?: SubscriptionPlan;
}

export interface UpgradePreview {
  currentTier: string; currentPeriod: string; targetTier: string; targetPeriod: string;
  originalPrice: number; deductibleAmount: number; payableAmount: number;
  targetEndDate: string; firstMonthCredits: number;
}

export interface CreditBalance {
  credits: number; subscriptionCredits: number;
  subscriptionCreditsExpiry: string | null; updatedAt: string;
  balance: number;
}

export const subscriptionApi = {
  getPlans: () => apiFetch<SubscriptionPlan[]>('/subscription/plans'),
  getMe: () => apiFetch<MySubscription | null>('/subscription/me'),
  getUpgradeAvailable: () => apiFetch<SubscriptionPlan[]>('/subscription/upgrade/available'),
  getUpgradePreview: (targetPlanId: string, targetPeriod: string) =>
    apiFetch<UpgradePreview>(`/subscription/upgrade/preview?targetPlanId=${targetPlanId}&targetPeriod=${targetPeriod}`),
  getBalance: () => apiFetch<CreditBalance>('/credits/balance'),

  // ── Banner ──

  /** 获取公开 banner（无需登录） */
  getPublicBanner: () =>
    apiFetch<PublicBannerData | null>('/subscription/banner'),

  /** [Admin] 获取完整 banner 配置 */
  getAdminBanner: () =>
    apiFetch<AdminBannerData | null>('/admin/subscription/banner'),

  /** [Admin] 部分更新 banner */
  updateBanner: (dto: UpdateBannerDto) =>
    apiFetch('/admin/subscription/banner', {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),

  // ── Recharge ──

  createRechargeOrder: (amount: number) =>
    apiFetch<{ id: string; orderNo: string; amount: number; status: string; createdAt: string }>(
      '/recharge/orders',
      { method: 'POST', body: JSON.stringify({ amount }) },
    ),

  payRechargeOrder: (orderNo: string) =>
    apiFetch<{ orderNo: string; amount: number; status: string; codeUrl: string | null }>(
      `/recharge/orders/${orderNo}/pay`,
      { method: 'POST' },
    ),

  queryRechargeOrder: (orderNo: string) =>
    apiFetch<{ orderNo: string; amount: number; status: string; payChannel: string | null; paidAt: string | null }>(
      `/recharge/orders/${orderNo}`,
    ),

  closeRechargeOrder: (orderNo: string) =>
    apiFetch<{ success: boolean }>(
      `/recharge/orders/${orderNo}/close`,
      { method: 'POST' },
    ),

  getRechargeOrders: (page = 1, pageSize = 20) =>
    apiFetch<{ items: Array<{ id: string; orderNo: string; amount: number; balanceBefore: number; balanceAfter: number; status: string; payChannel: string | null; prepayId: string | null; transactionId: string | null; paidAt: string | null; expiredAt: string | null; closedAt: string | null; createdAt: string }>; total: number; page: number; pageSize: number }>(
      `/recharge/orders?page=${page}&pageSize=${pageSize}`,
    ),

  // ── Subscription Orders (WeChat Pay) ──

  createSubscriptionOrder: (planId: string, period: string, type: string) =>
    apiFetch<{ orderNo: string; amount: number; expiredAt: string }>(
      '/subscription/orders',
      { method: 'POST', body: JSON.stringify({ planId, period, type }) },
    ),

  paySubscriptionOrder: (orderNo: string) =>
    apiFetch<{ orderNo: string; amount: number; codeUrl: string | null }>(
      `/subscription/orders/${orderNo}/pay`,
      { method: 'POST' },
    ),

  querySubscriptionOrder: (orderNo: string) =>
    apiFetch<{ orderNo: string; amount: number; status: string; payChannel: string | null; paidAt: string | null }>(
      `/subscription/orders/${orderNo}`,
    ),

  closeSubscriptionOrder: (orderNo: string) =>
    apiFetch<{ success: boolean }>(
      `/subscription/orders/${orderNo}/close`,
      { method: 'POST' },
    ),

  querySubscriptionOrders: (params?: { status?: string; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ items: Array<{ orderNo: string; amount: number; status: string; createdAt: string }>; total: number; page: number; pageSize: number }>(
      `/subscription/orders${suffix}`,
    );
  },

  /** [Admin] 上传 banner 背景图，返回 { imageKey } */
  uploadBannerImage: async (file: File): Promise<{ imageKey: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/admin/subscription/banner/upload', {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Upload failed');
    }
    const body = await res.json();
    // Unwrap TransformInterceptor { code: 0, data: T }
    return body.data ?? body;
  },
};
