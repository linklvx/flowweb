/** ImageBitmap 缓存（图片片一次解码多次绘制，spec 第六节） */
const cache = new Map<string, Promise<ImageBitmap | null>>();

export function getImageBitmap(mediaId: string, blob: Blob): Promise<ImageBitmap | null> {
  let p = cache.get(mediaId);
  if (!p) {
    p = createImageBitmap(blob).catch(() => null);
    cache.set(mediaId, p);
  }
  return p;
}

export function clearImageBitmaps(): void { cache.clear(); }
