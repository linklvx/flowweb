import { create } from 'zustand';
import { subscriptionApi } from '@/api/subscriptionApi';

interface CreditsState {
  credits: number;
  subscriptionCredits: number;
  subscriptionCreditsExpiry: string | null;
  tier: string | null;
  loading: boolean;
  error: string | null;
  fetchBalance: () => Promise<void>;
  updateCredits: (credits: number) => void;
  isSubscriptionActive: () => boolean;
}

export const useCreditsStore = create<CreditsState>((set, get) => ({
  credits: 0,
  subscriptionCredits: 0,
  subscriptionCreditsExpiry: null,
  tier: null,
  loading: true,
  error: null,

  fetchBalance: async () => {
    set({ loading: true, error: null });
    try {
      const [data, sub] = await Promise.all([
        subscriptionApi.getBalance(),
        subscriptionApi.getMe(),
      ]);
      set({
        credits: data.credits,
        subscriptionCredits: data.subscriptionCredits,
        subscriptionCreditsExpiry: data.subscriptionCreditsExpiry,
        tier: sub?.tier ?? null,
        loading: false,
      });
    } catch {
      set({ error: '积分获取失败', loading: false });
    }
  },

  updateCredits: (credits: number) => set({ credits }),

  isSubscriptionActive: () => {
    const { subscriptionCreditsExpiry } = get();
    if (!subscriptionCreditsExpiry) return false;
    return new Date(subscriptionCreditsExpiry).getTime() > Date.now();
  },
}));
