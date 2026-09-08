import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import TeamPage from './TeamPage';
import { useTeamStore, _internal } from '@/stores/teamStore';

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
  // TeamSidebar 依赖的 helper（整模块 mock 下缺失则渲染即崩）
  teamCreditsTotal: (b: { credits: number; subscriptionCredits: number }) => b.credits + b.subscriptionCredits,
  createTeam: vi.fn(),
}));

vi.mock('@/api/teamApi', () => api);
const { stableUser } = vi.hoisted(() => ({ stableUser: { id: 'u1', name: '我' } }));
// user 必须稳定引用（真实 AuthProvider 的 user 是 state）：每渲染新建对象会让
// fetchTeams 的 [user] 依赖每帧重跑 → 强制重拉循环，重拉次数断言将失去语义
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: stableUser, loading: false }),
}));

const team = {
  id: 't1', name: '我的团队', role: 'OWNER' as const, status: 'ACTIVE', isDefault: false, isOwner: true, createdAt: '2026-08-01', memberCount: 2, projectCount: 0,
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
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
    localStorage.clear();
    _internal.reset();
    useTeamStore.setState({ teams: [], status: 'loading', currentTeamId: null });
  });

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
    const detail = within(screen.getByTestId('team-detail'));
    expect(detail.getByText('500')).toBeInTheDocument();
    expect(detail.getByText('通用积分 400')).toBeInTheDocument();
    expect(detail.getByText('2')).toBeInTheDocument();
    expect(detail.getByText('1.0G')).toBeInTheDocument();
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

  it('⑪ 点击左侧列表项切换：store 更新且右侧数据以新 teamId 重拉（无刷新核心承诺）', async () => {
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await screen.findByText('张三');
    fireEvent.click(screen.getByTestId('team-card-t2'));
    expect(useTeamStore.getState().currentTeamId).toBe('t2');
    await waitFor(() => expect(api.listMembers).toHaveBeenCalledWith('t2', 1));
  });

  it('④ 预留席位占位行补齐（成员 2/20 → 18 个占位）', async () => {
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await screen.findByText('张三');
    expect(screen.getAllByText('— 空席位 —').length).toBe(18);
  });

  it('只有默认团队时：渲染个人面板（无空态），创建入口在 sidebar', async () => {
    api.getMyTeams.mockResolvedValue([
      { id: 't1', name: '我的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, projectCount: 0, balance: { credits: 100, subscriptionCredits: 0 }, subscription: null },
    ]);
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: '个人项目' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建团队' })).toBeInTheDocument();
    expect(screen.queryByText(/还没有团队/)).not.toBeInTheDocument();
  });

  it('选中默认团队时渲染个人项目精简面板（余额+订阅状态，无成员管理）', async () => {
    api.getMyTeams.mockResolvedValue([
      { id: 't1', name: '我的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, projectCount: 0, balance: { credits: 100, subscriptionCredits: 50 }, subscription: { planName: 'pro', status: 'active', currentPeriodEnd: '2026-09-15' } },
      { id: 't2', name: '第二团队', role: 'OWNER', status: 'ACTIVE', isDefault: false, isOwner: true, createdAt: '2026-08-02', memberCount: 2, projectCount: 0, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
    ]);
    useTeamStore.setState({ currentTeamId: 't1' });
    api.getTeamBalanceView.mockResolvedValue({ credits: 100, subscriptionCredits: 50, total: 150, quota: 0, used: 0 });
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    // sidebar 同名卡片文本也是「个人项目」，getByText 会多匹配；改按 heading role 精确匹配右侧面板 h2 标题
    expect(await screen.findByRole('heading', { name: '个人项目' })).toBeInTheDocument();
    expect(screen.getByTestId('personal-balance-total')).toHaveTextContent('150');
    expect(screen.queryByTestId('tab-members')).not.toBeInTheDocument();
    await waitFor(() => expect(api.listMembers).not.toHaveBeenCalled());
  });

  it('个人面板下点击右侧团队卡片切换到团队管理', async () => {
    api.getMyTeams.mockResolvedValue([
      { id: 't1', name: '我的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, projectCount: 0, balance: { credits: 100, subscriptionCredits: 50 }, subscription: { planName: 'pro', status: 'active', currentPeriodEnd: '2026-09-15' } },
      { id: 't2', name: '第二团队', role: 'OWNER', status: 'ACTIVE', isDefault: false, isOwner: true, createdAt: '2026-08-02', memberCount: 2, projectCount: 0, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
    ]);
    useTeamStore.setState({ currentTeamId: 't1' });
    api.getTeamBalanceView.mockResolvedValue({ credits: 100, subscriptionCredits: 50, total: 150, quota: 0, used: 0 });
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: '个人项目' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('team-card-t2'));
    await waitFor(() => expect(useTeamStore.getState().currentTeamId).toBe('t2'));
    expect(await screen.findByTestId('tab-members')).toBeInTheDocument();
  });

  it('个人精简面板充值按钮跳 /settings/credits、开通会员跳 /settings/membership', async () => {
    api.getMyTeams.mockResolvedValue([
      { id: 't1', name: '我的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, projectCount: 0, balance: { credits: 100, subscriptionCredits: 50 }, subscription: { planName: 'pro', status: 'active', currentPeriodEnd: '2026-09-15' } },
      { id: 't2', name: '第二团队', role: 'OWNER', status: 'ACTIVE', isDefault: false, isOwner: true, createdAt: '2026-08-02', memberCount: 2, projectCount: 0, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
    ]);
    useTeamStore.setState({ currentTeamId: 't1' });
    api.getTeamBalanceView.mockResolvedValue({ credits: 100, subscriptionCredits: 50, total: 150, quota: 0, used: 0 });
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    // sidebar 同名卡片文本也是「个人项目」，getByText 会多匹配；改按 heading role 精确匹配右侧面板 h2 标题
    expect(await screen.findByRole('heading', { name: '个人项目' })).toBeInTheDocument();
    expect(screen.getByTestId('link-personal-recharge').getAttribute('href')).toBe('/settings/credits');
    expect(screen.getByTestId('link-personal-membership').getAttribute('href')).toBe('/settings/membership');
  });

  it('创建链路：createTeam 成功但 fetchTeams 失败 → 不 switchTo 且弹窗保持（防 currentTeam 悬空）', async () => {
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await screen.findByText('张三'); // store 已 success（旧列表 t1/t2 保留），currentTeamId 归一为 t1
    const before = useTeamStore.getState().currentTeamId;
    api.createTeam.mockResolvedValue({ id: 't-new', name: '新团队' });
    api.getMyTeams.mockRejectedValueOnce(new Error('refresh fail')); // fetchTeams 强制重拉走 getMyTeams
    fireEvent.click(screen.getByRole('button', { name: '创建团队' }));
    const input = await screen.findByPlaceholderText('团队名称');
    fireEvent.change(input, { target: { value: '新团队' } });
    fireEvent.click(screen.getByRole('button', { name: '创 建' })); // Modal okText 两字，antd 自动插空格
    await waitFor(() => expect(api.createTeam).toHaveBeenCalledWith('新团队'));
    // spec §4：新 id 不在旧列表，switchTo 会让 currentTeam 悬空 → 失败分支必须跳过
    await waitFor(() => expect(useTeamStore.getState().currentTeamId).toBe(before));
    // 弹窗保持开启：输入框仍在文档、值未清空
    expect(screen.getByPlaceholderText('团队名称')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('团队名称')).toHaveValue('新团队');
  });

  it('⑫ 重入刷新：success 态重挂载强制重拉 /team/mine（他人侧变更可见）', async () => {
    const { unmount } = render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await waitFor(() => expect(useTeamStore.getState().status).toBe('success')); // 首挂成功
    api.getMyTeams.mockResolvedValue([
      team,
      { ...team, id: 't2', name: '第二团队', role: 'MEMBER' as const, isOwner: false },
      { ...team, id: 't3', name: '新批准的团队', role: 'MEMBER' as const, isOwner: false },
    ]);
    api.getMyTeams.mockClear();
    unmount();
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await waitFor(() => expect(api.getMyTeams).toHaveBeenCalledTimes(1)); // 旧 ensure 实现 success 短路不重发——回归哨兵
    expect(await screen.findByText('新批准的团队')).toBeInTheDocument();
  });
});
