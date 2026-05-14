import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Navbar } from './Navbar';
import { AuthProvider } from '@/components/AuthProvider';
import { NavActionKey } from '@flowweb/shared';

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

  it('should render nav action buttons and login link', () => {
    renderWithProviders(<Navbar />);
    expect(screen.getByText('模板广场')).toBeInTheDocument();
    expect(screen.getByText('开通会员')).toBeInTheDocument();
    expect(screen.getByText('登录')).toBeInTheDocument();
  });

  it('should call onAction with correct NavActionKey when templates button is clicked', () => {
    const onAction = vi.fn();
    renderWithProviders(<Navbar onAction={onAction} />);
    fireEvent.click(screen.getByText('模板广场'));
    expect(onAction).toHaveBeenCalledWith(NavActionKey.Templates);
  });

  it('should call onAction for membership button', () => {
    const onAction = vi.fn();
    renderWithProviders(<Navbar onAction={onAction} />);
    fireEvent.click(screen.getByText('开通会员'));
    expect(onAction).toHaveBeenCalledWith(NavActionKey.Membership);
  });

  it('should render login link when user is not authenticated', () => {
    renderWithProviders(<Navbar />);
    const loginLink = screen.getByText('登录');
    expect(loginLink).toBeInTheDocument();
    expect(loginLink.tagName).toBe('A');
  });
});
