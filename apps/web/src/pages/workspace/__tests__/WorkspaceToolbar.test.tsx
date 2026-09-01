import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { WorkspaceToolbar } from '../components/WorkspaceToolbar';

const props = {
  activeTab: 'personal' as const,
  onTabChange: vi.fn(),
  viewMode: 'grid' as const,
  onViewModeChange: vi.fn(),
  onSearchChange: vi.fn(),
  filter: 'all' as const,
  onFilterChange: vi.fn(),
  onCreateFolder: vi.fn(),
};

describe('WorkspaceToolbar 头部合并', () => {
  it('tabs 与工具组渲染于同一 md:flex-row 行容器', () => {
    render(<WorkspaceToolbar {...props} />);
    const row = screen.getByRole('button', { name: '个人' }).closest('div[class*="md:flex-row"]');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByRole('button', { name: /新建文件夹/ })).toBeInTheDocument();
  });

  it('tab 点击透传 onTabChange', () => {
    render(<WorkspaceToolbar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '团队项目' }));
    expect(props.onTabChange).toHaveBeenCalledWith('team');
  });

  it('无「导入」按钮，「新建文件夹」按钮存在', () => {
    render(<WorkspaceToolbar {...props} />);
    expect(screen.queryByRole('button', { name: /导入/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新建文件夹/ })).toBeInTheDocument();
  });
});
