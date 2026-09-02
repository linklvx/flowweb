import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ConfigProvider, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { CrownOutlined, GiftOutlined, LogoutOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '@/components/AuthProvider';
import { LoginModal } from '@/components/auth/LoginModal';
import { TeamSwitcher } from '@/components/TeamSwitcher';
import { useVipModalStore } from '@/stores/vipModalStore';
import { useCreditsStore } from '@/stores/creditsStore';

const TIER_LABEL: Record<string, string> = { basic: '普通', pro: 'Pro', max: 'Max', ultra: 'Ultra' };

const BTN = 'h-8 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] hover:bg-[#262626] hover:border-[#444] hover:text-white text-[13px] leading-5 text-[#d0d0d0] px-2.5 flex items-center gap-1 no-underline cursor-pointer transition-colors duration-150';

export function TopActionBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const openVipModal = useVipModalStore(s => s.open);
  const credits = useCreditsStore(s => s.credits);
  const subscriptionCredits = useCreditsStore(s => s.subscriptionCredits);
  const tier = useCreditsStore(s => s.tier);
  const fetchBalance = useCreditsStore(s => s.fetchBalance);

  const handleLogout = useCallback(async () => {
    navigate('/');
    await logout();
  }, [logout, navigate]);

  // 登录门控：fetchBalance 无 token 判断，公开组页面未登录不发请求（避免 401 噪音）
  useEffect(() => {
    if (user) void fetchBalance();
  }, [user, fetchBalance]);

  const totalCredits = credits + subscriptionCredits;
  const displayName = user?.name || user?.email || '?';
  const firstLetter = displayName.charAt(0).toUpperCase();
  const avatarUrl = user?.image;

  const avatarNode = (size: string) =>
    avatarUrl ? (
      <img src={avatarUrl} alt={displayName} className={`${size} rounded-full object-cover block`} />
    ) : (
      <span className={`${size} rounded-full bg-[#4ade80] text-black text-sm font-bold flex items-center justify-center`}>
        {firstLetter}
      </span>
    );

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'header',
      disabled: true,
      label: (
        <div className="flex items-center gap-3 px-2 py-1 min-w-[180px]">
          {avatarNode('w-10 h-10 text-sm')}
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-[#e2e8f0] truncate">{displayName}</span>
            <span className="text-sm text-white">⚡ {totalCredits.toLocaleString()} 积分</span>
          </div>
        </div>
      ),
    },
    { type: 'divider' as const },
    { key: 'team', icon: <UserOutlined />, label: <Link to="/team" className="no-underline text-inherit">团队管理</Link> },
    { key: 'center', icon: <UserOutlined />, label: <Link to="/settings" className="no-underline text-inherit">用户中心</Link> },
    { key: 'settings', icon: <SettingOutlined />, label: <Link to="/settings/profile" className="no-underline text-inherit">个人设置</Link> },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: <span className="text-red-400">退出登录</span>,
      onClick: handleLogout,
    },
  ];

  return (
    <div data-testid="top-action-bar" className="h-[77px] flex items-center justify-end gap-2">
      <Link to="/settings/credits" className={BTN}>
        <GiftOutlined className="text-base text-[#a0a0a0]" /> 赚积分
      </Link>
      <button onClick={openVipModal} className={BTN}>
        <CrownOutlined className="text-base text-[#a0a0a0]" /> 会员充值
      </button>
      {user ? (
        <>
          <Link to="/settings/membership" className={BTN}>
            <span className="text-[13px] font-medium text-white">⚡ {totalCredits.toLocaleString()}</span>
            {tier && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                tier === 'ultra' ? 'bg-[#f59e0b] text-black'
                  : tier === 'max' ? 'bg-[#a855f7] text-white'
                  : tier === 'pro' ? 'bg-[#3b82f6] text-white'
                  : 'bg-[#9ca3af] text-black'
              }`}>
                {TIER_LABEL[tier] ?? tier}
              </span>
            )}
          </Link>
          <ConfigProvider
            theme={{
              components: {
                Dropdown: {
                  colorBgElevated: '#252525',
                  colorText: '#e2e8f0',
                  controlItemBgHover: '#3a3a3a',
                  borderRadiusLG: 12,
                  paddingXXS: 6,
                },
              },
            }}
          >
            <TeamSwitcher />
            <Dropdown
              menu={{ items: userMenuItems }}
              trigger={['hover']}
              placement="bottomRight"
              align={{ offset: [0, 6] }}
            >
              <span data-testid="user-avatar" className="cursor-pointer">{avatarNode('w-8 h-8')}</span>
            </Dropdown>
          </ConfigProvider>
        </>
      ) : (
        <button
          data-testid="login-register-btn"
          onClick={() => setShowLoginModal(true)}
          className="h-8 rounded-lg bg-white hover:bg-[#e8e8e8] text-black text-[13px] font-medium leading-5 px-4 border-none cursor-pointer transition-colors duration-150"
        >
          登录/注册
        </button>
      )}
      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} />}
    </div>
  );
}
