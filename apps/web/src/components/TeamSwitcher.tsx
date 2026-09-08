import { useEffect } from 'react';
import { Dropdown, message } from 'antd';
import type { MenuProps } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { teamDisplayName } from '@/api/teamApi';
import { useAuth } from '@/components/AuthProvider';
import { useTeamStore } from '@/stores/teamStore';

/** 顶栏团队切换器：teamStore 驱动（挂载即 ensureTeams 拉取点）；只有默认团队时整体隐藏 */
export function TeamSwitcher() {
  const { user } = useAuth();
  const teams = useTeamStore((s) => s.teams);
  const status = useTeamStore((s) => s.status);
  const currentTeamId = useTeamStore((s) => s.currentTeamId);
  const ensureTeams = useTeamStore((s) => s.ensureTeams);
  const switchTo = useTeamStore((s) => s.switchTo);

  useEffect(() => {
    if (user) void ensureTeams(user.id);
  }, [user, ensureTeams]);

  useEffect(() => {
    if (status === 'error') message.error('团队列表加载失败');
  }, [status]);

  const realTeams = teams.filter((t) => !t.isDefault);
  if (status === 'success' && realTeams.length === 0) return null;

  const currentTeam = teams.find((t) => t.id === currentTeamId) ?? teams[0];

  const items: MenuProps['items'] = teams.map((t) => ({
    key: t.id,
    label: <span>{teamDisplayName(t)}{t.id === currentTeam?.id ? ' ✓' : ''}</span>,
  }));

  return (
    <Dropdown menu={{ items, onClick: ({ key }) => switchTo(key) }} trigger={['click']} placement="bottomRight">
      <button className="flex items-center gap-1.5 rounded-full bg-gray-800/80 px-4 py-1.5 text-xs text-[#ccc] no-underline hover:bg-gray-700 transition-colors border-none cursor-pointer">
        {currentTeam ? teamDisplayName(currentTeam) : '团队'} <DownOutlined className="text-[10px]" />
      </button>
    </Dropdown>
  );
}
