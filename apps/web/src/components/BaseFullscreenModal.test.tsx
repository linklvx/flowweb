import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BaseFullscreenModal } from './BaseFullscreenModal';

describe('BaseFullscreenModal', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
    // Mock rAF so requestAnimationFrame callbacks run synchronously in jsdom
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(performance.now());
      return 0;
    });
  });

  it('returns null when open is false', () => {
    const { container } = render(
      <BaseFullscreenModal open={false} onClose={vi.fn()} label="测试弹窗">
        <div data-testid="content">业务内容</div>
      </BaseFullscreenModal>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders portal content when open is true', () => {
    render(
      <BaseFullscreenModal open={true} onClose={vi.fn()} label="测试弹窗">
        <div data-testid="content">业务内容</div>
      </BaseFullscreenModal>,
    );
    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(screen.getByText('业务内容')).toBeInTheDocument();
  });

  it('renders dialog role with aria-label and aria-modal', () => {
    render(
      <BaseFullscreenModal open={true} onClose={vi.fn()} label="全屏查看">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label', '全屏查看');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('calls onClose when clicking backdrop (not content)', () => {
    const onClose = vi.fn();
    render(
      <BaseFullscreenModal open={true} onClose={onClose} label="测试">
        <div data-testid="content">内容</div>
      </BaseFullscreenModal>,
    );
    // 点击业务内容不触发关闭
    fireEvent.click(screen.getByTestId('content'));
    expect(onClose).not.toHaveBeenCalled();

    // 点击遮罩触发关闭 — backdrop 是 dialog 的父元素
    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape keydown and calls preventDefault + stopImmediatePropagation', () => {
    const onClose = vi.fn();
    render(
      <BaseFullscreenModal open={true} onClose={onClose} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const stopImmediateSpy = vi.spyOn(event, 'stopImmediatePropagation');
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    document.dispatchEvent(event);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(stopImmediateSpy).toHaveBeenCalled();
  });

  it('does not call onClose for non-Escape keys', () => {
    const onClose = vi.fn();
    render(
      <BaseFullscreenModal open={true} onClose={onClose} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('locks body scroll when open and restores on close', () => {
    const prevOverflow = document.body.style.overflow;

    const { rerender } = render(
      <BaseFullscreenModal open={true} onClose={vi.fn()} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <BaseFullscreenModal open={false} onClose={vi.fn()} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    expect(document.body.style.overflow).toBe(prevOverflow);
  });

  it('restores body scroll on unmount (cleanup safety)', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = render(
      <BaseFullscreenModal open={true} onClose={vi.fn()} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });

  it('does not modify body overflow when mounted with open=false', () => {
    document.body.style.overflow = 'auto';
    render(
      <BaseFullscreenModal open={false} onClose={vi.fn()} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    // overflow unchanged when mounted closed
    expect(document.body.style.overflow).toBe('auto');

    document.body.style.overflow = '';
  });

  it('preserves original overflow through full open/close cycle', () => {
    document.body.style.overflow = 'scroll';
    const { rerender } = render(
      <BaseFullscreenModal open={false} onClose={vi.fn()} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    expect(document.body.style.overflow).toBe('scroll');

    // Open
    rerender(
      <BaseFullscreenModal open={true} onClose={vi.fn()} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    // Close — restore 'scroll'
    rerender(
      <BaseFullscreenModal open={false} onClose={vi.fn()} label="测试">
        <div>内容</div>
      </BaseFullscreenModal>,
    );
    expect(document.body.style.overflow).toBe('scroll');

    document.body.style.overflow = '';
  });

  it('focuses initialFocusRef on open', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const ref = { current: btn };
    const focusSpy = vi.spyOn(btn, 'focus');

    render(
      <BaseFullscreenModal open={true} onClose={vi.fn()} label="测试" initialFocusRef={ref}>
        <div>内容</div>
      </BaseFullscreenModal>,
    );

    expect(focusSpy).toHaveBeenCalled();
    document.body.removeChild(btn);
  });

  it('returns focus to triggerRef on close via cleanup', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const triggerRef = { current: btn as HTMLElement | null };
    const focusSpy = vi.spyOn(btn, 'focus');

    const { rerender } = render(
      <BaseFullscreenModal open={true} onClose={vi.fn()} label="测试" triggerRef={triggerRef}>
        <div>内容</div>
      </BaseFullscreenModal>,
    );

    rerender(
      <BaseFullscreenModal open={false} onClose={vi.fn()} label="测试" triggerRef={triggerRef}>
        <div>内容</div>
      </BaseFullscreenModal>,
    );

    expect(focusSpy).toHaveBeenCalled();
    document.body.removeChild(btn);
  });

  it('returns focus to triggerRef on unmount (safety net)', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const triggerRef = { current: btn as HTMLElement | null };
    const focusSpy = vi.spyOn(btn, 'focus');

    const { unmount } = render(
      <BaseFullscreenModal open={true} onClose={vi.fn()} label="测试" triggerRef={triggerRef}>
        <div>内容</div>
      </BaseFullscreenModal>,
    );

    unmount();
    expect(focusSpy).toHaveBeenCalled();
    document.body.removeChild(btn);
  });
});

describe('BaseFullscreenModal closeOnBackdrop 开关', () => {
  it('默认 true：点遮罩关闭（既有行为保持）', () => {
    const onClose = vi.fn();
    render(<BaseFullscreenModal open onClose={onClose} label="测试"><div /></BaseFullscreenModal>);
    fireEvent.click(screen.getByRole('dialog').parentElement!); // dialog 的父级即遮罩层
    expect(onClose).toHaveBeenCalled();
  });
  it('closeOnBackdrop=false：点遮罩不关闭（视频编辑器场景）', () => {
    const onClose = vi.fn();
    render(<BaseFullscreenModal open onClose={onClose} label="测试" closeOnBackdrop={false}><div /></BaseFullscreenModal>);
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).not.toHaveBeenCalled();
  });
});
