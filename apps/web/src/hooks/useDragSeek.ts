import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';
import type WaveSurfer from 'wavesurfer.js';

/**
 * Manual throttle -- no lodash dependency.
 */
function throttle<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let lastTime = 0;
  return ((...args: any[]) => {
    const now = Date.now();
    if (now - lastTime >= delay) {
      lastTime = now;
      fn(...args);
    }
  }) as T;
}

export function useDragSeek(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  wavesurfer: WaveSurfer | null,
  isReady: boolean,
  duration: number,
  visibleWidth: number,
): { isDragging: boolean } {
  const TOTAL_BAR_STEP = 4; // BAR_WIDTH + BAR_GAP
  const totalBarsWidth = 250 * TOTAL_BAR_STEP; // 1000
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);

  const stopDrag = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleSeek = (e: MouseEvent) => {
      if (!wavesurfer || !isReady || duration <= 0) return;
      const rect = canvas.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      // Mode B: waveform scrolls, playhead at viewport center.
      // Click offset from center → time offset from currentTime.
      const offsetFromCenter = offsetX - visibleWidth / 2;
      const timeOffset = (offsetFromCenter / totalBarsWidth) * duration;
      const currentTime = wavesurfer.getCurrentTime();
      const newTime = Math.max(0, Math.min(duration, currentTime + timeOffset));
      const progress = duration > 0 ? newTime / duration : 0;
      wavesurfer.seekTo(Math.max(0, Math.min(1, progress)));
    };

    const throttledSeek = throttle(handleSeek, 10);

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      throttledSeek(e);
    };

    const onMouseUp = () => {
      if (isDraggingRef.current) stopDrag();
    };

    const onBlur = () => {
      if (isDraggingRef.current) stopDrag();
    };

    // Capture-phase mousedown: prevents React Flow from receiving the event
    const onMouseDown = (e: MouseEvent) => {
      if (!isReady) return;
      e.stopPropagation();
      isDraggingRef.current = true;
      setIsDragging(true);
      handleSeek(e);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('blur', onBlur);
    };

    canvas.addEventListener('mousedown', onMouseDown, true);

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
      isDraggingRef.current = false;
      stopDrag();
    };
  }, [canvasRef, wavesurfer, isReady, duration, stopDrag]);

  return { isDragging };
}
