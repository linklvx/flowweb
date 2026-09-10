import type { SubtitleRenderState, VisualRenderState } from '../scene/interpolate';
import { layoutSubtitleLines } from '../scene/subtitle-layout';

export const CANVAS_W = 1920;
export const CANVAS_H = 1080;

export interface VisualLayer {
  source: CanvasImageSource;
  srcW: number; srcH: number;
  state: VisualRenderState;
}
export interface SubtitleLayer { state: SubtitleRenderState; }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 薄绘制层（spec：不测）——1920×1080 合成坐标系；720p 导出由 Plan 4 整体 0.5× ctx.scale。
 *  绘制顺序：黑底 → 视觉层（renderOrder 已由 selectActiveClips 排好）→ overlay 层（toBlack/toWhite 全屏，决策 4）→ 字幕（最后，spec renderOrder）。 */
export class CanvasRenderer {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  draw(visual: VisualLayer[], subtitles: SubtitleLayer[]): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    const overlays: { color: 'black' | 'white'; alpha: number }[] = [];
    for (const l of visual) {
      this.drawVisual(l);
      if (l.state.overlay && l.state.overlay.alpha > 0) overlays.push(l.state.overlay);
    }
    for (const o of overlays) {
      ctx.save();
      ctx.globalAlpha = clamp01(o.alpha);
      ctx.fillStyle = o.color === 'black' ? '#000' : '#FFF';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();
    }
    for (const s of subtitles) this.drawSubtitle(s);
  }

  private drawVisual({ source, srcW, srcH, state }: VisualLayer): void {
    const { transform } = state;
    const contain = Math.min(CANVAS_W / srcW, CANVAS_H / srcH); // contain 居中基准 = scale 1（spec 数据模型默认基准）
    const scale = contain * transform.scale;
    const w = srcW * scale;
    const h = srcH * scale;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = clamp01(state.opacity);
    ctx.translate(CANVAS_W / 2 + transform.x, CANVAS_H / 2 + transform.y);
    if (transform.rotation) ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.drawImage(source, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  private drawSubtitle({ state }: SubtitleLayer): void {
    if (!state.visible || !state.text) return;
    const ctx = this.ctx;
    // G5：字间距参与 measure 与绘制（ctx.letterSpacing Chromium 99+；jsdom/旧浏览器赋值静默无效不抛）
    ctx.save();
    const font = `${state.style.fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.font = font;
    try { (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${state.style.letterSpacing}px`; } catch { /* 不支持则忽略 */ }
    const layout = layoutSubtitleLines(state.text, state.style, (s, f) => { ctx.font = f; return ctx.measureText(s).width; });
    const blockH = layout.lines.length * layout.lineHeight;
    const firstLineCenterY = CANVAS_H - 96 - blockH + layout.lineHeight / 2; // 底边安全边距 96px
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = state.style.color;
    layout.lines.forEach((line, i) => {
      ctx.fillText(line, CANVAS_W / 2, firstLineCenterY + i * layout.lineHeight);
    });
    ctx.restore();
  }
}
