// apps/web/src/pages/canvas/video-editor/export/precheck.ts
import type { ProjectData } from '../types';
import { totalDuration } from '../timeline/timecode';

export const EXPORT_BITRATES = {
  '720p': { video: 5_000_000, audio: 128_000 },
  '1080p': { video: 12_000_000, audio: 128_000 },
} as const;
export type ExportResolution = keyof typeof EXPORT_BITRATES;

export const MAX_EXPORT_DURATION_SEC = 900; // 15 分钟上限
export const MEMORY_WARN_BYTES = 1024 ** 3; // >1GB 警告放行

export function estimateSizeBytes(resolution: ExportResolution, durationSec: number): number {
  const { video, audio } = EXPORT_BITRATES[resolution];
  return Math.round(((video + audio) / 8) * durationSec * 1.2); // 码率×时长×1.2
}

/** 48kHz 立体声 float32 × (音频轨数 + 视频片数) × 3.5 瞬时系数（视频内嵌音轨保守全算） */
export function estimateMemoryBytes(data: ProjectData, durationSec: number): number {
  let audioTracks = 0;
  for (const t of data.tracks) if (t.type === 'audio') audioTracks++;
  let videoClips = 0;
  for (const c of Object.values(data.clips)) if (c.type === 'video') videoClips++;
  return Math.round(durationSec * 48_000 * 2 * 4 * (audioTracks + videoClips) * 3.5);
}

export type PrecheckError =
  | { code: 'empty'; message: string }
  | { code: 'duration'; message: string }
  | { code: 'missing-media'; message: string }
  | { code: 'missing-url'; message: string }
  | { code: 'encoder-video'; message: string }
  | { code: 'encoder-audio'; message: string };
export type PrecheckWarning = { code: 'memory'; message: string };

/** 第二参是 mediaUrls（Record<mediaId, url|undefined>）——只查 id 会放行"条目存在但 url 缺失"
 *  （batch 失败容忍/团队素材 url 空/历史条目），Worker 端对无 url 静默 continue → 导出黑帧却"成功"。 */
export function runPrecheck(
  data: ProjectData,
  mediaUrls: Record<string, string | undefined>,
  encoder: { video: boolean; audio: boolean },
): { errors: PrecheckError[]; warnings: PrecheckWarning[]; durationSec: number; memoryEstimateBytes: number } {
  const errors: PrecheckError[] = [];
  const warnings: PrecheckWarning[] = [];
  const durationSec = totalDuration(data);
  if (durationSec <= 0) errors.push({ code: 'empty', message: '空工程不可导出——请先添加素材片段' });
  if (durationSec > MAX_EXPORT_DURATION_SEC) {
    errors.push({ code: 'duration', message: `总时长 ${Math.round(durationSec)}s 超过 15 分钟上限` });
  }
  for (const c of Object.values(data.clips)) {
    if (c.type === 'subtitle') continue; // 字幕无 mediaId
    const url = mediaUrls[c.mediaId];
    if (url === undefined) errors.push({ code: 'missing-media', message: `素材 ${c.mediaId} 缺失或未加载（上游已删除？）` });
    else if (!url) errors.push({ code: 'missing-url', message: `素材 ${c.mediaId} 的下载地址缺失（详情未就绪？稍后重开面板刷新）` });
  }
  if (!encoder.video) errors.push({ code: 'encoder-video', message: '当前浏览器不支持 H.264 视频编码，请使用最新 Chrome/Edge' });
  if (!encoder.audio) errors.push({ code: 'encoder-audio', message: '当前浏览器不支持 AAC 音频编码（含 polyfill）' });
  const memoryEstimateBytes = estimateMemoryBytes(data, durationSec);
  if (memoryEstimateBytes > MEMORY_WARN_BYTES) {
    warnings.push({ code: 'memory', message: `预计内存峰值约 ${(memoryEstimateBytes / 1024 ** 3).toFixed(1)}GB，可能影响稳定性，建议降 720p 或缩短工程` });
  }
  return { errors, warnings, durationSec, memoryEstimateBytes };
}
