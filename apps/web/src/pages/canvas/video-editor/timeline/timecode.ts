// apps/web/src/pages/canvas/video-editor/timeline/timecode.ts
import type { ProjectData } from '../types';
import { FPS } from './clip-math';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** HH:MM:SS:FF（30fps 非丢帧）——时间轴片段块"名称 · 源时间码"用 */
export function formatTimecode(t: number, fps = FPS): string {
  const totalFrames = Math.round(t * fps);
  const f = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

/** M:SS——剪辑节点本体简略显示 */
export function formatShortTime(t: number): string {
  const totalSeconds = Math.floor(t);
  return `${Math.floor(totalSeconds / 60)}:${pad(totalSeconds % 60)}`;
}

/** 总长 = max(clip.end)；原点恒 0——片段不从 0 开始时前导为黑场并计入成片 */
export function totalDuration(data: ProjectData): number {
  let max = 0;
  for (const c of Object.values(data.clips)) max = Math.max(max, c.start + c.duration);
  return max;
}
