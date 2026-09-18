import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { PhoneLoginForm } from '@/components/auth/PhoneLoginForm';
import { WeChatQRLogin } from '@/components/auth/WeChatQRLogin';
import { AgreementFooter } from '@/components/auth/AgreementFooter';
/** @deprecated 旧邮箱登录，后续替换 */
import { AuthModal } from '@/components/AuthModal';

export function LoginPage() {
  const [showEmailLogin, setShowEmailLogin] = useState(false);
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

  if (showEmailLogin) {
    return <AuthModal onClose={() => setShowEmailLogin(false)} />;
  }

  // 恒浅岛根（spec D4），B 段扩展
  return (
    <div className="light min-h-screen bg-[#f5f5f5] flex items-center justify-center">
      <div className="w-[720px] rounded-[16px] overflow-hidden shadow-lg">
        {/* Banner */}
        <div className="h-[140px] rounded-t-[16px] overflow-hidden">
          <div className="w-full h-full bg-gradient-to-b from-[#e8e8e8] to-[#f0f0f0] flex items-center justify-center">
            <span className="text-[24px] font-semibold italic tracking-[-0.04em] leading-none text-[#141414]">
              Flow123
            </span>
          </div>
        </div>

        {/* Form area */}
        <div className="bg-[#FFF] relative z-[1] -mt-[15px] pt-8">
          {error === 'wechat_failed' && (
            <div className="text-center text-[12px] text-[#F53F3F] mb-4">
              微信登录失败，请重试
            </div>
          )}

          <div className="flex gap-0 pl-10 h-[550px] rounded-t-[12px]">
            <PhoneLoginForm onLoginSuccess={() => { window.location.href = '/canvas'; }} />

            {/* Divider */}
            <div
              className="w-[1px] mt-2 h-[500px] opacity-10"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,1) 0%, #0D0D0D 35%, #0D0D0D 65%, rgba(255,255,255,1) 100%)',
              }}
            />

            <WeChatQRLogin onAlternativeLogin={() => setShowEmailLogin(true)} />
          </div>

          <AgreementFooter />
        </div>
      </div>
    </div>
  );
}
