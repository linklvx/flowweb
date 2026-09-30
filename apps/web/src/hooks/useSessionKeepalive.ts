import { useEffect } from 'react';

export const SESSION_KEEPALIVE_MS = 15 * 60 * 1000;

/** 批3-3 F8：画布页 15min 静默探活 /api/auth/me——服务端 SessionService.touch 顺带续期近过期
 *  session（expiresAt 顺延 7d）+ /me 重发 cookie（滑动 maxAge）；WS 路径无法续 cookie，全靠此探活。
 *  setInterval.unref 的浏览器等价物：document.hidden 跳过（页面不可见不产生流量）；卸载清。 */
export function useSessionKeepalive() {
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      void fetch('/api/auth/me', { credentials: 'include' }).catch(() => {});   // 静默探活：失败不炸不提示
    }, SESSION_KEEPALIVE_MS);
    return () => clearInterval(timer);
  }, []);
}
