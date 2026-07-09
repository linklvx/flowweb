import { apiFetch } from './client';

export interface SubscriptionPlan {
  id: string; name: string; tier: string; monthlyCredits: number;
  priceMonthly: number; priceQuarterly: number; priceAnnually: number; sort: number;
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
};
