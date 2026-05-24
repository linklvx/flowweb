import { useMemo } from 'react';
import type WaveSurfer from 'wavesurfer.js';

const peaksCache = new Map<string, number[]>();
const MAX_CACHE_SIZE = 50;

/**
 * Extract fixed-count (default 250) normalized peaks from wavesurfer's decoded AudioBuffer.
 * Returns 0~1 values with minimum 0.05 for silent regions.
 * Cached by audioUrl with LRU eviction (max 50 entries).
 */
export function useWaveformPeaks(
  wavesurfer: WaveSurfer | null,
  audioUrl: string,
  count: number = 250,
): number[] {
  return useMemo(() => {
    if (!wavesurfer) return [];

    // Cache hit: return cached peaks (keyed by audioUrl + count)
    const cacheKey = `${audioUrl}__${count}`;
    const cached = peaksCache.get(cacheKey);
    if (cached) return cached;

    // Cache miss: compute peaks from decoded data
    const decoded = wavesurfer.getDecodedData();
    if (!decoded) return [];

    const channelData = decoded.getChannelData(0);
    const totalSamples = channelData.length;
    if (totalSamples === 0) return new Array(count).fill(0.05);

    const segmentSize = Math.floor(totalSamples / count);
    if (segmentSize === 0) return new Array(count).fill(0.05); // extreme short audio fallback

    // Find global max for normalization
    let globalMax = 0;
    for (let i = 0; i < totalSamples; i++) {
      const abs = Math.abs(channelData[i]);
      if (abs > globalMax) globalMax = abs;
    }

    const peaks: number[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const start = i * segmentSize;
      const end = start + segmentSize;
      let max = 0;
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channelData[j]);
        if (abs > max) max = abs;
      }
      // Normalize and floor to minimum
      peaks[i] = globalMax > 0 ? Math.max(max / globalMax, 0.05) : 0.05;
    }

    // LRU eviction
    if (peaksCache.size >= MAX_CACHE_SIZE) {
      const firstKey = peaksCache.keys().next().value;
      if (firstKey !== undefined) peaksCache.delete(firstKey);
    }
    peaksCache.set(cacheKey, peaks);

    return peaks;
  }, [wavesurfer, audioUrl, count]);
}
