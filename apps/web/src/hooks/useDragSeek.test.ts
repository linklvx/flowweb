import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDragSeek } from './useDragSeek';

describe('useDragSeek', () => {
  let canvas: HTMLCanvasElement;
  let wavesurfer: { seekTo: ReturnType<typeof vi.fn> };
  let windowRemoveSpy: ReturnType<typeof vi.spyOn>;
  let windowListeners: Map<string, EventListener>;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: vi.fn(() => ({ left: 50, top: 100, width: 1000, height: 120 })),
    });

    wavesurfer = { seekTo: vi.fn() };

    windowListeners = new Map();
    vi.spyOn(window, 'addEventListener').mockImplementation(
      (event: string, handler: any) => {
        windowListeners.set(event, handler);
      }
    );
    windowRemoveSpy = vi.spyOn(window, 'removeEventListener').mockImplementation(
      (event: string) => {
        windowListeners.delete(event);
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should set isDragging true on mousedown', () => {
    const canvasRef = { current: canvas };
    const { result } = renderHook(() =>
      useDragSeek(canvasRef, wavesurfer as any, true, 120)
    );

    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: 250 + 50,
      }));
    });

    expect(result.current.isDragging).toBe(true);
  });

  it('should call stopPropagation on mousedown', () => {
    const canvasRef = { current: canvas };
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, true, 120));

    const stopPropSpy = vi.spyOn(MouseEvent.prototype, 'stopPropagation');

    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: 250,
      }));
    });

    expect(stopPropSpy).toHaveBeenCalled();
    stopPropSpy.mockRestore();
  });

  it('should seek on mousemove during drag', () => {
    const canvasRef = { current: canvas };
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, true, 120));

    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: 250 + 50,
      }));
    });

    act(() => {
      const handler = windowListeners.get('mousemove') as EventListener;
      handler(new MouseEvent('mousemove', { bubbles: true, clientX: 500 + 50 }));
    });

    expect(wavesurfer.seekTo).toHaveBeenCalled();
  });

  it('should set isDragging false on mouseup', () => {
    const canvasRef = { current: canvas };
    const { result } = renderHook(() =>
      useDragSeek(canvasRef, wavesurfer as any, true, 120)
    );

    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: 250,
      }));
    });

    act(() => {
      const handler = windowListeners.get('mouseup') as EventListener;
      handler(new MouseEvent('mouseup', { bubbles: true }));
    });

    expect(result.current.isDragging).toBe(false);
  });

  it('should clamp seek to 0% minimum', () => {
    const canvasRef = { current: canvas };
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, true, 120));

    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: 0 + 50,
      }));
    });

    expect(wavesurfer.seekTo).toHaveBeenCalledWith(0);
  });

  it('should clamp seek to 100% maximum', () => {
    const canvasRef = { current: canvas };
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, true, 120));

    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: 2000 + 50,
      }));
    });

    expect(wavesurfer.seekTo).toHaveBeenCalledWith(1);
  });

  it('should stop dragging on window blur', () => {
    const canvasRef = { current: canvas };
    const { result } = renderHook(() =>
      useDragSeek(canvasRef, wavesurfer as any, true, 120)
    );

    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: 250,
      }));
    });

    act(() => {
      const handler = windowListeners.get('blur') as EventListener;
      handler(new Event('blur'));
    });

    expect(result.current.isDragging).toBe(false);
  });

  it('should remove window listeners on unmount', () => {
    const canvasRef = { current: canvas };
    const { unmount } = renderHook(() =>
      useDragSeek(canvasRef, wavesurfer as any, true, 120)
    );

    unmount();

    const calls = windowRemoveSpy.mock.calls.map((c: any) => c[0]);
    expect(calls).toContain('mousemove');
    expect(calls).toContain('mouseup');
    expect(calls).toContain('blur');
  });

  it('should not seek when not ready', () => {
    const canvasRef = { current: canvas };
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, false, 120));

    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: 250 + 50,
      }));
    });

    // The guard should prevent seekTo from being called
    expect(wavesurfer.seekTo).not.toHaveBeenCalled();
  });
});
