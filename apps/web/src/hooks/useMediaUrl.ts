import { useState, useEffect } from 'react';
import { getCachedUrl, fetchMediaUrl, currentMediaUserId } from '@/utils/mediaUrlCache';

export function useMediaUrl(fileId: string | null | undefined): {
  url: string | null;
  loading: boolean;
  error: Error | null;
} {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const uid = currentMediaUserId();   // v4：渲染期读身份进 deps——身份切换时 effect 重评估
                                    //（现状 RequireAuth 登出即卸载子树，此 dep 是防未来 context 直连场景的契约钉）

  useEffect(() => {
    if (!fileId) {
      setUrl(null); setLoading(false); setError(null);
      return;
    }
    const hit = getCachedUrl(fileId);
    if (hit) {
      setUrl(hit.url); setLoading(false); setError(null);
      return;
    }
    let cancelled = false;                        // 竞态保护：fileId 快速切换时旧响应不覆盖新状态
    setLoading(true); setError(null);
    fetchMediaUrl(fileId)
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err : new Error(String(err))); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fileId, uid]);

  return { url, loading, error };
}
