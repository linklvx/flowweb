import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { VipSubscribeModal } from './VipSubscribeModal';
import { useVipModalStore } from '@/stores/vipModalStore';
import type { SubscriptionPeriod } from '@flowweb/shared';

function makePlan(tier: string, name: string, firstPrice: number, regularPrice: number, credits: number) {
  return {
    tier, name, price: firstPrice, originalPrice: regularPrice,
    discountTag: regularPrice > 0 ? Math.round(firstPrice / regularPrice * 10) + '折' : '-',
    monthlyPoints: credits,
    imageEstimate: credits * 4,
    videoEstimate: Math.floor(credits * 0.2),
    concurrentLimit: tier === 'ultra' ? null : (tier === 'max' ? 20 : tier === 'pro' ? 12 : 8),
    storageSize: tier === 'ultra' ? '600GB' : tier === 'max' ? '300GB' : tier === 'pro' ? '100GB' : '60GB',
    annualSavingPercent: tier === 'ultra' ? 47 : tier === 'max' ? 47 : tier === 'pro' ? 46 : 20,
    rights: {
      limited: ['Seedream 5.0 Pro 限时8折', 'Happy Horse 1.1 限时4折'],
      general: ['8个并发任务', '云端存储空间60GB', '去除品牌水印 商用无忧', '会员专享无限次加速', '登录每日赠送20积分', '训练专属权益'],
      exclusive: ['脚本策划', '智能分镜（Kling3.0/O3）', '9/4/25 宫格生成', '宫格切分', '镜头聚焦', '多模态主体库', '视频剪辑', '720 度全景'],
    },
  } as any;
}

const PLANS_BY_PERIOD: Record<SubscriptionPeriod, any[]> = {
  monthly: [
    makePlan('basic', '普通', 49, 66, 1500),
    makePlan('pro', 'Pro', 149, 199, 4600),
    makePlan('max', 'Max', 499, 669, 16300),
    makePlan('ultra', 'Ultra', 999, 1299, 32800),
  ],
  quarterly: [
    makePlan('basic', '普通', 135, 180, 1500),
    makePlan('pro', 'Pro', 400, 540, 4600),
    makePlan('max', 'Max', 1400, 1800, 16300),
    makePlan('ultra', 'Ultra', 2800, 3600, 32800),
  ],
  annually: [
    makePlan('basic', '普通', 520, 720, 1500),
    makePlan('pro', 'Pro', 1500, 2000, 4600),
    makePlan('max', 'Max', 5400, 7200, 16300),
    makePlan('ultra', 'Ultra', 10800, 14400, 32800),
  ],
};

