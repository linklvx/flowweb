import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodePalette } from './NodePalette';
// Mock canvasStore with viewport
const mockAddNode = vi.fn();
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: vi.fn((selector?: any) => {
    const state = {
      addNode: mockAddNode,
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    if (typeof selector === 'function') return selector(state);
    return state;
  }),
}));

describe('NodePalette', () => {
  const renderPalette = () =>
    render(<NodePalette />);

  beforeEach(() => {
    mockAddNode.mockClear();
  });

  it('should render five node types', () => {
    renderPalette();
    expect(screen.getByText('文本输入')).toBeInTheDocument();
    expect(screen.getByText('图片生成')).toBeInTheDocument();
    expect(screen.getByText('视频生成')).toBeInTheDocument();
    expect(screen.getByText('音频生成')).toBeInTheDocument();
    expect(screen.getByText('多图堆叠')).toBeInTheDocument();
  });

  it('should render draggable items', () => {
    renderPalette();
    const items = screen.getAllByText(/输入|生成/);
    items.forEach((item) => {
      const parent = item.closest('[draggable]');
      expect(parent).toBeTruthy();
    });
  });

  it('should render panel title', () => {
    renderPalette();
    expect(screen.getByText('节点面板')).toBeInTheDocument();
  });

  it('should add text node on click', () => {
    renderPalette();
    fireEvent.click(screen.getByText('文本输入'));
    expect(mockAddNode).toHaveBeenCalledWith('text', expect.any(Object));
  });

  it('should add image node on click', () => {
    renderPalette();
    fireEvent.click(screen.getByText('图片生成'));
    expect(mockAddNode).toHaveBeenCalledWith('image', expect.any(Object));
  });

  it('should add video node on click', () => {
    renderPalette();
    fireEvent.click(screen.getByText('视频生成'));
    expect(mockAddNode).toHaveBeenCalledWith('video', expect.any(Object));
  });

  it('should add multiImage node on click', () => {
    renderPalette();
    fireEvent.click(screen.getByText('多图堆叠'));
    expect(mockAddNode).toHaveBeenCalledWith('multiImage', expect.any(Object));
  });

  it('should still support drag (draggable attribute preserved)', () => {
    renderPalette();
    const items = screen.getAllByText(/输入|生成/);
    items.forEach((item) => {
      const parent = item.closest('[draggable]');
      expect(parent).toBeTruthy();
      expect(parent?.getAttribute('draggable')).toBe('true');
    });
  });

  describe('add-node button', () => {
    it('should render add-node button with correct attributes', () => {
      renderPalette();
      const btn = screen.getByLabelText('添加节点');
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveAttribute('type', 'button');
      expect(btn).toHaveAttribute('data-sidebar-btn', 'add-node');
    });

    it('should render add-node button with a plus SVG icon', () => {
      renderPalette();
      const btn = screen.getByLabelText('添加节点');
      const svg = btn.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should place add-node button before the panel title', () => {
      renderPalette();
      const btn = screen.getByLabelText('添加节点');
      const title = screen.getByText('节点面板');
      // The button should appear before the title in the DOM order
      expect(btn.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe('shortcuts button', () => {
    it('should render shortcuts button at the bottom', () => {
      renderPalette();
      expect(screen.getByText('快捷键')).toBeInTheDocument();
    });

    it('should call onToggleShortcuts when shortcuts button is clicked', () => {
      const onToggle = vi.fn();
      render(<NodePalette onToggleShortcuts={onToggle} />);
      fireEvent.click(screen.getByText('快捷键'));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('should render shortcuts button without onToggleShortcuts prop (optional)', () => {
      renderPalette();
      fireEvent.click(screen.getByText('快捷键'));
      // Should not throw
    });
  });
});
