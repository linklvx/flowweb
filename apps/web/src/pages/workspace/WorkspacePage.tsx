import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, ConfigProvider, Tabs } from 'antd';
import { teamDisplayName, type MyTeam } from '@/api/teamApi';
import { useTeams } from './hooks/useTeams';
import { WorkspaceTabBar } from './components/WorkspaceTabBar';
import { WorkspaceDimension } from './components/WorkspaceDimension';

export function WorkspacePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: 'personal' | 'team' = searchParams.get('tab') === 'team' ? 'team' : 'personal';
  const urlTeamId = searchParams.get('teamId');
  const { state, realTeams, retry } = useTeams();

  // 切页签：清 folder 与 teamId（D3 扩展，spec §一.2）
  const setTab = (t: 'personal' | 'team') => {
    setSearchParams(t === 'team' ? { tab: 'team' } : {}, { replace: true });
  };
  // 切团队：清 folder（spec §一.2）
  const setTeamId = (id: string) => setSearchParams({ tab: 'team', teamId: id }, { replace: true });

  const validTeamId = urlTeamId && realTeams.some((t) => t.id === urlTeamId) ? urlTeamId : null;

  // 团队非成功分支的头部 tabs 行（spec §五）：容器类与合并行对齐，唯无 justify-between（单子元素）
  const tabsRow = (
    <div className="flex flex-col md:flex-row items-start gap-y-2 pt-2 pb-2 px-8">
      <WorkspaceTabBar activeTab="team" onTabChange={setTab} />
    </div>
  );

  // 直链 teamId 回落三分支（spec §一.2）：teams 就绪后修正 URL（replace，不污染后退栈；不带 folder）
  useEffect(() => {
    if (tab !== 'team' || state.status !== 'success' || realTeams.length === 0) return;
    if (!validTeamId) {
      setSearchParams({ tab: 'team', teamId: realTeams[0].id }, { replace: true });
    }
  }, [tab, state.status, validTeamId, realTeams, setSearchParams]);

  return (
    <div>
      <div className="pt-4">
        {tab === 'team' ? (
          state.status === 'loading' ? (
            <>{tabsRow}<p className="text-sm text-text-dim-2 px-8 pt-4">加载中…</p></>
          ) : state.status === 'error' ? (
            <>
              {tabsRow}
              <div className="flex flex-col items-center py-20 gap-3" data-testid="teams-error">
                <p className="text-sm text-text-dim-2">团队列表加载失败</p>
                <Button onClick={() => retry()}>重试</Button>
              </div>
            </>
          ) : realTeams.length === 0 ? (
            <>
              {tabsRow}
              <div className="flex flex-col items-center justify-center py-20 gap-3" data-testid="team-empty-state">
                <p className="text-sm text-text-dim-2">还没有团队，创建一个开始协作吧</p>
                <Button type="primary" onClick={() => navigate('/team')}>前往创建团队</Button>
              </div>
            </>
          ) : validTeamId ? (
            /* key=validTeamId：切团队强制重挂载维度组件，搜索/筛选/folder 等本地 state 归零（既有行为） */
            <WorkspaceDimension
              key={validTeamId} teamId={validTeamId} activeTab="team" onTabChange={setTab}
              dimensionLabel={teamDisplayName(realTeams.find((t) => t.id === validTeamId)!)}
            >
              <div className="px-8" data-testid="team-tabs-row">
                <ConfigProvider
                  theme={{
                    components: {
                      Tabs: {
                        itemColor: '#7a7a7a',
                        itemHoverColor: '#a6a6a6',
                        itemSelectedColor: '#f5f5f5',
                        inkBarColor: '#f5f5f5',
                      },
                    },
                  }}
                >
                  <Tabs
                    activeKey={validTeamId}
                    onChange={setTeamId}
                    items={realTeams.map((t) => ({ key: t.id, label: teamTabLabel(t) }))}
                  />
                </ConfigProvider>
              </div>
            </WorkspaceDimension>
          ) : (
            // success 但 URL teamId 尚未补默认的过渡帧，与 loading 同形避免闪空
            <>{tabsRow}<p className="text-sm text-text-dim-2 px-8 pt-4">加载中…</p></>
          )
        ) : (
          <WorkspaceDimension key="personal" activeTab="personal" onTabChange={setTab} />
        )}
      </div>
    </div>
  );
}

function teamTabLabel(t: MyTeam) {
  return <span>{teamDisplayName(t)}<span className="text-xs text-text-dim-2 ml-1">{t.memberCount}</span></span>;
}
