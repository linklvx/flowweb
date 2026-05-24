import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWaveformPeaks } from './useWaveformPeaks';

// Helper: create a fake wavesurfer-like object with getDecodedData()
function createFakeWavesurfer(channelData: Float32Array[]): any {
  return {
    getDecodedData: vi.fn(() => ({
      getChannelData: (ch: number) => channelData[ch] ?? channelData[0],
      length: channelData[0]?.length ?? 0,
      numberOfChannels: channelData.length,
      sampleRate: 44100,
    })),
  };
}

describe('useWaveformPeaks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Basic functionality ───

  it('should return empty array when wavesurfer is null', () => {
    const { result } = renderHook(() => useWaveformPeaks(null, 'test-url'));
    expect(result.current).toEqual([]);
  });

  it('should compute 250 peaks from audio data', () => {
    const samples = new Float32Array(44100);
    for (let i = 0; i < 44100; i++) {
      samples[i] = Math.sin(2 * Math.PI * 440 * i / 44100);
    }
    const ws = createFakeWavesurfer([samples]);
    const { result } = renderHook(() => useWaveformPeaks(ws, 'test-url', 250));
    expect(result.current).toHaveLength(250);
  });

  // ─── Normalization ───

  it('should normalize peaks to 0~1 range', () => {
    const samples = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) {
      samples[i] = (i % 2 === 0) ? 0.5 : -0.5;
    }
    const ws = createFakeWavesurfer([samples]);
    const { result } = renderHook(() => useWaveformPeaks(ws, 'test-url', 250));
    for (const peak of result.current) {
      expect(peak).toBeGreaterThanOrEqual(0);
      expect(peak).toBeLessThanOrEqual(1);
    }
  });

  // ─── Silent audio fallback ───

  it('should floor silent audio to 0.05 minimum', () => {
    const samples = new Float32Array(1000); // all zeros
    const ws = createFakeWavesurfer([samples]);
    const { result } = renderHook(() => useWaveformPeaks(ws, 'test-url', 250));
    for (const peak of result.current) {
      expect(peak).toBeGreaterThanOrEqual(0.05);
    }
  });

  // ─── Cache ───

  it('should cache peaks by audioUrl and not recalculate', () => {
    const samples = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) samples[i] = 0.5;
    const ws = createFakeWavesurfer([samples]);

    const { result: r1, rerender: rr1 } = renderHook(
      ({ url }) => useWaveformPeaks(ws, url, 250),
      { initialProps: { url: 'cache-test-url' } }
    );
    expect(r1.current).toHaveLength(250);

    const firstCallCount = ws.getDecodedData.mock.calls.length;
    rr1({ url: 'cache-test-url' });
    expect(ws.getDecodedData.mock.calls.length).toBe(firstCallCount);
  });

  it('should recalculate when audioUrl changes', () => {
    const samples = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) samples[i] = 0.5;
    const ws = createFakeWavesurfer([samples]);

    const { rerender } = renderHook(
      ({ url }) => useWaveformPeaks(ws, url, 250),
      { initialProps: { url: 'url-1' } }
    );

    const firstCallCount = ws.getDecodedData.mock.calls.length;
    rerender({ url: 'url-2' });
    expect(ws.getDecodedData.mock.calls.length).toBeGreaterThan(firstCallCount);
  });

  // ─── Custom count ───

  it('should support custom peak count', () => {
    const samples = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) samples[i] = 0.3;
    const ws = createFakeWavesurfer([samples]);
    const { result } = renderHook(() => useWaveformPeaks(ws, 'test-url', 100));
    expect(result.current).toHaveLength(100);
  });

  // ─── Extreme short audio ───

  it('should return uniform peaks for extremely short audio', () => {
    const samples = new Float32Array(10); // too short for 250 segments
    const ws = createFakeWavesurfer([samples]);
    const { result } = renderHook(() => useWaveformPeaks(ws, 'test-url', 250));
    expect(result.current).toHaveLength(250);
    for (const peak of result.current) {
      expect(peak).toBeGreaterThanOrEqual(0.05);
    }
  });

  // ─── getDecodedData returning null (wavesurfer exists but not loaded) ───

  it('should return empty array when getDecodedData returns null', () => {
    const ws = {
      getDecodedData: vi.fn(() => null),
    };
    const { result } = renderHook(() => useWaveformPeaks(ws as any, 'null-data-url', 250));
    expect(result.current).toEqual([]);
  });

  // ─── LRU eviction ───

  it('should evict least recently used entries when cache exceeds max size', () => {
    const samples = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) samples[i] = 0.5;
    const ws = createFakeWavesurfer([samples]);

    // Fill cache with MAX_CACHE_SIZE entries
    for (let i = 0; i < 50; i++) {
      renderHook(() => useWaveformPeaks(ws, `lru-${i}`, 250));
    }

    // Touch lru-0 to mark it as recently used
    renderHook(() => useWaveformPeaks(ws, 'lru-0', 250));

    // Add more entries to trigger eviction of untouched entries
    // Adding 10 entries evicts lru-1..lru-10 but keeps recently touched lru-0
    for (let i = 50; i < 60; i++) {
      renderHook(() => useWaveformPeaks(ws, `lru-${i}`, 250));
    }

    // lru-0 was recently touched, should still be cached
    const baseCalls = ws.getDecodedData.mock.calls.length;
    renderHook(() => useWaveformPeaks(ws, 'lru-0', 250));
    expect(ws.getDecodedData.mock.calls.length).toBe(baseCalls);

    // lru-1 was never touched after initial add, should be evicted
    const baseCalls2 = ws.getDecodedData.mock.calls.length;
    renderHook(() => useWaveformPeaks(ws, 'lru-1', 250));
    expect(ws.getDecodedData.mock.calls.length).toBeGreaterThan(baseCalls2);
  });
});
