import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
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
  getTeamLimits: vi.fn(),
  getTeamUsage: vi.fn(),
  // 新 TeamPage 调用 teamDisplayName；mock 工厂缺失则组件内 undefined 即崩
  teamDisplayName: (t: { isDefault: boolean; name: string }) => (t.isDefault ? '个人项目' : t.name),
  createTeam: vi.fn(),
}));

vi.mock('@/api/teamApi', () => api);
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', name: '我' }, loading: false }),
}));

const team = {
  id: 't1', name: '我的团队', role: 'OWNER' as const, status: 'ACTIVE', isDefault: false, isOwner: true, createdAt: '2026-08-01', memberCount: 2,
  balance: { credits: 400, subscriptionCredits: 100 },
  subscription: null,
};

function setup() {
  api.getMyTeams.mockResolvedValue([team, { ...team, id: 't2', name: '第二团队', role: 'MEMBER' as const, isOwner: false }]);
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
}

describe('TeamPage', () => {
  beforeEach(() => { vi.clearAllMocks(); setup(); });

  it('① 布局：左导航 4 项 tab + 默认成员管理激活', async () => {
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    expect(await screen.findByTestId('tab-members')).toBeInTheDocument();
    expect(screen.getByTestId('tab-credits')).toBeInTheDocument();
    expect(screen.getByTestId('tab-permissions')).toBeInTheDocument();
    expect(screen.getByTestId('tab-requests')).toBeInTheDocument();
    expect(await screen.findByText('张三')).toBeInTheDocument();
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

  it('⑥ CreditsTab：充值/订阅按钮跳转 /team/:id/billing', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<TeamPage />} />
          <Route path="/team/:id/billing" element={<div data-testid="billing-page-marker" />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('张三');
    fireEvent.click(screen.getByTestId('tab-credits'));
    fireEvent.click(screen.getByRole('button', { name: '充值 / 订阅' }));
    expect(await screen.findByTestId('billing-page-marker')).toBeInTheDocument();
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

  it('只有默认团队时空状态+新建团队按钮', async () => {
    api.getMyTeams.mockResolvedValue([
      { id: 't1', name: '我的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, balance: { credits: 100, subscriptionCredits: 0 }, subscription: null },
    ]);
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    expect(await screen.findByText(/还没有团队/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建团队' })).toBeInTheDocument();
  });

  it('选中默认团队时渲染个人项目精简面板（余额+订阅状态，无成员管理）', async () => {
    api.getMyTeams.mockResolvedValue([
      { id: 't1', name: '我的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, balance: { credits: 100, subscriptionCredits: 50 }, subscription: { planName: 'pro', status: 'active', currentPeriodEnd: '2026-09-15' } },
      { id: 't2', name: '第二团队', role: 'OWNER', status: 'ACTIVE', isDefault: false, isOwner: true, createdAt: '2026-08-02', memberCount: 2, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
    ]);
    localStorage.setItem('currentTeamId', 't1');
    api.getTeamBalanceView.mockResolvedValue({ credits: 100, subscriptionCredits: 50, total: 150, quota: 0, used: 0 });
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    expect(await screen.findByText('个人项目')).toBeInTheDocument();
    expect(screen.getByTestId('personal-balance-total')).toHaveTextContent('150');
    expect(screen.queryByTestId('tab-members')).not.toBeInTheDocument();
    await waitFor(() => expect(api.listMembers).not.toHaveBeenCalled());
  });

  it('个人精简面板充值按钮跳 /settings/credits、开通会员跳 /settings/membership', async () => {
    api.getMyTeams.mockResolvedValue([
      { id: 't1', name: '我的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, balance: { credits: 100, subscriptionCredits: 50 }, subscription: { planName: 'pro', status: 'active', currentPeriodEnd: '2026-09-15' } },
      { id: 't2', name: '第二团队', role: 'OWNER', status: 'ACTIVE', isDefault: false, isOwner: true, createdAt: '2026-08-02', memberCount: 2, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
    ]);
    localStorage.setItem('currentTeamId', 't1');
    api.getTeamBalanceView.mockResolvedValue({ credits: 100, subscriptionCredits: 50, total: 150, quota: 0, used: 0 });
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    expect(await screen.findByText('个人项目')).toBeInTheDocument();
    expect(screen.getByTestId('link-personal-recharge').getAttribute('href')).toBe('/settings/credits');
    expect(screen.getByTestId('link-personal-membership').getAttribute('href')).toBe('/settings/membership');
  });
});
