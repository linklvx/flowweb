import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
}));

vi.mock('./AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
  AuthProvider: ({ children }: any) => children,
}));

import { RequireAuth } from './RequireAuth';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route element={<RequireAuth />}>
          <Route path="/canvas" element={<div>Canvas Page</div>} />
          <Route path="/admin" element={<div>Admin Page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should redirect to /login when not authenticated', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    renderAt('/canvas');
    expect(screen.getByText('Login Page')).toBeDefined();
    expect(screen.queryByText('Canvas Page')).toBeNull();
  });

  it('should render protected page when authenticated', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'test@test.com', name: 'Test' },
      loading: false,
    });
    renderAt('/canvas');
    expect(screen.getByText('Canvas Page')).toBeDefined();
  });

  it('should show loading state while auth is resolving', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true });
    renderAt('/canvas');
    expect(screen.getByText('加载中...')).toBeDefined();
  });

  it('should protect /admin as well', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    renderAt('/admin');
    expect(screen.getByText('Login Page')).toBeDefined();
  });

  it('should allow access to /admin when authenticated', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'test@test.com', name: 'Test' },
      loading: false,
    });
    renderAt('/admin');
    expect(screen.getByText('Admin Page')).toBeDefined();
  });
});
