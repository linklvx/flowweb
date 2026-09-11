// apps/web/src/pages/canvas/video-editor/audio-engine/mixdown.ts
import type { ProjectData, AudioClip, VideoClip } from '../types';
import { buildGainPoints, gainValueAt } from './gain';
import { totalDuration } from '../timeline/timecode';
import type { PcmData } from './pcm';

export const MIX_SAMPLE_RATE = 48000;
const GAIN_BLOCK = 128; // 增益按 128 样本块恒定（≈2.7ms），15min 工程逐样本折线求值不可行

export type MixdownPcm = PcmData;
export type PcmResolver = (mediaId: string, speed: number) => Promise<MixdownPcm | null>;

/** 全时间线离线混音（导出专用）：audio 片 + video 片内嵌音轨 → 立体声 PCM。
 *  增益语义与实时调度同源（buildGainPoints/gainValueAt——equal-gain crossfade/fade/关键帧/muted 一致）。
 *  返回 null 表示无任何可混音轨（纯图片/字幕/无音轨工程）。 */
export async function mixdownTimeline(
  data: ProjectData,
  resolvePcm: PcmResolver,
  onProgress?: (ratio: number) => void,
): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number } | null> {
  const audible = Object.values(data.clips).filter(
    (c): c is AudioClip | VideoClip => c.type === 'audio' || c.type === 'video',
  );
  if (audible.length === 0) return null;
  const totalSamples = Math.ceil(totalDuration(data) * MIX_SAMPLE_RATE);
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);
  let anyMixed = false;
  let done = 0;
  for (const clip of audible) {
    const pcm = await resolvePcm(clip.mediaId, clip.playbackSpeed);
    if (pcm) {
      anyMixed = true;
      const pts = buildGainPoints(data, clip.id);
      const outStart = Math.round(clip.start * MIX_SAMPLE_RATE);
      // stretched 坐标系：resolvePcm 返回已 stretchPcm 的 PCM，源坐标 = 原坐标 / speed
      const srcStart = Math.round((clip.sourceStart / clip.playbackSpeed) * MIX_SAMPLE_RATE);
      const srcL = pcm.channels[0];
      const srcR = pcm.channels[1] ?? pcm.channels[0]; // 单声道素材复制到双声道
      const nSamples = Math.min(
        Math.round(clip.duration * MIX_SAMPLE_RATE),
        totalSamples - outStart,
        srcL.length - srcStart,
      );
      for (let i = 0; i < nSamples; i += GAIN_BLOCK) {
        const g = gainValueAt(pts, i / MIX_SAMPLE_RATE); // 块首时刻增益，块内恒定
        const end = Math.min(i + GAIN_BLOCK, nSamples);
        for (let j = i; j < end; j++) {
          left[outStart + j] += srcL[srcStart + j] * g;
          right[outStart + j] += srcR[srcStart + j] * g;
        }
      }
    }
    done += 1;
    onProgress?.(done / audible.length);
  }
  return anyMixed ? { left, right, sampleRate: MIX_SAMPLE_RATE } : null;
}
