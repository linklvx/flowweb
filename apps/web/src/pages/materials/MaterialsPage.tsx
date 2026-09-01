import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, Tabs } from 'antd';
import { teamDisplayName } from '@/api/teamApi';
import { useTeams } from '@/pages/workspace/hooks/useTeams';
import { WorkspaceTabBar } from '@/pages/workspace/components/WorkspaceTabBar';
import { MaterialLibraryBrowser } from '@/components/MaterialLibrary/MaterialLibraryBrowser';
import { useMaterialLibraryStore } from '@/stores/materialLibraryStore';

/** 独立素材库页（spec §二）：个人=默认团队③级回落，团队=②级 dto.teamId */
export default function MaterialsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: 'personal' | 'team' = searchParams.get('tab') === 'team' ? 'team' : 'personal';
  const urlTeamId = searchParams.get('teamId');
  const { state, realTeams, retry } = useTeams();
  const enterContext = useMaterialLibraryStore((s) => s.enterContext);

  const setTab = (t: 'personal' | 'team') => {
    setSearchParams(t === 'team' ? { tab: 'team' } : {}, { replace: true });
  };
  const setTeamId = (id: string) => setSearchParams({ tab: 'team', teamId: id }, { replace: true });

  const validTeamId = urlTeamId && realTeams.some((t) => t.id === urlTeamId) ? urlTeamId : null;

  // 直链 teamId 回落三分支（同 works，spec §一.2；素材页 folder 不进 URL 无 folder 残留问题）
  useEffect(() => {
    if (tab !== 'team' || state.status !== 'success' || realTeams.length === 0) return;
    if (!validTeamId) {
      setSearchParams({ tab: 'team', teamId: realTeams[0].id }, { replace: true });
    }
  }, [tab, state.status, validTeamId, realTeams, setSearchParams]);

  // enterContext 调用时机②③④（spec §二.3）：页面挂载/切 tab/切团队
  useEffect(() => {
    if (tab === 'personal') enterContext({});
  }, [tab, enterContext]);
  useEffect(() => {
    if (tab === 'team' && validTeamId) enterContext({ teamId: validTeamId });
  }, [tab, validTeamId, enterContext]);

  return (
    <div>
      <div className="pt-4">
        <div className="px-8 pt-2">
          <WorkspaceTabBar
            activeTab={tab}
            onTabChange={setTab}
            labels={{ personal: '个人素材', team: '团队素材' }}
          />
        </div>
        {tab === 'team' ? (
          state.status === 'loading' ? (
            <p className="text-sm text-[#888] px-8 pt-4">加载中…</p>
          ) : state.status === 'error' ? (
            <div className="flex flex-col items-center py-20 gap-3" data-testid="teams-error">
              <p className="text-sm text-[#888]">团队列表加载失败</p>
              <Button onClick={() => retry()}>重试</Button>
            </div>
          ) : realTeams.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3" data-testid="materials-empty-state">
              <p className="text-sm text-[#888]">还没有团队，创建一个开始协作吧</p>
              <Button type="primary" onClick={() => navigate('/team')}>前往创建团队</Button>
            </div>
          ) : validTeamId ? (
            <>
              <div className="px-8" data-testid="team-tabs-row">
                <Tabs
                  activeKey={validTeamId}
                  onChange={setTeamId}
                  items={realTeams.map((t) => ({ key: t.id, label: teamDisplayName(t) }))}
                />
              </div>
              <div className="px-8 pb-10">
                <MaterialLibraryBrowser key={validTeamId} title="我的素材库" />
              </div>
            </>
          ) : (
            <p className="text-sm text-[#888] px-8 pt-4">加载中…</p>
          )
        ) : (
          <div className="px-8 pb-10">
            <MaterialLibraryBrowser key="personal" title="我的素材库" />
          </div>
        )}
      </div>
    </div>
  );
}
