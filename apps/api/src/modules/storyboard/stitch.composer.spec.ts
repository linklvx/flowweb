import { describe, it, expect, vi, beforeEach } from 'vitest';
import { composeStoryboard } from './stitch.composer';

vi.mock('sharp', () => {
  const resize = vi.fn().mockReturnThis();
  const toBufferCell = vi.fn().mockResolvedValue(Buffer.from('cell'));
  const toBufferOut = vi.fn().mockResolvedValue(Buffer.from('out'));
  const composite = vi.fn().mockReturnThis();
  const jpeg = vi.fn().mockReturnThis();

  // Image processing chain (when called with Buffer)
  const imgChain = { resize, toBuffer: toBufferCell };

  // Main canvas chain (when called with SVG Buffer)
  const canvasChain = { composite, jpeg, toBuffer: toBufferOut };

  const mod = vi.fn((input) => {
    // All calls use Buffer now (images are JPEG buffers, canvas is SVG buffer)
    // We distinguish by checking if it looks like SVG
    if (Buffer.isBuffer(input) && input.toString().startsWith('<svg')) {
      return canvasChain;
    }
    return imgChain;
  });

  return { default: mod };
});

describe('composeStoryboard 调用参数（spec 7.2）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('每格 cover 裁剪到单格尺寸、图片按序、缝隙 2px', async () => {
    const sharp = (await import('sharp')).default as any;
    sharp.mockClear();
    await composeStoryboard({
      images: [Buffer.from('a'), Buffer.from('b')],
      cellWidth: 1000,
      cellHeight: 562,
      rows: 1,
      cols: 2,
      gap: 2,
      showIndex: false,
    });
    // 2 images + 1 canvas = 3 calls
    expect(sharp).toHaveBeenCalledTimes(3);
    // resize(cover) 每格一次 (前两次调用是图片处理)
    expect(sharp.mock.calls[0][0]).toEqual(Buffer.from('a'));
    expect(sharp.mock.results[0].value.resize).toHaveBeenCalledWith(1000, 562, { fit: 'cover' });
    expect(sharp.mock.calls[1][0]).toEqual(Buffer.from('b'));
    expect(sharp.mock.results[1].value.resize).toHaveBeenCalledWith(1000, 562, { fit: 'cover' });
    // 最后一次是画布创建
    expect(typeof sharp.mock.calls[2][0]).toBe('object');
  });

  it('主画布 composite 布局坐标正确（2px 缝）', async () => {
    const sharp = (await import('sharp')).default as any;
    await composeStoryboard({
      images: [Buffer.from('a'), Buffer.from('b'), Buffer.from('c'), null],
      cellWidth: 100,
      cellHeight: 50,
      rows: 2,
      cols: 2,
      gap: 2,
      showIndex: false,
    });
    // Last call should be canvas creation with SVG
    const canvasCall = sharp.mock.calls[sharp.mock.calls.length - 1][0];
    expect(canvasCall.toString()).toContain('<svg');
    expect(canvasCall.toString()).toContain('width="202"'); // 2*100+2
    expect(canvasCall.toString()).toContain('height="102"'); // 2*50+2
    expect(canvasCall.toString()).toContain('fill="#1a1a1a"');
    const positions = sharp.mock.results[sharp.mock.results.length - 1].value.composite.mock.calls[0][0].map((c: any) => [c.left, c.top]);
    expect(positions).toContainEqual([102, 0]); // 第二列 x = 100+2
  });

  it('showIndex → 序号 SVG composite 左下角', async () => {
    const sharp = (await import('sharp')).default as any;
    await composeStoryboard({
      images: [Buffer.from('a')],
      cellWidth: 100,
      cellHeight: 50,
      rows: 1,
      cols: 1,
      gap: 2,
      showIndex: true,
      indexFontSize: 16,
    });
    const canvasResult = sharp.mock.results[sharp.mock.results.length - 1];
    const layers = canvasResult.value.composite.mock.calls[0][0];
    const layer = layers.find((c: any) => String(c.input).includes('01'));
    expect(layer).toBeTruthy();
  });

  it('空格 → #333 占位格', async () => {
    const sharp = (await import('sharp')).default as any;
    await composeStoryboard({
      images: [null],
      cellWidth: 100,
      cellHeight: 50,
      rows: 1,
      cols: 1,
      gap: 2,
      showIndex: false,
    });
    const canvasResult = sharp.mock.results[sharp.mock.results.length - 1];
    const layers = canvasResult.value.composite.mock.calls[0][0];
    const layer = layers.find((c: any) => String(c.input).includes('#333333'));
    expect(layer).toBeTruthy();
  });
});
