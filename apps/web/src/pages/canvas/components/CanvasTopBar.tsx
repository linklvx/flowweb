import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/components/AuthProvider';
import { SaveAsTemplateDialog } from './SaveAsTemplateDialog';
import { Dropdown, ConfigProvider } from 'antd';
import type { MenuProps } from 'antd';
import { UserOutlined, SettingOutlined, LogoutOutlined } from '@ant-design/icons';

interface Props {
  projectId: string;
  projectName: string;
}

export function CanvasTopBar({ projectId, projectName }: Props) {
  const { user, logout } = useAuth();
  const [credits, setCredits] = useState<number | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const navigate = useNavigate();

  const handleLogout = useCallback(async () => {
    navigate('/');
    await logout();
  }, [logout, navigate]);

  useEffect(() => {
    fetch('/api/credits/balance')
      .then(r => r.json())
      .then(json => { if (json.code === 0) setCredits(json.data.credits); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      if (typeof ce.detail === 'number') setCredits(ce.detail);
    };
    window.addEventListener('credits:update', handler);
    return () => window.removeEventListener('credits:update', handler);
  }, []);

  const displayName = user?.name || user?.email || '?';
  const firstLetter = displayName.charAt(0).toUpperCase();
  const avatarUrl = user?.image;

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
    <>
      <div className="absolute top-3 right-4 z-50 flex items-center gap-3 bg-[#1A1A1A]/90 backdrop-blur px-3 py-1.5 rounded-full border border-[#333] shadow-lg">
        {user && (
          <button
            onClick={() => setShowSaveDialog(true)}
            className="text-[#4ade80] text-xs bg-transparent border-none cursor-pointer hover:text-[#5dfc8e] transition-colors"
          >
            保存项目
          </button>
        )}
        {credits !== null && (
          <span className="text-sm text-white whitespace-nowrap tracking-wider">⚡ {credits?.toLocaleString()}</span>
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
            <Dropdown
              menu={{ items: userMenuItems }}
              trigger={['hover']}
              placement="bottomRight"
              align={{ offset: [0, 6] }}
            >
              <span className="cursor-pointer">
                {avatarNode('w-5 h-5 text-[10px]')}
              </span>
            </Dropdown>
          </ConfigProvider>
        ) : (
          <Link
            to="/login"
            className="px-2 py-0.5 rounded-full text-xs border border-[#4ade80] text-[#4ade80] no-underline hover:bg-[#4ade80]/10 transition-colors"
          >
            登录
          </Link>
        )}
        {/* debug: projectId */}
        <span className="absolute -bottom-8 right-0 text-[10px] text-[#444] whitespace-nowrap select-all">
          pid: {projectId}
        </span>
      </div>

      {showSaveDialog && (
        <SaveAsTemplateDialog
          projectId={projectId}
          projectName={projectName}
          onClose={() => setShowSaveDialog(false)}
          onSaved={() => { setShowSaveDialog(false); }}
        />
      )}
    </>
  );
}
