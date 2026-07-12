import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodePalette } from './NodePalette';
import { useMenuStore } from '@/stores/menuStore';

// Mock canvasStore
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

// Mock material library store
vi.mock('@/stores/materialLibraryStore', () => ({
  useMaterialLibraryStore: (selector: any) => selector({ open: vi.fn() }),
}));

// Mock history store
vi.mock('@/stores/historyStore', () => ({
  useHistoryStore: (selector: any) => selector({ open: vi.fn() }),
}));

describe('NodePalette', () => {
  const renderPalette = () => render(<NodePalette />);

  beforeEach(() => {
    vi.clearAllMocks();
    useMenuStore.setState({ isOpen: false, position: undefined, triggerEl: null, lastMousePos: { x: 0, y: 0 } });
  });

  it('should render the + button', () => {
    renderPalette();
    const btn = screen.getByLabelText('添加节点');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).toHaveAttribute('data-sidebar-btn', 'add-node');
  });

  it('should open menu in store when + button is clicked', () => {
    renderPalette();
    expect(useMenuStore.getState().isOpen).toBe(false);
    fireEvent.click(screen.getByLabelText('添加节点'));
    expect(useMenuStore.getState().isOpen).toBe(true);
  });

  it('should close menu in store when + button is clicked again (toggle)', () => {
    renderPalette();
    const btn = screen.getByLabelText('添加节点');
    fireEvent.click(btn);
    expect(useMenuStore.getState().isOpen).toBe(true);
    fireEvent.click(btn);
    expect(useMenuStore.getState().isOpen).toBe(false);
  });

  it('should have ARIA attributes on the button', () => {
    renderPalette();
    const btn = screen.getByLabelText('添加节点');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn).toHaveAttribute('aria-controls', 'add-node-menu');
  });

  it('should set aria-expanded to true when menu is open', () => {
    renderPalette();
    const btn = screen.getByLabelText('添加节点');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('should sync triggerEl to menuStore on mount and clear on unmount', () => {
    const { unmount } = renderPalette();
    expect(useMenuStore.getState().triggerEl).toBeInstanceOf(HTMLButtonElement);
    unmount();
    expect(useMenuStore.getState().triggerEl).toBeNull();
  });

  it('should rotate the + icon when menu is open', () => {
    renderPalette();
    const btn = screen.getByLabelText('添加节点');
    const svg = btn.querySelector('svg');
    expect(svg).toBeTruthy();
    fireEvent.click(btn);
    expect(svg!.style.transform).toBe('rotate(45deg)');
  });

  it('should render the shortcuts button', () => {
    renderPalette();
    const btn = screen.getByLabelText('快捷键');
    expect(btn).toBeInTheDocument();
  });

  it('should call onToggleShortcuts when shortcuts button is clicked', () => {
    const onToggle = vi.fn();
    render(<NodePalette onToggleShortcuts={onToggle} />);
    fireEvent.click(screen.getByLabelText('快捷键'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('should render shortcuts button without onToggleShortcuts prop (optional)', () => {
    renderPalette();
    fireEvent.click(screen.getByLabelText('快捷键'));
    // should not throw
  });

  it('should render material library button', () => {
    renderPalette();
    expect(screen.getByLabelText('素材库')).toBeInTheDocument();
  });

  it('should render history button', () => {
    renderPalette();
    expect(screen.getByLabelText('历史记录')).toBeInTheDocument();
  });
});
