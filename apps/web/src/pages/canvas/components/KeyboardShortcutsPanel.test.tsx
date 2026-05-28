import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel';

describe('KeyboardShortcutsPanel', () => {
  const renderPanel = (isOpen: boolean, onClose = vi.fn()) =>
    render(<KeyboardShortcutsPanel isOpen={isOpen} onClose={onClose} />);

  it('should render nothing when isOpen is false', () => {
    const { container } = renderPanel(false);
    expect(container.firstChild).toBeNull();
  });

  it('should render the panel when isOpen is true', () => {
    renderPanel(true);
    expect(screen.getByText('创作')).toBeInTheDocument();
    expect(screen.getByText('缩放')).toBeInTheDocument();
    expect(screen.getByText('移动画布')).toBeInTheDocument();
    expect(screen.getByText('其他')).toBeInTheDocument();
  });

  it('should render all shortcut entries', () => {
    renderPanel(true);
    expect(screen.getByText('成组')).toBeInTheDocument();
    expect(screen.getByText('合并分镜组')).toBeInTheDocument();
    expect(screen.getByText('解组')).toBeInTheDocument();
    expect(screen.getByText('连线')).toBeInTheDocument();
    expect(screen.getByText('复制整组')).toBeInTheDocument();
    expect(screen.getByText('生成')).toBeInTheDocument();
    expect(screen.getByText('新建节点')).toBeInTheDocument();
    expect(screen.getByText('节点复制')).toBeInTheDocument();
    expect(screen.getByText('创建副本')).toBeInTheDocument();
    expect(screen.getByText('放大')).toBeInTheDocument();
    expect(screen.getByText('缩小')).toBeInTheDocument();
    expect(screen.getByText('适应画布')).toBeInTheDocument();
    expect(screen.getByText('撤销')).toBeInTheDocument();
    expect(screen.getByText('重做')).toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
    // Labels that appear in multiple sections
    const trackpadItems = screen.getAllByText('触控板');
    expect(trackpadItems.length).toBe(2); // 缩放 + 移动画布
    const mouseItems = screen.getAllByText('鼠标');
    expect(mouseItems.length).toBe(2); // 缩放 + 移动画布
    // Labels that appear once
    expect(screen.getByText('键盘')).toBeInTheDocument();
    expect(screen.getByText('整理画布')).toBeInTheDocument();
  });

  it('should call onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsPanel isOpen={true} onClose={onClose} />);
    const closeBtn = screen.getByLabelText('关闭快捷键面板');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should call onClose when clicking outside the panel', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsPanel isOpen={true} onClose={onClose} />);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should not call onClose when clicking inside the panel', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsPanel isOpen={true} onClose={onClose} />);
    const panel = screen.getByText('创作').closest('[data-panel]');
    fireEvent.mouseDown(panel!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('should render key cap elements', () => {
    renderPanel(true);
    const ctrlKeys = screen.getAllByText('Ctrl');
    expect(ctrlKeys.length).toBeGreaterThanOrEqual(3);
    const gKeys = screen.getAllByText('G');
    expect(gKeys.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Tab')).toBeInTheDocument();
    expect(screen.getByText('Enter')).toBeInTheDocument();
  });
});
