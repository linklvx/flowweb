import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnouncementBar } from './AnnouncementBar';
import { useAnnouncementStore } from '@/stores/announcementStore';

const ANNOUNCEMENT = {
  id: 'a1',
  message: '平台公告：新功能上线',
  linkText: '了解更多',
  linkUrl: 'https://example.com',
  bgColor: '#0f2761',
  textColor: '#ffffff',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('AnnouncementBar', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    useAnnouncementStore.setState({ announcement: ANNOUNCEMENT, loaded: true });
  });

  it('渲染公告文字与应用配色', () => {
    render(<AnnouncementBar />);
    const bar = screen.getByTestId('announcement-bar');
    expect(screen.getByText('平台公告：新功能上线')).toBeInTheDocument();
    expect(bar.style.backgroundColor).toBe('rgb(15, 39, 97)');
  });

  it('配置了链接时渲染链接按钮，点击只打开一次（不冒泡整栏）', () => {
    render(<AnnouncementBar />);
    fireEvent.click(screen.getByTestId('announcement-link-btn'));
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('点内容区（无链接按钮处）也触发整栏跳转', () => {
    render(<AnnouncementBar />);
    fireEvent.click(screen.getByText('平台公告：新功能上线'));
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener noreferrer');
  });

  it('关闭按钮：真实 dismiss 写 sessionStorage 并清空 store，不触发跳转', () => {
    // 不 mock dismiss——sessionStorage 写入逻辑在真实 action 内，mock 掉则断言其副作用必失败
    render(<AnnouncementBar />);
    fireEvent.click(screen.getByTestId('announcement-close-btn'));
    expect(openSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('announcement_dismissed_a1')).toBe('1');
    expect(useAnnouncementStore.getState().announcement).toBeNull();
  });

  it('无公告时不渲染', () => {
    useAnnouncementStore.setState({ announcement: null });
    const { container } = render(<AnnouncementBar />);
    expect(container.firstChild).toBeNull();
  });
});
