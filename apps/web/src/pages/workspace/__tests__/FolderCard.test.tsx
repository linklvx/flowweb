import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FolderCard } from '../components/FolderCard';
import type { FolderViewModel } from '../types';

vi.setSystemTime(new Date('2026-08-18T12:00:00'));

const folder: FolderViewModel = {
  id: 'f1', name: '项目文件夹', parentId: null,
  createdAt: '2026-08-18T09:00:00', updatedAt: '2026-08-18T09:00:00',
  canvasCount: 3, thumbnails: ['linear-gradient(red, blue)'],
};

function renderFolder(overrides?: { folder?: Partial<FolderViewModel>; showCount?: boolean; variant?: 'grid' | 'list' }) {
  const props = {
    folder: { ...folder, ...overrides?.folder },
    showCount: overrides?.showCount ?? true,
    variant: overrides?.variant ?? 'grid',
    onClick: vi.fn(),
    onRequestRename: vi.fn(),
    onDelete: vi.fn(),
  };
  return { props, ...render(<FolderCard {...props} />) };
}

describe('FolderCard', () => {
  it('渲染名称、画布数、编辑时间', () => {
    renderFolder();
    expect(screen.getByText('项目文件夹')).toBeInTheDocument();
    expect(screen.getByText('3 个画布')).toBeInTheDocument();
    expect(screen.getByText(/编辑于/)).toBeInTheDocument();
  });

  it('showCount=false（搜索态）不显示画布数', () => {
    renderFolder({ showCount: false });
    expect(screen.queryByText('3 个画布')).not.toBeInTheDocument();
  });

  it('点击卡片触发 onClick', () => {
    const { props } = renderFolder();
    fireEvent.click(screen.getByTestId('folder-card-f1'));
    expect(props.onClick).toHaveBeenCalled();
  });

  it('菜单「删除」触发 onDelete', () => {
    const { props } = renderFolder();
    fireEvent.click(screen.getByLabelText('更多操作'));
    fireEvent.click(screen.getByText('删除'));
    expect(props.onDelete).toHaveBeenCalledWith(props.folder);
  });

  it('菜单「重命名」触发 onRequestRename（Modal 由页面处理）', () => {
    const { props } = renderFolder();
    fireEvent.click(screen.getByLabelText('更多操作'));
    fireEvent.click(screen.getByText('重命名'));
    expect(props.onRequestRename).toHaveBeenCalledWith(props.folder);
  });

  it('hover 铅笔点击触发 onRequestRename（不进入内联编辑）', () => {
    const { props } = renderFolder();
    fireEvent.click(screen.getByLabelText('重命名文件夹'));
    expect(props.onRequestRename).toHaveBeenCalledWith(props.folder);
    expect(screen.queryByDisplayValue('项目文件夹')).not.toBeInTheDocument();
  });

  it('variant="list" 渲染紧凑行（含菜单与数量）', () => {
    const { props } = renderFolder({ variant: 'list' });
    expect(screen.getByTestId('folder-card-f1').className).toContain('h-16');
    expect(screen.getByText('3 个画布')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('更多操作'));
    fireEvent.click(screen.getByText('重命名'));
    expect(props.onRequestRename).toHaveBeenCalled();
  });
});
