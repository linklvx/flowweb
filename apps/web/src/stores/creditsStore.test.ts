import { describe, it, expect, vi, beforeEach } from 'vitest';

const subApi = vi.hoisted(() => ({ getBalance: vi.fn(), getMe: vi.fn() }));
const teamApi = vi.hoisted(() => ({ getTeamBalanceView: vi.fn() }));
vi.mock('@/api/subscriptionApi', () => ({ subscriptionApi: subApi }));
vi.mock('@/api/teamApi', () => ({ getTeamBalanceView: teamApi.getTeamBalanceView }));

import { useCreditsStore } from './creditsStore';

describe('creditsStore scope-aware', () => {
  beforeEach(() => {
    subApi.getBalance.mockResolvedValue({ credits: 10, subscriptionCredits: 20, total: 30, subscriptionCreditsExpiry: '2099-01-01', updatedAt: '2026-01-01' });
    subApi.getMe.mockResolvedValue({ tier: 'pro' });
    teamApi.getTeamBalanceView.mockResolvedValue({ credits: 5, subscriptionCredits: 0, total: 5, quota: 0, used: 0 });
  });

  it('fetchBalance（personal）：双池+expiry+tier', async () => {
    await useCreditsStore.getState().fetchBalance();
    const s = useCreditsStore.getState();
    expect(s.scope).toBe('personal');
    expect(s.credits).toBe(10);
    expect(s.subscriptionCredits).toBe(20);
    expect(s.isSubscriptionActive()).toBe(true);
  });

  it('fetchTeamBalance（team）：团队双池，无 expiry，tier 清空', async () => {
    await useCreditsStore.getState().fetchTeamBalance('t-1');
    const s = useCreditsStore.getState();
    expect(s.scope).toBe('team');
    expect(s.teamId).toBe('t-1');
    expect(s.credits).toBe(5);
    expect(s.tier).toBeNull();
    expect(s.isSubscriptionActive()).toBe(false);   // subscriptionCredits=0
  });

  it('团队 scope 且 subscriptionCredits>0 时订阅态为活', async () => {
    teamApi.getTeamBalanceView.mockResolvedValue({ credits: 0, subscriptionCredits: 30, total: 30, quota: 0, used: 0 });
    await useCreditsStore.getState().fetchTeamBalance('t-1');
    expect(useCreditsStore.getState().isSubscriptionActive()).toBe(true);
  });

  it('applyBalance：Socket 推送的完整对象写入双池', () => {
    useCreditsStore.getState().applyBalance({ credits: 7, subscriptionCredits: 8 });
    expect(useCreditsStore.getState().credits).toBe(7);
    expect(useCreditsStore.getState().subscriptionCredits).toBe(8);
  });
});
