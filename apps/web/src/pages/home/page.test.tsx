import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { HomePage } from './index';
import { AuthProvider } from '@/components/AuthProvider';

// Mock stores
vi.mock('@/stores/contentStore', () => ({
  useContentStore: vi.fn(() => ({
    cards: [],
    loading: false,
    error: null,
    fetchCards: vi.fn(),
  })),
}));

vi.mock('@/stores/announcementStore', () => ({
  useAnnouncementStore: vi.fn(() => ({
    visible: true,
    message: '平台公告：新用户送100积分',
    linkUrl: undefined,
    dismiss: vi.fn(),
  })),
}));

vi.mock('@/stores/vipModalStore', () => ({
  useVipModalStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { visible: false, open: vi.fn(), close: vi.fn() };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/components/VipSubscribeModal', () => ({
  VipSubscribeModal: () => <div data-testid="vip-subscribe-modal">VIP Modal</div>,
}));

describe('HomePage', () => {
  const renderHomePage = () =>
    render(
      <MemoryRouter>
        <AuthProvider>
          <HomePage />
        </AuthProvider>
      </MemoryRouter>
    );

  it('should render announcement message', () => {
    renderHomePage();
    expect(screen.getByText('平台公告：新用户送100积分')).toBeInTheDocument();
  });

  it('should render brand logo', () => {
    renderHomePage();
    expect(screen.getByText(/Flow123/i)).toBeInTheDocument();
  });

  it('should render hero title', () => {
    renderHomePage();
    expect(screen.getByText('AI 多模态内容创作平台')).toBeInTheDocument();
  });

  it('should render CTA button', () => {
    renderHomePage();
    expect(screen.getByText('开始创作')).toBeInTheDocument();
  });

  it('should render content section heading', () => {
    renderHomePage();
    expect(screen.getByText('精选工作流模板')).toBeInTheDocument();
  });

  it('should render nav links', () => {
    renderHomePage();
    expect(screen.getByText('首页')).toBeInTheDocument();
    expect(screen.getByText('模板广场')).toBeInTheDocument();
    expect(screen.getByText('文档中心')).toBeInTheDocument();
    expect(screen.getByText('我的作品')).toBeInTheDocument();
    expect(screen.getByText('登录/注册')).toBeInTheDocument();
  });

  it('should render AI assistant button', () => {
    renderHomePage();
    expect(screen.getByRole('button', { name: /AI 助手/i })).toBeInTheDocument();
  });

  it('should not render vip modal by default (visible is false)', () => {
    renderHomePage();
    expect(screen.queryByTestId('vip-subscribe-modal')).not.toBeInTheDocument();
  });
});
