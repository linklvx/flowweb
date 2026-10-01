import { useState, useEffect, useRef, useCallback } from 'react';
import { getCachedUrl, fetchMediaUrl, invalidateMediaUrl, currentMediaUserId } from '@/utils/mediaUrlCache';

export function useMediaUrl(fileId: string | null | undefined): {
  url: string | null;
  loading: boolean;
  error: Error | null;
  onError: (event?: unknown) => void;
} {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const uid = currentMediaUserId();   // v4：渲染期读身份进 deps——身份切换时 effect 重评估
                                    //（现状 RequireAuth 登出即卸载子树，此 dep 是防未来 context 直连场景的契约钉）
  // R2b-5：per-fileId 一次性重试门（≠ PlayView 元素级 retriedRef——那个不清缓存，重取拿回同一条坏 URL）
  const retriedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!fileId) {
      setUrl(null); setLoading(false); setError(null);
      return;
    }
    const hit = getCachedUrl(fileId);
    if (hit) {
      setUrl(hit.url); setLoading(false); setError(null);
      if (!hit.stale) return;
      // R2b-5 临期档（第一入口，挂载时余寿不足）：立即回旧 url + 后台预刷新。
      // 随机 0-5s 延迟去同步批量瓦片重签；触发时复查合并并发挂载（已被刷新→直接采用，0 请求）。
      let cancelled = false;
      const timer = setTimeout(() => {
        const cur = getCachedUrl(fileId);
        if (!cur) return;                       // 条目已被 invalidate → onError 自愈接管
        if (!cur.stale) {                       // 已被其它挂载的预刷新更新 → 直接采用，免重复取
          if (!cancelled) setUrl(cur.url);
          return;
        }
        fetchMediaUrl(fileId)
          .then((u) => { if (!cancelled) setUrl(u); })
          .catch(() => { /* 后台预刷新失败静默：旧 url 仍在展示，真死亡由 onError 自愈兜底 */ });
      }, Math.random() * 5000);
      return () => { cancelled = true; clearTimeout(timer); };
    }
    let cancelled = false;                        // 竞态保护：fileId 快速切换时旧响应不覆盖新状态
    setLoading(true); setError(null);
    fetchMediaUrl(fileId)
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err : new Error(String(err))); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fileId, uid]);

  // R2b-5 onError 失效自愈（第二入口，驻留节点 URL 事后死亡）：<img>/<video>/<audio> onError 直通
  const onError = useCallback((_event?: unknown) => {
    if (!fileId) return;
    invalidateMediaUrl(fileId);                     // cache+pending 同清（只清 cache 会被去重短路拿回坏 URL）
    if (retriedRef.current.has(fileId)) return;     // 一次性重试门：第二次 onError 不再重试
    retriedRef.current.add(fileId);
    setUrl(null); setError(null); setLoading(true); // url=null 走占位（禁空串 src）；error 仅表"取 URL 失败"，自愈启动即清
    fetchMediaUrl(fileId)
      .then((u) => { setUrl(u); setError(null); })  // 重取成功：error 保持空
      .catch((err) => { setError(err instanceof Error ? err : new Error(String(err))); })  // 重取失败走 error 路径，不再重试
      .finally(() => setLoading(false));
  }, [fileId]);

  return { url, loading, error, onError };
}
