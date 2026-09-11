import { useEffect, useState } from 'react';
import { getMediaBlob } from '../renderer/media-blob';
import { decodeMediaPcm } from '../audio-engine/decode';
import { peaksFromAudioBuffer } from '../timeline/waveform';

const peaksCache = new Map<string, number[]>();
export const PEAKS_COUNT = 200;

/** 波形峰值按 mediaId 缓存（spec 第五节：共享单例解码器产数据，不为每片段 new wavesurfer） */
export function useAudioPeaks(mediaId: string | undefined, url: string | undefined): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(() => (mediaId ? peaksCache.get(mediaId) ?? null : null));
  useEffect(() => {
    if (!mediaId || !url) return;
    if (peaksCache.has(mediaId)) { setPeaks(peaksCache.get(mediaId)!); return; }
    let cancelled = false;
    void (async () => {
      try {
        const blob = await getMediaBlob(mediaId, url);
        if (!blob) return;
        const pcm = await decodeMediaPcm(blob, 48000);
        if (!pcm) return;
        const source = {
          sampleRate: pcm.sampleRate,
          length: pcm.channels[0].length,
          getChannelData: (ch: number) => pcm.channels[Math.min(ch, pcm.channels.length - 1)],
        };
        const p = peaksFromAudioBuffer(source, PEAKS_COUNT);
        peaksCache.set(mediaId, p);
        if (!cancelled) setPeaks(p);
      } catch { /* 静默：无波形显示占位色块 */ }
    })();
    return () => { cancelled = true; };
  }, [mediaId, url]);
  return peaks;
}
