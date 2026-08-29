import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const { mockUseAuth, mockCreditsStore, mockCanvasState, mockTeamApi } = vi.hoisted(() => ({
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

import { CanvasTopBar } from './CanvasTopBar';

describe('CanvasTopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanvasState.teamId = null;
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
});
