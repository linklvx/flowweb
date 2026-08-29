import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import TeamPage from './TeamPage';

const api = vi.hoisted(() => ({
  getMyTeams: vi.fn(),
  listMembers: vi.fn(),
  changeRole: vi.fn(),
  removeMember: vi.fn(),
  setQuota: vi.fn(),
  renameTeam: vi.fn(),
  disbandTeam: vi.fn(),
  listJoinRequests: vi.fn(),
  approveJoinRequest: vi.fn(),
  rejectJoinRequest: vi.fn(),
  getTeamBalanceView: vi.fn(),
  listTeamTransactions: vi.fn(),
  createTeamRechargeOrder: vi.fn(),
  payTeamOrder: vi.fn(),
  createSubscriptionOrder: vi.fn(),
  listTeamPlans: vi.fn(),
  getTeamLimits: vi.fn(),
  getTeamUsage: vi.fn(),
}));

vi.mock('@/api/teamApi', () => api);
vi.mock('@/components/WeChatQRModal', () => ({ WeChatQRModal: () => null }));
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', name: '我' }, loading: false }),
}));

const team = {
  id: 't1', name: '我的团队', role: 'OWNER' as const, status: 'ACTIVE', memberCount: 2,
  balance: { credits: 400, subscriptionCredits: 100 },
  subscription: null,
};

function setup() {
  api.getMyTeams.mockResolvedValue([team, { ...team, id: 't2', name: '第二团队', role: 'MEMBER' as const }]);
  api.listMembers.mockResolvedValue({
    items: [
      { id: 'm1', role: 'OWNER', monthlyQuota: 0, monthlyUsed: 0, user: { id: 'u1', name: '我' } },
      { id: 'm2', role: 'MEMBER', monthlyQuota: 100, monthlyUsed: 30, user: { id: 'u2', name: '张三' } },
    ],
    total: 2,
  });
  api.getTeamBalanceView.mockResolvedValue({ credits: 400, subscriptionCredits: 100, total: 500, quota: 0, used: 0 });
  api.listTeamTransactions.mockResolvedValue({ items: [{ id: 'x1', amount: 100, type: 'recharge', creditType: 'regular', balanceAfter: 100, createdAt: '2026-08-27T00:00:00Z' }], total: 1 });
  api.getTeamLimits.mockResolvedValue({ seatLimit: 20, storageLimitBytes: 6 * 1024 ** 3 });
  api.getTeamUsage.mockResolvedValue(1024 ** 3);
  api.listJoinRequests.mockResolvedValue([
    { id: 'r1', userId: 'u9', status: 'PENDING', message: '想加入', createdAt: '2026-08-27T00:00:00Z', user: { id: 'u9', name: '李四' } },
  ]);
  api.approveJoinRequest.mockResolvedValue(undefined);
  api.rejectJoinRequest.mockResolvedValue(undefined);
  api.listTeamPlans.mockResolvedValue([
    { id: 'p1', name: '团队基础版', monthlyCredits: 1000, storageLimitBytes: String(20 * 1024 ** 3), seatLimit: 30, priceMonthly: 9900, isActive: true },
  ]);
}

describe('TeamPage', () => {
  beforeEach(() => { vi.clearAllMocks(); setup(); });

  it('① 布局：左导航 4 项 tab + 默认成员管理激活', async () => {
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    expect(await screen.findByTestId('tab-members')).toBeInTheDocument();
    expect(screen.getByTestId('tab-credits')).toBeInTheDocument();
    expect(screen.getByTestId('tab-permissions')).toBeInTheDocument();
    expect(screen.getByTestId('tab-requests')).toBeInTheDocument();
    expect(screen.getByText('张三')).toBeInTheDocument();
  });

  it('③ OverviewCard：剩余积分=总额+通用积分、席位 n/20、存储 1.0G/6.0G', async () => {
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await screen.findByText('张三');
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('通用积分 400')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1.0G')).toBeInTheDocument();
  });

  it('② 团队 ID 复制 + 邀请弹窗含链接', async () => {
    const clip = vi.fn();
    Object.assign(navigator, { clipboard: { writeText: clip } });
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await screen.findByText('张三');
    fireEvent.click(screen.getByTestId('team-id-copy'));
    expect(clip).toHaveBeenCalledWith('t1');
    fireEvent.click(screen.getByRole('button', { name: '邀请成员' }));
    expect(await screen.findByDisplayValue(/\/join\?team=t1/)).toBeInTheDocument();
  });

  it('⑦ JoinRequestsTab：批准调 API', async () => {
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await screen.findByText('张三');
    fireEvent.click(screen.getByTestId('tab-requests'));
    fireEvent.click(await screen.findByRole('button', { name: '批 准' }));
    await waitFor(() => expect(api.approveJoinRequest).toHaveBeenCalledWith('t1', 'r1'));
  });

  it('⑥ CreditsTab：档位充值（10 元→100 积分订单+支付）', async () => {
    api.createTeamRechargeOrder.mockResolvedValue({ outTradeNo: 'TEAM1' });
    api.payTeamOrder.mockResolvedValue({ codeUrl: 'weixin://x', orderNo: 'TEAM1', amount: 1000, status: 'PENDING' });
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await screen.findByText('张三');
    fireEvent.click(screen.getByTestId('tab-credits'));
    fireEvent.click(screen.getByRole('button', { name: '充 值' }));
    fireEvent.click(await screen.findByText('¥10'));
    await waitFor(() => expect(api.createTeamRechargeOrder).toHaveBeenCalledWith('t1', 10));
    await waitFor(() => expect(api.payTeamOrder).toHaveBeenCalledWith('t1', 'TEAM1'));
  });

  it('⑪ 团队切换下拉：多团队显示并切换写 localStorage', async () => {
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await screen.findByText('张三');
    const select = screen.getByTestId('team-switcher');
    expect(select).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 't2' } });
    expect(localStorage.getItem('currentTeamId')).toBe('t2');
  });

  it('④ 预留席位占位行补齐（成员 2/20 → 18 个占位）', async () => {
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await screen.findByText('张三');
    expect(screen.getAllByText('— 空席位 —').length).toBe(18);
  });
});
