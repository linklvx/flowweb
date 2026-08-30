import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Sidebar } from './Sidebar';

const mockInfo = vi.fn();
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return { ...actual, App: { ...actual.App, useApp: () => ({ message: { info: mockInfo } }) } };
});

describe('Sidebar', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  const renderSidebar = (initial = '/') =>
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Sidebar topOffset={0} />
      </MemoryRouter>
    );

  it('渲染 Logo 与四项菜单', () => {
    renderSidebar();
    expect(screen.getByAltText('Flow123')).toHaveAttribute('src', '/img/LOGO.png');
    expect(screen.getByText('首页').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText('模板广场').closest('a')).toHaveAttribute('href', '/templates');
    expect(screen.getByText('素材库').closest('a')).toHaveAttribute('href', '/materials');
    expect(screen.getByText('工作空间').closest('a')).toHaveAttribute('href', '/works');
  });

  it('当前页菜单高亮（/materials 下素材库激活）', () => {
    renderSidebar('/materials');
    const el = screen.getByText('素材库').closest('a');
    expect(el?.className).toContain('bg-[#262626]');
    const home = screen.getByText('首页').closest('a');
    expect(home?.className).not.toContain('bg-[#262626]');
  });

  it('新建项目：清 projectId（跳转由 startNewProject 单测覆盖）', () => {
    localStorage.setItem('flowweb_projectId', 'old');
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /新建项目/ }));
    expect(localStorage.getItem('flowweb_projectId')).toBeNull();
  });

  it('公众号入口点击弹出二维码弹窗', () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId('wechat-follow-entry'));
    expect(screen.getByAltText('公众号二维码')).toBeInTheDocument();
  });

  it('文档中心点击 toast 敬请期待，不跳转', () => {
    renderSidebar();
    const doc = screen.getByRole('button', { name: /文档中心/ });
    expect(doc.closest('a')).toBeNull();
    fireEvent.click(doc);
    expect(mockInfo).toHaveBeenCalledWith('敬请期待');
  });
});
