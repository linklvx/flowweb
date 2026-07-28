import { useState } from 'react';

export interface WeChatQRLoginProps {
  qrCodeUrl?: string;
  expired?: boolean;
  onRefresh?: () => void;
  onAlternativeLogin?: () => void;
  className?: string;
}

export function WeChatQRLogin({
  qrCodeUrl,
  expired = false,
  onRefresh,
  onAlternativeLogin,
  className = '',
}: WeChatQRLoginProps) {
  const [qrLoadFailed, setQrLoadFailed] = useState(false);

  const hasQrUrl = !!qrCodeUrl;
  const showLoadFailed = hasQrUrl && qrLoadFailed;
  const showExpired = hasQrUrl && !qrLoadFailed && expired;
  const showPlaceholder = !hasQrUrl || showLoadFailed || showExpired;

  const handleRetry = () => {
    setQrLoadFailed(false);
    onRefresh?.();
  };

  const getPlaceholderContent = () => {
    if (showLoadFailed) {
      return (
        <div
          role="button"
          tabIndex={0}
          aria-label="重新加载二维码"
          className="w-[135px] h-[135px] rounded-[4px] bg-[#F8F8F8] flex items-center justify-center cursor-pointer text-[12px] text-[#787878]"
          onClick={handleRetry}
        >
          加载失败，点击重试
        </div>
      );
    }
    if (showExpired) {
      return (
        <div className="relative w-[135px] h-[135px] rounded-[4px] overflow-hidden">
          <img
            src={qrCodeUrl}
            alt="微信扫码登录二维码"
            className="w-[135px] h-[135px] rounded-[4px]"
          />
          <div
            role="button"
            tabIndex={0}
            aria-label="重新加载二维码"
            className="absolute inset-0 bg-black/60 rounded-[4px] flex items-center justify-center cursor-pointer text-[12px] text-white text-center leading-[18px]"
            onClick={handleRetry}
          >
            二维码已过期
            <br />
            点击刷新
          </div>
        </div>
      );
    }
    if (!hasQrUrl) {
      return (
        <div className="w-[135px] h-[135px] rounded-[4px] bg-[#F8F8F8] flex items-center justify-center text-[12px] text-[#787878]">
          二维码加载中
        </div>
      );
    }
    return null;
  };

  return (
    <div
      className={`w-[320px] flex flex-col items-center justify-start ${className}`}
    >
      <div className="flex flex-col items-center flex-shrink-0 text-center">
        <div className="text-[16px] font-semibold text-[#141414] mb-6 z-[1]">
          微信扫码登录
        </div>

        <div className="relative mb-0 mx-0">
          <div className="w-[145px] h-[145px] rounded-[8px] bg-[#F8F8F8] flex justify-center items-center">
            {showPlaceholder ? (
              getPlaceholderContent()
            ) : (
              <img
                src={qrCodeUrl}
                alt="微信扫码登录二维码"
                className="w-[135px] h-[135px] rounded-[4px]"
                onError={() => setQrLoadFailed(true)}
              />
            )}
          </div>
        </div>

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
