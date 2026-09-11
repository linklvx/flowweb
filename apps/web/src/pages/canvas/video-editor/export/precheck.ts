// apps/web/src/pages/canvas/video-editor/export/precheck.ts
import type { ExportResolution } from '@flowweb/shared'; // 类型上移 shared——precheck 自身 satisfies 消费必须引入
import type { ProjectData } from '../types';
import { totalDuration } from '../timeline/timecode';

export const EXPORT_BITRATES = {
  '480p': { video: 2_500_000, audio: 96_000 },
  '720p': { video: 5_000_000, audio: 128_000 },
  '1080p': { video: 12_000_000, audio: 128_000 },
} as const satisfies Record<ExportResolution, { video: number; audio: number }>; // as const 必须在前——satisfies 在前报 TS1355；shared 联合漏改表键即编译红

export const MAX_EXPORT_DURATION_SEC = 900; // 15 分钟上限
export const MEMORY_WARN_BYTES = 1024 ** 3; // >1GB 警告放行

export function computeExportSize(canvasSize: { width: number; height: number }, tier: ExportResolution) {
  const targetShort = parseInt(tier, 10); // 480/720/1080
  const scale = targetShort / Math.min(canvasSize.width, canvasSize.height); // 档位=目标短边（spec 5.3）
  return { width: Math.round(canvasSize.width * scale / 2) * 2, height: Math.round(canvasSize.height * scale / 2) * 2 };
}

// ratio 单点——clamp（Math.max(1, …)）收进函数内部，估算/编码两端同调（窄画布不降码率，质量取向）。
// 注意「16:9 ratio=1」仅 720p/1080p 精确成立；480p 因取偶 854×480 → ≈1.00078，勿写 toBe(1) 用例。
export function exportPixelRatio(canvasSize: { width: number; height: number }, resolution: ExportResolution): number {
  const out = computeExportSize(canvasSize, resolution);
  const tierPx = parseInt(resolution, 10) ** 2 * (1920 / 1080); // 档位参考像素（16:9 基准）
  return Math.max(1, (out.width * out.height) / tierPx);
}

export function estimateSizeBytes(canvasSize: { width: number; height: number }, resolution: ExportResolution, durationSec: number): number {
  const { video, audio } = EXPORT_BITRATES[resolution];
  // 21:9 的 480p 输出 1138×480 勿按 2560×1080 画布像素高估——ratio 经 exportPixelRatio（含 clamp）
  return Math.round(((video * exportPixelRatio(canvasSize, resolution) + audio) / 8) * durationSec * 1.2);
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