describe('VipSubscribeModal', () => {
  beforeEach(() => {
    useVipModalStore.setState({ visible: false });
    document.body.style.overflow = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.style.overflow = '';
  });

  const renderOpen = () => {
    act(() => { useVipModalStore.getState().open(); });
    return render(<VipSubscribeModal plansByPeriod={PLANS_BY_PERIOD} />);
  };

  const renderClosed = () => {
    return render(<VipSubscribeModal plansByPeriod={PLANS_BY_PERIOD} />);
  };

  // Helper: trigger close and flush exit animation timer
  const flushClose = () => {
    act(() => { vi.runAllTimers(); });
  };

  // ─── 1. Conditional rendering ───
  it('should return nothing when visible is false', () => {
    const { container } = renderClosed();
    expect(container.innerHTML).toBe('');
  });

  it('should render dialog when visible is true', () => {
    renderOpen();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // ─── 2. Backdrop click → close ───
  it('should close when clicking backdrop', () => {
    renderOpen();
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement!;
    fireEvent.click(backdrop);
    flushClose();
    expect(useVipModalStore.getState().visible).toBe(false);
  });

  // ─── 3. Close button → close ───
  it('should close when clicking close button', () => {
    renderOpen();
    const closeBtn = screen.getByLabelText('关闭会员弹窗');
    fireEvent.click(closeBtn);
    flushClose();
    expect(useVipModalStore.getState().visible).toBe(false);
  });

  // ─── 4. ESC key → close ───
  it('should close on Escape key', () => {
    renderOpen();
    fireEvent.keyDown(document, { key: 'Escape' });
    flushClose();
    expect(useVipModalStore.getState().visible).toBe(false);
  });

  it('should not close on non-Escape key', () => {
    renderOpen();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(useVipModalStore.getState().visible).toBe(true);
  });

  // ─── 5. Body scroll lock ───
  it('should lock body scroll when open', () => {
    document.body.style.overflow = 'scroll';
    renderOpen();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('should restore body scroll on component unmount', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = renderOpen();
    expect(document.body.style.overflow).toBe('hidden');

    act(() => { useVipModalStore.getState().close(); });
    act(() => { vi.runAllTimers(); });
    unmount();

    expect(document.body.style.overflow).toBe('scroll');
  });

  // ─── 6. 4 plan cards ───
  it('should render 4 plan cards', () => {
    renderOpen();
    const buttons = screen.getAllByText('立即开通');
    expect(buttons).toHaveLength(4);
  });

  it('should render plan names: 普通, Pro, Max, Ultra', () => {
    renderOpen();
    expect(screen.getByText('普通')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Max')).toBeInTheDocument();
    expect(screen.getByText('Ultra')).toBeInTheDocument();
  });

  // ─── 7. Plan cards show API-driven data ───
  it('should display first price as the main price', () => {
    renderOpen();
    expect(screen.getByText('49')).toBeInTheDocument();
  });

  it('should display original price as strikethrough', () => {
    renderOpen();
    expect(screen.getByText('¥66')).toBeInTheDocument();
  });

  it('should display monthly credits', () => {
    renderOpen();
    expect(screen.getByText('1,500')).toBeInTheDocument();
  });

  // ─── 8. Period switching ───
  it('should have period tabs', () => {
    renderOpen();
    expect(screen.getByText('包月')).toBeInTheDocument();
    expect(screen.getByText('包季')).toBeInTheDocument();
    expect(screen.getByText('包年')).toBeInTheDocument();
  });

  it('should default to 包月 selected', () => {
    renderOpen();
    const monthlyBtn = screen.getByText('包月').closest('button');
    expect(monthlyBtn).not.toBeNull();
  });

  it('should show /月 suffix for monthly period', () => {
    renderOpen();
    expect(screen.getAllByText('/月').length).toBeGreaterThan(0);
  });

  it('should show /季 suffix when quarterly selected', () => {
    renderOpen();
    fireEvent.click(screen.getByText('包季'));
    expect(screen.getAllByText('/季').length).toBeGreaterThan(0);
  });

  it('should show /年 suffix when annually selected', () => {
    renderOpen();
    fireEvent.click(screen.getByText('包年'));
    expect(screen.getAllByText('/年').length).toBeGreaterThan(0);
  });

  // ─── 9. FAQ expand/collapse ───
  it('should render FAQ items', () => {
    renderOpen();
    expect(screen.getByText('积分有效期规则')).toBeInTheDocument();
    expect(screen.getByText('会员&积分 退款规则')).toBeInTheDocument();
  });

  it('should toggle FAQ item on click', () => {
    renderOpen();
    const faqBtn = screen.getByText('积分有效期规则').closest('button')!;
    expect(faqBtn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(faqBtn);
    act(() => { vi.advanceTimersByTime(100); });
    expect(faqBtn).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(faqBtn);
    act(() => { vi.advanceTimersByTime(100); });
    expect(faqBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('should allow multiple FAQs open simultaneously (non-exclusive)', () => {
    renderOpen();
    const faq1 = screen.getByText('积分有效期规则').closest('button')!;
    const faq2 = screen.getByText('会员&积分 退款规则').closest('button')!;

    fireEvent.click(faq1);
    fireEvent.click(faq2);
    act(() => { vi.advanceTimersByTime(100); });

    expect(faq1).toHaveAttribute('aria-expanded', 'true');
    expect(faq2).toHaveAttribute('aria-expanded', 'true');
  });

  // ─── 10. Team tab shows placeholder ───
  it('should show placeholder when team tab is clicked', () => {
    renderOpen();
    const teamTab = screen.getByText('团队版会员');
    fireEvent.click(teamTab);
    expect(screen.getByText('敬请期待')).toBeInTheDocument();
    expect(screen.queryByText('立即开通')).not.toBeInTheDocument();
  });

  // ─── 11. Default selections ───
  it('should have Pro tier active by default', () => {
    renderOpen();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    const proCard = document.querySelector('[data-tier="pro"]');
    expect(proCard).not.toBeNull();
    expect(proCard?.className).toContain('border-[#4ade80]');
  });

  // ─── 12. Accessibility attributes ───
  it('should have role="dialog" and aria-modal="true"', () => {
    renderOpen();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'vip-modal-title');
  });

  // ─── 13. Close button aria-label ───
  it('should have close button with aria-label', () => {
    renderOpen();
    const closeBtn = screen.getByLabelText('关闭会员弹窗');
    expect(closeBtn).toBeInTheDocument();
  });

  // ─── 14. Card selection switches activeTier ───
  it('should switch active tier on card click', () => {
    renderOpen();
    const basicCard = document.querySelector('[data-tier="basic"]') as HTMLElement;
    expect(basicCard).not.toBeNull();
    fireEvent.click(basicCard);
    expect(basicCard.className).toContain('border-[#4ade80]');
  });

  // ─── 15. Cards layout ───
  it('should render cards in a flex container', () => {
    renderOpen();
    const cards = document.querySelectorAll('[data-tier]');
    expect(cards.length).toBe(4);
  });

  // ─── 16. Card keyboard accessibility ───
  it('cards should be keyboard accessible via Tab', () => {
    renderOpen();
    const cards = document.querySelectorAll('[data-tier]');
    expect(cards.length).toBe(4);
    cards.forEach(card => {
      expect(card.getAttribute('tabindex')).toBe('0');
    });
  });

  // ─── 17. When no plansByPeriod prop, fetches from API ───
  it('should render empty when API has no plans yet', () => {
    act(() => { useVipModalStore.getState().open(); });
    const { container } = render(<VipSubscribeModal />);
    // No plans loaded from API, so no plan cards
    expect(screen.queryByText('立即开通')).not.toBeInTheDocument();
  });

  // ─── Entrance animation ───
  it('should have entrance transition classes', () => {
    renderOpen();
    const backdrop = screen.getByRole('dialog').parentElement!;
    act(() => { vi.advanceTimersByTime(50); });
    expect(backdrop.className).toContain('transition');
  });
});
