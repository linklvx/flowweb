import { useEffect, useRef, useCallback, useState } from 'react';
import { useWavesurfer } from '@wavesurfer/react';
import { useViewport } from '@xyflow/react';
import { useAudioStore } from '@/stores/audioStore';
import { formatDuration } from '@/utils/date';
import { useWaveformPeaks } from '@/hooks/useWaveformPeaks';
import { useCanvasRenderer } from '@/hooks/useCanvasRenderer';
import { useDragSeek } from '@/hooks/useDragSeek';

export interface AudioWaveformProps {
  nodeId: string;
  audioUrl: string;
  waveformUrl?: string;
  onError?: (error: Error) => void;
}

export function AudioWaveform({ nodeId, audioUrl, waveformUrl: _waveformUrl, onError }: AudioWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveformAreaRef = useRef<HTMLDivElement>(null);
  const { registerNode, unregisterNode, setWavesurfer, togglePlay, updateNodeState } = useAudioStore();
  const viewport = useViewport();
  const [useFallback, setUseFallback] = useState(false);
  const [visibleWidth, setVisibleWidth] = useState(340);

  // Dynamic visible width from container
  useEffect(() => {
    const el = waveformAreaRef.current;
    if (el) setVisibleWidth(el.clientWidth * 0.85);
  }, []);

  // Register/unregister lifecycle
  useEffect(() => {
    registerNode(nodeId);
    return () => { unregisterNode(nodeId); };
  }, [nodeId, registerNode, unregisterNode]);

  const { wavesurfer, isReady, isPlaying, currentTime } = useWavesurfer({
    container: containerRef,
    url: audioUrl,
    height: 120,
    backend: 'WebAudio',
    normalize: true,
    autoplay: false,
    autoScroll: false,
    mediaControls: false,
    interact: false, // Disable wavesurfer interaction — we handle it via useDragSeek
  });

  // Store wavesurfer instance
  useEffect(() => {
    if (wavesurfer) {
      setWavesurfer(nodeId, wavesurfer);
    }
  }, [wavesurfer, nodeId, setWavesurfer]);

  const duration = wavesurfer?.getDuration() ?? 0;

  // Sync playback state to store
  useEffect(() => {
    updateNodeState(nodeId, { isPlaying, currentTime, duration });
  }, [isPlaying, currentTime, duration, nodeId, updateNodeState]);

  // Resize on viewport zoom change
  useEffect(() => {
    if (wavesurfer && containerRef.current) {
      (wavesurfer as any).resize?.();
    }
  }, [viewport.zoom, wavesurfer]);

  // Finish event
  useEffect(() => {
    if (!wavesurfer) return;
    const unsub = wavesurfer.on('finish', () => {
      useAudioStore.getState().updateNodeState(nodeId, { isPlaying: false });
    });
    return () => { (unsub as (() => void) | undefined)?.(); };
  }, [wavesurfer, nodeId]);

  // Error handling
  useEffect(() => {
    if (!wavesurfer) return;
    const unsub = wavesurfer.on('error', (err: unknown) => {
      console.error('AudioWaveform load error:', nodeId, err);
      setUseFallback(true);
      onError?.(err instanceof Error ? err : new Error(String(err)));
    });
    return () => { (unsub as (() => void) | undefined)?.(); };
  }, [wavesurfer, nodeId, onError]);

  // Custom hooks
  const peaks = useWaveformPeaks(wavesurfer, audioUrl, 250, isReady);
  useCanvasRenderer(canvasRef, peaks, wavesurfer, isPlaying, duration, visibleWidth);
  const { isDragging } = useDragSeek(canvasRef, wavesurfer, isReady, duration, visibleWidth);

  // Playhead hover state
  const [isPlayheadHovered, setIsPlayheadHovered] = useState(false);

  // Play/pause handler
  const handleTogglePlay = useCallback(() => {
    if (!isReady) return;
    togglePlay(nodeId);
  }, [isReady, togglePlay, nodeId]);

  // Event isolation for React Flow canvas
  const stopEvent = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
  }, []);

  // Fallback: native audio element
  if (useFallback) {
    return (
      <audio controls src={audioUrl} className="w-full h-full" />
    );
  }

  return (
    <div
      className="w-full h-full flex flex-col select-none"
      onMouseDown={stopEvent}
      onMouseMove={stopEvent}
      onMouseUp={stopEvent}
      onMouseLeave={stopEvent}
      onTouchStart={stopEvent}
      onTouchMove={stopEvent}
      onTouchEnd={stopEvent}
    >
      {/* Waveform area */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div
          ref={waveformAreaRef}
          className="w-full relative"
          style={{
            backgroundColor: '#1f1f1f',
            borderRadius: 12,
            height: 120,
            boxSizing: 'border-box',
            overflow: 'hidden',
            position: 'relative',
          }}
          onMouseEnter={() => setIsPlayheadHovered(true)}
          onMouseLeave={() => setIsPlayheadHovered(false)}
        >
          {/* Hidden wavesurfer container (audio engine only, behind canvas) */}
          <div ref={containerRef} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: '100%', height: '100%', zIndex: -1 }} />

          {/* Waveform canvas */}
          <canvas
            ref={canvasRef}
            className="nodrag"
            style={{
              cursor: isDragging ? 'grabbing' : 'grab',
              position: 'absolute',
              top: 0,
              left: 0,
              zIndex: 1,
            }}
          />

          {/* Left edge fade */}
          <div
            style={{
              position: 'absolute',
              left: 0, top: 0, bottom: 0,
              width: '10%',
              background: 'linear-gradient(to right, #1f1f1f 0%, transparent 100%)',
              pointerEvents: 'none',
              zIndex: 20,
              borderRadius: '12px 0 0 12px',
            }}
          />

          {/* Right edge fade */}
          <div
            style={{
              position: 'absolute',
              right: 0, top: 0, bottom: 0,
              width: '10%',
              background: 'linear-gradient(to left, #1f1f1f 0%, transparent 100%)',
              pointerEvents: 'none',
              zIndex: 20,
              borderRadius: '0 12px 12px 0',
            }}
          />

          {/* Playhead (DOM overlay, pointer-events: none) */}
          <div
            className="playhead"
            style={{
              position: 'absolute',
              left: '50%', top: 0, bottom: 0,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              pointerEvents: 'none',
              zIndex: 30,
            }}
          >
            {/* Triangle arrow */}
            <svg width="10" height="6" className="shrink-0" style={{ pointerEvents: 'none' }}>
              <path d="M0 0h10L5 6z" fill="#38bdf8" />
            </svg>

            {/* Vertical line */}
            <div
              className="playhead-line"
              style={{
                width: isPlayheadHovered ? 4 : 2,
                flex: 1,
                backgroundColor: '#38bdf8',
                borderRadius: 1,
                transition: 'width 150ms cubic-bezier(0.25, 0.1, 0.25, 1)',
              }}
            />

            {/* Time tooltip (hover) */}
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                opacity: isPlayheadHovered ? 1 : 0,
                transition: 'opacity 150ms',
                pointerEvents: 'none',
                marginTop: 4,
              }}
            >
              <svg width="8" height="4" style={{ marginBottom: -1 }}>
                <path d="M0 4L4 0l4 4z" fill="#38bdf8" />
              </svg>
              <span
                style={{
                  backgroundColor: '#38bdf8',
                  color: '#0f172a',
                  fontSize: 10,
                  fontWeight: 500,
                  padding: '2px 6px',
                  borderRadius: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                {formatDuration(currentTime)}/{formatDuration(duration)}
              </span>
            </div>
          </div>

          {/* Loading overlay */}
          {(!isReady) && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800/70 rounded-[12px] z-40">
              <span data-testid="waveform-loading" className="text-xs text-gray-400 animate-pulse">
                loading
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Controls: play/pause + time */}
      <div className="flex items-center justify-center gap-3 py-1.5">
        <button
          aria-label={isPlaying ? '暂停' : '播放'}
          className="text-white hover:text-[#38bdf8] transition-colors"
          style={{ fontSize: 40, lineHeight: '40px', width: 40, height: 40 }}
          onClick={handleTogglePlay}
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </div>
      <div className="text-xs text-gray-400 text-center pb-1">
        {formatDuration(currentTime)} / {formatDuration(duration)}
      </div>
    </div>
  );
}
