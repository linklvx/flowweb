import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthModal } from './AuthModal';

const mockRefresh = vi.fn();
const mockOnClose = vi.fn();

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({ refresh: mockRefresh }),
}));

describe('AuthModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefresh.mockResolvedValue(undefined);
    mockOnClose.mockClear();
  });

  const renderModal = () => render(<AuthModal onClose={mockOnClose} />);

  it('should render login form by default', () => {
    renderModal();
    expect(screen.getByPlaceholderText('邮箱')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('密码')).toBeInTheDocument();
    expect(screen.getByText('用户登录')).toBeInTheDocument();
  });

  it('should have close button', () => {
    renderModal();
    const closeBtn = screen.getByRole('button', { name: /关闭/i });
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('should switch to register form when clicking bottom register link', () => {
    renderModal();
    const regLinks = screen.getAllByText('注册');
    fireEvent.click(regLinks[regLinks.length - 1]);
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument();
    expect(screen.getByText('用户注册')).toBeInTheDocument();
  });

  it('should switch back to login form when clicking bottom login link', () => {
    renderModal();
    const regLinks = screen.getAllByText('注册');
    fireEvent.click(regLinks[regLinks.length - 1]);
    const loginLinks = screen.getAllByText('登录');
    fireEvent.click(loginLinks[loginLinks.length - 1]);
    expect(screen.getByText('用户登录')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('用户名')).not.toBeInTheDocument();
  });

  it('should call onClose when clicking backdrop', () => {
    renderModal();
    fireEvent.click(screen.getByTestId('auth-modal-backdrop'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
