import { useState, useEffect, useCallback } from 'react';
import { Input, Button } from 'antd';
import { useAuth } from '@/components/AuthProvider';

export interface PhoneLoginFormProps {
  onLogin?: (phone: string, code: string) => void;
  /** 登录成功回调 — 由父组件导航/关闭弹窗 */
  onLoginSuccess?: () => void;
  /** 错误回调 — (错误码, 人类可读消息)，替代 __ERROR__: 字符串拼接 */
  onError?: (code: string, message: string) => void;
  loading?: boolean;
  errorMsg?: string;
  className?: string;
}

const COUNTDOWN_SECONDS = 60;

export function PhoneLoginForm({
  onLogin = () => {},
  onLoginSuccess,
  onError,
  loading = false,
  errorMsg = '',
  className = '',
}: PhoneLoginFormProps) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);

  const { refresh } = useAuth();

  const handleGetCode = useCallback(async () => {
    if (countdown > 0 || phone.length !== 11) return;
    if (!/^1[3-9]\d{9}$/.test(phone)) return;

    try {
      const res = await fetch('/api/auth/send-sms-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();

      if (res.ok) {
        setCountdown(COUNTDOWN_SECONDS);
      } else {
        onError?.(data.code || 'SEND_FAILED', data.error || '发送失败');
      }
    } catch {
      onError?.('NETWORK', '网络错误，请重试');
    }
  }, [countdown, phone, onError]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleLogin = async () => {
    if (!phone || !code) return;

    try {
      const res = await fetch('/api/auth/phone-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json();

      if (res.ok) {
        await refresh();
        onLoginSuccess?.();
      } else {
        onError?.(data.code || 'LOGIN_FAILED', data.error || '登录失败');
      }
    } catch {
      onError?.('NETWORK', '网络错误，请重试');
    }
  };

  return (
    <div className={`relative flex-1 ${className}`}>
      <div className="text-[16px] font-semibold text-[#141414] text-center z-[1]">
        手机号登录
      </div>

      {/* Phone input */}
      <div className="relative mt-6 w-[320px]">
        <div className="absolute left-0 top-0 bottom-0 w-[82px] flex items-center justify-center border-r border-[rgba(13,13,13,0.2)] z-10">
          <span className="text-[15px] text-[#000]">+86</span>
        </div>
        <Input
          variant="borderless"
          maxLength={11}
          placeholder="请输入手机号"
          aria-label="手机号"
          inputMode="numeric"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="bg-[#F8F8F8] rounded-[8px] h-[48px] text-[15px] text-[#000] placeholder-[#999]"
          style={{ paddingLeft: 82 }}
        />
      </div>

      {/* Code input */}
      <div className="relative mt-4 w-[320px]">
        <Input
          variant="borderless"
          maxLength={6}
          placeholder="请输入验证码"
          aria-label="验证码"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="bg-[#F8F8F8] rounded-[8px] h-[48px] text-[15px] text-[#333] placeholder-[#999]"
          style={{ paddingLeft: 20, paddingRight: 130 }}
        />
        <Button
          type="text"
          disabled={countdown > 0}
          aria-label="获取验证码"
          onClick={handleGetCode}
          className="!absolute right-[3px] top-1/2 -translate-y-1/2 h-[40px] w-[94px] rounded-[8px] bg-[#FFF] hover:!bg-[#FFF] hover:!text-[#1F6DFF] text-[#1F6DFF] text-[14px] disabled:text-[#888] disabled:cursor-not-allowed"
        >
          {countdown > 0 ? `${countdown}s后重试` : '获取验证码'}
        </Button>
      </div>

      {/* Error line */}
      <div
        data-testid="error-line"
        className="h-[30px] leading-[30px] text-[12px] text-[#F53F3F]"
      >
        {errorMsg}
      </div>

      {/* Login button */}
      <div>
        <Button
          type="text"
          disabled={loading}
          aria-label="登录/注册"
          onClick={handleLogin}
          className={`w-[320px] h-[48px] rounded-[8px] bg-[#1F6DFF] text-white font-semibold text-[14px] border-none hover:!bg-[#4080FF] hover:!text-white ${
            loading ? 'opacity-50' : ''
          }`}
        >
          登录/注册
        </Button>
      </div>
    </div>
  );
}
