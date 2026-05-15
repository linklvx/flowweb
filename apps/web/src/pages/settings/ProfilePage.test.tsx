import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));
const mockFetch = vi.fn();

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

globalThis.fetch = mockFetch;

import { ProfilePage } from './ProfilePage';

describe('ProfilePage', () => {
  const user = {
    id: 'u1', name: 'TestUser', email: 'test@test.com',
    image: null, emailVerified: false,
    createdAt: '2026-05-15T10:00:00.000Z',
    updatedAt: '2026-05-15T12:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user, updateUser: vi.fn() });
  });

  it('should display user info in view mode', () => {
    render(<ProfilePage />);
    expect(screen.getAllByText('TestUser').length).toBeGreaterThan(0);
    expect(screen.getAllByText('test@test.com').length).toBeGreaterThan(0);
    expect(screen.getByText('编辑资料')).toBeDefined();
  });

  it('should toggle to edit mode', () => {
    render(<ProfilePage />);
    fireEvent.click(screen.getByText('编辑资料'));
    expect(screen.getByText('保存')).toBeDefined();
    expect(screen.getByText('取消')).toBeDefined();
  });

  it('should disable save button when no changes', () => {
    render(<ProfilePage />);
    fireEvent.click(screen.getByText('编辑资料'));
    const saveBtn = screen.getByText('保存');
    expect(saveBtn).toBeDisabled();
  });

  it('should enable save button when name changed', () => {
    render(<ProfilePage />);
    fireEvent.click(screen.getByText('编辑资料'));
    const input = screen.getByDisplayValue('TestUser');
    fireEvent.change(input, { target: { value: 'NewName' } });
    const saveBtn = screen.getByText('保存');
    expect(saveBtn).not.toBeDisabled();
  });

  it('should call API and updateUser on save', async () => {
    const updateUser = vi.fn();
    mockUseAuth.mockReturnValue({ user, updateUser });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: { user: { ...user, name: 'NewName' } }
      })
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByText('编辑资料'));
    fireEvent.change(screen.getByDisplayValue('TestUser'), { target: { value: 'NewName' } });
    fireEvent.click(screen.getByText('保存'));

    // Button should show saving state immediately
    expect(screen.getByText('保存中...')).toBeDisabled();

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'NewName' })
      );
    });
  });
});
