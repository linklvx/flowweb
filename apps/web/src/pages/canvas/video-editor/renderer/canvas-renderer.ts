import type { SubtitleRenderState, VisualRenderState } from '../scene/interpolate';
import { layoutSubtitleLines, SUBTITLE_FONT, SUBTITLE_SPEC } from '../scene/subtitle-layout';
import type { CanvasSize } from '../timeline/canvas-size';

/** 基准坐标系（fontSize/maxWidth/bottomMargin 全以 1920×1080 基准定义）——仅供基准换算，
 *  运行时画布尺寸走 draw 的 size 参数（C 档 canvasSize，每帧注入防播放循环中陈旧） */
export const BASE_CANVAS_W = 1920;
export const BASE_CANVAS_H = 1080;

export interface VisualLayer {
  source: CanvasImageSource;
  srcW: number; srcH: number;
  state: VisualRenderState;
}
export interface SubtitleLayer { state: SubtitleRenderState; }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 薄绘制层（spec：不测）——合成坐标系随 draw 的 size 参数（C 档运行时画布，基准 1920×1080）；
 *  720p 导出由整体 0.5× ctx.scale。
 *  绘制顺序：黑底 → 视觉层（renderOrder 已由 selectActiveClips 排好）→ overlay 层（toBlack/toWhite 全屏，决策 4）→ 字幕（最后，spec renderOrder）。 */
export class CanvasRenderer {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  draw(visual: VisualLayer[], subtitles: SubtitleLayer[], size: CanvasSize): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size.width, size.height);
    const overlays: { color: 'black' | 'white'; alpha: number }[] = [];
    for (const l of visual) {
      this.drawVisual(l, size);
      if (l.state.overlay && l.state.overlay.alpha > 0) overlays.push(l.state.overlay);
    }
    for (const o of overlays) {
      ctx.save();
      ctx.globalAlpha = clamp01(o.alpha);
      ctx.fillStyle = o.color === 'black' ? '#000' : '#FFF';
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.restore();
    }
    for (const s of subtitles) this.drawSubtitle(s, size);
  }

  private drawVisual({ source, srcW, srcH, state }: VisualLayer, size: CanvasSize): void {
    const { transform } = state;
    const contain = Math.min(size.width / srcW, size.height / srcH); // contain 居中基准 = scale 1（运行时画布）
    const scale = contain * transform.scale;
    const w = srcW * scale;
    const h = srcH * scale;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = clamp01(state.opacity);
    ctx.translate(size.width / 2 + transform.x, size.height / 2 + transform.y);
    if (transform.rotation) ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.drawImage(source, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  private drawSubtitle({ state }: SubtitleLayer, size: CanvasSize): void {
    if (!state.visible || !state.text) return;
    const ctx = this.ctx;
    // G5：字间距参与 measure 与绘制（ctx.letterSpacing Chromium 99+；jsdom/旧浏览器赋值静默无效不抛）
    ctx.save();
    const font = `${state.style.fontSize}px ${SUBTITLE_FONT}`;
    ctx.font = font; // 预设置——measure 首调前兜底
    try { (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${state.style.letterSpacing}px`; } catch { /* 不支持则忽略 */ }
    const layout = layoutSubtitleLines(state.text, state.style, (s, f) => { ctx.font = f; return ctx.measureText(s).width; }, size);
    const blockH = layout.lines.length * layout.lineHeight;
    // R11-A1 ctx.font 时序：measure 只在换行判定时被调，单字/短字幕不触发——layout 后必须以缩放字号重设，
    // 否则 fillText 按未缩放 style.fontSize 绘制
    ctx.font = `${layout.fontSize}px ${SUBTITLE_FONT}`;
    const bottomMargin = SUBTITLE_SPEC.bottomMargin * (size.height / BASE_CANVAS_H); // 底边安全边距 96px 按高比例派生（基准 1080）
    const firstLineCenterY = size.height - bottomMargin - blockH + layout.lineHeight / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = state.style.color;
    layout.lines.forEach((line, i) => {
      ctx.fillText(line, size.width / 2, firstLineCenterY + i * layout.lineHeight);
    });
    ctx.restore();
  }
}
