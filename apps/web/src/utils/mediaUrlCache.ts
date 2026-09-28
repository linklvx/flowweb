import { getMediaUrl } from '@/api/mediaApi';

// ── 媒体 URL 模块级缓存（spec §4.5 v10 裁决 6；R0c 提前落地，R2b 只剩 mediaUrl 读写收敛+门禁）──
// 键 `${userId}:${fileId}`：服务端鉴权 per-user，fileId-only 会跨账号串图。
// userId 由 AuthProvider 渲染期写入（本模块零 React 订阅——每个媒体消费点不背 auth context 重渲染面）。
let currentUserId: string | null = null;
const CACHE_LIMIT = 64;
const cache = new Map<string, { url: string; expiresAt: number }>();  // Map 迭代序=插入序，首键即最旧 → LRU
const pending = new Map<string, Promise<string>>();

export function setMediaCacheUserId(userId: string | null) { currentUserId = userId; }
export function clearMediaUrlCache() {
  // v4/v5：语义=登出用——只清 cache、pending 保留（在飞请求完成后 .finally 按 key 精确删除；键有 userId 前缀，
  // 登出瞬间在飞的完成最多写一条旧用户键——且只写回自己发起时的键（闭包捕获，见 fetchMediaUrl），
  // 危害是内存不是串号，会被 LRU/过期自然淘汰。
  // 注意与 __resetMediaCacheForTests（测试隔离：cache+pending 都清）语义不同，勿混用。
  cache.clear();
}

// 测试钩子（仅测试文件 import；命名前缀 __ 表意）
export const __setUserIdForTests = setMediaCacheUserId;
export const __resetMediaCacheForTests = () => { cache.clear(); pending.clear(); };
export const __getCacheSizeForTests = () => cache.size;
export const __cachePutForTests = (fileId: string, url: string, ttlSec: number) =>
  cacheSet(cacheKey(fileId), url, ttlSec);  // v4：LRU 淘汰纯函数测点——65 次 renderHook 降为 0（快且不脆）

const cacheKey = (fileId: string) => `${currentUserId ?? ''}:${fileId}`;

export function currentMediaUserId() { return currentUserId; }  // v4：hook deps 身份跟随用

function cacheGet(key: string): { url: string } | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) { cache.delete(key); return null; }
  // LRU touch：删后重插，把该条挪到"最新"端
  cache.delete(key); cache.set(key, hit);
  return hit;
}

/** hook 渲染层命中查询（v5：cacheKey/cacheGet 保持私有——收进缓存层封装，hook 不碰缓存内部结构） */
export function getCachedUrl(fileId: string): { url: string } | null {
  return cacheGet(cacheKey(fileId));
}

function cacheSet(key: string, url: string, ttlSec: number) {
  cache.set(key, { url, expiresAt: Date.now() + ttlSec * 1000 });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
  }
}

export function fetchMediaUrl(fileId: string): Promise<string> {
  // v4：鉴权身份未就绪时直取不入缓存——防 ":fileId" 孤儿键（AuthProvider 渲染期写入通常已就绪，
  // 此条是防未来在 AuthProvider 之外消费的兜底；该窗口内的请求不做 in-flight 共享，语义一致）
  if (currentUserId === null) {
    return getMediaUrl(fileId).then((r) => r.url);
  }
  const key = cacheKey(fileId);   // 必须在发起时捕获（v5 契约）：登出/换号后在飞响应只能写回自己的键——
                                   // 若改成"调用时刻重算"，A 的响应会写进 B 的键（useMediaUrl.test 跨换号用例锁死）
  const existing = pending.get(key);              // in-flight 去重：并发挂载共享单请求
  if (existing) return existing;
  const p = getMediaUrl(fileId)
    .then((res) => {
      const ttl = Number.isFinite(res.ttlSec) ? res.ttlSec : 0;  // isFinite 兜底：缺失按 0=立即过期（防 NaN 恒假永不重取）
      cacheSet(key, res.url, ttl);
      return res.url;
    })
    .finally(() => { pending.delete(key); });
  pending.set(key, p);
  return p;
}
