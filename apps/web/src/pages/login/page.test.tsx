import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { LoginPage } from './page';

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    logout: vi.fn(),
    refresh: vi.fn(),
    updateUser: vi.fn(),
  }),
}));

describe('LoginPage', () => {
  function renderPage() {
    return render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
  }

  it('should render with full-screen dark background and centered card', () => {
    const { container } = renderPage();
    const outerDiv = container.firstChild as HTMLElement;
    expect(outerDiv.className).toContain('min-h-screen');
    expect(outerDiv.className).toContain('bg-[#f5f5f5]');
    expect(outerDiv.className).toContain('flex');
    expect(outerDiv.className).toContain('items-center');
    expect(outerDiv.className).toContain('justify-center');
  });

  it('should render banner fallback with Flow123', () => {
    renderPage();
    expect(screen.getByText('Flow123')).toBeInTheDocument();
  });

  it('should render phone login form, divider, wechat QR, and agreement footer', () => {
    renderPage();
    expect(screen.getByText('手机号登录')).toBeInTheDocument();
    expect(screen.getByText('微信扫码登录')).toBeInTheDocument();
    expect(screen.getByText('使用微信扫码快捷登录')).toBeInTheDocument();
    expect(
      screen.getByText(/登录即代表同意/),
    ).toBeInTheDocument();
  });

  it('should not have a close button (page-level entry)', () => {
    renderPage();
    expect(
      screen.queryByLabelText('Close'),
    ).not.toBeInTheDocument();
  });

  it('should render card with 720px width', () => {
    const { container } = renderPage();
    const card = container.querySelector('.w-\\[720px\\]');
    expect(card).toBeInTheDocument();
  });
});
