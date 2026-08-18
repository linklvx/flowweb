import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('@/pages/home/components/Navbar', () => ({ Navbar: () => <div data-testid="navbar" /> }));
vi.mock('@/api/templateApi', () => ({
  getTemplates: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));
vi.mock('@/api/projectApi', () => ({ createProject: vi.fn() }));
vi.mock('react-router', async (orig) => {
  const actual = await orig<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: vi.fn(),
  };
});

import * as templateApi from '@/api/templateApi';
import * as projectApi from '@/api/projectApi';
import { useNavigate } from 'react-router';
import { WorkspacePage } from '../WorkspacePage';

const navigate = vi.fn();
const tpl = (id: string, name: string, updatedAt: string) => ({
  id, name, description: '', coverUrl: null, isPublic: false,
  createdAt: updatedAt, updatedAt, importCount: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(templateApi.getTemplates).mockResolvedValue({
    templates: [
      tpl('c1', '阿尔法画布', '2026-08-18T10:00:00'),
      tpl('c2', '贝塔画布', '2026-08-18T09:00:00'),
      tpl('c3', '伽马画布', '2026-08-18T08:00:00'),
    ],
  } as never);
  vi.mocked(useNavigate).mockReturnValue(navigate);
  vi.mocked(projectApi.createProject).mockResolvedValue({ id: 'p9' } as never);
});

function renderPage(initialUrl = '/works') {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <WorkspacePage />
    </MemoryRouter>
  );
}

describe('WorkspacePage', () => {
  it('加载成功渲染：文件夹在前（含预置 2 个）+ 画布在后 + 新建文件夹卡首位', async () => {
    renderPage();
    expect(await screen.findByTestId('folder-card-folder-demo-1')).toBeInTheDocument();
    expect(screen.getByTestId('folder-card-folder-demo-2')).toBeInTheDocument();
    // c1、c2 归 folder-demo-1，c3 归 folder-demo-2；根目录无未分组画布
    expect(screen.queryByTestId('canvas-card-c1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('canvas-card-c3')).not.toBeInTheDocument();
    // 网格顺序：新建文件夹卡 → 文件夹 → 画布
    const first = document.querySelector('[data-testid="workspace-grid"] > :first-child');
    expect(first).toHaveAttribute('data-testid', 'create-folder-card');
  });

  it('点击文件夹进入子视图，面包屑出现，返回根目录', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('folder-card-folder-demo-1'));
    expect(await screen.findByTestId('canvas-card-c1')).toBeInTheDocument();
    expect(screen.getByText('未命名文件夹')).toBeInTheDocument();
    fireEvent.click(screen.getByText('工作空间'));
    await waitFor(() => expect(screen.queryByTestId('canvas-card-c1')).not.toBeInTheDocument());
  });

  it('普通画布点击跳 /works/:id', async () => {
    renderPage('/works?folder=folder-demo-1');
    fireEvent.click(await screen.findByTestId('canvas-card-c1'));
    expect(navigate).toHaveBeenCalledWith('/works/c1');
  });

  it('搜索防抖过滤（全局，跨文件夹）', async () => {
    renderPage();
    const input = await screen.findByLabelText('搜索'); // 先用真实 timers 等初始渲染
    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: '阿尔法' } });
    expect(screen.queryByTestId('canvas-card-c1')).not.toBeInTheDocument(); // 防抖内不生效
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId('canvas-card-c1')).toBeInTheDocument(); // c1 在文件夹内也能搜到（全局搜索）
    expect(screen.queryByTestId('folder-card-folder-demo-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('create-folder-card')).not.toBeInTheDocument(); // 搜索态隐藏新建卡
    vi.useRealTimers();
  });

  it('筛选「仅画布」隐藏新建卡，画布仍显示', async () => {
    renderPage('/works?folder=folder-demo-1');
    fireEvent.click(await screen.findByText('显示全部'));
    fireEvent.click(screen.getByText('仅画布'));
    await waitFor(() => expect(screen.queryByTestId('create-folder-card')).not.toBeInTheDocument());
    expect(screen.getByTestId('canvas-card-c1')).toBeInTheDocument();
  });

  it('新建文件夹流程', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '新建文件夹' }));
    fireEvent.change(await screen.findByLabelText('文件夹名称'), { target: { value: '我的新文件夹' } });
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    expect(await screen.findByText('我的新文件夹')).toBeInTheDocument();
  });

  it('新建画布流程：createProject + 占位 + 跳转', async () => {
    renderPage('/works?folder=folder-demo-1');
    fireEvent.click(await screen.findByRole('button', { name: /新建画布/ }));
    fireEvent.change(await screen.findByLabelText('画布名称'), { target: { value: '新作品' } });
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/canvas?projectId=p9'));
    expect(await screen.findByTestId('canvas-card-placeholder-p9')).toBeInTheDocument();
  });

  it('移动画布到根目录', async () => {
    renderPage('/works?folder=folder-demo-1');
    const card = await screen.findByTestId('canvas-card-c1');
    fireEvent.click(card.querySelector('[aria-label="更多操作"]')!);
    fireEvent.click(await screen.findByText('移动到文件夹'));
    fireEvent.click(await screen.findByText('根目录（未分组）'));
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    await waitFor(() => expect(screen.queryByTestId('canvas-card-c1')).not.toBeInTheDocument());
  });

  it('删除非空文件夹 toast 报错', async () => {
    renderPage();
    const card = await screen.findByTestId('folder-card-folder-demo-1');
    fireEvent.click(card.querySelector('[aria-label="更多操作"]')!);
    fireEvent.click(await screen.findByText('删除'));
    await waitFor(() => expect(screen.getByTestId('folder-card-folder-demo-1')).toBeInTheDocument()); // 未删除
  });

  it('无效 folderId 重置根目录', async () => {
    renderPage('/works?folder=nope');
    await waitFor(() => expect(screen.getByTestId('folder-card-folder-demo-1')).toBeInTheDocument());
    expect(screen.queryByTestId('canvas-card-c1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('canvas-card-c3')).not.toBeInTheDocument();
  });

  it('加载失败显示错误空态，重试成功', async () => {
    vi.mocked(templateApi.getTemplates).mockRejectedValueOnce(new Error('x'));
    renderPage();
    expect(await screen.findByTestId('empty-state-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重 试' }));
    expect(await screen.findByTestId('folder-card-folder-demo-1')).toBeInTheDocument();
  });

  it('list 视图渲染行', async () => {
    renderPage();
    fireEvent.click(await screen.findByLabelText('List view'));
    expect(await screen.findByTestId('workspace-list')).toBeInTheDocument();
  });
});
