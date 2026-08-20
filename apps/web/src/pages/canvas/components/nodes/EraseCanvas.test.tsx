import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React, { createRef } from 'react';

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({ setEditOverlayDragging: vi.fn() })),
  }),
}));

function createMockImageData(w: number, h: number): ImageData {
  return {
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
    colorSpace: 'srgb' as PredefinedColorSpace,
  };
}

function createMockContext(): CanvasRenderingContext2D {
  return {
    getImageData: vi.fn((_x, _y, w, h) => createMockImageData(w, h)),
    putImageData: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    translate: vi.fn(),
    transform: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    createImageData: vi.fn(),
    createLinearGradient: vi.fn(),
    createPattern: vi.fn(),
    createRadialGradient: vi.fn(),
    getLineDash: vi.fn(() => []),
    setLineDash: vi.fn(),
    getTransform: vi.fn(),
    resetTransform: vi.fn(),
    stroke: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    isPointInPath: vi.fn(() => false),
    isPointInStroke: vi.fn(() => false),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    arcTo: vi.fn(),
    ellipse: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    scrollPathIntoView: vi.fn(),
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low' as ImageSmoothingQuality,
    filter: 'none',
    lineWidth: 1,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    miterLimit: 10,
    lineDashOffset: 0,
    shadowBlur: 0,
    shadowColor: 'rgba(0,0,0,0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    strokeStyle: '',
    font: '',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'top' as CanvasTextBaseline,
    direction: 'inherit' as CanvasDirection,
    letterSpacing: '0px',
    fontKerning: 'auto' as CanvasFontKerning,
    fontStretch: 'normal' as CanvasFontStretch,
    fontVariantCaps: 'normal' as CanvasFontVariantCaps,
    textRendering: 'auto' as CanvasTextRendering,
    wordSpacing: '0px',
  } as unknown as CanvasRenderingContext2D;
}

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement, _contextId, _options) {
    if (!(this as any).__mockCtx) {
      (this as any).__mockCtx = createMockContext();
    }
    return (this as any).__mockCtx;
  }) as any;
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

import { EraseCanvas, type EraseCanvasHandle } from './EraseCanvas';

describe('EraseCanvas', () => {
  it('renders a canvas element with correct dimensions', () => {
    render(<EraseCanvas width={400} height={300} brushSize={20} tool="brush" />);
    const canvas = document.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
    expect(canvas?.width).toBe(400);
    expect(canvas?.height).toBe(300);
  });

  it('has nopan class', () => {
    render(<EraseCanvas width={400} height={300} brushSize={20} tool="brush" />);
    const canvas = document.querySelector('canvas');
    expect(canvas?.className).toContain('nopan');
  });

  it('exposes hasContent as false initially', () => {
    const ref = createRef<EraseCanvasHandle>();
    render(<EraseCanvas ref={ref} width={400} height={300} brushSize={20} tool="brush" />);
    expect(ref.current?.hasContent()).toBe(false);
  });

  it('clear resets the canvas', () => {
    const ref = createRef<EraseCanvasHandle>();
    render(<EraseCanvas ref={ref} width={400} height={300} brushSize={20} tool="brush" />);
    ref.current?.clear();
    expect(ref.current?.hasContent()).toBe(false);
  });

  it('undo on empty canvas does not throw', () => {
    const ref = createRef<EraseCanvasHandle>();
    render(<EraseCanvas ref={ref} width={400} height={300} brushSize={20} tool="brush" />);
    expect(() => ref.current?.undo()).not.toThrow();
  });

  it('redo on empty canvas does not throw', () => {
    const ref = createRef<EraseCanvasHandle>();
    render(<EraseCanvas ref={ref} width={400} height={300} brushSize={20} tool="brush" />);
    expect(() => ref.current?.redo()).not.toThrow();
  });

  it('canRedo returns false initially', () => {
    const ref = createRef<EraseCanvasHandle>();
    render(<EraseCanvas ref={ref} width={400} height={300} brushSize={20} tool="brush" />);
    expect(ref.current?.canRedo()).toBe(false);
  });

  describe('coordinate transformation under zoom', () => {
    it('scales mouse coordinates when canvas bounding rect differs from canvas dimensions', () => {
      const ref = createRef<EraseCanvasHandle>();
      render(<EraseCanvas ref={ref} width={400} height={300} brushSize={20} tool="brush" />);
      const canvas = document.querySelector('canvas')!;

      canvas.getBoundingClientRect = vi.fn(() => ({
        left: 100, top: 50,
        width: 800, height: 600,
        right: 900, bottom: 650,
        x: 100, y: 50,
        toJSON: () => {},
      }));

      canvas.dispatchEvent(new MouseEvent('pointerdown', {
        clientX: 500, clientY: 350, bubbles: true, cancelable: true,
      }));

      const ctx = canvas.getContext('2d')!;
      expect(ctx.arc).toHaveBeenCalledWith(200, 150, 10, 0, Math.PI * 2);
    });

    it('scales rect tool coordinates under zoom', () => {
      const ref = createRef<EraseCanvasHandle>();
      render(<EraseCanvas ref={ref} width={400} height={300} brushSize={20} tool="rect" />);
      const canvas = document.querySelector('canvas')!;

      canvas.getBoundingClientRect = vi.fn(() => ({
        left: 0, top: 0,
        width: 800, height: 600,
        right: 800, bottom: 600,
        x: 0, y: 0,
        toJSON: () => {},
      }));

      canvas.dispatchEvent(new MouseEvent('pointerdown', {
        clientX: 200, clientY: 100, bubbles: true, cancelable: true,
      }));

      canvas.dispatchEvent(new MouseEvent('pointermove', {
        clientX: 600, clientY: 400, bubbles: true, cancelable: true,
      }));

      const ctx = canvas.getContext('2d')!;
      expect(ctx.rect).toHaveBeenCalledWith(100, 50, 200, 150);
    });
  });

  it('initializes canvas context with willReadFrequently', () => {
    render(<EraseCanvas width={400} height={300} brushSize={20} tool="brush" />);
    const getContextMock = HTMLCanvasElement.prototype.getContext as any;
    expect(getContextMock).toHaveBeenCalledWith('2d', { willReadFrequently: true });
  });
});
