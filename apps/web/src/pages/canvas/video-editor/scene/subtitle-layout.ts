import type { SubtitleClip } from '../types';

/** 字幕绘制规格（spec 第六节）：1920×1080 基准，720p 随 0.5× 整体缩放由 renderer 的 ctx.scale 处理 */
export const SUBTITLE_SPEC = {
  canvasW: 1920, canvasH: 1080,
  bottomMargin: 96,   // 底边安全边距
  maxWidth: 1664,     // 最大宽自动换行
  maxLines: 2,        // 超长截断行数上限（决策 12）
} as const;
export const SUBTITLE_FONT = '"PingFang SC", "Microsoft YaHei", sans-serif';

export interface SubtitleLayout { lines: string[]; lineHeight: number; fontSize: number; }

/** 换行/截断纯函数：measure 由渲染端注入（ctx.measureText），测试注入假实现。
 *  行为：\n 分段；段内按 maxWidth 逐字换行；超过 maxLines 截断（第 maxLines 行按 maxWidth 切，不加省略号）。 */
export function layoutSubtitleLines(
  text: string,
  style: SubtitleClip['style'],
  measure: (s: string, font: string) => number,
): SubtitleLayout {
  const font = `${style.fontSize}px ${SUBTITLE_FONT}`;
  const fits = (s: string) => measure(s, font) <= SUBTITLE_SPEC.maxWidth;
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      if (line && !fits(line + ch)) {
        lines.push(line);
        if (lines.length >= SUBTITLE_SPEC.maxLines) break;
        line = ch;
      } else {
        line += ch;
      }
    }
    if (lines.length >= SUBTITLE_SPEC.maxLines) break;
    lines.push(line);
  }
  // 截断：已达上限时丢余段；第 maxLines 行保证自身不超宽（逐字累加天然保证）
  const capped = lines.slice(0, SUBTITLE_SPEC.maxLines);
  return { lines: capped, lineHeight: Math.round(style.fontSize * 1.4), fontSize: style.fontSize };
}
