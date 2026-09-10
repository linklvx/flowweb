// apps/web/src/pages/canvas/video-editor/timeline/overlap.ts
import type { Clip, ProjectData, Transition } from '../types';
import { quantizeTime, MIN_FRAME_SEC } from './clip-math';

export function clipsOnTrack(data: ProjectData, trackId: string): Clip[] {
  const t = data.tracks.find(t => t.id === trackId);
  if (!t) return [];
  return t.clips.map(id => data.clips[id]).filter(Boolean).sort((a, b) => a.start - b.start);
}

/** crossfade 前片：同轨相邻、start 更小者中最近的一个 */
export function crossfadePredecessor(data: ProjectData, clip: Clip): Clip | null {
  if (clip.type === 'audio' || clip.type === 'subtitle') return null; // audio/字幕无转场——窄化联合消除 as any
  if (clip.transitionIn?.type !== 'crossfade') return null;
  const prev = clipsOnTrack(data, clip.trackId).filter(c => c.start < clip.start && c.id !== clip.id);
  return prev.length ? prev[prev.length - 1] : null;
}

export interface EffectiveTransitions { in: Transition | null; out: Transition | null; overlap: number; }

/** 有效转场（crossfade 边界状态机，渲染/导出消费有效值而非原始数据） */
export function effectiveTransitions(data: ProjectData, clipId: string): EffectiveTransitions {
  const clip = data.clips[clipId];
  if (!clip || clip.type === 'subtitle' || clip.type === 'audio') {
    return { in: null, out: null, overlap: 0 };
  }
  let effIn: Transition | null = clip.transitionIn ?? null;
  let overlap = 0;
  if (clip.transitionIn?.type === 'crossfade') {
    const prev = crossfadePredecessor(data, clip);
    if (!prev) {
      effIn = { type: 'fadeIn', duration: clip.transitionIn.duration }; // 前片缺失/被移走 → 退化
    } else {
      overlap = Math.max(0, prev.start + prev.duration - clip.start); // 实际重叠区
    }
  }
  let effOut: Transition | null = clip.transitionOut ?? null;
  if (effOut) {
    const next = clipsOnTrack(data, clip.trackId).find(c => c.start >= clip.start && c.id !== clip.id);
    if (next && (next as any).transitionIn?.type === 'crossfade' && crossfadePredecessor(data, next)?.id === clip.id) {
      effOut = null; // crossfade 优先：前片独立出转场被吞并
    }
  }
  return { in: effIn, out: effOut, overlap };
}

/** 同轨放置校验：禁重叠除 crossfade overlap（仅同轨；跨轨自由——图层叠加是多轨核心）。
 *  spec 第三节：重叠区转场由后片（start 较大者）的 transitionIn crossfade 单侧表达——
 *  allowed 逐对取 later 片的 crossfade duration（被放置片为后片时取 placedClip，为前片时取已入库对手片） */
export function canPlaceAt(
  data: ProjectData, clipId: string, start: number, trackId: string, duration: number,
  placedClip?: { transitionIn?: Transition },
): boolean {
  for (const c of clipsOnTrack(data, trackId)) {
    if (c.id === clipId) continue;
    const overlap = Math.min(start + duration, c.start + c.duration) - Math.max(start, c.start);
    if (overlap <= 1e-9) continue;
    const laterIn: Transition | undefined = start > c.start ? placedClip?.transitionIn : (c as any).transitionIn;
    const allowed = laterIn?.type === 'crossfade' ? laterIn.duration : 0;
    if (overlap > allowed + 1e-9) return false;
  }
  return true;
}

/** 冲突吸附最近空位：desired 起向两侧帧网格扫描，返回第一个可放 start */
export function findNearestFreeStart(
  data: ProjectData, clipId: string, desiredStart: number, trackId: string, duration: number,
  clipTransition?: { transitionIn?: Transition },
): number {
  const step = quantizeTime(MIN_FRAME_SEC);
  for (let offset = 0; offset <= 24 * 3600; offset += step) {
    const right = quantizeTime(desiredStart + offset);
    if (canPlaceAt(data, clipId, right, trackId, duration, clipTransition)) return right;
    if (offset === 0) continue;
    const left = quantizeTime(desiredStart - offset);
    if (left >= 0 && canPlaceAt(data, clipId, left, trackId, duration, clipTransition)) return left;
  }
  return quantizeTime(desiredStart); // 兜底：理论不可达（时间轴无限长）
}
