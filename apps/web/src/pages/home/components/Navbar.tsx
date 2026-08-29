import { useAuth } from '@/components/AuthProvider';
import { Link, useLocation, useNavigate } from 'react-router';
import { useState, useEffect, useCallback } from 'react';
import { Dropdown, ConfigProvider } from 'antd';
import type { MenuProps } from 'antd';
import { GiftOutlined, CrownOutlined, UserOutlined, SettingOutlined, LogoutOutlined } from '@ant-design/icons';
import { LoginModal } from '@/components/auth/LoginModal';
import { TeamSwitcher } from '@/components/TeamSwitcher';
import { useVipModalStore } from '@/stores/vipModalStore';

interface NavLink {
  label: string;
  href: string;
}

const navLinks: NavLink[] = [
  { label: '首页', href: '/' },
  { label: '模板广场', href: '/templates' },
  { label: '文档中心', href: '/docs' },
  { label: '工作空间', href: '/works' },
];

interface Props {
  onAction?: (key: string) => void;
}

export function Navbar({ onAction: _onAction }: Props) {
  const { user, logout } = useAuth();
  const [credits, setCredits] = useState<number | null>(null);
  const [subCredits, setSubCredits] = useState<number | null>(null);
  const [subTier, setSubTier] = useState<string | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const openVipModal = useVipModalStore(s => s.open);

  const handleLogout = useCallback(async () => {
    navigate('/');
    await logout();
  }, [logout, navigate]);

  useEffect(() => {
    if (!user) {
      setCredits(null);
      setSubCredits(null);
      setSubTier(null);
      return;
    }
    fetch('/api/credits/balance')
      .then(r => r.json())
      .then(json => {
        if (json.code === 0) {
          setCredits(json.data.credits);
          setSubCredits(json.data.subscriptionCredits ?? 0);
        }
      })
      .catch(() => {});
    fetch('/api/subscription/me')
      .then(r => r.json())
      .then(json => { if (json.code === 0 && json.data) setSubTier(json.data.tier); })
      .catch(() => {});
  }, [user]);

  const totalCredits = credits !== null ? credits + (subCredits ?? 0) : null;
  const tierLabel: Record<string, string> = { basic: '普通', pro: 'Pro', max: 'Max', ultra: 'Ultra' };

  const displayName = user?.name || user?.email || '?';
  const firstLetter = displayName.charAt(0).toUpperCase();
  const avatarUrl = user?.image;

  const isActive = (href: string) => {
    if (href === '/') return location.pathname === '/';
    return location.pathname.startsWith(href);
  };

  const avatarNode = (size: string) =>
    avatarUrl ? (
      <img src={avatarUrl} alt={displayName} className={`${size} rounded-full object-cover`} />
    ) : (
      <span className={`${size} rounded-full bg-[#4ade80] text-black text-sm font-bold flex items-center justify-center`}>
        {firstLetter}
      </span>
    );

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'header',
      label: (
        <div className="flex items-center gap-3 px-2 py-1 min-w-[180px]">
          {avatarNode('w-10 h-10 text-sm')}
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-[#e2e8f0] truncate">{displayName}</span>
            {credits !== null && (
              <span className="text-sm text-white">⚡ {credits?.toLocaleString()} 积分</span>
            )}
          </div>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' as const },
    {
      key: 'team',
      icon: <UserOutlined />,
      label: <Link to="/team" className="no-underline text-inherit">团队管理</Link>,
    },
    {
      key: 'center',
      icon: <UserOutlined />,
      label: <Link to="/settings" className="no-underline text-inherit">用户中心</Link>,
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: <Link to="/settings/profile" className="no-underline text-inherit">个人设置</Link>,
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: <span className="text-red-400">退出登录</span>,
      onClick: handleLogout,
    },
  ];

  return (
    <nav className="h-16 bg-[#1A1A1A] shadow-md border-b border-[#333]">
      <div className="h-full mx-auto max-w-[1640px] px-5 md:px-10 lg:px-[120px] flex items-center justify-between">
        <div className="flex items-center gap-12">
          <div className="text-[#4ade80] font-bold text-lg select-none">
            💦 Flow123
          </div>
          <div className="flex gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className={`px-3 py-1.5 rounded-md text-sm no-underline hover:bg-[#333] hover:text-white transition-colors ${
                  isActive(link.href) ? 'font-bold text-white' : 'text-[#ccc]'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex gap-3 items-center">
          <Link to="/settings/credits" className="flex items-center gap-1.5 rounded-full bg-gray-800/80 px-4 py-1.5 text-xs text-[#ccc] no-underline hover:bg-gray-700 transition-colors">
            <GiftOutlined className="text-sm" /> 赚积分
          </Link>
          <button onClick={openVipModal} className="flex items-center gap-1.5 rounded-full bg-gray-800/80 px-4 py-1.5 text-xs text-[#4ade80] no-underline hover:bg-gray-700 transition-colors border-none cursor-pointer">
            <CrownOutlined className="text-sm" /> 会员充值
          </button>
          {totalCredits !== null && (
            <Link to="/settings/membership" className="no-underline">
              <span className="text-sm text-white flex items-center gap-1 rounded-full bg-gray-800/80 px-4 py-1.5 hover:bg-gray-700 transition-colors cursor-pointer">
                ⚡ {totalCredits.toLocaleString()}
                {subTier && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                    subTier === 'ultra' ? 'bg-[#f59e0b] text-black' :
                    subTier === 'max' ? 'bg-[#a855f7] text-white' :
                    subTier === 'pro' ? 'bg-[#3b82f6] text-white' :
                    'bg-[#9ca3af] text-black'
                  }`}>
                    {tierLabel[subTier] ?? subTier}
                  </span>
                )}
                {!user && <span className="text-[#888]">Free</span>}
              </span>
            </Link>
          )}
          {user ? (
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
                <span className="cursor-pointer">
                  {avatarNode('w-8 h-8')}
                </span>
              </Dropdown>
            </ConfigProvider>
          ) : (
            <button
              onClick={() => setShowLoginModal(true)}
              className="rounded-full bg-gray-700 px-3 py-1.5 text-xs text-[#ccc] hover:bg-gray-600 transition-colors border-none cursor-pointer"
            >
              登录/注册
            </button>
          )}
        </div>
      </div>
      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} />}
    </nav>
  );
}
