import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { HomePage } from './index';

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

describe('HomePage', () => {
  const renderHomePage = () =>
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

  it('should render announcement message', () => {
    renderHomePage();
    expect(screen.getByText('平台公告：新用户送100积分')).toBeInTheDocument();
  });

  it('should render brand logo', () => {
    renderHomePage();
    expect(screen.getByText(/FlowAI/i)).toBeInTheDocument();
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

  it('should render nav action buttons', () => {
    renderHomePage();
    expect(screen.getByText('模板广场')).toBeInTheDocument();
    expect(screen.getByText('开通会员')).toBeInTheDocument();
    expect(screen.getByText('登录')).toBeInTheDocument();
  });

  it('should render AI assistant button', () => {
    renderHomePage();
    expect(screen.getByRole('button', { name: /AI 助手/i })).toBeInTheDocument();
  });
});
