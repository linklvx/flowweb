// apps/web/src/pages/canvas/video-editor/audio-engine/gain.ts
import type { AudioClip, ProjectData, VideoClip } from '../types';
import { keyframeValueAt, interpolateTransform, crossfadeContextOf, transitionEffect, type VisualClip } from '../scene/interpolate';
import { effectiveTransitions } from '../timeline/overlap';

export interface GainPoint { t: number; value: number; } // t 为片段局部时间

/** 折线求值（调度 seek 锚点用；points 首点恒 t=0） */
export function gainValueAt(points: GainPoint[], tLocal: number): number {
  if (points.length === 0) return 0;
  return keyframeValueAt(points, tLocal, points[0].value);
}

/** 片段音轨增益拐点集（调度时转 GainNode automation）：
 *  - audio 片：volume × VolumeKeyframe 插值 × fade in/out；muted 轨恒 0；
 *  - video 片（内嵌音轨）：与画面 opacity 同曲线 equal-gain（spec 第六节）——
 *    transform.opacity 通道 × 转场 alpha（crossfade/fadeIn/fadeOut），toBlack/toWhite 仅画面 overlay 不影响音轨；
 *  - image/subtitle：无音轨恒 0。
 *  输出保证含 t=0 与 t=duration 端点、按 t 升序。 */
export function buildGainPoints(data: ProjectData, clipId: string): GainPoint[] {
  const clip = data.clips[clipId] as VideoClip | AudioClip | undefined;
  if (!clip) return [];
  const tr = data.tracks.find(t => t.id === clip.trackId);
  if (tr?.muted) return [{ t: 0, value: 0 }];
  const dur = clip.duration;
  const times = new Set<number>([0, dur]);
  let gainAt: (tl: number) => number;

  if (clip.type === 'audio') {
    const kf = clip.keyframes.map(k => ({ t: k.t, value: k.value }));
    for (const k of kf) times.add(k.t);
    if (clip.fade.in > 0) times.add(Math.min(clip.fade.in, dur));
    if (clip.fade.out > 0) times.add(Math.max(0, dur - clip.fade.out));
    gainAt = (tl) => {
      let g = keyframeValueAt(kf, tl, clip.volume);
      if (clip.fade.in > 0 && tl < clip.fade.in) g *= tl / clip.fade.in;
      const rem = dur - tl;
      if (clip.fade.out > 0 && rem < clip.fade.out) g *= rem / clip.fade.out;
      return g;
    };
  } else if (clip.type === 'video') {
    const opKf = clip.keyframes.filter(k => k.property === 'opacity').map(k => ({ t: k.t, value: k.value }));
    for (const k of opKf) times.add(k.t);
    const cf = crossfadeContextOf(data, clipId);
    const eff = effectiveTransitions(data, clipId);
    if (cf) {
      // 双窗口拐点（决策 17 与 transitionEffect 同源）
      if (cf.backOverlap > 0) times.add(Math.min(cf.backOverlap, dur));
      if (cf.frontOverlap > 0) times.add(Math.max(0, dur - cf.frontOverlap));
    }
    const skipIn = !!cf && cf.backOverlap > 0; // crossfade 入场已由窗口施加（防重复）
    if (!skipIn && eff.in && eff.in.duration > 0 && eff.in.type !== 'toBlack' && eff.in.type !== 'toWhite') times.add(Math.min(eff.in.duration, dur));
    if (eff.out && eff.out.duration > 0 && eff.out.type !== 'toBlack' && eff.out.type !== 'toWhite') times.add(Math.max(0, dur - eff.out.duration));
    gainAt = (tl) => {
      const v = clip as VisualClip;
      const opacity = interpolateTransform(v, tl).opacity;
      const { alpha } = transitionEffect(data, v, tl);
      return opacity * alpha;
    };
  } else {
    return [{ t: 0, value: 0 }];
  }

  const sorted = [...times].sort((a, b) => a - b);
  const pts: GainPoint[] = [];
  for (const t of sorted) {
    const value = gainAt(t);
    if (pts.length === 0 || Math.abs(pts[pts.length - 1].t - t) > 1e-9) pts.push({ t, value });
  }
  return pts;
}
