import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTeams } from './useTeams';
import { useTeamStore, _internal } from '@/stores/teamStore';

const mockGetMyTeams = vi.fn();
vi.mock('@/api/teamApi', () => ({
  getMyTeams: (...args: any[]) => mockGetMyTeams(...args),
  teamDisplayName: (t: any) => t.name,
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
});
