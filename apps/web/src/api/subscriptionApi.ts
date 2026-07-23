import { apiFetch } from './client';
import type { PublicBannerData, AdminBannerData, UpdateBannerDto } from '@flowweb/shared';

export interface SubscriptionPlan {
  id: string; name: string; tier: string; monthlyCredits: number;
  priceMonthly: number; firstPriceMonthly: number;
  priceQuarterly: number; firstPriceQuarterly: number;
  priceAnnually: number; firstPriceAnnually: number;
  sort: number;
}

export interface MySubscription {
  id: string; planId: string; tier: string; period: string; status: string;
  paidAmount: number; totalCredits: number; totalDays: number;
  consumedCredits: number; currentPeriodEnd: string; nextGrantDate: string;
  grantCount: number; autoRenew: boolean; cancelledAt: string | null;
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
  subscribe: (planId: string, period: string) =>
    apiFetch('/subscription/subscribe', { method: 'POST', body: JSON.stringify({ planId, period }) }),
  getUpgradeAvailable: () => apiFetch<SubscriptionPlan[]>('/subscription/upgrade/available'),
  getUpgradePreview: (targetPlanId: string, targetPeriod: string) =>
    apiFetch<UpgradePreview>(`/subscription/upgrade/preview?targetPlanId=${targetPlanId}&targetPeriod=${targetPeriod}`),
  upgrade: (targetPlanId: string, targetPeriod: string) =>
    apiFetch('/subscription/upgrade', { method: 'POST', body: JSON.stringify({ targetPlanId, targetPeriod }) }),
  cancelAutoRenew: () => apiFetch('/subscription/cancel-auto-renew', { method: 'POST' }),
  enableAutoRenew: () => apiFetch('/subscription/enable-auto-renew', { method: 'POST' }),
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
    apiFetch<{ orderNo: string; amount: number; balanceBefore: number; balanceAfter: number; status: string; paidAt: string | null }>(
      `/recharge/orders/${orderNo}/pay`,
      { method: 'POST' },
    ),

  getRechargeOrders: (page = 1, pageSize = 20) =>
    apiFetch<{ items: Array<{ id: string; orderNo: string; amount: number; balanceBefore: number; balanceAfter: number; status: string; payChannel: string | null; paidAt: string | null; createdAt: string }>; total: number; page: number; pageSize: number }>(
      `/recharge/orders?page=${page}&pageSize=${pageSize}`,
    ),

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
    return res.json();
  },
};
