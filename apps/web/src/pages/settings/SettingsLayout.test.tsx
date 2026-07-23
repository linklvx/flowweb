import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

import { SettingsLayout } from './SettingsLayout';

describe('SettingsLayout', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', name: 'Test', email: 'test@test.com' },
      logout: vi.fn(),
    });
  });

  it('should render sidebar navigation links', () => {
    render(
      <MemoryRouter initialEntries={['/settings/profile']}>
        <Routes>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route path="profile" element={<div>Profile Content</div>} />
            <Route path="credits" element={<div>Credits Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('个人资料')).toBeDefined();
    expect(screen.getByText('积分与余额')).toBeDefined();
    expect(screen.getByText('退出登录')).toBeDefined();
  });

  it('should render child route via Outlet', () => {
    render(
      <MemoryRouter initialEntries={['/settings/profile']}>
        <Routes>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route path="profile" element={<div>Profile Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('Profile Content')).toBeDefined();
  });
});
