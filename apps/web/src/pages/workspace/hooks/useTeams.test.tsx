import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTeams } from './useTeams';
import { useTeamStore, _internal } from '@/stores/teamStore';

const mockGetMyTeams = vi.fn();
const { stableUser } = vi.hoisted(() => ({ stableUser: { id: 'u1', name: '我' } }));
vi.mock('@/api/teamApi', () => ({
  getMyTeams: (...args: any[]) => mockGetMyTeams(...args),
  teamDisplayName: (t: any) => t.name,
}));
// user 必须稳定引用（真实 AuthProvider 的 user 是 state）：每渲染新建对象会让
// fetchTeams 的 [user] 依赖每帧重跑 → 强制重拉循环，error 态被二次拉取打回 loading
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: stableUser, loading: false }),
}));

const team = (id: string, isOwner: boolean, isDefault = false) => ({ id, name: id, isOwner, isDefault, memberCount: 1, projectCount: 0 });

describe('useTeams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _internal.reset();
    useTeamStore.setState({ teams: [], status: 'loading', currentTeamId: null });
  });

  it('成功：三态 success，realTeams 过滤 isDefault 且 owned 在前', async () => {
    mockGetMyTeams.mockResolvedValue([
      team('default', true, true),
      team('joined-1', false),
      team('owned-1', true),
    ]);
    const { result } = renderHook(() => useTeams());
    expect(result.current.state.status).toBe('loading');
    await waitFor(() => expect(result.current.state.status).toBe('success'));
    expect(result.current.realTeams.map((t) => t.id)).toEqual(['owned-1', 'joined-1']);
  });

  it('失败：error 终态，retry 后恢复（不再死屏）', async () => {
    mockGetMyTeams.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useTeams());
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    mockGetMyTeams.mockResolvedValue([team('owned-1', true)]);
    result.current.retry();
    await waitFor(() => expect(result.current.state.status).toBe('success'));
  });

  it('重入刷新：success 后重新挂载强制重拉（新团队可见）', async () => {
    mockGetMyTeams.mockResolvedValue([team('owned-1', true)]);
    const first = renderHook(() => useTeams());
    await waitFor(() => expect(first.result.current.state.status).toBe('success'));
    mockGetMyTeams.mockResolvedValue([team('owned-1', true), team('owned-2', true)]);
    mockGetMyTeams.mockClear();
    first.unmount();
    const second = renderHook(() => useTeams());
    await waitFor(() => expect(mockGetMyTeams).toHaveBeenCalledTimes(1)); // 旧 ensure 实现 success 短路不重发——回归哨兵
    await waitFor(() => expect(second.result.current.realTeams.map((t) => t.id)).toEqual(['owned-1', 'owned-2']));
  });
});
