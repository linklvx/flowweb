import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const mockCtx = { drawImage: vi.fn() };
  const mockCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => mockCtx),
    toBlob: vi.fn((cb: (b: Blob | null) => void) => {
      setTimeout(() => cb(new Blob(['cropped'], { type: 'image/webp' })), 0);
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

import { cropImage } from './imageCrop';

describe('cropImage', () => {
  it('resolves with a Blob on successful crop', async () => {
    const promise = cropImage('http://example.com/img.png', { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, 2048);
    mocks.mockImage.width = 1000;
    mocks.mockImage.height = 800;
    mocks.mockImage.onload?.();
    const blob = await promise;
    expect(blob).toBeInstanceOf(Blob);
  });

  it('sets crop canvas to correct dimensions', () => {
    const promise = cropImage('http://example.com/img.png', { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, 2048);
    mocks.mockImage.width = 1000;
    mocks.mockImage.height = 800;
    mocks.mockImage.onload?.();
    expect(mocks.mockCanvas.width).toBe(800);
    expect(mocks.mockCanvas.height).toBe(640);
    return promise;
  });

  it('scales down if crop exceeds maxSize', () => {
    const promise = cropImage('http://example.com/img.png', { x: 0, y: 0, width: 1, height: 1 }, 500);
    mocks.mockImage.width = 2000;
    mocks.mockImage.height = 1000;
    mocks.mockImage.onload?.();
    expect(mocks.mockCanvas.width).toBeLessThanOrEqual(500);
    expect(mocks.mockCanvas.height).toBeLessThanOrEqual(500);
    return promise;
  });

  it('outputs image/webp with quality 0.92', async () => {
    const promise = cropImage('http://example.com/img.png', { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }, 2048);
    mocks.mockImage.width = 800;
    mocks.mockImage.height = 600;
    mocks.mockImage.onload?.();
    await promise;
    expect(mocks.mockCanvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.92);
  });

  it('rejects on image load error', async () => {
    const promise = cropImage('http://example.com/broken.png', { x: 0, y: 0, width: 0.5, height: 0.5 }, 2048);
    mocks.mockImage.onerror?.();
    await expect(promise).rejects.toThrow('图片加载失败');
  });
});
