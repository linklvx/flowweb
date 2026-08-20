import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDragSeek } from './useDragSeek';

describe('useDragSeek', () => {
  let canvas: HTMLCanvasElement;
  let wavesurfer: {
    seekTo: ReturnType<typeof vi.fn>;
    getCurrentTime: ReturnType<typeof vi.fn>;
    isPlaying: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    play: ReturnType<typeof vi.fn>;
  };
  let windowRemoveSpy: ReturnType<typeof vi.spyOn>;
  let windowListeners: Map<string, EventListener>;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: vi.fn(() => ({ left: 50, top: 100, width: 1000, height: 120 })),
    });

    wavesurfer = {
      seekTo: vi.fn(),
      getCurrentTime: vi.fn(() => 60),
      isPlaying: vi.fn(() => false),
      pause: vi.fn(),
      play: vi.fn(),
    };

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
      useDragSeek(canvasRef, wavesurfer as any, true, 120, 340)
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
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, true, 120, 340));

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
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, true, 120, 340));

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
      useDragSeek(canvasRef, wavesurfer as any, true, 120, 340)
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
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, true, 120, 340));

    // Start drag
    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: 300,
      }));
    });

    // Drag far right → deltaX negative → time clamped to 0
    act(() => {
      const handler = windowListeners.get('mousemove') as EventListener;
      handler(new MouseEvent('mousemove', { bubbles: true, clientX: 5000 }));
    });

    expect(wavesurfer.seekTo).toHaveBeenCalledWith(0);
  });

  it('should clamp seek to 100% maximum', () => {
    const canvasRef = { current: canvas };
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, true, 120, 340));

    // Start drag
    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: 300,
      }));
    });

    // Drag far left → deltaX positive → time clamped to duration
    act(() => {
      const handler = windowListeners.get('mousemove') as EventListener;
      handler(new MouseEvent('mousemove', { bubbles: true, clientX: -2000 }));
    });

    expect(wavesurfer.seekTo).toHaveBeenCalledWith(1);
  });

  it('should stop dragging on window blur', () => {
    const canvasRef = { current: canvas };
    const { result } = renderHook(() =>
      useDragSeek(canvasRef, wavesurfer as any, true, 120, 340)
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
      useDragSeek(canvasRef, wavesurfer as any, true, 120, 340)
    );

    unmount();

    const calls = windowRemoveSpy.mock.calls.map((c: any) => c[0]);
    expect(calls).toContain('mousemove');
    expect(calls).toContain('mouseup');
    expect(calls).toContain('blur');
  });

  it('should use delta from mousedown, not accumulating on each mousemove', () => {
    // Simulate wavesurfer updating its internal time after each seekTo
    let internalTime = 60;
    wavesurfer.getCurrentTime = vi.fn(() => internalTime);
    wavesurfer.seekTo = vi.fn((progress: number) => {
      internalTime = progress * 120; // duration = 120
    });

    const canvasRef = { current: canvas };
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, true, 120, 340));

    // mousedown at center (clientX=220, rect.left=50 → mouseDownX=170)
    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: 220,
      }));
    });

    // Drag 100px right: deltaX=-100, timeOffset=-12, baseTime=60→48, progress=0.4
    act(() => {
      const handler = windowListeners.get('mousemove') as EventListener;
      handler(new MouseEvent('mousemove', { bubbles: true, clientX: 320 }));
    });

    // Verify correct seek based on delta from mousedown
    expect(wavesurfer.seekTo).toHaveBeenCalledWith(expect.closeTo(0.4, 2));

    // Same position again: deltaX=-100, should NOT drift
    act(() => {
      const handler = windowListeners.get('mousemove') as EventListener;
      handler(new MouseEvent('mousemove', { bubbles: true, clientX: 320 }));
    });

    const lastCall = wavesurfer.seekTo.mock.calls[wavesurfer.seekTo.mock.calls.length - 1];
    expect(lastCall[0]).toBeCloseTo(0.4, 2);
  });

  it('should pause on mousedown when playing', () => {
    wavesurfer.isPlaying = vi.fn(() => true);

    const canvasRef = { current: canvas };
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, true, 120, 340));

    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: 300,
      }));
    });

    expect(wavesurfer.pause).toHaveBeenCalled();
  });

  it('should resume playback on mouseup after drag when was playing', () => {
    wavesurfer.isPlaying = vi.fn(() => true);

    const canvasRef = { current: canvas };
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, true, 120, 340));

    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: 300,
      }));
    });

    act(() => {
      const handler = windowListeners.get('mouseup') as EventListener;
      handler(new MouseEvent('mouseup', { bubbles: true }));
    });

    expect(wavesurfer.play).toHaveBeenCalled();
  });

  it('should not resume playback on mouseup if was not playing', () => {
    const canvasRef = { current: canvas };
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, true, 120, 340));

    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: 300,
      }));
    });

    act(() => {
      const handler = windowListeners.get('mouseup') as EventListener;
      handler(new MouseEvent('mouseup', { bubbles: true }));
    });

    expect(wavesurfer.play).not.toHaveBeenCalled();
  });

  it('should not seek when not ready', () => {
    const canvasRef = { current: canvas };
    renderHook(() => useDragSeek(canvasRef, wavesurfer as any, false, 120, 340));

    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: 250 + 50,
      }));
    });

    // The guard should prevent seekTo from being called
    expect(wavesurfer.seekTo).not.toHaveBeenCalled();
  });
});
