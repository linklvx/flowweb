import { useEffect, useRef, useCallback, useState } from 'react';
import { useWaveSurfer } from '@wavesurfer/react';
import { useReactFlow } from '@xyflow/react';
import { useAudioStore } from '@/stores/audioStore';
import { formatDuration } from '@/utils/date';

export interface AudioWaveformProps {
  nodeId: string;
  audioUrl: string;
  waveformUrl?: string; // Phase 2: pre-generated peaks URL
  onError?: (error: Error) => void;
}

export function AudioWaveform({ nodeId, audioUrl, waveformUrl: _waveformUrl, onError }: AudioWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { registerNode, unregisterNode, setWavesurfer, togglePlay, updateNodeState } = useAudioStore();
  const { viewport } = useReactFlow();
  const [useFallback, setUseFallback] = useState(false);

  // Register/unregister lifecycle
  useEffect(() => {
    registerNode(nodeId);
    return () => { unregisterNode(nodeId); };
  }, [nodeId, registerNode, unregisterNode]);

  const { wavesurfer, isReady, isPlaying, currentTime, duration, error } = useWaveSurfer({
    container: containerRef.current,
    url: audioUrl,
    waveColor: '#ffffff',
    progressColor: '#ff3333',
    cursorColor: '#ff3333',
    cursorWidth: 2,
    barWidth: 3,
    barGap: 1,
    barRadius: 2,
    height: 120,
    backend: 'WebAudio',
    responsive: true,
    normalize: true,
    autoplay: false,
    autoScroll: false,
    mediaControls: false,
    interact: true,
  });

  // Store wavesurfer instance in global store
  useEffect(() => {
    if (wavesurfer) {
      setWavesurfer(nodeId, wavesurfer);
    }
  }, [wavesurfer, nodeId, setWavesurfer]);

  // Sync playback state to store
  useEffect(() => {
    updateNodeState(nodeId, { isPlaying, currentTime, duration });
  }, [isPlaying, currentTime, duration, nodeId, updateNodeState]);

  // Resize on viewport zoom change
  useEffect(() => {
    if (wavesurfer && containerRef.current) {
      wavesurfer.resize();
    }
  }, [viewport.zoom, wavesurfer]);

  // Finish event: reset isPlaying
  useEffect(() => {
    if (!wavesurfer) return;
    const unsub = wavesurfer.on('finish', () => {
      useAudioStore.getState().updateNodeState(nodeId, { isPlaying: false });
    });
    return () => { (unsub as (() => void) | undefined)?.(); };
  }, [wavesurfer, nodeId]);

  // Error handling — useWaveSurfer error + wavesurfer load error
  useEffect(() => {
    if (error) {
      console.error('AudioWaveform error:', nodeId, error);
      setUseFallback(true);
      onError?.(error);
    }
  }, [error, nodeId, onError]);

  useEffect(() => {
    if (!wavesurfer) return;
    const unsub = wavesurfer.on('error', (err: unknown) => {
      console.error('AudioWaveform load error:', nodeId, err);
      setUseFallback(true);
      onError?.(err instanceof Error ? err : new Error(String(err)));
    });
    return () => { (unsub as (() => void) | undefined)?.(); };
  }, [wavesurfer, nodeId, onError]);

  // Play/pause handler with ready check
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
      {/* Waveform container */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div
          className="w-full relative"
          style={{
            backgroundColor: '#2d2d2d',
            borderRadius: 12,
            padding: '16px 0',
            height: 120,
            boxSizing: 'border-box',
            cursor: 'pointer',
          }}
        >
          <div ref={containerRef} className="h-full w-full" />
          {(!isReady) && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800/70 rounded-[12px]">
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
          className="text-white hover:text-[#4ade80] transition-colors"
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
