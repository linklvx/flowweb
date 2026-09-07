import { create } from 'zustand';
import { getMyTeams, type MyTeam } from '@/api/teamApi';

const CURRENT_TEAM_ID_KEY = 'currentTeamId';

function readSavedTeamId(): string | null {
  try {
    return localStorage.getItem(CURRENT_TEAM_ID_KEY);
  } catch {
    return null;
  }
}

function persistTeamId(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(CURRENT_TEAM_ID_KEY);
    else localStorage.setItem(CURRENT_TEAM_ID_KEY, id);
  } catch {
    // 存储被禁（如隐私模式）时静默忽略（先例 Sidebar.tsx）
  }
}

let inFlight: Promise<MyTeam[]> | null = null;
let seq = 0;

interface TeamState {
  /** 信任后端排序（默认团队→OWNER→创建时间），前端只 filter 不重排 */
  teams: MyTeam[];
  status: 'loading' | 'error' | 'success';
  currentTeamId: string | null;
  /** success 跳过；否则拉取并复用 in-flight（双挂载去重）。永不 reject（error 态由三态渲染兜底） */
  ensureTeams: () => Promise<void>;
  /** 强制重拉：不复用 in-flight，失败 reject 由调用方 message 提示 */
  fetchTeams: () => Promise<void>;
  /** 更新当前团队 + 持久记忆；不导航不校验（点击源保证 id 合法） */
  switchTo: (id: string) => void;
  /** 仅重命名等本地可推导字段（store 已有完整对象）；计数/角色变化走 fetchTeams */
  upsert: (patch: { id: string } & Partial<MyTeam>) => void;
  /** 解散后移除；若为当前选中 → 回退 list[0] 并写 LS */
  remove: (id: string) => void;
}

export const useTeamStore = create<TeamState>((set, get) => {
  const normalize = (teams: MyTeam[]): { teams: MyTeam[]; currentTeamId: string | null } => {
    const cur = get().currentTeamId;
    if (teams.length === 0) {
      persistTeamId(null);
      return { teams, currentTeamId: null };
    }
    if (cur && teams.some((t) => t.id === cur)) return { teams, currentTeamId: cur };
    persistTeamId(teams[0].id);
    return { teams, currentTeamId: teams[0].id };
  };

  const load = (force: boolean): Promise<MyTeam[]> => {
    if (!force) {
      if (get().status === 'success') return Promise.resolve(get().teams);
      if (inFlight) return inFlight;
    }
    const mySeq = ++seq;
    const request = getMyTeams().then(
      (teams) => {
        if (mySeq === seq) set({ ...normalize(teams), status: 'success' });
        return teams;
      },
      (err) => {
        if (mySeq === seq && get().teams.length === 0) set({ status: 'error' });
        throw err;
      },
    );
    // 句柄绑定当代 seq：旧请求 finally 不得误清新句柄
    const guarded = request.finally(() => {
      if (mySeq === seq) inFlight = null;
    });
    inFlight = guarded;
    if (get().teams.length === 0) set({ status: 'loading' });
    return guarded;
  };

  return {
    teams: [],
    status: 'loading',
    currentTeamId: readSavedTeamId(),

    ensureTeams: () => load(false).then(
      () => undefined,
      () => undefined, // 永不 reject：error 终态由消费组件三态渲染兜底
    ),
    fetchTeams: () => load(true).then(() => undefined), // 失败透传，调用方 message

    switchTo: (id) => {
      set({ currentTeamId: id });
      persistTeamId(id);
    },
    upsert: (patch) => {
      set((s) => ({ teams: s.teams.map((t) => (t.id === patch.id ? { ...t, ...patch } : t)) }));
    },
    remove: (id) => {
      const teams = get().teams.filter((t) => t.id !== id);
      if (get().currentTeamId === id) {
        const next = teams[0]?.id ?? null;
        persistTeamId(next);
        set({ teams, currentTeamId: next });
      } else {
        set({ teams });
      }
    },
  };
});

export const selectPersonalTeam = (teams: MyTeam[]): MyTeam | null =>
  teams.find((t) => t.isDefault) ?? null;
export const selectOwnedTeams = (teams: MyTeam[]): MyTeam[] =>
  teams.filter((t) => !t.isDefault && t.isOwner);
export const selectJoinedTeams = (teams: MyTeam[]): MyTeam[] =>
  teams.filter((t) => !t.isDefault && !t.isOwner);

/** 测试专用：清模块级 inFlight/seq（setState 清不掉它们） */
export const _internal = {
  reset() {
    inFlight = null;
    seq = 0;
  },
};
