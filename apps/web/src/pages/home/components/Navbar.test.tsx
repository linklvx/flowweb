import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Navbar } from './Navbar';
import { NavActionKey } from '@flowweb/shared';

describe('Navbar', () => {
  it('should render brand logo text', () => {
    render(<Navbar />);
    expect(screen.getByText(/FlowAI/i)).toBeInTheDocument();
  });

  it('should render all three nav action buttons', () => {
    render(<Navbar />);
    expect(screen.getByText('模板广场')).toBeInTheDocument();
    expect(screen.getByText('开通会员')).toBeInTheDocument();
    expect(screen.getByText('登录')).toBeInTheDocument();
  });

  it('should call onAction with correct NavActionKey when templates button is clicked', () => {
    const onAction = vi.fn();
    render(<Navbar onAction={onAction} />);
    fireEvent.click(screen.getByText('模板广场'));
    expect(onAction).toHaveBeenCalledWith(NavActionKey.Templates);
  });

  it('should call onAction for membership button', () => {
    const onAction = vi.fn();
    render(<Navbar onAction={onAction} />);
    fireEvent.click(screen.getByText('开通会员'));
    expect(onAction).toHaveBeenCalledWith(NavActionKey.Membership);
  });

  it('should call onAction for login button', () => {
    const onAction = vi.fn();
    render(<Navbar onAction={onAction} />);
    fireEvent.click(screen.getByText('登录'));
    expect(onAction).toHaveBeenCalledWith(NavActionKey.Login);
  });
});
