import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { OutpaintSelectionOverlay, type OutpaintRect } from './OutpaintSelectionOverlay';

const { mockUseViewport } = vi.hoisted(() => ({
  mockUseViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
}));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, useViewport: mockUseViewport };
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

  it('does not render any backdrop elements', () => {
    const { container } = render(<OutpaintSelectionOverlay {...baseProps} />);
    const backdrops = container.querySelectorAll('[data-testid="outpaint-backdrop"]');
    expect(backdrops.length).toBe(0);
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
    const lastCall = onChange.mock.lastCall![0] as OutpaintRect;
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
      const rect = onChange.mock.lastCall![0] as OutpaintRect;
      expect(rect.width).toBeGreaterThanOrEqual(100);
    }
  });

  it('clamps frame so image cannot escape outside', () => {
    const onChange = vi.fn();
    const { container } = render(
      <OutpaintSelectionOverlay {...baseProps} value={{ x: 0, y: 0, width: 512, height: 512 }} onChange={onChange} />
    );
    // Drag nw handle inward (south-east), trying to push frame inside image bounds
    const nwHandle = container.querySelector('[data-handle="nw"]') as HTMLElement;
    fireEvent.mouseDown(nwHandle, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: 50 });
    fireEvent.mouseUp(window);
    const rect = onChange.mock.lastCall![0] as OutpaintRect;
    // x must be <= 0 (frame left cannot go past image left)
    expect(rect.x).toBeLessThanOrEqual(0);
    // y must be <= 0
    expect(rect.y).toBeLessThanOrEqual(0);
    // frame right (x+width) must be >= imageWidth (512)
    expect(rect.x + rect.width).toBeGreaterThanOrEqual(512);
    // frame bottom (y+height) must be >= imageHeight (512)
    expect(rect.y + rect.height).toBeGreaterThanOrEqual(512);
  });

  describe('viewport boundary constraints', () => {
    let portal: HTMLDivElement;

    beforeEach(() => {
      portal = document.createElement('div');
      portal.id = 'node-toolbar-portal';
      document.body.appendChild(portal);
    });

    afterEach(() => {
      portal.remove();
    });

    function setViewport(w: number, h: number) {
      Object.defineProperty(portal, 'clientWidth', { value: w, configurable: true });
      Object.defineProperty(portal, 'clientHeight', { value: h, configurable: true });
    }

    it('clamps nw handle so left edge does not go past viewport left boundary', () => {
      setViewport(800, 600);
      const onChange = vi.fn();
      const { container } = render(
        <OutpaintSelectionOverlay {...baseProps} imageVpX={50} imageVpY={50} onChange={onChange} />
      );
      const nwHandle = container.querySelector('[data-handle="nw"]') as HTMLElement;
      // drag far left, trying to push frame beyond viewport left
      fireEvent.mouseDown(nwHandle, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(window, { clientX: -200, clientY: 100 }); // dx = -300 at zoom=1
      fireEvent.mouseUp(window);
      expect(onChange).toHaveBeenCalled();
      const rect = onChange.mock.lastCall![0] as OutpaintRect;
      // frameL = imageVpX + rect.x * zoom >= 0 → rect.x >= -50
      expect(rect.x).toBeGreaterThanOrEqual(-50);
    });

    it('clamps e handle so right edge does not go past viewport right boundary', () => {
      setViewport(800, 600);
      const onChange = vi.fn();
      const { container } = render(
        <OutpaintSelectionOverlay {...baseProps} imageVpX={100} imageVpY={100} onChange={onChange} />
      );
      const eHandle = container.querySelector('[data-handle="e"]') as HTMLElement;
      fireEvent.mouseDown(eHandle, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(window, { clientX: 900, clientY: 100 }); // dx = +800
      fireEvent.mouseUp(window);
      expect(onChange).toHaveBeenCalled();
      const rect = onChange.mock.lastCall![0] as OutpaintRect;
      // frameR = imageVpX + (rect.x + rect.width) * zoom <= vpW
      expect(rect.x + rect.width).toBeLessThanOrEqual(800 - 100);
    });

    it('clamps n handle so top edge does not go past viewport top boundary', () => {
      setViewport(800, 600);
      const onChange = vi.fn();
      const { container } = render(
        <OutpaintSelectionOverlay {...baseProps} imageVpX={0} imageVpY={50} onChange={onChange} />
      );
      const nHandle = container.querySelector('[data-handle="n"]') as HTMLElement;
      fireEvent.mouseDown(nHandle, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(window, { clientX: 100, clientY: -200 }); // dy = -300
      fireEvent.mouseUp(window);
      expect(onChange).toHaveBeenCalled();
      const rect = onChange.mock.lastCall![0] as OutpaintRect;
      expect(rect.y).toBeGreaterThanOrEqual(-50);
    });

    it('clamps s handle so bottom edge does not go past viewport bottom boundary', () => {
      setViewport(800, 600);
      const onChange = vi.fn();
      const { container } = render(
        <OutpaintSelectionOverlay {...baseProps} imageVpX={0} imageVpY={100} onChange={onChange} />
      );
      const sHandle = container.querySelector('[data-handle="s"]') as HTMLElement;
      fireEvent.mouseDown(sHandle, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(window, { clientX: 100, clientY: 700 }); // dy = +600
      fireEvent.mouseUp(window);
      expect(onChange).toHaveBeenCalled();
      const rect = onChange.mock.lastCall![0] as OutpaintRect;
      expect(rect.y + rect.height).toBeLessThanOrEqual(600 - 100);
    });

    it('clamps move drag to top-left viewport boundary', () => {
      setViewport(800, 600);
      const onChange = vi.fn();
      const { container } = render(
        <OutpaintSelectionOverlay {...baseProps} imageVpX={100} imageVpY={100} onChange={onChange} />
      );
      const frame = container.querySelector('[data-testid="outpaint-frame"]') as HTMLElement;
      fireEvent.mouseDown(frame, { clientX: 200, clientY: 200 });
      fireEvent.mouseMove(window, { clientX: -200, clientY: -200 });
      fireEvent.mouseUp(window);
      expect(onChange).toHaveBeenCalled();
      const rect = onChange.mock.lastCall![0] as OutpaintRect;
      expect(rect.x).toBeGreaterThanOrEqual(-100);
      expect(rect.y).toBeGreaterThanOrEqual(-100);
    });

    it('clamps move drag to bottom-right viewport boundary', () => {
      setViewport(1000, 800);
      const onChange = vi.fn();
      const { container } = render(
        <OutpaintSelectionOverlay {...baseProps} imageVpX={100} imageVpY={100} onChange={onChange} />
      );
      const frame = container.querySelector('[data-testid="outpaint-frame"]') as HTMLElement;
      fireEvent.mouseDown(frame, { clientX: 200, clientY: 200 });
      fireEvent.mouseMove(window, { clientX: 1100, clientY: 900 });
      fireEvent.mouseUp(window);
      expect(onChange).toHaveBeenCalled();
      const rect = onChange.mock.lastCall![0] as OutpaintRect;
      expect(rect.x + rect.width).toBeLessThanOrEqual(1000 - 100);
      expect(rect.y + rect.height).toBeLessThanOrEqual(800 - 100);
    });

    it('viewport constraint takes priority when image is partially off-screen', () => {
      setViewport(800, 600);
      const onChange = vi.fn();
      // image left edge at -200 (partially off-screen left)
      const { container } = render(
        <OutpaintSelectionOverlay {...baseProps} imageVpX={-200} imageVpY={0} onChange={onChange} />
      );
      const wHandle = container.querySelector('[data-handle="w"]') as HTMLElement;
      fireEvent.mouseDown(wHandle, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(window, { clientX: -300, clientY: 100 }); // try to drag far left
      fireEvent.mouseUp(window);
      expect(onChange).toHaveBeenCalled();
      const rect = onChange.mock.lastCall![0] as OutpaintRect;
      // frameL >= 0: imageVpX + rect.x >= 0 → -200 + rect.x >= 0 → rect.x >= 200
      expect(rect.x).toBeGreaterThanOrEqual(200);
    });

    it('applies viewport constraints correctly when zoom is not 1', () => {
      setViewport(800, 600);
      mockUseViewport.mockReturnValue({ x: 0, y: 0, zoom: 0.5 });

      const onChange = vi.fn();
      const { container } = render(
        <OutpaintSelectionOverlay {...baseProps} imageVpX={100} imageVpY={100} onChange={onChange} />
      );
      const eHandle = container.querySelector('[data-handle="e"]') as HTMLElement;
      fireEvent.mouseDown(eHandle, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(window, { clientX: 900, clientY: 100 }); // dx = 800 (client), dx/zoom = 1600
      fireEvent.mouseUp(window);
      expect(onChange).toHaveBeenCalled();
      const rect = onChange.mock.lastCall![0] as OutpaintRect;
      // frameR = imageVpX + (rect.x + rect.width) * zoom <= vpW
      expect((rect.x + rect.width) * 0.5).toBeLessThanOrEqual(700);

      // Restore default zoom=1
      mockUseViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 });
    });

    it('clamps bottom edge respecting bottomReserve prop', () => {
      setViewport(800, 600);
      const onChange = vi.fn();
      const { container } = render(
        <OutpaintSelectionOverlay {...baseProps} imageVpX={0} imageVpY={100} onChange={onChange} bottomReserve={72} />
      );
      const sHandle = container.querySelector('[data-handle="s"]') as HTMLElement;
      fireEvent.mouseDown(sHandle, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(window, { clientX: 100, clientY: 700 });
      fireEvent.mouseUp(window);
      expect(onChange).toHaveBeenCalled();
      const rect = onChange.mock.lastCall![0] as OutpaintRect;
      // frameB + bottomReserve <= vpH → (rect.y + rect.height) + imgT + bottomReserve <= vpH
      expect(rect.y + rect.height).toBeLessThanOrEqual(600 - 100 - 72);
    });
  });

  it('move drag should stop at image boundary, not expand frame', () => {
    const onChange = vi.fn();
    // Frame right edge at image right edge → x + width = 512
    const { container } = render(
      <OutpaintSelectionOverlay {...baseProps} value={{ x: 0, y: 0, width: 512, height: 512 }} onChange={onChange} />
    );
    // Drag frame body to the left (dx negative)
    const frame = container.querySelector('[data-testid="outpaint-frame"]') as HTMLElement;
    fireEvent.mouseDown(frame, { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 150, clientY: 200 }); // dx = -50
    fireEvent.mouseUp(window);
    const rect = onChange.mock.lastCall![0] as OutpaintRect;
    // x should NOT change (clamped at 0 since move would expose image right)
    expect(rect.x).toBe(0);
    // width should NOT expand (should stay at 512)
    expect(rect.width).toBe(512);
  });
});
