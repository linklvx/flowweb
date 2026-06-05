import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodePalette } from './NodePalette';

// Mock AddNodeMenu to avoid testing its internals here
vi.mock('./AddNodeMenu', () => ({
  AddNodeMenu: vi.fn(({ isOpen }: any) =>
    isOpen ? <div data-testid="add-node-menu">Menu</div> : null,
  ),
}));

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

// Mock material library store (needed by AddNodeMenu, imported via NodePalette)
vi.mock('@/stores/materialLibraryStore', () => ({
  useMaterialLibraryStore: (selector: any) => selector({ open: vi.fn() }),
}));

describe('NodePalette', () => {
  const renderPalette = () => render(<NodePalette />);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the + button', () => {
    renderPalette();
    const btn = screen.getByLabelText('添加节点');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).toHaveAttribute('data-sidebar-btn', 'add-node');
  });

  it('should show menu when + button is clicked', () => {
    renderPalette();
    expect(screen.queryByTestId('add-node-menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('添加节点'));
    expect(screen.getByTestId('add-node-menu')).toBeInTheDocument();
  });

  it('should close menu when + button is clicked again (toggle)', () => {
    renderPalette();
    const btn = screen.getByLabelText('添加节点');
    fireEvent.click(btn);
    expect(screen.getByTestId('add-node-menu')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByTestId('add-node-menu')).not.toBeInTheDocument();
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

  it('should rotate the + icon when menu is open', () => {
    renderPalette();
    const btn = screen.getByLabelText('添加节点');
    const svg = btn.querySelector('svg');
    expect(svg).toBeTruthy();
    fireEvent.click(btn);
    // After click: rotated 45deg via inline style
    expect(svg!.style.transform).toBe('rotate(45deg)');
  });
});
