import { useCallback, useEffect, useState } from 'react';
import { Dropdown, Input, Modal, message } from 'antd';
import type { MenuProps } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { getMyTeams, createTeam, type MyTeam } from '@/api/teamApi';

export function TeamSwitcher() {
  const [teams, setTeams] = useState<MyTeam[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const current = localStorage.getItem('currentTeamId');
  const currentTeam = teams.find((t) => t.id === current) ?? teams[0];

  const load = useCallback(async () => {
    const list = await getMyTeams();
    setTeams(list);
    // 解散回退：current 已不在列表 → 落回第一个（一期禁解散唯一团队，无团队不可能）
    const cur = localStorage.getItem('currentTeamId');
    if (list.length && !list.some((t) => t.id === cur)) {
      localStorage.setItem('currentTeamId', list[0].id);
      location.reload();
    }
  }, []);
  useEffect(() => {
    void load().catch((err) => message.error('团队列表加载失败：' + (err as Error).message));
  }, [load]);

  const switchTo = (id: string) => {
    if (id === current) return;
    localStorage.setItem('currentTeamId', id);
    location.reload();
  };

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const team = await createTeam(name);
      localStorage.setItem('currentTeamId', team.id); // 创建后自动切换
      location.reload();
    } catch (err) {
      message.error('创建失败：' + (err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const items: MenuProps['items'] = [
    ...teams.map((t) => ({
      key: t.id,
      label: <span>{t.name}{t.id === currentTeam?.id ? ' ✓' : ''}</span>,
    })),
    { type: 'divider' as const },
    { key: 'create', label: '新建团队' },
  ];

  return (
    <>
      <Dropdown
        menu={{ items, onClick: ({ key }) => (key === 'create' ? setOpen(true) : switchTo(key)) }}
        trigger={['click']}
        placement="bottomRight"
      >
        <button className="flex items-center gap-1.5 rounded-full bg-gray-800/80 px-4 py-1.5 text-xs text-[#ccc] no-underline hover:bg-gray-700 transition-colors border-none cursor-pointer">
          {currentTeam?.name ?? '团队'} <DownOutlined className="text-[10px]" />
        </button>
      </Dropdown>
      <Modal open={open} title="新建团队" okText="创建" cancelText="取消" confirmLoading={creating} onCancel={() => setOpen(false)} onOk={create}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="团队名称" />
      </Modal>
    </>
  );
}
