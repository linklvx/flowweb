import type { Clip, ProjectData, SubtitleClip, Transform, TransformKeyframe, VideoClip, ImageClip } from '../types';
import { sourceTime } from '../timeline/clip-math';
import { clipsOnTrack, crossfadePredecessor, effectiveTransitions } from '../timeline/overlap';

/** 单属性关键帧通道插值：无点取 base / 单点恒值 / 越首末取端值 / 中间线性（spec 数据模型插值边界）。
 *  base 缺省 0（计划测试存在 2 参调用——中间插值分支不消费 base，strict 下签名适配，控制器登记偏离） */
export function keyframeValueAt(points: { t: number; value: number }[], t: number, base = 0): number {
  if (points.length === 0) return base;
  if (points.length === 1) return points[0].value;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return sorted[0].value;
  if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].value;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]; const b = sorted[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      return span === 0 ? b.value : a.value + (b.value - a.value) * ((t - a.t) / span);
    }
  }
  return base; // 不可达（防御）
}

export type VisualClip = VideoClip | ImageClip;

/** 五属性（x/y/scale/rotation/opacity）各自独立关键帧通道；t 为片段局部时间 */
export function interpolateTransform(clip: VisualClip, tLocal: number): Transform {
  const kf = clip.keyframes ?? [];
  const ch = (p: TransformKeyframe['property']) => kf.filter(k => k.property === p).map(k => ({ t: k.t, value: k.value }));
  return {
    x: keyframeValueAt(ch('x'), tLocal, clip.transform.x),
    y: keyframeValueAt(ch('y'), tLocal, clip.transform.y),
    scale: keyframeValueAt(ch('scale'), tLocal, clip.transform.scale),
    rotation: keyframeValueAt(ch('rotation'), tLocal, clip.transform.rotation),
    opacity: keyframeValueAt(ch('opacity'), tLocal, clip.transform.opacity),
  };
}

export interface CrossfadeContext { backOverlap: number; frontOverlap: number; }

/** crossfade 双窗口角色判定（渲染与音频增益共用——equal-gain 同曲线单源，决策 17）：
 *  backOverlap = 本片 transitionIn crossfade 与前片的实际重叠（eff.overlap）；
 *  frontOverlap = 存在后片 crossfade 指向本片（predecessor 是本片）时的尾部重叠。
 *  两窗可并存（三片链中间片）；全零 → null（无重叠区无渐变）。 */
export function crossfadeContextOf(data: ProjectData, clipId: string): CrossfadeContext | null {
  const clip = data.clips[clipId];
  if (!clip || clip.type === 'subtitle' || clip.type === 'audio') return null;
  let backOverlap = 0;
  let frontOverlap = 0;
  if (clip.transitionIn?.type === 'crossfade') {
    const eff = effectiveTransitions(data, clipId);
    if (eff.in?.type === 'crossfade') backOverlap = eff.overlap;
  }
  const next = clipsOnTrack(data, clip.trackId)
    .find(c => c.start > clip.start && (c as VideoClip).transitionIn?.type === 'crossfade') as VideoClip | undefined;
  if (next && crossfadePredecessor(data, next)?.id === clipId) {
    frontOverlap = Math.max(0, clip.start + clip.duration - next.start);
  }
  return backOverlap > 0 || frontOverlap > 0 ? { backOverlap, frontOverlap } : null;
}

export interface TransitionEffect { alpha: number; overlay: { color: 'black' | 'white'; alpha: number } | null; }

/** 转场状态（局部时间）：crossfade 双窗口独立施加（back 前缘 0→1 / front 尾缘 1→0，中间片两窗 alpha 相乘）；
 *  独立转场与窗口并存——crossfade 类型永不作为独立转场施加（零重叠/出场位置均无效果，防白闪——
 *  语义只经双窗口表达）；未吞并的出场转场（如入 crossfade + 出 toBlack）正常叠加。 */
export function transitionEffect(data: ProjectData, clip: VisualClip, tLocal: number): TransitionEffect {
  let alpha = 1;
  let overlay: TransitionEffect['overlay'] = null;
  const dur = clip.duration;
  const cf = crossfadeContextOf(data, clip.id);
  const eff = effectiveTransitions(data, clip.id);
  if (cf) {
    if (cf.backOverlap > 0 && tLocal < cf.backOverlap) alpha *= tLocal / cf.backOverlap;
    const rem = dur - tLocal;
    if (cf.frontOverlap > 0 && rem < cf.frontOverlap) alpha *= rem / cf.frontOverlap;
  }
  const tin = eff.in;
  const tout = eff.out;
  if (tin && tin.duration > 0 && tLocal < tin.duration) {
    const p = tLocal / tin.duration;
    if (tin.type === 'fadeIn') alpha *= p;
    else if (tin.type === 'toBlack' || tin.type === 'toWhite') overlay = { color: tin.type === 'toBlack' ? 'black' : 'white', alpha: 1 - p };
    // crossfade：无重叠区时 eff.in 保留原始 crossfade——永不作为独立转场施加（只经双窗口生效，防白闪）
  }
  if (tout && tout.duration > 0 && dur - tLocal < tout.duration) {
    const p = (dur - tLocal) / tout.duration;
    if (tout.type === 'fadeOut') alpha *= p;
    else if (tout.type === 'toBlack' || tout.type === 'toWhite') overlay = { color: tout.type === 'toBlack' ? 'black' : 'white', alpha: 1 - p };
    // 同上：transitionOut crossfade 语义由后片 transitionIn 表达，本片不施加
  }
  return { alpha, overlay };
}

export interface VisualRenderState {
  kind: 'visual';
  sourceTime: number | null; // 视频片=sourceTime 公式；图片片 null
  transform: Transform;
  opacity: number; // transform.opacity × 转场 alpha
  overlay: { color: 'black' | 'white'; alpha: number } | null;
}
export interface SubtitleRenderState {
  kind: 'subtitle';
  text: string;
  style: SubtitleClip['style'];
  visible: boolean;
}
export type RenderState = VisualRenderState | SubtitleRenderState;

/** 同源渲染核心插值（预览/导出共用）：t 为成片绝对时间 */
export function interpolateClip(data: ProjectData, clipId: string, t: number): RenderState {
  const clip = data.clips[clipId] as Clip;
  const tLocal = t - clip.start;
  if (clip.type === 'subtitle') {
    return { kind: 'subtitle', text: clip.text, style: clip.style, visible: clip.visible };
  }
  if (clip.type === 'audio') {
    throw new Error('interpolateClip: audio clip 不进视觉管线（音频走 audio-engine）');
  }
  const visual = clip as VisualClip;
  const transform = interpolateTransform(visual, tLocal);
  const { alpha, overlay } = transitionEffect(data, visual, tLocal);
  return {
    kind: 'visual',
    sourceTime: visual.type === 'video' ? sourceTime(visual, t) : null,
    transform,
    opacity: transform.opacity * alpha,
    overlay,
  };
}
