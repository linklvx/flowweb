import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/components/AuthProvider';
import { ThemeToggleButton } from '@/components/theme/ThemeToggleButton';
import { getAwareness } from '@/stores/canvasCollabRuntime';
import type { AwarenessState } from '@/collab/awareness';
import { Dropdown, Popover } from 'antd';
import type { MenuProps } from 'antd';
import { UserOutlined, SettingOutlined, LogoutOutlined, TeamOutlined } from '@ant-design/icons';
import { useCreditsStore } from '@/stores/creditsStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { getDefaultTeam } from '@/api/teamApi';
import CreditsDropdown from './CreditsDropdown';
import { SaveStatusIndicator } from './SaveStatusIndicator';
import { ProjectMembersPanel } from './ProjectMembersPanel';
import { loginUrl } from '@/utils/loginRedirect';

interface Props {
  projectId: string;
}

export function CanvasTopBar({ projectId }: Props) {
  const { user, logout } = useAuth();
  const [onlineUsers, setOnlineUsers] = useState<AwarenessState[]>([]);
  useEffect(() => {
    const bridge = getAwareness();
    if (!bridge) return;
    // R33：在线成员排除本机（getRemoteStates——clientID 过滤；本机已在右侧头像区呈现，自计入会双算）
    const update = () => setOnlineUsers(bridge.getRemoteStates());
    update();
    return bridge.onStateChange(update);
  }, []);
  const navigate = useNavigate();
  const store = useCreditsStore();

  const handleLogout = useCallback(async () => {
    navigate('/');
    await logout();
  }, [logout, navigate]);

  const teamId = useCanvasStore((s) => s.teamId);

  // 画布初始余额：经 project.teamId 判 scope（D2——不只依赖 Socket 推送）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!teamId) {
        store.fetchBalance();
        return;
      }
      const def = await getDefaultTeam().catch(() => null);
      if (cancelled) return;
      if (def && teamId !== def.id) store.fetchTeamBalance(teamId);
      else store.fetchBalance();
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  // Socket 扣费推送：node:status credits 为完整余额对象（D1）
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      const d = ce.detail;
      if (d && typeof d === 'object' && 'credits' in d) store.applyBalance(d);
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
      <span className={`${size} rounded-full bg-accent text-on-accent text-sm font-bold flex items-center justify-center`}>
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
            <span className="text-sm font-medium text-text truncate">{displayName}</span>
            {!store.loading && (
              <span className="text-sm text-text">⚡ {(store.credits + (store.isSubscriptionActive() ? store.subscriptionCredits : 0)).toLocaleString()} 积分</span>
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
      <div className="absolute top-3 right-4 z-50 flex items-center gap-3">
        <ThemeToggleButton />
        {/* Y0b-4 T13（Q-M）：成员表入口——挂既有 ProjectMembersPanel（角色 Tag/逐行角色下拉/DELETE 全
            复用 projectMemberApi 既有端点，零新端点零新面板）；计数=远端在线+本机 */}
        <Popover
          trigger="click"
          placement="bottomRight"
          content={<div className="w-[440px]"><ProjectMembersPanel projectId={projectId} /></div>}
        >
          <button
            type="button"
            data-testid="members-trigger"
            aria-label="项目成员"
            className="flex items-center gap-1 bg-surface backdrop-blur px-2 py-1.5 rounded-full border border-overlay-2 shadow-lg cursor-pointer"
          >
            <TeamOutlined className="text-xs text-text" />
            <span className="text-xs text-text font-bold">{onlineUsers.length + 1}</span>
          </button>
        </Popover>
        {onlineUsers.length > 0 && (
          <div className="flex items-center -space-x-1.5 bg-surface backdrop-blur px-2 py-1.5 rounded-full border border-overlay-2 shadow-lg" data-testid="online-users">
            {onlineUsers.filter((o) => o.user?.id && o.user?.name).slice(0, 5).map((o, i) => (
              // Y0b-3 T7：background=服务端注入 color（s.user.color）——禁 fallback 双源；
              // T13（Q-M）presence 增强：右下角在线点（bg-brand-green 主题 token——禁新 hex 入 baseline）
              <span
                key={i}
                title={o.user.name}
                className="relative w-5 h-5 rounded-full text-[10px] flex items-center justify-center text-on-accent font-bold border border-on-accent"
                style={{ background: o.user.color }}
              >
                {o.user.name.slice(0, 1)}
                <span data-testid={`presence-dot-${o.user.id}`} className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-brand-green border border-on-accent" />
              </span>
            ))}
          </div>
        )}
        {user && (
          <div className="bg-surface backdrop-blur px-3 py-1.5 rounded-full border border-overlay-2 shadow-lg">
            <SaveStatusIndicator />
          </div>
        )}
        <div className="relative flex items-center gap-3 bg-surface backdrop-blur px-3 py-1.5 rounded-full border border-overlay-2 shadow-lg">
          {!store.loading && <CreditsDropdown />}
          {!store.loading && store.tier && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
              store.tier === 'ultra' ? 'bg-[#f59e0b] text-black' :
              store.tier === 'max' ? 'bg-[#a855f7] text-text' :
              store.tier === 'pro' ? 'bg-[#3b82f6] text-text' :
              'bg-[#9ca3af] text-black'
            }`}>
              {{ basic: '普通', pro: 'Pro', max: 'Max', ultra: 'Ultra' }[store.tier] ?? store.tier}
            </span>
          )}
          {user ? (
            /* C2 移除 deferredToC2 钉深覆盖（B2-c 登记，与 TopActionBar 同款）：App algorithm 已随主题派生，
               dark 档 darkAlgorithm 原生供给浮层暗色、light 档随画布壳跟随域转浅 */
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
          ) : (
            // 批2-3 收口：登录入口带 next=当前画布地址（loginUrl 唯一真相源——登录后回跳本画布）
            <Link
              to={loginUrl()}
              className="px-2 py-0.5 rounded-full text-xs border border-accent text-accent-text no-underline hover:bg-[#4ade80]/10 transition-colors"
            >
              登录
            </Link>
          )}
          {/* debug: projectId */}
          <span className="absolute -bottom-8 right-0 text-[10px] text-text-dim-1 whitespace-nowrap select-all">
            pid: {projectId}
          </span>
        </div>
      </div>
    </>
  );
}
