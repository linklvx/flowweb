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
    expect(screen.getByText('Flow123')).toBeInTheDocument();
    expect(screen.getByText('Flow123').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText('首页').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText('模板广场').closest('a')).toHaveAttribute('href', '/templates');
    expect(screen.getByText('素材库').closest('a')).toHaveAttribute('href', '/materials');
    expect(screen.getByText('工作空间').closest('a')).toHaveAttribute('href', '/works');
  });

  it('当前页菜单高亮（/materials 下素材库激活）', () => {
    renderSidebar('/materials');
    const el = screen.getByText('素材库').closest('a');
    expect(el?.className).toContain('bg-surface-dim');
    const home = screen.getByText('首页').closest('a');
    expect(home?.className).not.toContain('bg-surface-dim');
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

  it('视觉对齐：边框 1px overlay-2、行高字号规范', () => {
    const { container } = renderSidebar();
    const aside = screen.getByTestId('sidebar');
    expect(aside.className).toContain('border-r');
    expect(aside.className).toContain('border-r-overlay-2');
    const navLink = screen.getByText('首页').closest('a');
    expect(navLink?.className).toContain('leading-[26px]');
    expect(navLink?.className).toContain('text-[15px]');
    expect(navLink?.className).toContain('h-[38px]');
    expect(navLink?.className).toContain('text-text');
    expect(navLink?.className).toContain('hover:text-text');
    expect(navLink?.className).toContain('gap-[13px]');
    expect(navLink?.className).not.toContain('pb-[10px]');
    expect(navLink?.className).toContain('mb-[5px]');
    expect(navLink?.querySelector('span')?.className).toContain('text-[18px]');
    const createBtn = screen.getByRole('button', { name: /新建项目/ });
    expect(createBtn.className).toContain('leading-[22px]');
    expect(createBtn.className).toContain('my-[10px]');
    expect(createBtn.className).toContain('bg-surface-dim');
    expect(createBtn.className).toContain('text-text');
    const docBtn = screen.getByRole('button', { name: /文档中心/ });
    expect(docBtn.className).toContain('leading-[22px]');
    expect(docBtn.className).toContain('text-sm');
    expect(docBtn.className).toContain('bg-bg');
    expect(docBtn.className).toContain('text-text');
    expect(container.querySelector('.mt-auto')?.className).toContain('pb-[6px]');
  });

  it('渲染折叠按钮：默认展开态 aria-label 为 收起侧边栏', () => {
    renderSidebar();
    const btn = screen.getByRole('button', { name: '收起侧边栏' });
    expect(btn).toBeInTheDocument();
    expect(btn.className).toContain('text-text');
    expect(btn.className).toContain('bg-bg');
    expect(btn.className).not.toContain('hover:bg');
    expect(btn.closest('header')?.className).toContain('h-[60px]');
    expect(btn.querySelector('.anticon')?.className).toContain('text-[23px]');
  });

  it('点击收起：data-collapsed=true 并写入 localStorage', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }));
    const aside = screen.getByTestId('sidebar');
    expect(aside).toHaveAttribute('data-collapsed', 'true');
    expect(aside.className).toContain('w-[78px]');
    expect(localStorage.getItem('sidebar.collapsed')).toBe('true');
  });

  it('持久化恢复：localStorage 预置 true 时初始即收起态', () => {
    localStorage.setItem('sidebar.collapsed', 'true');
    renderSidebar();
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeInTheDocument();
  });

  it('收起态再点击展开：data-collapsed 移除并写回 false', () => {
    localStorage.setItem('sidebar.collapsed', 'true');
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }));
    expect(screen.getByTestId('sidebar')).not.toHaveAttribute('data-collapsed');
    expect(localStorage.getItem('sidebar.collapsed')).toBe('false');
  });

  it('收起态：文字不渲染、aria-label 保留、图标行居中且宽 36px', () => {
    localStorage.setItem('sidebar.collapsed', 'true');
    renderSidebar();
    expect(screen.queryByText('首页')).toBeNull();
    expect(screen.queryByText('Flow123')).toBeNull();
    expect(screen.getByRole('link', { name: '首页' }).className).toContain('justify-center');
    expect(screen.getByRole('link', { name: '首页' }).className).toContain('w-[38px]');
    expect(screen.getByRole('link', { name: '首页' }).className).toContain('self-center');
    expect(screen.getByRole('link', { name: '首页' }).className).toContain('mb-[5px]');
    expect(screen.getByRole('link', { name: '首页' }).className).not.toContain('px-2');
    expect(screen.getByRole('button', { name: '新建项目' }).className).toContain('justify-center');
    expect(screen.getByRole('button', { name: '新建项目' }).className).toContain('w-[36px]');
    expect(screen.getByRole('button', { name: '新建项目' }).className).toContain('self-center');
    expect(screen.getByTestId('wechat-follow-entry').className).toContain('justify-center');
    expect(screen.getByTestId('wechat-follow-entry').className).toContain('w-[38px]');
    expect(screen.getByTestId('wechat-follow-entry').className).toContain('bg-bg');
    expect(screen.getByTestId('wechat-follow-entry').className).toContain('self-center');
    expect(screen.getByTestId('wechat-follow-entry').className).toContain('mb-[5px]');
    expect(screen.getByRole('button', { name: '文档中心' }).className).toContain('justify-center');
    expect(screen.getByRole('button', { name: '文档中心' }).className).toContain('w-[38px]');
    expect(screen.getByRole('button', { name: '文档中心' }).className).toContain('bg-bg');
    expect(screen.getByRole('button', { name: '文档中心' }).className).toContain('self-center');
    expect(screen.getByRole('button', { name: '文档中心' }).className).toContain('mb-[5px]');
  });
});
