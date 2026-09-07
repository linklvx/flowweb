import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TeamSwitcher } from './TeamSwitcher';
import { useTeamStore, _internal } from '@/stores/teamStore';

const api = vi.hoisted(() => ({
  getMyTeams: vi.fn(),
  // 新 TeamSwitcher 调用 teamDisplayName；mock 工厂缺失则组件内 undefined 即崩
  teamDisplayName: (t: { isDefault: boolean; name: string }) => (t.isDefault ? '个人项目' : t.name),
}));

vi.mock('@/api/teamApi', () => api);

const team = (id: string, name: string, isDefault = false) => ({
  id, name, role: 'OWNER' as const, status: 'ACTIVE', isDefault, isOwner: true,
  createdAt: '2026-08-01', memberCount: 1, projectCount: 0,
  balance: { credits: 0, subscriptionCredits: 0 },
  subscription: null,
});

describe('TeamSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    _internal.reset();
    useTeamStore.setState({ teams: [], status: 'loading', currentTeamId: null });
  });

  it('① 渲染列表 + 当前标记：currentTeamId=t2 → 按钮显示 B 团', async () => {
    api.getMyTeams.mockResolvedValue([team('t1', 'A 团'), team('t2', 'B 团')]);
    useTeamStore.setState({ currentTeamId: 't2' });
    render(<TeamSwitcher />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /B 团/ })).toBeInTheDocument(),
    );
  });

  it('② 切换：点 A 团 → store.currentTeamId=t1（无 reload）', async () => {
    api.getMyTeams.mockResolvedValue([team('t1', 'A 团'), team('t2', 'B 团')]);
    useTeamStore.setState({ currentTeamId: 't2' });
    render(<TeamSwitcher />);
    await screen.findByText('B 团');
    fireEvent.click(screen.getByRole('button', { name: /B 团/ }));
    fireEvent.click(await screen.findByText('A 团'));
    await waitFor(() => expect(useTeamStore.getState().currentTeamId).toBe('t1'));
    expect(localStorage.getItem('currentTeamId')).toBe('t1');
  });

  it('③ 归一化：currentTeamId=dead 不在列表 → store 与 LS 回退 t1（无 reload）', async () => {
    api.getMyTeams.mockResolvedValue([team('t1', 'A 团')]);
    useTeamStore.setState({ currentTeamId: 'dead' });
    render(<TeamSwitcher />);
    await waitFor(() => expect(useTeamStore.getState().currentTeamId).toBe('t1'));
    expect(localStorage.getItem('currentTeamId')).toBe('t1');
  });

  it('④ 只有默认团队时整体隐藏（渲染 null）', async () => {
    api.getMyTeams.mockResolvedValue([team('t1', 'A的团队', true)]);
    const { container } = render(<TeamSwitcher />);
    await waitFor(() => expect(api.getMyTeams).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('button')).toBeNull());
  });

  it('⑤ 有真实团队时显示，默认团队条目显示「个人项目」且排第一', async () => {
    api.getMyTeams.mockResolvedValue([team('t1', 'A的团队', true), team('t2', 'B 团')]);
    render(<TeamSwitcher />);
    fireEvent.click(await screen.findByRole('button'));
    // 触发按钮本身也显示「个人项目」，必须在菜单项层查询（findAllByText 会多匹配按钮本体）
    const menuItems = await screen.findAllByRole('menuitem');
    // currentTeamId 未设置时 currentTeam 回退列表第一项（默认团队）→ 首项带 ✓ 当前标记
    expect(menuItems.map((el) => el.textContent)).toEqual(['个人项目 ✓', 'B 团']);
  });

  it('⑥ 不再有「新建团队」入口', async () => {
    api.getMyTeams.mockResolvedValue([team('t1', 'A的团队', true), team('t2', 'B 团')]);
    render(<TeamSwitcher />);
    fireEvent.click(await screen.findByRole('button'));
    await waitFor(() => expect(screen.queryByText('新建团队')).not.toBeInTheDocument());
  });
});
