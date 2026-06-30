import { useState, useCallback, useEffect } from 'react';
import { Slider, Button } from 'antd';

interface VideoTrimPanelProps {
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  duration: number;
  initialTrimStart: number;
  initialTrimEnd: number;
  onConfirm: (start: number, end: number) => Promise<void> | void;
  onCancel: () => void;
  onRangeChange?: (start: number, end: number) => void;
  taskStatus?: 'idle' | 'queued' | 'processing' | 'done' | 'error';
  error?: string | null;
}

const MIN_GAP = 0.5;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
}

export function VideoTrimPanel({
  videoRef,
  duration,
  initialTrimStart,
  initialTrimEnd,
  onConfirm,
  onCancel,
  onRangeChange,
  taskStatus,
  error: _error,
}: VideoTrimPanelProps) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 30;
  const safeStart = Number.isFinite(initialTrimStart) ? Math.max(0, initialTrimStart) : 0;
  const safeEnd = Number.isFinite(initialTrimEnd) ? Math.min(safeDuration, Math.max(0, initialTrimEnd)) : safeDuration;
  const [range, setRange] = useState<[number, number]>([safeStart, safeEnd]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const trimDuration = range[1] - range[0];
  const isValid = trimDuration >= MIN_GAP;
  const isProcessing = taskStatus === 'processing' || taskStatus === 'queued';

  // Video loop: seek to start when playing past end of trim range
  useEffect(() => {
    const vid = videoRef?.current;
    if (!vid) return;

    // Jump to trim start on panel open
    vid.currentTime = Math.max(0, Math.min(range[0], vid.duration || safeDuration));

    const onTimeUpdate = () => {
      if (vid.currentTime >= range[1]) {
        vid.currentTime = range[0];
      }
    };
    vid.addEventListener('timeupdate', onTimeUpdate);
    return () => vid.removeEventListener('timeupdate', onTimeUpdate);
  }, [videoRef, range, safeDuration]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        const vid = videoRef?.current;
        if (vid) {
          vid.paused ? vid.play() : vid.pause();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, videoRef]);

  const handleChange = useCallback(
    (value: number[]) => {
      let [start, end] = value;
      // Clamp boundaries
      start = Math.max(0, start);
      end = Math.min(safeDuration, end);
      // Enforce minimum gap
      if (end - start < MIN_GAP) {
        // If start was moved, push end; otherwise push start
        if (start !== range[0]) {
          end = Math.min(safeDuration, start + MIN_GAP);
        } else {
          start = Math.max(0, end - MIN_GAP);
        }
      }
      setRange([start, end]);
      onRangeChange?.(start, end);
    },
    [safeDuration, range, onRangeChange],
  );

  const handleConfirm = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isValid || isProcessing || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onConfirm(range[0], range[1]);
    } finally {
      setIsSubmitting(false);
    }
  }, [isValid, isProcessing, isSubmitting, onConfirm, range]);

  return (
    <div
      className="nodrag nopan nowheel"
      style={{
        width: '100%',
        padding: '12px',
        borderRadius: '12px',
        border: '0.5px solid var(--canvas-controls-border)',
        background: 'var(--canvas-controls-bg)',
        boxShadow: 'var(--canvas-shadow-dropdown)',
        backdropFilter: 'blur(16px)',
        color: 'var(--canvas-controls-text)',
        fontSize: 13,
        pointerEvents: 'auto',
      }}
    >
      {/* Time labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span>{formatTime(range[0])}</span>
        <span style={{ opacity: 0.6 }}>
          {formatTime(trimDuration)}
        </span>
        <span>{formatTime(range[1])}</span>
      </div>

      {/* Range slider */}
      <div data-min="0" data-max={String(safeDuration)} data-step="0.1">
        <Slider
          range
          min={0}
          max={safeDuration}
          step={0.1}
          value={range}
          onChange={handleChange}
          disabled={isProcessing}
        />
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, gap: 8 }}>
        <Button
          size="small"
          onClick={onCancel}
          disabled={isSubmitting || isProcessing}
          style={{ flex: 1 }}
        >
          取消
        </Button>

        <Button
          type="primary"
          size="small"
          disabled={!isValid || isProcessing || isSubmitting}
          aria-disabled={!isValid || isProcessing || isSubmitting}
          onClick={handleConfirm}
          style={{ flex: 2 }}
        >
          {isSubmitting ? '提交中...' : isProcessing ? '裁剪中...' : '确认裁剪'}
        </Button>
      </div>

      {!isValid && !isProcessing && !isSubmitting && (
        <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4, textAlign: 'center' }}>
          最小裁剪时长 0.5 秒
        </div>
      )}

      {taskStatus === 'error' && (
        <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 8, textAlign: 'center' }}>
          {_error || '裁剪提交失败，请检查网络后重试'}
        </div>
      )}
    </div>
  );
}
