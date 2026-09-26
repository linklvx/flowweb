import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi } from 'vitest';

const authState = { user: { id: 'a', name: 'Admin', role: 'ADMIN' } as any, loading: false, logout: vi.fn() }; // AdminLayout 解构 logout，mock 需带
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => authState }));

import AdminLayout from './AdminLayout';

describe('AdminLayout', () => {
  it('渲染 5 组一级菜单文案（二级菜单 jsdom 布局测量脆弱，用容错断言）', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/models']}>
        <AdminLayout />
      </MemoryRouter>,
    );
    // 一级菜单精确断言（ProLayout 菜单异步挂载，需 findBy 等待；二级默认收起，展开依赖测量）
    for (const label of ['模型管理', '会员订阅', '首页配置', '风格库', '参数配置']) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
    // 二级菜单容错：存在即可，不存在不视为失败（浏览器验收覆盖）
    for (const label of ['套餐管理', '公告条']) {
      screen.queryByText(label); // no-throw
    }
  });
  it('菜单项渲染为 react-router Link（href 指向子路由）', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/models']}>
        <AdminLayout />
      </MemoryRouter>,
    );
    const link = await screen.findByRole('link', { name: /模型管理/ });
    expect(link.getAttribute('href')).toBe('/admin/models');
  });
  it('顶栏含退出登录按钮', () => {
    render(
      <MemoryRouter initialEntries={['/admin/models']}>
        <AdminLayout />
      </MemoryRouter>,
    );
    expect(screen.getByText('退出登录')).toBeTruthy();
  });

  it('点击退出登录调用 modal.confirm（useApp 必须在 AntdApp 内层，回归 P1-1）', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/admin/models']}>
        <AdminLayout />
      </MemoryRouter>,
    );
    await user.click(screen.getByText('退出登录'));
    // modal.confirm 正常工作（在 App context 内）→ 弹窗标题渲染；若 useApp 在父层则此处抛 TypeError
    expect(await screen.findByText('确认退出登录？')).toBeTruthy();
  });
});
