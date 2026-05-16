import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Navbar } from './Navbar';
import { AuthProvider } from '@/components/AuthProvider';

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
    expect(screen.getByText(/FlowAI/i)).toBeInTheDocument();
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

  it('should render login/register link when user is not authenticated', () => {
    renderWithProviders(<Navbar />);
    const loginLink = screen.getByText('登录/注册');
    expect(loginLink).toBeInTheDocument();
    expect(loginLink.tagName).toBe('A');
    expect(loginLink.closest('a')).toHaveAttribute('href', '/login?redirect=/');
  });
});
