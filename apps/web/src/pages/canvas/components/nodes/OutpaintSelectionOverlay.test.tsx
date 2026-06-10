import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { OutpaintSelectionOverlay, type OutpaintRect } from './OutpaintSelectionOverlay';

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, useViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })) };
});

const defaultRect: OutpaintRect = { x: -51, y: -51, width: 614, height: 614 };
const baseProps = {
  imageVpX: 0,
  imageVpY: 0,
  imageVpW: 512,
  imageVpH: 512,
  value: defaultRect,
  onChange: vi.fn(),
};

describe('OutpaintSelectionOverlay', () => {
  it('renders with nodrag and nopan classes', () => {
    const { container } = render(<OutpaintSelectionOverlay {...baseProps} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains('nodrag')).toBe(true);
    expect(root.classList.contains('nopan')).toBe(true);
  });

  it('renders backdrop on expanded areas (4 sides for default 1.2x rect)', () => {
    const { container } = render(<OutpaintSelectionOverlay {...baseProps} />);
    const backdrops = container.querySelectorAll('[data-testid="outpaint-backdrop"]');
    expect(backdrops.length).toBe(4);
    backdrops.forEach((b) => {
      expect((b as HTMLElement).style.backgroundColor).toBe('rgba(0, 0, 0, 0.8)');
    });
  });

  it('renders 8 resize handles (4 corners + 4 edges)', () => {
    const { container } = render(<OutpaintSelectionOverlay {...baseProps} />);
    const handles = container.querySelectorAll('[data-handle]');
    expect(handles.length).toBe(8);
    const handleNames = Array.from(handles).map((h) => h.getAttribute('data-handle'));
    expect(handleNames.sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  });

  it('has correct cursors on corner handles', () => {
    const { container } = render(<OutpaintSelectionOverlay {...baseProps} />);
    const nw = container.querySelector('[data-handle="nw"]') as HTMLElement;
    const ne = container.querySelector('[data-handle="ne"]') as HTMLElement;
    expect(nw.style.cursor).toBe('nwse-resize');
    expect(ne.style.cursor).toBe('nesw-resize');
  });

  it('selection frame has move cursor', () => {
    const { container } = render(<OutpaintSelectionOverlay {...baseProps} />);
    const frame = container.querySelector('[data-testid="outpaint-frame"]') as HTMLElement;
    expect(frame.style.cursor).toBe('move');
  });

  it('shows 9-grid guidelines on hover', () => {
    const { container } = render(<OutpaintSelectionOverlay {...baseProps} />);
    const grid = container.querySelector('[data-testid="outpaint-grid"]') as HTMLElement;
    expect(grid.style.opacity).toBe('0');
    fireEvent.mouseEnter(container.firstElementChild!);
    expect(grid.style.opacity).toBe('1');
  });

  it('calls onChange when right handle is dragged', () => {
    const onChange = vi.fn();
    const { container } = render(
      <OutpaintSelectionOverlay {...baseProps} onChange={onChange} />
    );
    const eHandle = container.querySelector('[data-handle="e"]') as HTMLElement;
    fireEvent.mouseDown(eHandle, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 120, clientY: 100 });
    fireEvent.mouseUp(window);
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.lastCall[0] as OutpaintRect;
    expect(lastCall.width).toBeGreaterThan(defaultRect.width);
  });

  it('respects minimum size (100px)', () => {
    const onChange = vi.fn();
    const { container } = render(
      <OutpaintSelectionOverlay {...baseProps} value={{ x: 0, y: 0, width: 100, height: 100 }} onChange={onChange} />
    );
    const wHandle = container.querySelector('[data-handle="w"]') as HTMLElement;
    fireEvent.mouseDown(wHandle, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 100 });
    fireEvent.mouseUp(window);
    if (onChange.mock.calls.length > 0) {
      const rect = onChange.mock.lastCall[0] as OutpaintRect;
      expect(rect.width).toBeGreaterThanOrEqual(100);
    }
  });
});
