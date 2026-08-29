import { useCallback, useEffect, useState } from 'react';
import { Dropdown, message } from 'antd';
import type { MenuProps } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { getMyTeams, teamDisplayName, type MyTeam } from '@/api/teamApi';

/** 顶栏团队切换器：只有默认团队（无真实团队）时整体隐藏；列表=个人项目（固定第一）+真实团队；新建团队入口在 /team 页 */
export function TeamSwitcher() {
  const [teams, setTeams] = useState<MyTeam[] | null>(null);
  const current = localStorage.getItem('currentTeamId');
  const currentTeam = teams?.find((t) => t.id === current) ?? teams?.[0];

  const load = useCallback(async () => {
    const list = await getMyTeams();
    setTeams(list);
    // 解散回退：current 已不在列表 → 落回第一个（默认团队排第一）
    const cur = localStorage.getItem('currentTeamId');
    if (list.length && !list.some((t) => t.id === cur)) {
      localStorage.setItem('currentTeamId', list[0].id);
      location.reload();
    }
  }, []);
  useEffect(() => {
    void load().catch((err) => message.error('团队列表加载失败：' + (err as Error).message));
  }, [load]);

  const realTeams = (teams ?? []).filter((t) => !t.isDefault);
  if (teams !== null && realTeams.length === 0) return null;

  const switchTo = (id: string) => {
    if (id === current) return;
    localStorage.setItem('currentTeamId', id);
    location.reload();
  };

  const items: MenuProps['items'] = (teams ?? []).map((t) => ({
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
