import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/components/AuthProvider';
import { getAwareness } from '@/stores/canvasCollabRuntime';
import { userColor } from '@/collab/awareness';
import type { AwarenessState } from '@/collab/awareness';
import { SaveAsTemplateDialog } from './SaveAsTemplateDialog';
import { Dropdown, ConfigProvider } from 'antd';
import type { MenuProps } from 'antd';
import { UserOutlined, SettingOutlined, LogoutOutlined, SaveOutlined } from '@ant-design/icons';
import { useCreditsStore } from '@/stores/creditsStore';
import CreditsDropdown from './CreditsDropdown';
import { SaveStatusIndicator } from './SaveStatusIndicator';

interface Props {
  projectId: string;
  projectName: string;
}

export function CanvasTopBar({ projectId, projectName }: Props) {
  const { user, logout } = useAuth();
  const [onlineUsers, setOnlineUsers] = useState<AwarenessState[]>([]);
  useEffect(() => {
    const bridge = getAwareness();
    if (!bridge) return;
    const update = () => setOnlineUsers([...bridge.getStates().values() as any]);
    update();
    return bridge.onStateChange(update);
  }, []);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const navigate = useNavigate();
  const store = useCreditsStore();

  const handleLogout = useCallback(async () => {
    navigate('/');
    await logout();
  }, [logout, navigate]);

  useEffect(() => {
    store.fetchBalance();
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      if (typeof ce.detail === 'number') store.updateCredits(ce.detail);
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
            {!store.loading && (
              <span className="text-sm text-white">⚡ {(store.credits + (store.isSubscriptionActive() ? store.subscriptionCredits : 0)).toLocaleString()} 积分</span>
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
    {
      key: 'save-template',
      icon: <SaveOutlined />,
      label: '保存为模板',
      onClick: () => setShowSaveDialog(true),
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
      <div className="absolute top-3 right-4 z-50 flex items-center gap-3">
        {onlineUsers.length > 0 && (
          <div className="flex items-center -space-x-1.5 bg-[#1A1A1A]/90 backdrop-blur px-2 py-1.5 rounded-full border border-[#333] shadow-lg" data-testid="online-users">
            {onlineUsers.filter((o) => o.user?.id && o.user?.name).slice(0, 5).map((o, i) => (
              <span
                key={i}
                title={o.user.name}
                className="w-5 h-5 rounded-full text-[10px] flex items-center justify-center text-[#111] font-bold border border-[#111]"
                style={{ background: userColor(o.user.id) }}
              >
                {o.user.name.slice(0, 1)}
              </span>
            ))}
          </div>
        )}
        {user && (
          <div className="bg-[#1A1A1A]/90 backdrop-blur px-3 py-1.5 rounded-full border border-[#333] shadow-lg">
            <SaveStatusIndicator />
          </div>
        )}
        <div className="relative flex items-center gap-3 bg-[#1A1A1A]/90 backdrop-blur px-3 py-1.5 rounded-full border border-[#333] shadow-lg">
          {!store.loading && <CreditsDropdown />}
          {!store.loading && store.tier && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
              store.tier === 'ultra' ? 'bg-[#f59e0b] text-black' :
              store.tier === 'max' ? 'bg-[#a855f7] text-white' :
              store.tier === 'pro' ? 'bg-[#3b82f6] text-white' :
              'bg-[#9ca3af] text-black'
            }`}>
              {{ basic: '普通', pro: 'Pro', max: 'Max', ultra: 'Ultra' }[store.tier] ?? store.tier}
            </span>
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
