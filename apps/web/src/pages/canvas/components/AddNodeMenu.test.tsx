import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddNodeMenu } from './AddNodeMenu';

// Mock canvas store
const mockAddNode = vi.fn();
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (selector: any) => selector({ addNode: mockAddNode, viewport: { x: 0, y: 0, zoom: 1 } }),
}));

// Mock material library store
const mockOpen = vi.fn();
vi.mock('@/stores/materialLibraryStore', () => ({
  useMaterialLibraryStore: (selector: any) => selector({ open: mockOpen }),
}));

describe('AddNodeMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the menu with header "添加节点"', () => {
    render(<AddNodeMenu isOpen={true} onClose={() => {}} triggerRef={{ current: null }} />);
    expect(screen.getByText('添加节点')).toBeInTheDocument();
  });

  it('renders all 5 node type items', () => {
    render(<AddNodeMenu isOpen={true} onClose={() => {}} triggerRef={{ current: null }} />);
    expect(screen.getByText('文本')).toBeInTheDocument();
    expect(screen.getByText('图片')).toBeInTheDocument();
    expect(screen.getByText('视频')).toBeInTheDocument();
    expect(screen.getByText('视频合成')).toBeInTheDocument();
    expect(screen.getByText('音频')).toBeInTheDocument();
  });

  it('renders "添加资源" section with upload item', () => {
    render(<AddNodeMenu isOpen={true} onClose={() => {}} triggerRef={{ current: null }} />);
    expect(screen.getByText('添加资源')).toBeInTheDocument();
    expect(screen.getByText('上传')).toBeInTheDocument();
  });

  it('does NOT render removed items', () => {
    render(<AddNodeMenu isOpen={true} onClose={() => {}} triggerRef={{ current: null }} />);
    expect(screen.queryByText('导演台')).not.toBeInTheDocument();
    expect(screen.queryByText('脚本')).not.toBeInTheDocument();
    expect(screen.queryByText('从生成历史选择')).not.toBeInTheDocument();
  });

  it('calls addNode with "text" when clicking text menu item', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    fireEvent.click(screen.getByText('文本'));
    expect(mockAddNode).toHaveBeenCalledWith('text', expect.any(Object));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls addNode with "image" when clicking image menu item', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    fireEvent.click(screen.getByText('图片'));
    expect(mockAddNode).toHaveBeenCalledWith('image', expect.any(Object));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls addNode with "video" when clicking video menu item', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    fireEvent.click(screen.getByText('视频'));
    expect(mockAddNode).toHaveBeenCalledWith('video', expect.any(Object));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls addNode with "composite" when clicking composite menu item', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    fireEvent.click(screen.getByText('视频合成'));
    expect(mockAddNode).toHaveBeenCalledWith('composite', expect.any(Object));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls addNode with "audio" when clicking audio menu item', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    fireEvent.click(screen.getByText('音频'));
    expect(mockAddNode).toHaveBeenCalledWith('audio', expect.any(Object));
    expect(onClose).toHaveBeenCalled();
  });

  it('opens material library when clicking upload menu item', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    fireEvent.click(screen.getByText('上传'));
    expect(mockOpen).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render when isOpen is false', () => {
    render(<AddNodeMenu isOpen={false} onClose={() => {}} triggerRef={{ current: null }} />);
    expect(screen.queryByText('添加节点')).not.toBeInTheDocument();
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('menu item icon containers have background color', () => {
    render(<AddNodeMenu isOpen={true} onClose={() => {}} triggerRef={{ current: null }} />);
    const menuItems = screen.getAllByRole('menuitem');
    for (const item of menuItems) {
      const iconContainer = item.firstElementChild as HTMLElement;
      expect(iconContainer).toHaveStyle({ backgroundColor: 'var(--canvas-controls-hover)' });
    }
  });

  it('menu container uses compact gap between items', () => {
    render(<AddNodeMenu isOpen={true} onClose={() => {}} triggerRef={{ current: null }} />);
    const menu = screen.getByRole('menu');
    expect(menu).toHaveClass('gap-0.5');
  });

  it('menu item buttons have no border or rounded corners', () => {
    render(<AddNodeMenu isOpen={true} onClose={() => {}} triggerRef={{ current: null }} />);
    const menuItems = screen.getAllByRole('menuitem');
    for (const item of menuItems) {
      expect(item).toHaveClass('border-0');
      expect(item).not.toHaveClass('rounded-xl');
      expect(item).toHaveClass('h-[50px]');
      expect(item).toHaveClass('py-1');
      expect(item).toHaveClass('bg-transparent');
    }
  });

  it('has ARIA menu role and menuitem roles', () => {
    render(<AddNodeMenu isOpen={true} onClose={() => {}} triggerRef={{ current: null }} />);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.length).toBe(6); // 5 node types + 1 upload
  });
});
