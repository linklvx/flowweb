import { useEffect, useState } from 'react';
import { Button, Modal, Input, message } from 'antd';
import { createTeam } from '@/api/teamApi';
import { useAuth } from '@/components/AuthProvider';
import { useTeamStore } from '@/stores/teamStore';
import { TeamSidebar } from './TeamSidebar';
import { TeamDetail } from './TeamDetail';

/** /team 布局壳：订阅 store 三态；持有 createModal（sidebar 与右侧共用）；TeamDetail key 重挂载 */
export default function TeamPage() {
  const { user } = useAuth();
  const status = useTeamStore((s) => s.status);
  const teams = useTeamStore((s) => s.teams);
  const currentTeamId = useTeamStore((s) => s.currentTeamId);
  const fetchTeams = useTeamStore((s) => s.fetchTeams);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);

  // 页面自查数据 + 每次进入强制拉新（他人侧变更：被批准入团/被移出/充值后返回）；
  // 失败吞错——已有数据时 store 保留 success 静默旧数据，空列表失败走 error 三态
  useEffect(() => { if (user) void fetchTeams(user.id).catch(() => undefined); }, [user, fetchTeams]);

  // 创建链路：createTeam → fetchTeams 重拉 → switchTo；fetchTeams 失败不 switchTo（新 id 不在旧列表会悬空）
  const doCreateTeam = async () => {
    if (creating || !createName.trim()) return;
    setCreating(true);
    let created: { id: string };
    try {
      created = await createTeam(createName.trim());
    } catch (err) {
      message.error('创建失败：' + (err as Error).message);
      setCreating(false);
      return;
    }
    try {
      await fetchTeams(user!.id);
      useTeamStore.getState().switchTo(created.id);
      setCreateOpen(false);
      setCreateName('');
    } catch {
      message.info('团队已创建，列表暂时未刷新，稍后自动恢复');
    } finally {
      setCreating(false);
    }
  };

  const currentTeam = teams.find((t) => t.id === currentTeamId) ?? null;

  // TeamSidebar 常驻（内部自带三态）；右侧 section 内部分流加载中/错误/TeamDetail
  // —— spec §3「sidebar 两行骨架 + 右侧加载中 / 双侧错误态」，sidebar 的骨架/重试分支在真实页面可达
  return (
    <div className="text-[#e2e8f0]">
      <div className="flex items-start gap-6">
        <TeamSidebar onCreateTeam={() => setCreateOpen(true)} />
        <section className="flex-1 min-w-0" data-testid="team-detail">
          {status !== 'success' && (
            status === 'loading'
              ? <p className="text-sm text-[#888] p-8">加载中…</p>
              : (
                <div className="flex flex-col items-center py-20 gap-3" data-testid="team-load-error">
                  <p className="text-sm text-[#888]">团队列表加载失败</p>
                  <Button onClick={() => { if (user) void fetchTeams(user.id).catch(() => undefined); }}>重试</Button>
                </div>
              )
          )}
          {status === 'success' && currentTeam && (
            <TeamDetail key={currentTeam.id} team={currentTeam} onCreateTeam={() => setCreateOpen(true)} />
          )}
        </section>
      </div>
      <Modal open={createOpen} title="新建团队" okText="创建" cancelText="取消" confirmLoading={creating}
        onCancel={() => setCreateOpen(false)} onOk={doCreateTeam}>
        <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="团队名称" />
      </Modal>
    </div>
  );
}
