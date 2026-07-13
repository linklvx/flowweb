import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Navbar } from './Navbar';
import { AuthProvider } from '@/components/AuthProvider';

const mockOpen = vi.fn();

vi.mock('@/stores/vipModalStore', () => ({
  useVipModalStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { visible: false, open: mockOpen, close: vi.fn() };
    return selector ? selector(state) : state;
  },
}));

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>
  );
}

describe('Navbar', () => {
  it('should render brand logo text', () => {
    renderWithProviders(<Navbar />);
    expect(screen.getByText(/Flow123/i)).toBeInTheDocument();
  });

  it('should render nav links: 首页, 模板广场, 文档中心, 我的作品', () => {
    renderWithProviders(<Navbar />);
    expect(screen.getByText('首页')).toBeInTheDocument();
    expect(screen.getByText('模板广场')).toBeInTheDocument();
    expect(screen.getByText('文档中心')).toBeInTheDocument();
    expect(screen.getByText('我的作品')).toBeInTheDocument();
  });

  it('should link 首页 to /', () => {
    renderWithProviders(<Navbar />);
    expect(screen.getByText('首页').closest('a')).toHaveAttribute('href', '/');
  });

  it('should link 模板广场 to /templates', () => {
    renderWithProviders(<Navbar />);
    expect(screen.getByText('模板广场').closest('a')).toHaveAttribute('href', '/templates');
  });

  it('should link 文档中心 to /docs', () => {
    renderWithProviders(<Navbar />);
    expect(screen.getByText('文档中心').closest('a')).toHaveAttribute('href', '/docs');
  });

  it('should link 我的作品 to /settings/templates', () => {
    renderWithProviders(<Navbar />);
    expect(screen.getByText('我的作品').closest('a')).toHaveAttribute('href', '/settings/templates');
  });

  it('should render login/register button when user is not authenticated', () => {
    renderWithProviders(<Navbar />);
    const loginBtn = screen.getByText('登录/注册');
    expect(loginBtn).toBeInTheDocument();
    expect(loginBtn.tagName).toBe('BUTTON');
  });

  it('should render vip button as button element (not link)', () => {
    renderWithProviders(<Navbar />);
    const vipBtn = screen.getByText('会员充值');
    expect(vipBtn.tagName).toBe('BUTTON');
  });

  it('should call vipModalStore.open on vip button click', () => {
    mockOpen.mockClear();
    renderWithProviders(<Navbar />);
    const vipBtn = screen.getByText('会员充值');
    fireEvent.click(vipBtn);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });
});
