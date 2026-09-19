import { useState } from 'react';
import { ConfigProvider, Modal, theme as antdTheme } from 'antd';
import { PhoneLoginForm } from './PhoneLoginForm';
import { useAuth } from '@/components/AuthProvider';
import { WeChatQRLogin } from './WeChatQRLogin';
import { AgreementFooter } from './AgreementFooter';
/** @deprecated 旧邮箱登录，后续替换 */
import { AuthModal } from '../AuthModal';

export interface LoginModalProps {
  onClose: () => void;
  bannerUrl?: string;
}

export function LoginModal({
  onClose,
  bannerUrl,
}: LoginModalProps) {
  const [bannerFailed, setBannerFailed] = useState(false);
  const [showEmailLogin, setShowEmailLogin] = useState(false);
  const { refresh } = useAuth();

  if (showEmailLogin) {
    return <AuthModal onClose={() => setShowEmailLogin(false)} />;
  }

  return (
    // 恒浅岛双通道（方案 A，spec O5 定稿/video-works.md:27 先例）：defaultAlgorithm 经 context 穿透
    // portal 管 body 挂载弹层；rootClassName 落 .ant-modal-root 使后代经继承取 .light 的 --fw-* 浅值。
    // 双宿主（TopActionBar chrome / VideoPlayerModal videos 域）免逐宿主特裁——现状本就浅渲染，零行为变更
    <ConfigProvider theme={{ algorithm: antdTheme.defaultAlgorithm }}>
      <Modal
        open
        centered
        destroyOnClose
        footer={null}
        closable
        onCancel={onClose}
        width={720}
        styles={{
          content: { padding: 0, background: 'transparent' },
          body: { padding: 0 },
        }}
        className="[&_.ant-modal-content]:bg-transparent [&_.ant-modal-content]:p-0"
        rootClassName="light"
      >
      <div className="rounded-[16px] overflow-hidden">
        {/* Banner */}
        <div className="h-[140px] rounded-t-[16px] overflow-hidden">
          {bannerUrl && !bannerFailed ? (
            <img
              src={bannerUrl}
              alt="登录Banner"
              className="w-full h-full object-cover"
              onError={() => setBannerFailed(true)}
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-b from-[#e8e8e8] to-[#f0f0f0] flex items-center justify-center">
              <span className="text-[24px] font-semibold italic tracking-[-0.04em] leading-none text-[#141414]">
                Flow123
              </span>
            </div>
          )}
        </div>

        {/* Form area */}
        <div className="bg-[#FFF] relative z-[1] -mt-[15px] pt-8">
          <div className="flex gap-0 pl-10 h-[550px] rounded-t-[12px]">
            <PhoneLoginForm
              onLoginSuccess={() => {
                refresh();
                onClose();
              }}
            />

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
      </Modal>
    </ConfigProvider>
  );
}
