// apps/web/src/pages/canvas/video-editor/timeline/clip-math.ts
import type { Clip } from '../types';

export const FPS = 30;
export const MIN_FRAME_SEC = 1 / FPS;

export function secondsToFrame(t: number, fps = FPS): number {
  return Math.round(t * fps);
}
export function frameToSeconds(frame: number, fps = FPS): number {
  return frame / fps;
}
/** 成片时间量化到帧网格——唯一真相是帧整数；源 sourceStart/sourceTime 保持连续浮点交 decoder nearest sample */
export function quantizeTime(t: number, fps = FPS): number {
  return frameToSeconds(secondsToFrame(t, fps), fps);
}

/** 有源片段（video/audio 共有 sourceStart + playbackSpeed） */
export type TimedClip = Extract<Clip, { sourceStart: unknown }>;
const isTimed = (c: Clip): c is TimedClip => c.type === 'video' || c.type === 'audio';

/** sourceTime(clip, t) = sourceStart + (t - start) * playbackSpeed */
export function sourceTime(clip: TimedClip, t: number): number {
  return clip.sourceStart + (t - clip.start) * clip.playbackSpeed;
}

export interface TrimGuard { minDelta: number; maxDelta: number; }

export function trimLeftGuard(clip: Clip, _mediaDuration: number): TrimGuard {
  const sourceLimit = isTimed(clip) ? -clip.sourceStart / clip.playbackSpeed : -Infinity;
  // 左拉（Δ<0）双下界取交：素材 0 点（sourceStart ≥ 0）+ 时间轴 0 点（start ≥ 0）。
  // duration = duration - Δ 随左拉增大，左拉侧无帧下界问题（负 duration 在 Δ>0 侧，由 maxDelta 防）。
  // -0 归一 +0：start=0 时 Math.max(-100, -0) 产 -0，Object.is/JSON.stringify/Math.sign 场景露馅（R3 审核 P2）
  const minDelta = Math.max(sourceLimit, -clip.start);
  return {
    minDelta: minDelta === 0 ? 0 : minDelta,
    maxDelta: clip.duration - MIN_FRAME_SEC,
  };
}

export function trimRightGuard(clip: Clip, mediaDuration: number): TrimGuard {
  const max = isTimed(clip)
    ? (mediaDuration - clip.sourceStart) / clip.playbackSpeed - clip.duration
    : Infinity - clip.duration; // image/subtitle 无素材上限（Infinity 兜底同效）
  return { minDelta: MIN_FRAME_SEC - clip.duration, maxDelta: isFinite(max) ? max : Infinity };
}

export function clampDelta(g: TrimGuard, delta: number): number {
  return Math.min(Math.max(delta, g.minDelta), g.maxDelta);
}

/** 左缘 trim：start += Δ；duration -= Δ；sourceStart += Δ * playbackSpeed。
 *  成片时间结果（start/duration）量化回帧网格——spec 红线：帧整数为唯一真相，反复 trim 累加浮点尾差必须被每步消除；sourceStart 保持连续浮点 */
export function applyTrimLeft(clip: Clip, delta: number): Clip {
  const d = quantizeTime(delta);
  const start = quantizeTime(clip.start + d);
  const duration = quantizeTime(clip.duration - d);
  if (isTimed(clip)) {
    return { ...clip, start, duration, sourceStart: clip.sourceStart + d * clip.playbackSpeed };
  }
  return { ...clip, start, duration };
}

/** 右缘 trim：不改 sourceStart（成片 duration 同样量化回帧网格） */
export function applyTrimRight(clip: Clip, delta: number): Clip {
  const d = quantizeTime(delta);
  return { ...clip, duration: quantizeTime(clip.duration + d) };
}

/** 分割（spec 公式）：后片.sourceStart = 前.sourceStart + (cut - 前.start) * speed；转场/关键帧按语义重分配 */
export function splitClipAt(clip: Clip, cutPoint: number, backId: string): { front: Clip; back: Clip } {
  const cut = quantizeTime(cutPoint);
  const localCut = cut - clip.start;
  const front: Clip = { ...clip, duration: localCut, transitionOut: undefined } as Clip;
  const backBase: any = {
    ...clip,
    id: backId,
    start: cut,
    duration: clip.start + clip.duration - cut,
    transitionIn: undefined,
  };
  if (isTimed(clip)) backBase.sourceStart = clip.sourceStart + localCut * clip.playbackSpeed;
  // SubtitleClip 无 keyframes 字段（shared 类型实形）——as any 绕联合访问，运行时 undefined ?? [] 兜底
  backBase.keyframes = ((clip as any).keyframes ?? [])
    .filter((k: any) => k.t > localCut)
    .map((k: any) => ({ ...k, t: k.t - localCut }));
  (front as any).keyframes = ((clip as any).keyframes ?? []).filter((k: any) => k.t <= localCut);
  return { front, back: backBase as Clip };
}
