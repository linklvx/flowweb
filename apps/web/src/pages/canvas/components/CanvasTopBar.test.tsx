import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const { mockUseAuth, mockCreditsStore, mockCanvasState, mockTeamApi, mockGetAwareness } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockCreditsStore: {
    credits: 88,
    subscriptionCredits: 12,
    subscriptionCreditsExpiry: null,
    tier: null,
    scope: 'personal',
    teamId: null,
    loading: false,
    error: null,
    fetchBalance: vi.fn(),
    fetchTeamBalance: vi.fn(),
    applyBalance: vi.fn(),
    isSubscriptionActive: vi.fn(() => false),
  },
  mockCanvasState: { teamId: null as string | null },
  mockTeamApi: { getDefaultTeam: vi.fn() },
  mockGetAwareness: vi.fn(),
}));

vi.mock('@/stores/creditsStore', () => ({
  useCreditsStore: () => mockCreditsStore,
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (selector: (s: { teamId: string | null }) => unknown) => selector(mockCanvasState),
}));

vi.mock('@/api/teamApi', () => ({
  getDefaultTeam: mockTeamApi.getDefaultTeam,
}));

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/stores/canvasCollabRuntime', () => ({
  getAwareness: () => mockGetAwareness(),
}));

import { CanvasTopBar } from './CanvasTopBar';

describe('CanvasTopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanvasState.teamId = null;
    mockGetAwareness.mockReturnValue(null);
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'u1@flowai.dev', name: 'U1' },
      loading: false,
    });
    mockTeamApi.getDefaultTeam.mockResolvedValue({ id: 't-default', name: '个人项目', isDefault: true });
  });

  function renderTopBarWith({ teamId }: { teamId: string | null }) {
    mockCanvasState.teamId = teamId;
    return render(
      <MemoryRouter>
        <CanvasTopBar projectId="test-pid" projectName="未命名项目" />
      </MemoryRouter>,
    );
  }

  function renderBar() {
    return renderTopBarWith({ teamId: null });
  }

  it('should display user avatar when authenticated', () => {
    renderBar();
    expect(screen.getByText('U')).toBeInTheDocument();
  });

  it('should display credits from store', () => {
    renderBar();
    expect(screen.getByLabelText('查看积分明细')).toBeDefined();
  });

  it('should show login link when not authenticated', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    renderBar();
    expect(screen.getByText('登录')).toBeDefined();
  });

  it('画布属非默认团队：挂载拉 /team/:id/balance（fetchTeamBalance）', async () => {
    renderTopBarWith({ teamId: 't-team' });
    await waitFor(() => expect(mockCreditsStore.fetchTeamBalance).toHaveBeenCalledWith('t-team'));
    expect(mockCreditsStore.fetchBalance).not.toHaveBeenCalled();
  });

  it('画布属默认团队：挂载走 personal fetchBalance', async () => {
    renderTopBarWith({ teamId: 't-default' });
    await waitFor(() => expect(mockCreditsStore.fetchBalance).toHaveBeenCalled());
    expect(mockCreditsStore.fetchTeamBalance).not.toHaveBeenCalled();
  });

  it('credits:update CustomEvent detail 为对象时 applyBalance', () => {
    renderTopBarWith({ teamId: 't-default' });
    act(() => {
      window.dispatchEvent(new CustomEvent('credits:update', { detail: { credits: 1, subscriptionCredits: 2 } }));
    });
    expect(mockCreditsStore.applyBalance).toHaveBeenCalledWith({ credits: 1, subscriptionCredits: 2 });
  });

  it('R33：在线成员列表排除本机（getRemoteStates——现状 getStates 全量自计入必红）', () => {
    mockGetAwareness.mockReturnValue({
      getStates: () => new Map([
        [1, { user: { id: 'me', name: '本机我' } }],   // 本机 clientID=1
        [2, { user: { id: 'u2', name: '协作者' } }],
      ]),
      getRemoteStates: () => [{ user: { id: 'u2', name: '协作者' } }],
      onStateChange: () => () => {},
    });
    renderBar();
    expect(screen.getByTitle('协作者')).toBeInTheDocument();
    expect(screen.queryByTitle('本机我')).toBeNull(); // R33：在线列表自计入（本机已在右侧头像区呈现）
  });
});
