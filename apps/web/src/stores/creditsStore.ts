import { create } from 'zustand';
import { subscriptionApi } from '@/api/subscriptionApi';
import { getTeamBalanceView } from '@/api/teamApi';

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
  /** silent 档（Y3 D1）：终态信号重拉不亮 loading（顶栏数字不灭）；失败三不改
   *  （loading/error/数字全保持）。默认档=挂载第一次拉取，仍显 loading。 */
  fetchBalance: (opts?: { silent?: boolean }) => Promise<void>;
  fetchTeamBalance: (teamId: string, opts?: { silent?: boolean }) => Promise<void>;
  isSubscriptionActive: () => boolean;
}

/** 共用递增序号（Y3 D1 慢响应不覆盖）：两拉取函数同源——仅最后一次响应可写 store
 *  （挂载拉取与终态重拉会重叠，旧响应迟归=序号失配直接弃）。 */
let fetchSeq = 0;

export const useCreditsStore = create<CreditsState>((set, get) => ({
  credits: 0,
  subscriptionCredits: 0,
  subscriptionCreditsExpiry: null,
  tier: null,
  scope: 'personal',
  teamId: null,
  loading: true,
  error: null,

  fetchBalance: async (opts) => {
    const silent = opts?.silent === true;
    const seq = ++fetchSeq;
    if (!silent) set({ loading: true, error: null });
    set({ scope: 'personal', teamId: null });
    try {
      const [data, sub] = await Promise.all([
        subscriptionApi.getBalance(),
        subscriptionApi.getMe(),
      ]);
      if (seq !== fetchSeq) { set({ loading: false }); return; }   // 旧响应迟归——不覆盖新结果（只清本请求亮起的 loading）
      set({
        credits: data.credits,
        subscriptionCredits: data.subscriptionCredits,
        subscriptionCreditsExpiry: data.subscriptionCreditsExpiry,
        tier: sub?.tier ?? null,
        ...(silent ? {} : { loading: false }),
      });
    } catch {
      if (seq !== fetchSeq) { set({ loading: false }); return; }
      if (!silent) set({ error: '积分获取失败', loading: false });   // 静默失败三不改（loading/error/数字）
    }
  },

  fetchTeamBalance: async (teamId, opts) => {
    const silent = opts?.silent === true;
    const seq = ++fetchSeq;
    if (!silent) set({ loading: true, error: null });
    set({ scope: 'team', teamId });
    try {
      const b = await getTeamBalanceView(teamId);
      if (seq !== fetchSeq) { set({ loading: false }); return; }   // 旧响应迟归——不覆盖新结果（只清本请求亮起的 loading）
      set({
        credits: b.credits,
        subscriptionCredits: b.subscriptionCredits,
        subscriptionCreditsExpiry: null,
        tier: null,
        ...(silent ? {} : { loading: false }),
      });
    } catch {
      if (seq !== fetchSeq) { set({ loading: false }); return; }
      if (!silent) set({ error: '积分获取失败', loading: false });   // 静默失败三不改（loading/error/数字）
    }
  },

  isSubscriptionActive: () => {
    const { scope, subscriptionCredits, subscriptionCreditsExpiry } = get();
    if (scope === 'team') return subscriptionCredits > 0;
    if (!subscriptionCreditsExpiry) return false;
    return new Date(subscriptionCreditsExpiry).getTime() > Date.now();
  },
}));
