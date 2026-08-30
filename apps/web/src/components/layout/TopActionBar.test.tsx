import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TopActionBar } from './TopActionBar';
import { AuthProvider } from '@/components/AuthProvider';
import { useCreditsStore } from '@/stores/creditsStore';

const mockOpen = vi.fn();
vi.mock('@/stores/vipModalStore', () => ({
  useVipModalStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { visible: false, open: mockOpen, close: vi.fn() };
    return selector ? selector(state) : state;
  },
}));
vi.mock('@/components/auth/LoginModal', () => ({
  LoginModal: () => <div data-testid="login-modal">LoginModal</div>,
}));
vi.mock('@/components/TeamSwitcher', () => ({
  TeamSwitcher: () => <div data-testid="team-switcher" />,
}));

const mockFetch = vi.spyOn(globalThis, 'fetch');
const asResponse = (body: unknown) => ({ json: async () => body }) as Response;

function renderBar() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <TopActionBar />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('TopActionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCreditsStore.setState({
      credits: 900,
      subscriptionCredits: 100,
      tier: 'pro',
      loading: false,
      error: null,
      scope: 'personal',
      teamId: null,
      subscriptionCreditsExpiry: null,
      fetchBalance: vi.fn().mockResolvedValue(undefined),
      fetchTeamBalance: vi.fn(),
      applyBalance: vi.fn(),
      isSubscriptionActive: () => true,
    });
  });

  it('未登录：赚积分链接/会员充值按钮/登录注册按钮', async () => {
    mockFetch.mockResolvedValue(asResponse({ user: null }));
    renderBar();
    await waitFor(() => screen.getByTestId('top-action-bar'));
    expect(screen.getByText('赚积分').closest('a')).toHaveAttribute('href', '/settings/credits');
    expect(screen.getByRole('button', { name: /会员充值/ })).toBeInTheDocument();
    expect(screen.getByTestId('login-register-btn')).toBeInTheDocument();
  });

  it('未登录点会员充值：直接 openVipModal（不拦登录）', async () => {
    mockFetch.mockResolvedValue(asResponse({ user: null }));
    renderBar();
    await waitFor(() => screen.getByTestId('login-register-btn'));
    fireEvent.click(screen.getByRole('button', { name: /会员充值/ }));
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it('未登录点登录/注册：打开 LoginModal', async () => {
    mockFetch.mockResolvedValue(asResponse({ user: null }));
    renderBar();
    await waitFor(() => screen.getByTestId('login-register-btn'));
    fireEvent.click(screen.getByTestId('login-register-btn'));
    expect(screen.getByTestId('login-modal')).toBeInTheDocument();
  });

  it('登录态：积分数字 toLocaleString+等级标签+头像+团队切换器，且触发 fetchBalance', async () => {
    mockFetch.mockResolvedValue(asResponse({ user: { id: 'u1', name: '张三', email: 'z@x.com' } }));
    renderBar();
    await waitFor(() => screen.getByTestId('user-avatar'));
    expect(screen.getByText(/1,000/)).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByTestId('team-switcher')).toBeInTheDocument();
    expect(useCreditsStore.getState().fetchBalance).toHaveBeenCalled();
  });
});
