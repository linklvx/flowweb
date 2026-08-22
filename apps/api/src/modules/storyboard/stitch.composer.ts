// stitch.composer.ts — 纯合成函数（sharp 注入行为由调用方决定）
import sharp from 'sharp';

export interface ComposeParams {
  images: (Buffer | null)[]; // 有序；null = 空格/失败格
  cellWidth: number;
  cellHeight: number;
  rows: number;
  cols: number;
  gap: number;
  showIndex: boolean;
  indexFontSize?: number;
}

export async function composeStoryboard(p: ComposeParams): Promise<Buffer> {
  const { rows, cols, gap, cellWidth, cellHeight } = p;
  const width = cols * cellWidth + (cols - 1) * gap;
  const height = rows * cellHeight + (rows - 1) * gap;

  const layers: { input: Buffer; left: number; top: number }[] = [];
  for (let i = 0; i < rows * cols; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const left = col * (cellWidth + gap);
    const top = row * (cellHeight + gap);
    const img = p.images[i];
    if (img) {
      layers.push({
        input: await sharp(img).resize(cellWidth, cellHeight, { fit: 'cover' }).toBuffer(),
        left,
        top,
      });
    } else {
      layers.push({
        input: Buffer.from(
          `<svg width="${cellWidth}" height="${cellHeight}"><rect width="100%" height="100%" fill="#333333"/></svg>`
        ),
        left,
        top,
      });
    }
    if (p.showIndex && img) {
      const fs = p.indexFontSize ?? Math.round(cellWidth * 0.05);
      const pad = Math.round(cellWidth * 0.037);
      layers.push({
        input: Buffer.from(
          `<svg width="${cellWidth}" height="${cellHeight}"><text x="${pad}" y="${cellHeight - Math.round(pad * 0.8)}" fill="#ffffff" font-size="${fs}" font-weight="600" font-family="sans-serif">${String(i + 1).padStart(2, '0')}</text></svg>`
        ),
        left,
        top,
      });
    }
  }
  // Create main canvas with background color using SVG
  const canvasSvg = `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#1a1a1a"/></svg>`;
  return sharp(Buffer.from(canvasSvg))
    .composite(layers)
    .jpeg({ quality: 92 })
    .toBuffer();
}
