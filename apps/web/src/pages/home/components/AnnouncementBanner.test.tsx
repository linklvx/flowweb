import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnouncementBanner } from './AnnouncementBanner';

describe('AnnouncementBanner', () => {
  it('should render message text', () => {
    render(<AnnouncementBanner message="平台公告：新用户送100积分" />);
    expect(screen.getByText('平台公告：新用户送100积分')).toBeInTheDocument();
  });

  it('should render as a link when linkUrl is provided', () => {
    render(<AnnouncementBanner message="点击查看详情" linkUrl="/promo" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/promo');
  });

  it('should call onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<AnnouncementBanner message="test" onClose={onClose} />);
    const closeBtn = screen.getByRole('button', { name: /关闭/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
