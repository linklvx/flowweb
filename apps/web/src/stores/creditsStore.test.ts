import { describe, it, expect, vi, beforeEach } from 'vitest';

const subApi = vi.hoisted(() => ({ getBalance: vi.fn(), getMe: vi.fn() }));
const teamApi = vi.hoisted(() => ({ getTeamBalanceView: vi.fn() }));
vi.mock('@/api/subscriptionApi', () => ({ subscriptionApi: subApi }));
vi.mock('@/api/teamApi', () => ({ getTeamBalanceView: teamApi.getTeamBalanceView }));

import { useCreditsStore } from './creditsStore';

const seed = (o: Partial<ReturnType<typeof useCreditsStore.getState>>) => {
  useCreditsStore.setState({
    credits: 111, subscriptionCredits: 0, subscriptionCreditsExpiry: null,
    tier: null, scope: 'personal', teamId: null, loading: false, error: null,
    ...o,
  });
};

describe('creditsStore scope-aware', () => {
  beforeEach(() => {
    subApi.getBalance.mockReset();
    subApi.getMe.mockReset();
    teamApi.getTeamBalanceView.mockReset();
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
});

describe('Y3 Task6 D1：silent 档+共用递增序号（拉取侧）', () => {
  beforeEach(() => {
    subApi.getBalance.mockReset();
    subApi.getMe.mockReset();
    teamApi.getTeamBalanceView.mockReset();
    subApi.getBalance.mockResolvedValue({ credits: 10, subscriptionCredits: 20, total: 30, subscriptionCreditsExpiry: '2099-01-01', updatedAt: '2026-01-01' });
    subApi.getMe.mockResolvedValue({ tier: 'pro' });
    teamApi.getTeamBalanceView.mockResolvedValue({ credits: 5, subscriptionCredits: 0, total: 5, quota: 0, used: 0 });
  });

  it('挂载档（默认）：显 loading=true（数字灭一下的旧形态只留给挂载）', async () => {
    seed({ loading: false });
    const p = useCreditsStore.getState().fetchBalance();
    expect(useCreditsStore.getState().loading).toBe(true);
    await p;
    expect(useCreditsStore.getState().loading).toBe(false);
  });

  it('⑥silent 档失败三不改：loading/error/数字全保持（静默重拉失败无感）', async () => {
    seed({ credits: 111, subscriptionCredits: 0, loading: false, error: null });
    subApi.getBalance.mockRejectedValue(new Error('boom'));
    subApi.getMe.mockRejectedValue(new Error('boom'));
    await useCreditsStore.getState().fetchBalance({ silent: true });   // 修前无 silent 档=红（tsc 拒收）
    const s = useCreditsStore.getState();
    expect(s.loading).toBe(false);        // 不改 loading
    expect(s.error).toBeNull();           // 不改 error
    expect(s.credits).toBe(111);          // 不改数字
    expect(s.subscriptionCredits).toBe(0);
  });

  it('⑥silent 档失败三不改（team 侧）', async () => {
    seed({ credits: 111, scope: 'team', teamId: 't-1', loading: false, error: null });
    teamApi.getTeamBalanceView.mockRejectedValue(new Error('boom'));
    await useCreditsStore.getState().fetchTeamBalance('t-1', { silent: true });
    const s = useCreditsStore.getState();
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.credits).toBe(111);
    expect(s.scope).toBe('team');
    expect(s.teamId).toBe('t-1');
  });

  it('silent 档成功：写数字但不置 loading（顶栏数字不灭）', async () => {
    seed({ credits: 111, loading: false, error: null });
    const p = useCreditsStore.getState().fetchBalance({ silent: true });
    expect(useCreditsStore.getState().loading).toBe(false);   // 全程不亮 loading
    await p;
    const s = useCreditsStore.getState();
    expect(s.loading).toBe(false);
    expect(s.credits).toBe(10);
    expect(s.subscriptionCredits).toBe(20);
  });

  it('⑦旧响应迟归不覆盖：挂载慢响应在终态重拉（silent）之后到达——序号失配不写 store', async () => {
    seed({ credits: 111, loading: false, error: null });
    // 挂载拉取（默认档）挂起——响应故意迟到
    let releaseMount: (v: { credits: number; subscriptionCredits: number; total: number; subscriptionCreditsExpiry: string; updatedAt: string }) => void = () => {};
    subApi.getBalance.mockImplementationOnce(() => new Promise((r) => { releaseMount = r; }));
    subApi.getMe.mockResolvedValue({ tier: 'pro' });
    const mountP = useCreditsStore.getState().fetchBalance();
    // 终态信号触发的静默重拉（新一轮）先完成——写入新值
    await useCreditsStore.getState().fetchBalance({ silent: true });
    expect(useCreditsStore.getState().credits).toBe(10);
    // 挂载响应迟归（序号已失配）——不得覆盖新结果
    releaseMount({ credits: 999, subscriptionCredits: 999, total: 999, subscriptionCreditsExpiry: '2099-01-01', updatedAt: '2026-01-01' });
    await mountP;
    expect(useCreditsStore.getState().credits).toBe(10);   // 修前旧响应直接覆盖=红
    expect(useCreditsStore.getState().subscriptionCredits).toBe(20);
    expect(useCreditsStore.getState().loading).toBe(false);
  });

  it('⑦两函数共用一个递增序号：fetchBalance 与 fetchTeamBalance 交叉在飞只认末次', async () => {
    seed({ credits: 111, loading: false, error: null });
    let releaseA: (v: { credits: number; subscriptionCredits: number }) => void = () => {};
    subApi.getBalance.mockImplementationOnce(() => new Promise((r) => { releaseA = r; }));
    subApi.getMe.mockResolvedValue({ tier: 'pro' });
    const slowP = useCreditsStore.getState().fetchBalance({ silent: true });   // 第 N 次（慢）
    const fastP = useCreditsStore.getState().fetchTeamBalance('t-1', { silent: true });   // 第 N+1 次（快）——胜
    await fastP;
    expect(useCreditsStore.getState().credits).toBe(5);
    expect(useCreditsStore.getState().scope).toBe('team');
    releaseA({ credits: 10, subscriptionCredits: 20 });
    await slowP;
    expect(useCreditsStore.getState().credits).toBe(5);   // 旧（不同函数）响应失配不写
    expect(useCreditsStore.getState().scope).toBe('team');
  });
});
