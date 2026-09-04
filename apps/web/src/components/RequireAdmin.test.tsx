import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RequireAdmin } from './RequireAdmin';

const authState = { user: null as any, loading: false };
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => authState,
}));

function setup() {
  return render(
    <MemoryRouter initialEntries={['/admin/x']}>
      <Routes>
        <Route element={<RequireAdmin />}>
          <Route path="/admin/x" element={<div>ADMIN CONTENT</div>} />
        </Route>
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { authState.user = null; authState.loading = false; });

describe('RequireAdmin', () => {
  it('loading 态不渲染 403 也不渲染内容（不闪烁）', () => {
    authState.loading = true;
    const { container } = setup();
    expect(container.querySelector('.ant-spin')).toBeTruthy();
    expect(screen.queryByText('需要管理员权限')).toBeNull();
    expect(screen.queryByText('ADMIN CONTENT')).toBeNull();
  });
  it('未登录 → 跳 /login', () => {
    authState.user = null;
    setup();
    expect(screen.getByText('LOGIN PAGE')).toBeTruthy();
  });
  it('USER → 403 页面', () => {
    authState.user = { id: 'u', role: 'USER' };
    setup();
    expect(screen.getByText('需要管理员权限')).toBeTruthy();
    expect(screen.queryByText('ADMIN CONTENT')).toBeNull();
  });
  it('ADMIN → 渲染子路由', () => {
    authState.user = { id: 'u', role: 'ADMIN' };
    setup();
    expect(screen.getByText('ADMIN CONTENT')).toBeTruthy();
  });
});
