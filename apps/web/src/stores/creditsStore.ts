import { create } from 'zustand';
import { subscriptionApi } from '@/api/subscriptionApi';
import { getTeamBalanceView } from '@/api/teamApi';

interface BalancePatch {
  credits: number;
  subscriptionCredits: number;
}

interface CreditsState {
  credits: number;
  subscriptionCredits: number;
  subscriptionCreditsExpiry: string | null;
  tier: string | null;
  /** scope-aware（D2/D9）：画布内按 project.teamId 判定，个人=默认团队 */
  scope: 'personal' | 'team';
  teamId: string | null;
  loading: boolean;
  error: string | null;
  fetchBalance: () => Promise<void>;
  fetchTeamBalance: (teamId: string) => Promise<void>;
  applyBalance: (patch: BalancePatch) => void;
  isSubscriptionActive: () => boolean;
}

export const useCreditsStore = create<CreditsState>((set, get) => ({
  credits: 0,
  subscriptionCredits: 0,
  subscriptionCreditsExpiry: null,
  tier: null,
  scope: 'personal',
  teamId: null,
  loading: true,
  error: null,

  fetchBalance: async () => {
    set({ loading: true, error: null, scope: 'personal', teamId: null });
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

  fetchTeamBalance: async (teamId) => {
    set({ loading: true, error: null, scope: 'team', teamId });
    try {
      const b = await getTeamBalanceView(teamId);
      set({
        credits: b.credits,
        subscriptionCredits: b.subscriptionCredits,
        subscriptionCreditsExpiry: null,
        tier: null,
        loading: false,
      });
    } catch {
      set({ error: '积分获取失败', loading: false });
    }
  },

  applyBalance: (patch) => set({ credits: patch.credits, subscriptionCredits: patch.subscriptionCredits }),

  isSubscriptionActive: () => {
    const { scope, subscriptionCredits, subscriptionCreditsExpiry } = get();
    if (scope === 'team') return subscriptionCredits > 0;
    if (!subscriptionCreditsExpiry) return false;
    return new Date(subscriptionCreditsExpiry).getTime() > Date.now();
  },
}));
