import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreditsPanelContent, default as CreditsDropdown } from './CreditsDropdown';
import { useCreditsStore } from '@/stores/creditsStore';

const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock('@/stores/creditsStore', () => ({
  useCreditsStore: vi.fn(),
}));

vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
}));

const baseProps = {
  credits: 5000,
  subscriptionCredits: 1000,
  subscriptionCreditsExpiry: '2026-12-31T12:00:00.000Z' as string | null,
  isActive: true,
  loading: false,
  error: null as string | null,
  onRetry: vi.fn(),
  onRecharge: vi.fn(),
  onInvite: vi.fn(),
};

describe('CreditsPanelContent', () => {
  // 1
  it('shows total = credits + subscriptionCredits when subscription is active', () => {
    render(<CreditsPanelContent {...baseProps} />);
    const matches = screen.getAllByText('6,000');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  // 2
  it('excludes subscriptionCredits from total when expired', () => {
    render(<CreditsPanelContent {...baseProps} isActive={false} />);
    const matches = screen.getAllByText('5,000');
    // 5,000 should appear (total + breakdown), 6,000 should NOT appear
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('6,000')).toBeNull();
  });

  // 3
  it('shows subscriptionCredits in the left column', () => {
    render(<CreditsPanelContent {...baseProps} />);
    const nums = screen.getAllByText('1,000');
    expect(nums.length).toBeGreaterThanOrEqual(1);
  });

  // 4
  it('shows credits in the right column', () => {
    render(<CreditsPanelContent {...baseProps} />);
    const nums = screen.getAllByText('5,000');
    expect(nums.length).toBeGreaterThanOrEqual(1);
  });

  // 5
  it('shows "暂无生效订阅" when expiry is null', () => {
    render(<CreditsPanelContent {...baseProps} subscriptionCreditsExpiry={null} isActive={false} />);
    expect(screen.getByText('暂无生效订阅')).toBeDefined();
  });

  // 6
  it('shows "已过期" with muted style when subscription expired', () => {
    render(<CreditsPanelContent {...baseProps} isActive={false} />);
    expect(screen.getByText('已过期')).toBeDefined();
    const leftCard = screen.getByText('已过期').closest('[class*="opacity"]');
    expect(leftCard).toBeDefined();
  });

  // 7
  it('shows formatted expiry date when subscription is active', () => {
    render(<CreditsPanelContent {...baseProps} />);
    expect(screen.getByText(/有效期至 2026-12-31/)).toBeDefined();
  });

  // 8
  it('renders zeros without crashing', () => {
    render(
      <CreditsPanelContent
        {...baseProps}
        credits={0}
        subscriptionCredits={0}
        subscriptionCreditsExpiry={null}
        isActive={false}
      />,
    );
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(1);
  });

  // 9
  it('formats large numbers with thousand separators', () => {
    render(<CreditsPanelContent {...baseProps} credits={1234567} subscriptionCredits={0} isActive={false} />);
    const matches = screen.getAllByText('1,234,567');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  // 10
  it('has a recharge button', () => {
    render(<CreditsPanelContent {...baseProps} />);
    expect(screen.getByText('充值')).toBeDefined();
  });

  // 11
  it('has an invite button', () => {
    render(<CreditsPanelContent {...baseProps} />);
    expect(screen.getByText('邀请好友 · 一起赢积分')).toBeDefined();
  });

  // 12
  it('shows Skeleton when loading', () => {
    render(<CreditsPanelContent {...baseProps} loading={true} />);
    const skeletons = document.querySelectorAll('.ant-skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  // 13
  it('shows error message with retry button', () => {
    const onRetry = vi.fn();
    render(<CreditsPanelContent {...baseProps} error="积分获取失败" onRetry={onRetry} />);
    expect(screen.getByText('积分获取失败')).toBeDefined();
    const retryBtn = screen.getByText('重试');
    expect(retryBtn).toBeDefined();
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  // 14
  it('calls onRecharge when recharge button is clicked', () => {
    const onRecharge = vi.fn();
    render(<CreditsPanelContent {...baseProps} onRecharge={onRecharge} />);
    fireEvent.click(screen.getByText('充值'));
    expect(onRecharge).toHaveBeenCalledOnce();
  });

  // 15
  it('calls onInvite when invite button is clicked', () => {
    const onInvite = vi.fn();
    render(<CreditsPanelContent {...baseProps} onInvite={onInvite} />);
    fireEvent.click(screen.getByText('邀请好友 · 一起赢积分'));
    expect(onInvite).toHaveBeenCalledOnce();
  });
});

describe('CreditsDropdown trigger', () => {
  it('renders trigger button with total credits and aria-label', () => {
    (useCreditsStore as unknown as Mock).mockReturnValue({
      credits: 5000,
      subscriptionCredits: 1000,
      subscriptionCreditsExpiry: '2026-12-31T12:00:00.000Z',
      loading: false,
      error: null,
      isSubscriptionActive: () => true,
      fetchBalance: vi.fn(),
    });

    render(<CreditsDropdown />);
    const btn = screen.getByLabelText('查看积分明细');
    expect(btn).toBeDefined();
    expect(btn.textContent).toContain('6,000');
  });
});

describe('CreditsDropdown scope 分流', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  function mockStore(scope: 'personal' | 'team', opts: { error?: string } = {}) {
    const store = {
      credits: 5000,
      subscriptionCredits: 1000,
      subscriptionCreditsExpiry: null,
      scope,
      teamId: scope === 'team' ? 't-1' : null,
      loading: false,
      error: opts.error ?? null,
      fetchBalance: vi.fn(),
      fetchTeamBalance: vi.fn(),
      isSubscriptionActive: () => true,
    };
    (useCreditsStore as unknown as Mock).mockReturnValue(store);
    return store;
  }

  it('scope=team 时充值按钮跳 /team/:id/billing', async () => {
    mockStore('team');
    render(<CreditsDropdown />);
    fireEvent.mouseEnter(screen.getByLabelText('查看积分明细'));
    fireEvent.click(await screen.findByRole('button', { name: /充值/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/team/t-1/billing');
  });

  it('scope=personal 时充值跳 /settings/credits', async () => {
    mockStore('personal');
    render(<CreditsDropdown />);
    fireEvent.mouseEnter(screen.getByLabelText('查看积分明细'));
    fireEvent.click(await screen.findByRole('button', { name: /充值/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/credits');
  });

  it('scope=team 时订阅积分卡显示团队语义（无到期日期）', () => {
    render(<CreditsPanelContent {...baseProps} scope="team" subscriptionCredits={30} />);
    expect(screen.getByText('团队订阅积分')).toBeInTheDocument();
  });

  it('scope=team 时重试拉团队余额而非个人接口', async () => {
    const store = mockStore('team', { error: '积分获取失败' });
    render(<CreditsDropdown />);
    fireEvent.mouseEnter(screen.getByLabelText('查看积分明细'));
    fireEvent.click(await screen.findByText('重试'));
    expect(store.fetchTeamBalance).toHaveBeenCalledWith('t-1');
    expect(store.fetchBalance).not.toHaveBeenCalled();
  });
});
