import { useRef, useCallback, type PointerEvent as ReactPointerEvent } from 'react';
import { useThumbnails } from '@/hooks/useThumbnails';

// MIN_GAP sourced from VideoTrimPanel (will be imported in Task 3)
const MIN_GAP = 0.5;

export interface VideoTrimTimelineProps {
  duration: number;
  videoSrc: string | null | undefined;
  trimStart: number;
  trimEnd: number;
  onRangeChange: (start: number, end: number) => void;
  disabled?: boolean;
}

export function VideoTrimTimeline({
  duration,
  videoSrc,
  trimStart,
  trimEnd,
  onRangeChange,
  disabled = false,
}: VideoTrimTimelineProps) {
  const { thumbnails } = useThumbnails({ videoSrc, duration });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    handle: 'left' | 'right';
    startX: number;
    startTrimStart: number;
    startTrimEnd: number;
    rafId: number | null;
  } | null>(null);

  // ─── Coordinate conversion ─────────────────────────────────

  const clientXToTime = useCallback(
    (clientX: number): number => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return 0;
      const ratio = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(duration, ratio * duration));
    },
    [duration],
  );

  // ─── Drag handlers ─────────────────────────────────────────

  const handlePointerDown = useCallback(
    (handle: 'left' | 'right') => (e: ReactPointerEvent) => {
      if (disabled) return;
      e.stopPropagation();
      e.preventDefault();

      const el = e.currentTarget as HTMLElement;
      if (typeof el.setPointerCapture === 'function') {
        el.setPointerCapture(e.pointerId);
      }

      dragRef.current = {
        handle,
        startX: e.clientX,
        startTrimStart: trimStart,
        startTrimEnd: trimEnd,
        rafId: null,
      };

      const onMove = (ev: PointerEvent) => {
        if (!dragRef.current) return;
        const d = dragRef.current;

        // rAF throttle
        if (d.rafId !== null) return;
        d.rafId = requestAnimationFrame(() => {
          d.rafId = null;
          if (!dragRef.current) return;

          const deltaX = ev.clientX - d.startX;
          const deltaTime = (deltaX / (containerRef.current?.getBoundingClientRect().width ?? 500)) * duration;

          let newStart = d.startTrimStart;
          let newEnd = d.startTrimEnd;

          if (d.handle === 'left') {
            newStart = Math.max(0, Math.min(d.startTrimEnd - MIN_GAP, d.startTrimStart + deltaTime));
          } else {
            newEnd = Math.min(duration, Math.max(d.startTrimStart + MIN_GAP, d.startTrimEnd + deltaTime));
          }

          onRangeChange(newStart, newEnd);
        });
      };

      const onUp = (ev: PointerEvent) => {
        const d = dragRef.current;
        dragRef.current = null;
        if (d?.rafId !== null) {
          cancelAnimationFrame(d.rafId);
        }
        // Fire final value synchronously to ensure convergence
        if (d) {
          const deltaX = ev.clientX - d.startX;
          const deltaTime = (deltaX / (containerRef.current?.getBoundingClientRect().width ?? 500)) * duration;
          let newStart = d.startTrimStart;
          let newEnd = d.startTrimEnd;
          if (d.handle === 'left') {
            newStart = Math.max(0, Math.min(d.startTrimEnd - MIN_GAP, d.startTrimStart + deltaTime));
          } else {
            newEnd = Math.min(duration, Math.max(d.startTrimStart + MIN_GAP, d.startTrimEnd + deltaTime));
          }
          onRangeChange(newStart, newEnd);
        }
        if (typeof el.releasePointerCapture === 'function') {
          el.releasePointerCapture(e.pointerId);
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [disabled, trimStart, trimEnd, duration, onRangeChange],
  );

  // ─── Click handler ─────────────────────────────────────────

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      e.stopPropagation();
      const time = clientXToTime(e.clientX);

      if (time < trimStart) {
        onRangeChange(Math.max(0, time), trimEnd);
      } else if (time > trimEnd) {
        onRangeChange(trimStart, Math.min(duration, time));
      }
      // else: inside selection → no-op
    },
    [disabled, trimStart, trimEnd, duration, onRangeChange, clientXToTime],
  );

  // ─── Render ────────────────────────────────────────────────

  const leftPercent = (trimStart / duration) * 100;
  const rightPercent = (trimEnd / duration) * 100;
  const selectionWidth = rightPercent - leftPercent;

  return (
    <div
      ref={containerRef}
      className="nodrag nopan nowheel"
      style={{
        position: 'relative',
        height: '60px',
        borderRadius: '6px',
        overflow: 'hidden',
        backgroundColor: '#1a1a1a',
        opacity: disabled ? 0.6 : 1,
        userSelect: 'none',
      }}
    >
      {/* Thumbnail layer — z-0 */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', zIndex: 0 }}>
        {thumbnails.map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            style={{
              flex: '1 1 0',
              minWidth: 0,
              display: 'block',
              width: `${100 / thumbnails.length}%`,
              height: '100%',
              objectFit: 'cover',
              borderRight: i < thumbnails.length - 1
                ? '1px solid rgba(255,255,255,0.1)'
                : 'none',
            }}
          />
        ))}
      </div>

      {/* Selection highlight — z-10, pointer-events: none */}
      <div
        data-testid="selection-highlight"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${leftPercent}%`,
          width: `${selectionWidth}%`,
          zIndex: 10,
          pointerEvents: 'none',
          border: '2px solid #ffffff',
          backgroundColor: 'rgba(255, 255, 255, 0.15)',
        }}
      />

      {/* Click layer — z-20 */}
      <div
        data-testid="click-layer"
        style={{ position: 'absolute', inset: 0, zIndex: 20 }}
        onClick={handleClick}
      />

      {/* Left handle — z-30 */}
      <div
        data-testid="left-handle"
        style={{
          position: 'absolute',
          top: '-3px',
          bottom: '-3px',
          left: `${leftPercent}%`,
          zIndex: 30,
          width: '16px',
          transform: 'translateX(-50%)',
          cursor: disabled ? 'not-allowed' : 'ew-resize',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown('left')}
      >
        {/* Visual line */}
        <div
          data-testid="handle-line"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '3px',
            backgroundColor: '#ffffff',
          }}
        />
        {/* Dot */}
        <div
          data-testid="handle-dot"
          style={{
            position: 'absolute',
            top: '-3px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#ffffff',
            boxShadow: '0 0 4px rgba(0,0,0,0.5)',
          }}
        />
      </div>

      {/* Right handle — z-30 */}
      <div
        data-testid="right-handle"
        style={{
          position: 'absolute',
          top: '-3px',
          bottom: '-3px',
          left: `${rightPercent}%`,
          zIndex: 30,
          width: '16px',
          transform: 'translateX(-50%)',
          cursor: disabled ? 'not-allowed' : 'ew-resize',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown('right')}
      >
        <div
          data-testid="handle-line"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '3px',
            backgroundColor: '#ffffff',
          }}
        />
        <div
          data-testid="handle-dot"
          style={{
            position: 'absolute',
            top: '-3px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#ffffff',
            boxShadow: '0 0 4px rgba(0,0,0,0.5)',
          }}
        />
      </div>
    </div>
  );
}
