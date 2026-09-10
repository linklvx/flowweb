// apps/web/src/pages/canvas/video-editor/timeline/view-scale.ts
import type { Clip } from '../types';

export const SNAP_THRESHOLD_PX = 8;
export const EDGE_HIT_PX = 6;

export function timeToPx(t: number, pxPerSec: number): number {
  return t * pxPerSec;
}
export function pxToTime(px: number, pxPerSec: number): number {
  return px / pxPerSec;
}
export function snapThresholdSec(pxPerSec: number): number {
  return SNAP_THRESHOLD_PX / pxPerSec;
}

export type SnapKind = 'clip-start' | 'clip-end' | 'playhead' | 'whole-second';
export interface SnapPoint { time: number; kind: SnapKind; }
export interface SnapResult { time: number; snapped: SnapPoint | null; }

export function collectSnapPoints(excludeClipId: string | undefined, clips: Clip[], playhead: number): SnapPoint[] {
  const pts: SnapPoint[] = [];
  for (const c of clips) {
    if (c.id === excludeClipId) continue;
    pts.push({ time: c.start, kind: 'clip-start' });
    pts.push({ time: c.start + c.duration, kind: 'clip-end' });
  }
  pts.push({ time: playhead, kind: 'playhead' });
  return pts;
}

/** 最近点吸附：显式点（片段边缘/播放头）与整秒刻度合并判定，取更近者；无命中返回原值。
 *  tie-break：显式点先求值 + 严格小于（d < bestDist）才替换——等距时显式点胜出（固化为测试） */
export function snapTime(targetSec: number, points: SnapPoint[], pxPerSec: number): SnapResult {
  const threshold = snapThresholdSec(pxPerSec);
  let best: SnapPoint | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    const d = Math.abs(p.time - targetSec);
    if (d <= threshold && d < bestDist) { best = p; bestDist = d; }
  }
  const whole = Math.round(targetSec);
  const dWhole = Math.abs(whole - targetSec);
  if (dWhole <= threshold && dWhole < bestDist) {
    return { time: whole, snapped: { time: whole, kind: 'whole-second' } };
  }
  if (best) return { time: best.time, snapped: best };
  return { time: targetSec, snapped: null };
}

/** trim 边缘命中：offsetX 距片段左/右缘 6px 内 */
export function edgeHitTest(offsetX: number, widthPx: number): 'left' | 'right' | null {
  if (offsetX <= EDGE_HIT_PX) return 'left';
  if (widthPx - offsetX <= EDGE_HIT_PX) return 'right';
  return null;
}

/** Ctrl+滚轮缩放锚定：新 scrollLeft 使 anchorTime 在视口中的位置保持不变 */
export function anchorZoomScroll(input: {
  scrollLeft: number; anchorTime: number; oldPxPerSec: number; newPxPerSec: number; viewportW: number;
}): { scrollLeft: number } {
  const anchorOffset = input.anchorTime * input.oldPxPerSec - input.scrollLeft; // 锚点距视口左的距离
  return { scrollLeft: Math.max(0, input.anchorTime * input.newPxPerSec - anchorOffset) };
}
