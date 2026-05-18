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

  it('should render three node types', () => {
    renderPalette();
    expect(screen.getByText('文本输入')).toBeInTheDocument();
    expect(screen.getByText('图片生成')).toBeInTheDocument();
    expect(screen.getByText('视频生成')).toBeInTheDocument();
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

  it('should still support drag (draggable attribute preserved)', () => {
    renderPalette();
    const items = screen.getAllByText(/输入|生成/);
    items.forEach((item) => {
      const parent = item.closest('[draggable]');
      expect(parent).toBeTruthy();
      expect(parent?.getAttribute('draggable')).toBe('true');
    });
  });
});
