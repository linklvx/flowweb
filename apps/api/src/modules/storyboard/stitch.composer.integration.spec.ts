import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { composeStoryboard } from './stitch.composer';

async function fixture(color: string) {
  const svg = `<svg width="60" height="40"><rect width="100%" height="100%" fill="${color}"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

describe('composeStoryboard 集成（真实 sharp）', () => {
  it('2x2 三图一空 → 输出 JPEG 尺寸正确', async () => {
    const images = [
      await fixture('#ff0000'),
      await fixture('#00ff00'),
      await fixture('#0000ff'),
      null,
    ];
    const out = await composeStoryboard({
      images,
      cellWidth: 120,
      cellHeight: 68,
      rows: 2,
      cols: 2,
      gap: 2,
      showIndex: true,
    });
    expect(out.length).toBeGreaterThan(0);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(2 * 120 + 2);
    expect(meta.height).toBe(2 * 68 + 2);
    expect(meta.format).toBe('jpeg');
  });
});
