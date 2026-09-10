/** 媒体 blob 共享缓存（R2 A3 后服务音频解码与图片 ImageBitmap——视频取帧改 UrlSource 直连不经此，决策 1/13）；
 *  上限 8 个 LRU 淘汰（音频 PCM 与图片通常远小于视频，按个数上限一期够用） */
const cache = new Map<string, Promise<Blob>>();

export async function getMediaBlob(mediaId: string, url: string): Promise<Blob | null> {
  const hit = cache.get(mediaId);
  if (hit) {
    cache.delete(mediaId); cache.set(mediaId, hit); // LRU 触尾
    try { return await hit; } catch { cache.delete(mediaId); return null; }
  }
  const p = fetch(url).then(r => (r.ok ? r.blob() : Promise.reject(new Error(`fetch ${r.status}`))));
  cache.set(mediaId, p);
  if (cache.size > 8) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
  }
  try { return await p; } catch { cache.delete(mediaId); return null; }
}

export function resolveMediaBlob(mediaId: string, url: string | undefined): Promise<Blob | null> {
  return url ? getMediaBlob(mediaId, url) : Promise.resolve(null);
}

export function clearMediaBlobs(): void { cache.clear(); }
