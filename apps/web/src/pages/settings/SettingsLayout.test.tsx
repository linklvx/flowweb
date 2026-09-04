import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

  it('导航链接名为「个人会员订阅」（原会员中心）', () => {
    render(
      <MemoryRouter initialEntries={['/settings/profile']}>
        <Routes>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route path="profile" element={<div>Profile Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('个人会员订阅')).toBeDefined();
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

  it('should NOT render 工作空间 in sidebar (decoupled from settings)', () => {
    render(
      <MemoryRouter initialEntries={['/settings/profile']}>
        <Routes>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route path="profile" element={<div>Profile Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    const sidebarNav = screen.getByText('退出登录').closest('nav');
    expect(within(sidebarNav as HTMLElement).queryByText('工作空间')).toBeNull();
  });
});
