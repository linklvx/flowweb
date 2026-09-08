import { useCallback, useEffect } from 'react';
import type { MyTeam } from '@/api/teamApi';
import { useTeamStore, selectOwnedTeams, selectJoinedTeams } from '@/stores/teamStore';
import { useAuth } from '@/components/AuthProvider';

export type TeamsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; teams: MyTeam[] };

/** 团队列表三态 hook（works 与 /materials 复用）——teamStore 适配层，形状与旧版一致 */
export function useTeams() {
  const { user } = useAuth();
  const teams = useTeamStore((s) => s.teams);
  const status = useTeamStore((s) => s.status);
  const fetchTeams = useTeamStore((s) => s.fetchTeams);

  useEffect(() => {
    if (user) void fetchTeams(user.id).catch(() => undefined); // 每次进入拉新（#18）
  }, [user, fetchTeams]);

  // 旧版 retry 永不 reject（load 内部 try/catch）；消费页 onClick={() => retry()} 无 catch，
  // fetchTeams 失败会 reject → 必须包一层维持吞错契约（错误已由 status==='error' 三态表达）
  const retry = useCallback(() => {
    if (user) void fetchTeams(user.id).catch(() => undefined);
  }, [fetchTeams, user]);

  const realTeams = [...selectOwnedTeams(teams), ...selectJoinedTeams(teams)];
  const state: TeamsState = status === 'success'
    ? { status, teams }
    : { status };
  return { state, realTeams, retry };
}
