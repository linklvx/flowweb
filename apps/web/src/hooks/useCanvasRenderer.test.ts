import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCanvasRenderer } from './useCanvasRenderer';

function createMockContext(): any {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
    scale: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    roundRect: vi.fn(),
  };
}

function createMockCanvas(ctx: any): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getContext', {
    value: vi.fn(() => ctx),
  });
  return canvas;
}

let rafCallbacks: Array<(time: number) => void> = [];
const originalRAF = globalThis.requestAnimationFrame;
const originalCAF = globalThis.cancelAnimationFrame;

beforeEach(() => {
  rafCallbacks = [];
  globalThis.requestAnimationFrame = vi.fn((cb: (time: number) => void) => {
    const id = rafCallbacks.length + 1;
    rafCallbacks.push(cb);
    return id;
  });
  globalThis.cancelAnimationFrame = vi.fn();
  vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
});

afterEach(() => {
  globalThis.requestAnimationFrame = originalRAF;
  globalThis.cancelAnimationFrame = originalCAF;
  vi.restoreAllMocks();
});

describe('useCanvasRenderer', () => {
  it('should set canvas dimensions for high DPI', () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const canvasRef = { current: canvas };
    const peaks = new Array(250).fill(0.5);

    renderHook(() =>
      useCanvasRenderer(canvasRef, peaks, null, false, 0, 340, false),
    );

    expect(canvas.width).toBe(2000);
    expect(canvas.height).toBe(240);
    expect(canvas.style.width).toBe('1000px');
    expect(canvas.style.height).toBe('120px');
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
  });

  it('should start rAF loop when playing starts', () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const canvasRef = { current: canvas };
    const peaks = new Array(250).fill(0.5);
    const wavesurfer = { getCurrentTime: vi.fn(() => 0) };

    const { rerender } = renderHook(
      ({ isPlaying }) =>
        useCanvasRenderer(canvasRef, peaks, wavesurfer as any, isPlaying, 120, 340, false),
      { initialProps: { isPlaying: false } },
    );

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    rerender({ isPlaying: true });
    expect(requestAnimationFrame).toHaveBeenCalled();
  });

  it('should cancel rAF when paused', () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const canvasRef = { current: canvas };
    const peaks = new Array(250).fill(0.5);
    const wavesurfer = { getCurrentTime: vi.fn(() => 0) };

    const { rerender } = renderHook(
      ({ isPlaying }) =>
        useCanvasRenderer(canvasRef, peaks, wavesurfer as any, isPlaying, 120, 340, false),
      { initialProps: { isPlaying: true } },
    );

    rerender({ isPlaying: false });
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it('should cancel rAF on unmount', () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const canvasRef = { current: canvas };
    const peaks = new Array(250).fill(0.5);
    const wavesurfer = { getCurrentTime: vi.fn(() => 0) };

    const { unmount } = renderHook(() =>
      useCanvasRenderer(canvasRef, peaks, wavesurfer as any, true, 120, 340, false),
    );

    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it('should redraw when progress changes beyond threshold', () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const canvasRef = { current: canvas };
    const peaks = new Array(250).fill(0.5);
    let currentTime = 0;
    const wavesurfer = {
      getCurrentTime: vi.fn(() => currentTime),
    };

    renderHook(() =>
      useCanvasRenderer(canvasRef, peaks, wavesurfer as any, true, 120, 340, false),
    );

    const initialCalls = ctx.clearRect.mock.calls.length;
    currentTime = 10; // significant change for 120s duration
    rafCallbacks[0]?.(0);

    expect(ctx.clearRect.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it('should start rAF loop during drag even when paused', () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const canvasRef = { current: canvas };
    const peaks = new Array(250).fill(0.5);
    const wavesurfer = { getCurrentTime: vi.fn(() => 0) };

    // paused + not dragging → no rAF
    const { rerender } = renderHook(
      ({ isDragging }) =>
        useCanvasRenderer(canvasRef, peaks, wavesurfer as any, false, 120, 340, isDragging),
      { initialProps: { isDragging: false } },
    );

    expect(requestAnimationFrame).not.toHaveBeenCalled();

    // Start dragging → rAF should kick in
    rerender({ isDragging: true });
    expect(requestAnimationFrame).toHaveBeenCalled();
  });
});
