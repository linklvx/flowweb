import { getMediaUrl } from '@/api/mediaApi';

// ── 媒体 URL 模块级缓存（spec §4.5 v10 裁决 6；R0c 提前落地，R2b 只剩 mediaUrl 读写收敛+门禁）──
// 键 `${userId}:${fileId}`：服务端鉴权 per-user，fileId-only 会跨账号串图。
// userId 由 AuthProvider 渲染期写入（本模块零 React 订阅——每个媒体消费点不背 auth context 重渲染面）。
let currentUserId: string | null = null;
const CACHE_LIMIT = 64;
const cache = new Map<string, { url: string; expiresAt: number }>();  // Map 迭代序=插入序，首键即最旧 → LRU
const pending = new Map<string, Promise<string>>();
// R2b-5：临期窗口——剩余寿命 <= 60s 视为 stale（命中即回旧 url + 后台预刷新）。
// 与 onError 失效重取构成自愈双入口分工：临期管挂载时余寿不足，onError 管驻留节点 URL 事后死亡（plan 注记 8）。
export const NEAR_EXPIRY_MS = 60_000;

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

function cacheGet(key: string): { url: string; stale: boolean } | null {
  const hit = cache.get(key);
  if (!hit) return null;
  // isFinite 防御：非法 expiresAt 视同过期（NaN 与任何比较恒 false → 会永久误判 fresh，永不重取的最阴险失败）
  if (!Number.isFinite(hit.expiresAt) || hit.expiresAt <= Date.now()) {
    cache.delete(key); return null;   // 已过期（<=now）：未命中 + 删条目（现状语义维持）
  }
  // 此分支必有 expiresAt > now：now < expiresAt <= now+NEAR_EXPIRY_MS 即临期档
  const stale = hit.expiresAt <= Date.now() + NEAR_EXPIRY_MS;
  // LRU touch：删后重插，把该条挪到"最新"端
  cache.delete(key); cache.set(key, hit);
  return { url: hit.url, stale };
}

/** hook 渲染层命中查询（v5：cacheKey/cacheGet 保持私有——收进缓存层封装，hook 不碰缓存内部结构） */
export function getCachedUrl(fileId: string): { url: string; stale: boolean } | null {
  return cacheGet(cacheKey(fileId));
}

// R2b-5：onError 失效自愈入口——cache+pending 必须同清：只清 cache 会被 in-flight 去重
// 短路拿回同一条坏 URL（plan MUST-RED 注记）
export function invalidateMediaUrl(fileId: string) {
  const key = cacheKey(fileId);
  cache.delete(key);
  pending.delete(key);
}

function cacheSet(key: string, url: string, ttlSec: number) {
  // isFinite 兜底（R2b-5 收敛到唯一写点）：缺失/NaN 按 0=立即过期（NaN 与任何比较恒假 → 永不重取）
  const ttl = Number.isFinite(ttlSec) ? ttlSec : 0;
  cache.set(key, { url, expiresAt: Date.now() + ttl * 1000 });
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
  const p: Promise<string> = getMediaUrl(fileId)
    .then((res) => {
      // R2b-5 身份校验：在飞期间被 invalidateMediaUrl → 结果作废不写缓存——
      // 否则坏 URL 带旧 expiresAt 复活，onError 重取必然再失败
      if (pending.get(key) !== p) return res.url;
      cacheSet(key, res.url, res.ttlSec);
      return res.url;
    })
    .finally(() => {
      // 同理只删自己的去重位：不得误删 invalidate 后新发起请求的继任条目
      if (pending.get(key) === p) pending.delete(key);
    });
  pending.set(key, p);
  return p;
}
