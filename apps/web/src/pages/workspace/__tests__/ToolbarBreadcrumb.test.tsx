import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WorkspaceToolbar } from '../components/WorkspaceToolbar';
import { WorkspaceBreadcrumb } from '../components/WorkspaceBreadcrumb';
import type { Folder, ViewMode, FilterKind } from '../types';

describe('WorkspaceToolbar', () => {
  function renderToolbar(overrides?: Partial<Parameters<typeof WorkspaceToolbar>[0]>) {
    const props = {
      activeTab: 'personal' as const,
      onTabChange: vi.fn(),
      viewMode: 'grid' as ViewMode,
      onViewModeChange: vi.fn(),
      onSearchChange: vi.fn(),
      filter: 'all' as FilterKind,
      onFilterChange: vi.fn(),
      onCreateFolder: vi.fn(),
      ...overrides,
    };
    return { props, ...render(<WorkspaceToolbar {...props} />) };
  }

  it('搜索输入 300ms 防抖后回调', async () => {
    vi.useFakeTimers();
    const { props } = renderToolbar();
    fireEvent.change(screen.getByLabelText('搜索'), { target: { value: '关键词' } });
    expect(props.onSearchChange).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(props.onSearchChange).toHaveBeenCalledWith('关键词');
    vi.useRealTimers();
  });

  it('搜索输入自动 trim 前后空格', async () => {
    vi.useFakeTimers();
    const { props } = renderToolbar();
    fireEvent.change(screen.getByLabelText('搜索'), { target: { value: '  关键词  ' } });
    act(() => { vi.advanceTimersByTime(300); });
    expect(props.onSearchChange).toHaveBeenCalledWith('关键词');
    vi.useRealTimers();
  });

  it('筛选菜单三种选项', () => {
    renderToolbar();
    fireEvent.click(screen.getByText('显示全部'));
    expect(screen.getByText('仅文件夹')).toBeInTheDocument();
    expect(screen.getByText('仅画布')).toBeInTheDocument();
  });

  it('视图切换触发回调', () => {
    const { props } = renderToolbar();
    fireEvent.click(screen.getByLabelText('List view'));
    expect(props.onViewModeChange).toHaveBeenCalledWith('list');
  });

  it('新建文件夹按钮回调', () => {
    const { props } = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: /新建文件夹/ }));
    expect(props.onCreateFolder).toHaveBeenCalled();
  });
});

describe('WorkspaceBreadcrumb', () => {
  const f1: Folder = { id: 'f1', name: '文件夹一', parentId: null, createdAt: '', updatedAt: '' };

  it('根视图仅显示「工作空间」', () => {
    render(<WorkspaceBreadcrumb path={[]} currentFolderId={null} searchQuery="" onNavigate={vi.fn()} onClearSearch={vi.fn()} />);
    expect(screen.getByText('工作空间')).toBeInTheDocument();
  });

  it('文件夹内显示层级，点击「工作空间」返回根', () => {
    const onNavigate = vi.fn();
    render(<WorkspaceBreadcrumb path={[f1]} currentFolderId="f1" searchQuery="" onNavigate={onNavigate} onClearSearch={vi.fn()} />);
    expect(screen.getByText('文件夹一')).toBeInTheDocument();
    fireEvent.click(screen.getByText('工作空间'));
    expect(onNavigate).toHaveBeenCalledWith(null);
  });

  it('搜索态显示搜索词与清除按钮', () => {
    const onClearSearch = vi.fn();
    render(<WorkspaceBreadcrumb path={[f1]} currentFolderId="f1" searchQuery="关键词" onNavigate={vi.fn()} onClearSearch={onClearSearch} />);
    expect(screen.getByText(/关键词/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('清除搜索'));
    expect(onClearSearch).toHaveBeenCalled();
  });
});
