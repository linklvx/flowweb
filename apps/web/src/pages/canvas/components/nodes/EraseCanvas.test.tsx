import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React, { createRef } from 'react';

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
    fontStretch: 'normal' as CanvasFontStretching,
    fontVariantCaps: 'normal' as CanvasFontVariantCaps,
    textRendering: 'auto' as CanvasTextRendering,
    wordSpacing: '0px',
  } as unknown as CanvasRenderingContext2D;
}

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = vi.fn((_contextId, _options) => {
    return createMockContext() as any;
  }) as any;
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

  it('has nodrag class', () => {
    render(<EraseCanvas width={400} height={300} brushSize={20} tool="brush" />);
    const canvas = document.querySelector('canvas');
    expect(canvas?.className).toContain('nodrag');
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
});
