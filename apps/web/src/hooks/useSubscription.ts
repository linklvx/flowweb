import { useState, useEffect, useCallback } from 'react';
import { subscriptionApi, type SubscriptionPlan, type MySubscription, type UpgradePreview } from '@/api/subscriptionApi';
import type { PublicBannerData } from '@flowweb/shared';

export function useSubscriptionPlans() {
  const [data, setData] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setData(await subscriptionApi.getPlans()); setError(null); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, error, refresh };
}

export function useMySubscription() {
  const [data, setData] = useState<MySubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setData(await subscriptionApi.getMe()); setError(null); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, error, refresh };
}

export function useCreditBalance() {
  const [data, setData] = useState<{ credits: number; subscriptionCredits: number; subscriptionCreditsExpiry: string | null; balance: number }>({
    credits: 0, subscriptionCredits: 0, subscriptionCreditsExpiry: null, balance: 0,
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try { setData(await subscriptionApi.getBalance() as any); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { ...data, loading, refresh };
}

export function useUpgradePreview(targetPlanId: string | null, targetPeriod: string | null) {
  const [data, setData] = useState<UpgradePreview | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!targetPlanId || !targetPeriod) return;
    setLoading(true);
    subscriptionApi.getUpgradePreview(targetPlanId, targetPeriod)
      .then(setData)
      .finally(() => setLoading(false));
  }, [targetPlanId, targetPeriod]);

  return { data, loading };
}

export function usePublicBanner() {
  const [data, setData] = useState<PublicBannerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await subscriptionApi.getPublicBanner();
      setData(result);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, error, refresh };
}
