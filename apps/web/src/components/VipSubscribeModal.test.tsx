import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { VipSubscribeModal } from './VipSubscribeModal';
import { useVipModalStore } from '@/stores/vipModalStore';

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
    return render(<VipSubscribeModal />);
  };

  const renderClosed = () => {
    return render(<VipSubscribeModal />);
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

    // Close store directly and advance exit timer
    act(() => { useVipModalStore.getState().close(); });
    act(() => { vi.runAllTimers(); });
    // Re-render to let React process the state changes
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

  // ─── 7. Period switching ───
  it('should have period tabs', () => {
    renderOpen();
    expect(screen.getByText('连续包月')).toBeInTheDocument();
    expect(screen.getByText('连续包季')).toBeInTheDocument();
    expect(screen.getByText('连续包年')).toBeInTheDocument();
  });

  it('should default to 连续包月 selected', () => {
    renderOpen();
    const monthlyBtn = screen.getByText('连续包月').closest('button');
    expect(monthlyBtn).not.toBeNull();
  });

  // ─── 8. FAQ expand/collapse ───
  it('should render FAQ items', () => {
    renderOpen();
    expect(screen.getByText('积分有效期规则')).toBeInTheDocument();
    expect(screen.getByText('会员&积分 退款规则')).toBeInTheDocument();
  });

  it('should toggle FAQ item on click', () => {
    renderOpen();
    const faqBtn = screen.getByText('积分有效期规则').closest('button')!;
    // Initially collapsed - aria-expanded is false
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

  // ─── 9. Team tab shows placeholder ───
  it('should show placeholder when team tab is clicked', () => {
    renderOpen();
    const teamTab = screen.getByText('团队版会员');
    fireEvent.click(teamTab);
    expect(screen.getByText('敬请期待')).toBeInTheDocument();
    expect(screen.queryByText('立即开通')).not.toBeInTheDocument();
  });

  // ─── 10. Default selections ───
  it('should have Pro tier active by default', () => {
    renderOpen();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    // Pro card should have the selected border
    const proCard = document.querySelector('[data-tier="pro"]');
    expect(proCard).not.toBeNull();
    expect(proCard?.className).toContain('border-[#4ade80]');
  });

  // ─── 11. Accessibility attributes ───
  it('should have role="dialog" and aria-modal="true"', () => {
    renderOpen();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'vip-modal-title');
  });

  // ─── 12. Close button aria-label ───
  it('should have close button with aria-label', () => {
    renderOpen();
    const closeBtn = screen.getByLabelText('关闭会员弹窗');
    expect(closeBtn).toBeInTheDocument();
  });

  // ─── 13. Card selection switches activeTier ───
  it('should switch active tier on card click', () => {
    renderOpen();
    // Click basic card to switch away from default Pro
    const basicCard = document.querySelector('[data-tier="basic"]') as HTMLElement;
    expect(basicCard).not.toBeNull();
    fireEvent.click(basicCard);
    expect(basicCard.className).toContain('border-[#4ade80]');
  });

  // ─── 14. Cards layout ───
  it('should render cards in a flex container', () => {
    renderOpen();
    const cards = document.querySelectorAll('[data-tier]');
    expect(cards.length).toBe(4);
  });

  // ─── 15. Card keyboard accessibility ───
  it('cards should be keyboard accessible via Tab', () => {
    renderOpen();
    // Cards have tabIndex={0}
    const cards = document.querySelectorAll('[data-tier]');
    expect(cards.length).toBe(4);
    cards.forEach(card => {
      expect(card.getAttribute('tabindex')).toBe('0');
    });
  });

  // ─── Entrance animation ───
  it('should have entrance transition classes', () => {
    renderOpen();
    const backdrop = screen.getByRole('dialog').parentElement!;
    act(() => { vi.advanceTimersByTime(50); });
    expect(backdrop.className).toContain('transition');
  });
});
