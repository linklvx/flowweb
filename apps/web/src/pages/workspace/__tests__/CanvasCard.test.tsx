import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasCard } from '../components/CanvasCard';
import type { Canvas } from '../types';

const base: Canvas = {
  id: 'c1', projectId: 'p1', name: '画布 1', coverUrl: null, isPublic: false,
  createdAt: '2026-08-18T09:00:00', updatedAt: '2026-08-18T09:00:00', folderId: null,
};

function renderCard(canvas: Canvas, overrides?: Partial<Parameters<typeof CanvasCard>[0]>) {
  const props = {
    canvas,
    onClick: vi.fn(),
    onRename: vi.fn(),
    onMove: vi.fn(),
    onTogglePublic: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CanvasCard {...props} />) };
}

describe('CanvasCard', () => {
  it('渲染标题与「编辑于」相对时间', () => {
    vi.setSystemTime(new Date('2026-08-18T12:00:00'));
    renderCard(base);
    expect(screen.getByText('画布 1')).toHaveClass('text-white');
    expect(screen.getByText(/编辑于/)).toBeInTheDocument();
    expect(screen.getByTestId('canvas-card-c1')).toHaveClass('h-full');
    vi.useRealTimers();
  });

  it('点击卡片触发 onClick（透传，路由由页面层分流）', () => {
    const { props } = renderCard(base);
    fireEvent.click(screen.getByTestId('canvas-card-c1'));
    expect(props.onClick).toHaveBeenCalledWith(base);
  });

  it('画布菜单含 4 项（重命名、移动、公开/私有、删除）', () => {
    renderCard(base);
    fireEvent.click(screen.getByLabelText('更多操作'));
    expect(screen.getByText('重命名')).toBeInTheDocument();
    expect(screen.getByText('移动到文件夹')).toBeInTheDocument();
    expect(screen.getByText('设为公开')).toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('isPublic 时显示「公开」标签', () => {
    renderCard({ ...base, isPublic: true });
    expect(screen.getByText('公开')).toBeInTheDocument();
  });

  it('hover 铅笔进入编辑，回车确认调用 onRename', () => {
    const { props } = renderCard(base);
    fireEvent.click(screen.getByLabelText('重命名画布'));
    const input = screen.getByDisplayValue('画布 1');
    fireEvent.change(input, { target: { value: '新名字' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onRename).toHaveBeenCalledWith('c1', '新名字');
  });

  it('Esc 取消不调用 onRename', () => {
    const { props } = renderCard(base);
    fireEvent.click(screen.getByLabelText('重命名画布'));
    const input = screen.getByDisplayValue('画布 1');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.getByText('画布 1')).toBeInTheDocument();
  });

  it('菜单「重命名」同样进入编辑态', () => {
    renderCard(base);
    fireEvent.click(screen.getByLabelText('更多操作'));
    fireEvent.click(screen.getByText('重命名'));
    expect(screen.getByDisplayValue('画布 1')).toBeInTheDocument();
  });

  it('variant="list" 渲染六列行：grid 列宽/类型/创建时间/编辑时间', () => {
    vi.setSystemTime(new Date('2026-08-18T12:00:00'));
    renderCard(base, { variant: 'list' });
    const row = screen.getByTestId('canvas-card-c1');
    // jsdom inline style 序列化不稳定，用 getAttribute 子串断言（FolderStackPreview 先例）
    expect(row.querySelector('[style*="grid-template-columns"]')?.getAttribute('style')).toContain('72px 1fr 70px 100px 145px 145px');
    expect(screen.getByText('画布', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('2026-08-18 09:00')).toBeInTheDocument();
    expect(screen.getByText(/编辑于/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('variant="list" 菜单 hover 显隐 + 行分隔线', () => {
    const { container } = renderCard(base, { variant: 'list' });
    const menuWrap = container.querySelector('.bg-black\\/50');
    expect(menuWrap?.className).toContain('opacity-0');
    expect(menuWrap?.className).toContain('group-hover/menu:opacity-100');
    const row = screen.getByTestId('canvas-card-c1');
    expect(row.querySelector('.border-white\\/10')).toBeInTheDocument();
  });

  it('variant="list" isPublic 标签跟随名称渲染', () => {
    renderCard({ ...base, isPublic: true }, { variant: 'list' });
    expect(screen.getByText('公开')).toBeInTheDocument();
  });

  it('variant="list" 菜单删除仍触发 onDelete', () => {
    const { props } = renderCard(base, { variant: 'list' });
    fireEvent.click(screen.getByLabelText('更多操作'));
    fireEvent.click(screen.getByText('删除'));
    expect(props.onDelete).toHaveBeenCalled();
  });
});
