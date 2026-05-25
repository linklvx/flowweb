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
  const baseTimeRef = useRef(0);
  const wasPlayingRef = useRef(false);
  const mouseDownXRef = useRef(0);

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
      // Delta from mousedown position: drag right → waveform moves right (seek backward)
      const deltaX = mouseDownXRef.current - offsetX;
      const timeOffset = (deltaX / totalBarsWidth) * duration;
      const newTime = Math.max(0, Math.min(duration, baseTimeRef.current + timeOffset));
      const progress = duration > 0 ? newTime / duration : 0;
      wavesurfer.seekTo(Math.max(0, Math.min(1, progress)));
    };

    const throttledSeek = throttle(handleSeek, 10);

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      throttledSeek(e);
    };

    const finishDrag = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);
      if (wasPlayingRef.current) {
        wasPlayingRef.current = false;
        wavesurfer?.play();
      }
    };

    const onMouseUp = () => finishDrag();

    const onBlur = () => finishDrag();

    // Capture-phase mousedown: prevents React Flow from receiving the event
    const onMouseDown = (e: MouseEvent) => {
      if (!isReady) return;
      e.stopPropagation();
      isDraggingRef.current = true;
      setIsDragging(true);
      baseTimeRef.current = wavesurfer?.getCurrentTime() ?? 0;
      wasPlayingRef.current = wavesurfer?.isPlaying() ?? false;
      const rect = canvas.getBoundingClientRect();
      mouseDownXRef.current = e.clientX - rect.left;
      if (wasPlayingRef.current) wavesurfer?.pause();
      window.addEventListener('mousemove', onMouseMove, true);
      window.addEventListener('mouseup', onMouseUp, true);
      window.addEventListener('blur', onBlur, true);
    };

    canvas.addEventListener('mousedown', onMouseDown, true);

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('blur', onBlur, true);
      isDraggingRef.current = false;
      stopDrag();
    };
  }, [canvasRef, wavesurfer, isReady, duration, visibleWidth, stopDrag]);

  return { isDragging };
}
