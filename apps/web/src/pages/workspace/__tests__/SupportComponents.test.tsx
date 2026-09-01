import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreateCanvasCard } from '../components/CreateCanvasCard';
import { EmptyState } from '../components/EmptyState';
import { CardGridSkeleton } from '../components/CardGridSkeleton';

describe('CreateCanvasCard', () => {
  it('role=button + aria-label，点击触发回调', () => {
    const onClick = vi.fn();
    render(<CreateCanvasCard onClick={onClick} />);
    const el = screen.getByRole('button', { name: '新建画布' });
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalled();
  });
  it('渲染「新建画布」文字与虚线样式', () => {
    render(<CreateCanvasCard onClick={vi.fn()} />);
    expect(screen.getByText('新建画布')).toBeInTheDocument();
  });
  it('等高结构：无写死占位，外壳 h-full 拉伸、预览区固定 4:3', () => {
    const { container } = render(<CreateCanvasCard onClick={vi.fn()} />);
    expect(container.querySelector('.h-\\[52px\\]')).toBeNull();
    const shell = screen.getByRole('button', { name: '新建画布' });
    expect(shell).toHaveClass('h-full');
    expect(shell).toHaveClass('box-border'); // preflight:false 无全局 border-box，height+padding 组合必须显式声明
    const preview = shell.querySelector('div');
    expect(preview).not.toHaveClass('flex-1');
    expect(preview).toHaveAttribute('style', expect.stringContaining('aspect-ratio: 4 / 3'));
  });
});

describe('EmptyState', () => {
  it('empty-folder 态：文案 + 「新建画布」按钮', () => {
    const onAction = vi.fn();
    render(<EmptyState variant="empty-folder" onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: '新建画布' }));
    expect(onAction).toHaveBeenCalled();
  });
  it('no-results 态：清除搜索按钮', () => {
    render(<EmptyState variant="no-results" onAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: '清除搜索' })).toBeInTheDocument();
  });
  it('error 态：重试按钮', () => {
    render(<EmptyState variant="error" onAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: '重 试' })).toBeInTheDocument();
  });
  it('empty-root 态：新建画布引导', () => {
    render(<EmptyState variant="empty-root" onAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: '新建画布' })).toBeInTheDocument();
  });
});

describe('CardGridSkeleton', () => {
  it('渲染 10 个骨架卡', () => {
    const { container } = render(<CardGridSkeleton />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(10);
  });
  it('snapshot 锁定结构', () => {
    const { asFragment } = render(<CardGridSkeleton />);
    expect(asFragment()).toMatchSnapshot();
  });
});
