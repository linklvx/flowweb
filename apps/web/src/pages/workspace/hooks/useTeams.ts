import { useCallback, useEffect, useState } from 'react';
import { getMyTeams, type MyTeam } from '@/api/teamApi';

export type TeamsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; teams: MyTeam[] };

/** 团队列表三态 hook（works 与 /materials 复用）：失败落显式终态而非死屏（spec §一.1） */
export function useTeams() {
  const [state, setState] = useState<TeamsState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'success', teams: await getMyTeams() });
    } catch {
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const successTeams = state.status === 'success' ? state.teams : [];
  const realTeams = successTeams.filter((t) => !t.isDefault);
  const ordered = [...realTeams.filter((t) => t.isOwner), ...realTeams.filter((t) => !t.isOwner)];
  return { state, realTeams: ordered, retry: load };
}
