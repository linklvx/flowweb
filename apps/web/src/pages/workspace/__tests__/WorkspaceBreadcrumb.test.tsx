import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceBreadcrumb } from '../components/WorkspaceBreadcrumb';
import type { Folder } from '../types';

const folder = (id: string, name: string): Folder => ({ id, name, parentId: null, createdAt: '', updatedAt: '' });

function renderBreadcrumb(overrides?: Partial<Parameters<typeof WorkspaceBreadcrumb>[0]>) {
  const props = {
    path: [] as Folder[],
    currentFolderId: null,
    searchQuery: '',
    dimensionLabel: '个人项目',
    onNavigate: vi.fn(),
    onClearSearch: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<WorkspaceBreadcrumb {...props} />) };
}

describe('WorkspaceBreadcrumb 当前位置指示器', () => {
  it('非搜索态：分元素渲染 前缀/维度名/根目录（aria-label=当前位置）', () => {
    renderBreadcrumb();
    expect(screen.getByRole('navigation', { name: '当前位置' })).toBeInTheDocument();
    expect(screen.getByText('当前位置：')).toBeInTheDocument();
    expect(screen.getByText('个人项目')).toBeInTheDocument();
    expect(screen.getByText('根目录')).toBeInTheDocument();
  });

  it('根目录态：「根目录」不可点样式', () => {
    renderBreadcrumb({ currentFolderId: null });
    expect(screen.getByText('根目录')).toHaveClass('cursor-default');
  });

  it('文件夹内：「根目录」可点回根，路径链各级可点', () => {
    const { props } = renderBreadcrumb({
      path: [folder('top', '顶层'), folder('child', '子级')],
      currentFolderId: 'child',
    });
    const root = screen.getByText('根目录');
    fireEvent.click(root);
    expect(props.onNavigate).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByText('顶层'));
    expect(props.onNavigate).toHaveBeenCalledWith('top');
    expect(screen.getByText('子级')).toHaveClass('cursor-default'); // 末级不可点
  });

  it('搜索态：独立分支，不含「当前位置：」', () => {
    renderBreadcrumb({ searchQuery: '关键词' });
    expect(screen.queryByText('当前位置：')).not.toBeInTheDocument();
    expect(screen.getByText(/搜索/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(screen.queryByText('根目录')).not.toBeInTheDocument();
  });
});
