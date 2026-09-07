import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TeamSidebar } from './TeamSidebar';
import { useTeamStore, _internal } from '@/stores/teamStore';
import type { MyTeam } from '@/api/teamApi';

vi.mock('@/api/teamApi', () => ({
  teamCreditsTotal: (b: { credits: number; subscriptionCredits: number }) => b.credits + b.subscriptionCredits,
  teamDisplayName: (t: { isDefault: boolean; name: string }) => (t.isDefault ? '个人项目' : t.name),
}));

const team = (id: string, o: Partial<MyTeam> = {}): MyTeam => ({
  id, name: id, role: 'OWNER', status: 'ACTIVE', isDefault: false, isOwner: true,
  createdAt: '2026-08-01', memberCount: 1, projectCount: 2,
  balance: { credits: 100, subscriptionCredits: 50 }, subscription: null, ...o,
});
const LIST: MyTeam[] = [
  team('d', { isDefault: true, name: 'A的团队' }),
  team('t1', { name: '我建的' }),
  team('t2', { isOwner: false, role: 'MEMBER', name: '加入的团', memberCount: 5 }),
];
const setSuccess = (currentTeamId = 't1') => {
  useTeamStore.setState({ teams: LIST, status: 'success', currentTeamId });
};
const reset = () => {
  _internal.reset();
  useTeamStore.setState({ teams: [], status: 'loading', currentTeamId: null });
};

describe('TeamSidebar', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); reset(); });

  it('loading：渲染骨架占位', () => {
    render(<TeamSidebar onCreateTeam={vi.fn()} />);
    expect(screen.getByTestId('sidebar-loading')).toBeInTheDocument();
  });

  it('error：显示失败与重试，点击调 fetchTeams', () => {
    useTeamStore.setState({ teams: [], status: 'error', currentTeamId: null });
    const spy = vi.spyOn(useTeamStore.getState(), 'fetchTeams').mockResolvedValue();
    render(<TeamSidebar onCreateTeam={vi.fn()} />);
    fireEvent.click(screen.getByTestId('sidebar-error').querySelector('button')!);
    expect(spy).toHaveBeenCalled();
  });

  it('success：个人置顶 + 创建组 + 加入组（徽标=组长度）+ 选中态', () => {
    setSuccess('t1');
    render(<TeamSidebar onCreateTeam={vi.fn()} />);
    expect(screen.getByTestId('team-card-d')).toBeInTheDocument();
    expect(screen.getByText('创建的团队').parentElement!.textContent).toContain('1');
    expect(screen.getByText('加入的团队').parentElement!.textContent).toContain('1');
    // 选中卡片带渐变类
    expect(screen.getByTestId('team-card-t1').className).toContain('from-cyan-500/10');
    expect(screen.getByTestId('team-card-t2').className).not.toContain('from-cyan-500/10');
  });

  it('卡片统计：成员/项目/积分（teamCreditsTotal 口径）', () => {
    setSuccess('t2');
    render(<TeamSidebar onCreateTeam={vi.fn()} />);
    const card = screen.getByTestId('team-card-t2');
    expect(card.textContent).toContain('5');   // 成员
    expect(card.textContent).toContain('2');   // 项目
    expect(card.textContent).toContain('150'); // 积分 100+50
  });

  it('点击团队卡片与个人项都调 switchTo', () => {
    setSuccess('t1');
    const spy = vi.spyOn(useTeamStore.getState(), 'switchTo');
    render(<TeamSidebar onCreateTeam={vi.fn()} />);
    fireEvent.click(screen.getByTestId('team-card-t2'));
    expect(spy).toHaveBeenCalledWith('t2');
    fireEvent.click(screen.getByTestId('team-card-d'));
    expect(spy).toHaveBeenCalledWith('d');
  });

  it('「加入的团队」为 0 时整组不渲染（含组头）', () => {
    useTeamStore.setState({ teams: [LIST[0], LIST[1]], status: 'success', currentTeamId: 't1' });
    render(<TeamSidebar onCreateTeam={vi.fn()} />);
    expect(screen.queryByText('加入的团队')).not.toBeInTheDocument();
  });

  it('+ 按钮打开创建弹窗（onCreateTeam 回调）', () => {
    setSuccess();
    const onCreateTeam = vi.fn();
    render(<TeamSidebar onCreateTeam={onCreateTeam} />);
    fireEvent.click(screen.getByRole('button', { name: '创建团队' }));
    expect(onCreateTeam).toHaveBeenCalled();
  });
});
