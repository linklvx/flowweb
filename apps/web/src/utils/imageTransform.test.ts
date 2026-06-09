import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Canvas API before importing the module
const mocks = vi.hoisted(() => {
  const mockCtx = {
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
  };

  const mockCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => mockCtx),
    toBlob: vi.fn((cb: (b: Blob | null) => void) => {
      setTimeout(() => cb(new Blob(['test'], { type: 'image/png' })), 0);
    }),
  };

  const mockImage = {
    crossOrigin: '',
    onload: null as (() => void) | null,
    onerror: null as (() => void) | null,
    src: '',
    width: 0,
    height: 0,
  };

  return { mockCtx, mockCanvas, mockImage };
});

vi.stubGlobal('Image', vi.fn(() => mocks.mockImage));
vi.stubGlobal('document', {
  ...document,
  createElement: vi.fn((tag: string) => {
    if (tag === 'canvas') return mocks.mockCanvas as any;
    return null;
  }),
});

import { transformImage } from './imageTransform';

describe('transformImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves with a Blob when image loads successfully', async () => {
    const result = transformImage('http://example.com/image.png', 0, false, false);
    // Trigger onload
    mocks.mockImage.width = 800;
    mocks.mockImage.height = 600;
    mocks.mockImage.onload?.();
    const blob = await result;
    expect(blob).toBeInstanceOf(Blob);
  });

  it('sets crossOrigin to anonymous on the image', async () => {
    const promise = transformImage('http://example.com/image.png', 0, false, false);
    expect(mocks.mockImage.crossOrigin).toBe('anonymous');
    mocks.mockImage.onload?.();
    await promise;
  });

  it('passes the correct URL to image src', async () => {
    const promise = transformImage('http://example.com/test.png', 0, false, false);
    expect(mocks.mockImage.src).toBe('http://example.com/test.png');
    mocks.mockImage.onload?.();
    await promise;
  });

  it('rejects when image fails to load', async () => {
    const promise = transformImage('http://example.com/broken.png', 0, false, false);
    mocks.mockImage.onerror?.();
    await expect(promise).rejects.toThrow('图片加载失败');
  });

  it('sets canvas dimensions correctly for 0° rotation (no swap)', () => {
    const promise = transformImage('http://example.com/img.png', 0, false, false);
    mocks.mockImage.width = 800;
    mocks.mockImage.height = 600;
    mocks.mockImage.onload?.();
    // canvas width/height unchanged for 0°
    expect(mocks.mockCanvas.width).toBe(800);
    expect(mocks.mockCanvas.height).toBe(600);
    return promise;
  });

  it('swaps canvas dimensions for 90° rotation', () => {
    const promise = transformImage('http://example.com/img.png', 90, false, false);
    mocks.mockImage.width = 800;
    mocks.mockImage.height = 600;
    mocks.mockImage.onload?.();
    expect(mocks.mockCanvas.width).toBe(600);
    expect(mocks.mockCanvas.height).toBe(800);
    return promise;
  });

  it('swaps canvas dimensions for 270° rotation', () => {
    const promise = transformImage('http://example.com/img.png', 270, false, false);
    mocks.mockImage.width = 800;
    mocks.mockImage.height = 600;
    mocks.mockImage.onload?.();
    expect(mocks.mockCanvas.width).toBe(600);
    expect(mocks.mockCanvas.height).toBe(800);
    return promise;
  });

  it('does not swap canvas dimensions for 180° rotation', () => {
    const promise = transformImage('http://example.com/img.png', 180, false, false);
    mocks.mockImage.width = 800;
    mocks.mockImage.height = 600;
    mocks.mockImage.onload?.();
    expect(mocks.mockCanvas.width).toBe(800);
    expect(mocks.mockCanvas.height).toBe(600);
    return promise;
  });

  it('applies correct canvas transform sequence', () => {
    const promise = transformImage('http://example.com/img.png', 90, true, true);
    mocks.mockImage.width = 400;
    mocks.mockImage.height = 300;
    mocks.mockImage.onload?.();

    const ctx = mocks.mockCtx;
    // Translate to center: (300/2, 400/2) = (150, 200) for 90° rotated
    const translateCall = ctx.translate.mock.calls[0];
    expect(translateCall[0]).toBe(150); // canvasWidth / 2 = 300 / 2
    expect(translateCall[1]).toBe(200); // canvasHeight / 2 = 400 / 2

    // Rotate
    expect(ctx.rotate).toHaveBeenCalledWith((90 * Math.PI) / 180);

    // Scale (flip)
    expect(ctx.scale).toHaveBeenCalledWith(-1, -1);

    // Must translate before rotate
    const translateIdx = ctx.translate.mock.invocationCallOrder[0];
    const rotateIdx = ctx.rotate.mock.invocationCallOrder[0];
    const scaleIdx = ctx.scale.mock.invocationCallOrder[0];
    const drawIdx = ctx.drawImage.mock.invocationCallOrder[0];
    expect(translateIdx).toBeLessThan(rotateIdx);
    expect(rotateIdx).toBeLessThan(scaleIdx);
    expect(scaleIdx).toBeLessThan(drawIdx);

    return promise;
  });

  it('scales down images larger than maxSize', () => {
    const promise = transformImage('http://example.com/large.png', 0, false, false, 1024);
    mocks.mockImage.width = 4096;
    mocks.mockImage.height = 2048;
    mocks.mockImage.onload?.();
    // Both dimensions should be ≤ 1024
    expect(mocks.mockCanvas.width).toBeLessThanOrEqual(1024);
    expect(mocks.mockCanvas.height).toBeLessThanOrEqual(1024);
    return promise;
  });

  it('outputs image/webp Blob with quality 0.92', async () => {
    const promise = transformImage('http://example.com/img.png', 0, false, false);
    mocks.mockImage.width = 800;
    mocks.mockImage.height = 600;
    mocks.mockImage.onload?.();
    await promise;
    expect(mocks.mockCanvas.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/webp',
      0.92,
    );
  });

  it('outputs image/webp when rotation and flip are applied', async () => {
    const promise = transformImage('http://example.com/img.png', 90, true, true);
    mocks.mockImage.width = 800;
    mocks.mockImage.height = 600;
    mocks.mockImage.onload?.();
    await promise;
    expect(mocks.mockCanvas.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/webp',
      0.92,
    );
  });

  it('clears image src and canvas dimensions after toBlob', async () => {
    const promise = transformImage('http://example.com/img.png', 0, false, false);
    mocks.mockImage.width = 800;
    mocks.mockImage.height = 600;
    mocks.mockImage.onload?.();
    await promise;
    expect(mocks.mockImage.src).toBe('');
    expect(mocks.mockCanvas.width).toBe(0);
    expect(mocks.mockCanvas.height).toBe(0);
  });
});
