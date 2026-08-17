import { useEffect, useId, useState } from 'react';

declare global {
  interface Window {
    WxLogin?: (options: WechatLoginOptions) => void;
  }
}

interface WechatLoginOptions {
  self_redirect?: boolean;
  id: string;
  appid: string;
  scope: string;
  redirect_uri: string;
  state?: string;
  style?: string;
}

const WX_LOGIN_SCRIPT = 'https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js';
const WX_CALLBACK = 'https://www.flow123.com/api/auth/wechat/callback';

export interface WeChatQRLoginProps {
  onAlternativeLogin?: () => void;
  className?: string;
}

export function WeChatQRLogin({
  onAlternativeLogin,
  className = '',
}: WeChatQRLoginProps) {
  const containerId = `wechat-qr-${useId().replace(/:/g, '')}`;
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const res = await fetch('/api/auth/wechat/config');
        const data = await res.json();
        if (cancelled) return;

        if (!window.WxLogin) {
          await loadScript(WX_LOGIN_SCRIPT, 5000);
        }
        if (cancelled) return;

        window.WxLogin?.({
          self_redirect: false,
          id: containerId,
          appid: data.appid,
          scope: 'snsapi_login',
          redirect_uri: encodeURIComponent(WX_CALLBACK),
          state: Math.random().toString(36).slice(2),
        });
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [containerId]);

  return (
    <div className={`w-[320px] flex flex-col items-center justify-start ${className}`}>
      <div className="flex flex-col items-center flex-shrink-0 text-center">
        <div className="text-[16px] font-semibold text-[#141414] mb-6 z-[1]">
          微信扫码登录
        </div>

        {loadFailed ? (
          <div className="w-[300px] h-[300px] flex items-center justify-center text-[12px] text-[#787878]">
            微信登录暂时不可用，请使用邮箱登录
          </div>
        ) : (
          <div id={containerId} className="w-[300px] h-[400px]" />
        )}

        <div className="w-[145px] text-center text-[12px] mt-3 text-[#787878] select-none">
          使用微信扫码快捷登录
        </div>
      </div>

      <div className="flex items-center justify-center gap-x-3 text-[12px] text-[#ADADAD] mt-[17px] w-[196px]">
        <span className="flex-1 h-[1px] bg-[rgba(0,0,0,0.1)]" />
        <span>或</span>
        <span className="flex-1 h-[1px] bg-[rgba(0,0,0,0.1)]" />
      </div>

      <button
        type="button"
        className="mt-[17px] w-[196px] h-[40px] rounded-[8px] border border-[rgba(0,0,0,0.1)] bg-[#FFF] text-[#929292] text-[14px] cursor-pointer hover:border-[#4893FF] hover:!text-[#4893FF] transition-colors"
        onClick={() => onAlternativeLogin?.()}
      >
        邮箱登录
      </button>
    </div>
  );
}

function loadScript(src: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (window.WxLogin) return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('script load failed')));
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    const timer = setTimeout(() => reject(new Error('script timeout')), timeoutMs);
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('script load failed'));
    };
    document.body.appendChild(script);
  });
}
