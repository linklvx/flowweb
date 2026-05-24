import { useEffect, useRef, type RefObject } from 'react';
import type WaveSurfer from 'wavesurfer.js';

const BAR_WIDTH = 3;
const BAR_GAP = 1;
const BAR_RADIUS = 2;
const TOTAL_BAR_STEP = BAR_WIDTH + BAR_GAP; // 4px
const CANVAS_CSS_WIDTH = 1000;
const CANVAS_CSS_HEIGHT = 120;

/**
 * Manages Canvas 2D rendering of waveform bars with a rAF scroll loop during playback.
 *
 * - 1000x120 CSS pixels, scaled by devicePixelRatio for sharp rendering.
 * - Draws vertical bars from peaks array (3px wide, 1px gap, 2px border-radius).
 * - Color split at viewport center: left (played) = cyan #38bdf8, right (unplayed) = white.
 * - rAF loop during playback updates translateX from currentTime/duration.
 * - Skips redraw if progress hasn't changed by >0.001.
 * - Cancels rAF when paused or unmounted.
 */
export function useCanvasRenderer(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  peaks: number[],
  wavesurfer: WaveSurfer | null,
  isPlaying: boolean,
  duration: number,
  visibleWidth: number,
): void {
  const rafRef = useRef<number | null>(null);
  const lastProgressRef = useRef(-1);
  const dprRef = useRef(1);

  // ── Initialize canvas dimensions (high DPI) ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    dprRef.current = window.devicePixelRatio || 1;
    canvas.width = CANVAS_CSS_WIDTH * dprRef.current;
    canvas.height = CANVAS_CSS_HEIGHT * dprRef.current;
    canvas.style.width = `${CANVAS_CSS_WIDTH}px`;
    canvas.style.height = `${CANVAS_CSS_HEIGHT}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dprRef.current, dprRef.current);
  }, [canvasRef]);

  // ── Draw waveform + rAF scroll loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const currentTime = wavesurfer?.getCurrentTime() ?? 0;
      const progress = duration > 0 ? currentTime / duration : 0;

      // Skip redraw if progress hasn't changed significantly
      if (Math.abs(progress - lastProgressRef.current) < 0.001) {
        if (isPlaying && wavesurfer) {
          rafRef.current = requestAnimationFrame(draw);
        }
        return;
      }
      lastProgressRef.current = progress;

      // Translate so that the bar at the current progress aligns with viewport center
      const totalBarsWidth = peaks.length * TOTAL_BAR_STEP;
      const translateX = visibleWidth / 2 - progress * totalBarsWidth;

      ctx.save();
      ctx.clearRect(0, 0, CANVAS_CSS_WIDTH, CANVAS_CSS_HEIGHT);
      ctx.translate(translateX, 0);

      // Color split: bars left of viewport center = played (cyan), right = unplayed (white)
      const centerLine = visibleWidth / 2 - translateX;

      for (let i = 0; i < peaks.length; i++) {
        const x = i * TOTAL_BAR_STEP;
        const peak = peaks[i];
        const barHeight = Math.max(peak * CANVAS_CSS_HEIGHT * 0.85, 2);
        const y = (CANVAS_CSS_HEIGHT - barHeight) / 2;

        ctx.fillStyle = x < centerLine ? '#38bdf8' : '#ffffff';
        ctx.beginPath();
        ctx.roundRect(x, y, BAR_WIDTH, barHeight, BAR_RADIUS);
        ctx.fill();
      }

      ctx.restore();

      if (isPlaying && wavesurfer) {
        rafRef.current = requestAnimationFrame(draw);
      }
    };

    // Force a full redraw on effect re-run (e.g., when peaks or duration change)
    lastProgressRef.current = -1;

    if (isPlaying && wavesurfer) {
      rafRef.current = requestAnimationFrame(draw);
    } else {
      draw();
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [canvasRef, peaks, wavesurfer, isPlaying, duration, visibleWidth]);
}
