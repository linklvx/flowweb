import {
  CrownFilled, FolderOutlined, PlusOutlined, SketchOutlined, TeamOutlined, UserOutlined,
} from '@ant-design/icons';
import { useAnnouncementStore } from '@/stores/announcementStore';
import { useAuth } from '@/components/AuthProvider';
import { selectJoinedTeams, selectOwnedTeams, selectPersonalTeam, useTeamStore } from '@/stores/teamStore';
import { teamCreditsTotal, teamDisplayName, type MyTeam } from '@/api/teamApi';

/** 左侧团队列表：个人置顶 + 创建组 + 加入组；sticky 自滚（不动全局布局） */
function TeamCard({ team, active, onClick }: { team: MyTeam; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`team-card-${team.id}`}
      className={`w-full p-3 rounded-lg text-left transition-all border border-solid bg-transparent ${
        active
          ? 'bg-gradient-to-r from-cyan-500/10 to-emerald-500/10 border-cyan-500/30'
          : 'border-transparent hover:bg-overlay-1'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br from-cyan-500/20 to-emerald-500/20">
          {team.isDefault ? <UserOutlined className="text-text" /> : <span className="text-lg font-medium text-text">{team.name.slice(0, 1)}</span>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate text-text text-sm">{teamDisplayName(team)}</span>
            {!team.isDefault && team.isOwner && <CrownFilled className="text-xs shrink-0 text-amber-400" />}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span className="flex items-center gap-1"><TeamOutlined /><span>{team.memberCount}</span></span>
            <span className="flex items-center gap-1"><FolderOutlined /><span>{team.projectCount}</span></span>
            <span className="flex items-center gap-1"><SketchOutlined /><span>{teamCreditsTotal(team.balance)}</span></span>
          </div>
        </div>
      </div>
    </button>
  );
}

export function TeamSidebar({ onCreateTeam }: { onCreateTeam: () => void }) {
  const { user } = useAuth();
  const teams = useTeamStore((s) => s.teams);
  const status = useTeamStore((s) => s.status);
  const currentTeamId = useTeamStore((s) => s.currentTeamId);
  const switchTo = useTeamStore((s) => s.switchTo);
  const fetchTeams = useTeamStore((s) => s.fetchTeams);
  const announcement = useAnnouncementStore((s) => s.announcement);
  // 与 AppLayout:17 同口径：公告 64 / 无 0；顶栏容器 60px 在其下
  const topOffset = announcement ? 64 : 0;

  const personal = selectPersonalTeam(teams);
  const owned = selectOwnedTeams(teams);
  const joined = selectJoinedTeams(teams);

  return (
    <aside
      data-testid="team-sidebar"
      className="w-64 shrink-0 sticky self-start overflow-y-auto py-1 pr-1"
      style={{ top: 60 + topOffset, maxHeight: `calc(100vh - ${60 + topOffset}px)` }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-400">我的团队</h3>
        <button
          type="button" title="创建团队" aria-label="创建团队" onClick={onCreateTeam}
          className="p-1.5 text-gray-400 hover:text-text hover:bg-overlay-1 rounded-md transition-colors"
        >
          <PlusOutlined className="text-sm" />
        </button>
      </div>

      {status === 'loading' && (
        <div data-testid="sidebar-loading" className="space-y-2">
          <div className="h-16 rounded-lg bg-overlay-1 animate-pulse" />
          <div className="h-16 rounded-lg bg-overlay-1 animate-pulse" />
        </div>
      )}

      {status === 'error' && (
        <div data-testid="sidebar-error" className="text-xs text-gray-500 py-4 text-center">
          <p className="mb-2">团队列表加载失败</p>
          <button
            type="button"
            onClick={() => { if (user) void fetchTeams(user.id).catch(() => undefined); }}
            className="px-3 py-1 rounded border border-solid border-gray-600 text-gray-300"
          >
            重试
          </button>
        </div>
      )}

      {status === 'success' && (
        <div className="space-y-4">
          {personal && (
            <TeamCard team={personal} active={personal.id === currentTeamId} onClick={() => switchTo(personal.id)} />
          )}
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <CrownFilled className="text-xs text-amber-400" />
              <span className="text-xs font-medium text-amber-400/80">创建的团队</span>
              <span className="text-xs text-gray-600">{owned.length}</span>
            </div>
            {owned.map((t) => (
              <TeamCard key={t.id} team={t} active={t.id === currentTeamId} onClick={() => switchTo(t.id)} />
            ))}
          </div>
          {joined.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <TeamOutlined className="text-xs text-gray-400" />
                <span className="text-xs font-medium text-gray-400">加入的团队</span>
                <span className="text-xs text-gray-600">{joined.length}</span>
              </div>
              {joined.map((t) => (
                <TeamCard key={t.id} team={t} active={t.id === currentTeamId} onClick={() => switchTo(t.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
