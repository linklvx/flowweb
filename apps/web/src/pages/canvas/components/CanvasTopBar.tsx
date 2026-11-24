import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/components/AuthProvider';
import { ThemeToggleButton } from '@/components/theme/ThemeToggleButton';
import { getAwareness } from '@/stores/canvasCollabRuntime';
import type { AwarenessState } from '@/collab/awareness';
import { Dropdown, Popover } from 'antd';
import type { MenuProps } from 'antd';
import { UserOutlined, SettingOutlined, LogoutOutlined, TeamOutlined, UndoOutlined, RedoOutlined, CommentOutlined } from '@ant-design/icons';
import { useCreditsStore } from '@/stores/creditsStore';
import { useCanvasStore } from '@/stores/canvasStore';
// Y4a T11（spec §5/§9 锚 6）：画布撤销/重做按钮（undoCanvas/redoCanvas）——disabled=canvasUndo
// 栈事件驱动布尔（undoUiStore selector 订阅；键盘 useGroupKeyboard Ctrl+Z/Y 路由不动）
import { useUndoUiStore } from '@/stores/undoUiStore';
import { undoCanvas, redoCanvas } from '@/stores/canvasUndo';
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
  // Y4a T11：两布尔=undoUiStore selector 订阅（事件驱动禁用态——栈事件唯一真源，零轮询）
  const canvasCanUndo = useUndoUiStore((s) => s.canvasCanUndo);
  const canvasCanRedo = useUndoUiStore((s) => s.canvasCanRedo);

  // Y3 D1：默认团队比较结果 ref 化——挂载时判一次，终态信号不再每次请求默认团队。
  // teamId 变化时重置（null=未判），随下方挂载 effect 重算。
  const teamIsPersonalRef = useRef<boolean | null>(null);

  // Y3 D1：统一刷新函数——挂载（显 loading）与空 detail 信号（静默）共用。
  // 判定收拢：无 teamId →个人；默认团队→个人；非默认团队→团队池 fetchTeamBalance(teamId)。
  const refreshBalance = useCallback(async (opts: { silent?: boolean }): Promise<void> => {
    if (!teamId) { void store.fetchBalance(opts); return; }
    if (teamIsPersonalRef.current === null) {
      const def = await getDefaultTeam().catch(() => null);
      teamIsPersonalRef.current = def ? teamId === def.id : true;
    }
    if (teamIsPersonalRef.current) void store.fetchBalance(opts);
    else void store.fetchTeamBalance(teamId, opts);
  }, [teamId]);

  // 画布初始余额：经 project.teamId 判 scope（D2——不只依赖 Socket 推送）；挂载拉取显 loading。
  // refreshBalance 键随 teamId 变——effect 重跑时 ref 重置重判（拉取幂等+序号防覆盖，不设取消短路）。
  useEffect(() => {
    teamIsPersonalRef.current = null;   // teamId 变化重置（挂载档重判默认团队）
    void refreshBalance({});
  }, [refreshBalance]);

  // Y3 D1：credits:update 空 detail=终态信号（runtimeStore 四回落/增量终批恰一次派发）——按挂载
  // 已定的 scope 静默重拉（团队项目余额=团队池，每个成员 Feed 都会到、各自重拉正确）。旧
  // node:status credits 携完整对象的 applyBalance 档已随 D1 删除（不再信任推送值——REST 真值单源）。
  useEffect(() => {
    const handler = () => { void refreshBalance({ silent: true }); };
    window.addEventListener('credits:update', handler);
    return () => window.removeEventListener('credits:update', handler);
  }, [refreshBalance]);

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
        {/* Y4a T11（spec §5/§9 锚 6）：画布撤销/重做两颗——既有 icon button 同款 className
            （members-trigger 圆角胶囊族 rounded-full border-overlay-2 shadow-lg——非新设计面）；
            disabled 随 undoUiStore canvas 布尔；点击接 undoCanvas/redoCanvas（useGroupKeyboard
            :42-44 键盘路由不动——按钮与键盘同一动作身） */}
        <button
          type="button"
          aria-label="撤销"
          title="撤销 Ctrl+Z"
          disabled={!canvasCanUndo}
          onClick={() => { void undoCanvas(); }}
          className="flex items-center bg-surface backdrop-blur px-2 py-1.5 rounded-full border border-overlay-2 shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <UndoOutlined className="text-xs text-text" />
        </button>
        <button
          type="button"
          aria-label="重做"
          title="重做 Ctrl+Shift+Z"
          disabled={!canvasCanRedo}
          onClick={() => { void redoCanvas(); }}
          className="flex items-center bg-surface backdrop-blur px-2 py-1.5 rounded-full border border-overlay-2 shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RedoOutlined className="text-xs text-text" />
        </button>
        {/* Y4b T11（spec §3.2）：批注面板入口——既有 icon button 同款胶囊族（零新设计面）；
            点击开侧滑面板（ThreadsPanel 挂载在 page.tsx，store 接线单点）。
            评审 III 修正：本入口是纯读面板入口（只读会话/failed 本地副本仍须能读既有批注）——
            恒可用；写动作的面闸在 ThreadsPanel/ThreadComposer 内 */}
        <button
          type="button"
          data-testid="threads-trigger"
          aria-label="批注"
          onClick={() => window.dispatchEvent(new CustomEvent('threads:open'))}
          className="flex items-center bg-surface backdrop-blur px-2 py-1.5 rounded-full border border-overlay-2 shadow-lg cursor-pointer"
        >
          <CommentOutlined className="text-xs text-text" />
        </button>
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
