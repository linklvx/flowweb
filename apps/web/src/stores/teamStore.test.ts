import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTeamStore, _internal, selectPersonalTeam, selectOwnedTeams, selectJoinedTeams } from './teamStore';
import { getMyTeams, type MyTeam } from '@/api/teamApi';

vi.mock('@/api/teamApi', () => ({ getMyTeams: vi.fn() }));
const mockGetMyTeams = vi.mocked(getMyTeams);

const team = (id: string, o: Partial<MyTeam> = {}): MyTeam => ({
  id, name: id, role: 'OWNER', status: 'ACTIVE', isDefault: false, isOwner: true,
  createdAt: '2026-08-01', memberCount: 1, projectCount: 0,
  balance: { credits: 0, subscriptionCredits: 0 }, subscription: null, ...o,
});
const T_DEFAULT = team('d', { isDefault: true, isOwner: true, name: '个人' });
const T_OWNED = team('t1', { name: '我建的' });
const T_JOINED = team('t2', { isOwner: false, role: 'MEMBER', name: '我加入的' });
const LIST = [T_DEFAULT, T_OWNED, T_JOINED];

/** 手动受控 promise：模拟慢响应/竞态 */
function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const resetStore = () => {
  _internal.reset();
  useTeamStore.setState({ teams: [], status: 'loading', currentTeamId: null });
};

describe('teamStore', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); resetStore(); });
  afterEach(() => { resetStore(); });

  it('运行中改 LS 不影响 store（初始化读一次，此后只写不读）', () => {
    // 模块 import 时已读 LS——本用例锁定可观察契约：
    // 归一化只信 store 内 currentTeamId，运行中改 LS 无效
    mockGetMyTeams.mockResolvedValue(LIST);
    useTeamStore.setState({ currentTeamId: 't1' });
    localStorage.setItem('currentTeamId', 'hacked');
    return useTeamStore.getState().ensureTeams('u1').then(() => {
      expect(useTeamStore.getState().currentTeamId).toBe('t1');
    });
  });

  it('ensureTeams 去重：同轮双调用只打一次 /team/mine；success 后再调跳过', async () => {
    const d = deferred<MyTeam[]>();
    mockGetMyTeams.mockReturnValueOnce(d.promise);
    const [a, b] = [useTeamStore.getState().ensureTeams('u1'), useTeamStore.getState().ensureTeams('u1')];
    d.resolve(LIST);
    await Promise.all([a, b]);
    expect(mockGetMyTeams).toHaveBeenCalledTimes(1);
    expect(useTeamStore.getState().status).toBe('success');
    await useTeamStore.getState().ensureTeams('u1');
    expect(mockGetMyTeams).toHaveBeenCalledTimes(1);
  });

  it('归一化：currentTeamId 无效落 list[0] 并写 LS；有效保留', async () => {
    mockGetMyTeams.mockResolvedValue(LIST);
    useTeamStore.setState({ currentTeamId: 'dead' });
    await useTeamStore.getState().ensureTeams('u1');
    expect(useTeamStore.getState().currentTeamId).toBe('d');
    expect(localStorage.getItem('currentTeamId')).toBe('d');
  });

  it('fetchTeams(force) 不复用 in-flight：旧请求回包被 seq 丢弃', async () => {
    const slow = deferred<MyTeam[]>();
    const fresh = deferred<MyTeam[]>();
    mockGetMyTeams.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fresh.promise);
    const ensure = useTeamStore.getState().ensureTeams('u1');      // seq=1 慢
    const force = useTeamStore.getState().fetchTeams('u1');        // seq=2 夺权
    slow.resolve([T_DEFAULT]);                                  // 旧回包：应被丢弃
    fresh.resolve(LIST);                                        // 新回包：落地
    await Promise.all([ensure.catch(() => undefined), force]);
    expect(useTeamStore.getState().teams).toEqual(LIST);
    expect(useTeamStore.getState().currentTeamId).toBe('d');   // 旧包未污染
  });

  it('首次拉取失败 → error 终态且 ensureTeams 不抛；已有数据 force 失败 → 保留旧数据维持 success 且 fetchTeams 抛', async () => {
    mockGetMyTeams.mockRejectedValueOnce(new Error('boom'));
    await useTeamStore.getState().ensureTeams('u1');               // 不抛（三态兜底）
    expect(useTeamStore.getState().status).toBe('error');
    expect(useTeamStore.getState().teams).toEqual([]);

    mockGetMyTeams.mockResolvedValueOnce(LIST);
    await useTeamStore.getState().fetchTeams('u1');
    mockGetMyTeams.mockRejectedValueOnce(new Error('boom2'));
    await expect(useTeamStore.getState().fetchTeams('u1')).rejects.toThrow('boom2');
    expect(useTeamStore.getState().status).toBe('success');    // 保留
    expect(useTeamStore.getState().teams).toEqual(LIST);
  });

  it('switchTo：写 store + LS，不发请求不导航', () => {
    useTeamStore.setState({ teams: LIST, status: 'success', currentTeamId: 'd' });
    useTeamStore.getState().switchTo('t2');
    expect(useTeamStore.getState().currentTeamId).toBe('t2');
    expect(localStorage.getItem('currentTeamId')).toBe('t2');
    expect(mockGetMyTeams).not.toHaveBeenCalled();
  });

  it('remove：移除非当前项不动 currentTeamId；移除当前项回退 list[0] 并写 LS；清空置 null', () => {
    useTeamStore.setState({ teams: LIST, status: 'success', currentTeamId: 't1' });
    useTeamStore.getState().remove('t2');
    expect(useTeamStore.getState().teams.map((t) => t.id)).toEqual(['d', 't1']);
    expect(useTeamStore.getState().currentTeamId).toBe('t1');
    useTeamStore.getState().remove('t1');
    expect(useTeamStore.getState().currentTeamId).toBe('d');
    expect(localStorage.getItem('currentTeamId')).toBe('d');
    useTeamStore.getState().remove('d');
    expect(useTeamStore.getState().currentTeamId).toBeNull();
    expect(useTeamStore.getState().teams).toEqual([]);
  });

  it('upsert：仅合并已有项（重命名场景）', () => {
    useTeamStore.setState({ teams: LIST, status: 'success', currentTeamId: 't1' });
    useTeamStore.getState().upsert({ id: 't1', name: '新名' });
    expect(useTeamStore.getState().teams.find((t) => t.id === 't1')?.name).toBe('新名');
  });

  it('selectors：personal/owned/joined 只 filter 不重排', () => {
    expect(selectPersonalTeam(LIST)?.id).toBe('d');
    expect(selectOwnedTeams(LIST).map((t) => t.id)).toEqual(['t1']);
    expect(selectJoinedTeams(LIST).map((t) => t.id)).toEqual(['t2']);
    expect(selectPersonalTeam([])).toBeNull();
  });

  describe('换账号失效（loadedUserId）', () => {
    it('换号：A 成功后 ensureTeams(B) 清空重拉，currentTeamId 回落 B 的默认团队并覆盖 LS', async () => {
      mockGetMyTeams.mockResolvedValueOnce(LIST);
      await useTeamStore.getState().ensureTeams('a');
      expect(useTeamStore.getState().status).toBe('success');
      useTeamStore.getState().switchTo('t2'); // A 会话选中 t2，LS=t2
      const B_LIST = [team('bd', { isDefault: true, isOwner: true }), team('bt1', { name: 'B的团队' })];
      mockGetMyTeams.mockResolvedValueOnce(B_LIST);
      await useTeamStore.getState().ensureTeams('b');
      expect(mockGetMyTeams).toHaveBeenCalledTimes(2);
      expect(useTeamStore.getState().teams).toEqual(B_LIST);
      expect(useTeamStore.getState().currentTeamId).toBe('bd'); // 不沿用 A 的 t2
      expect(localStorage.getItem('currentTeamId')).toBe('bd');
    });

    it('换号清空时序：B 请求在途时 store 已同步清空为 loading/空列表', async () => {
      mockGetMyTeams.mockResolvedValueOnce(LIST);
      await useTeamStore.getState().ensureTeams('a');
      const d = deferred<MyTeam[]>();
      mockGetMyTeams.mockReturnValueOnce(d.promise);
      const p = useTeamStore.getState().ensureTeams('b');
      expect(useTeamStore.getState().teams).toEqual([]); // 请求 resolve 前已清
      expect(useTeamStore.getState().status).toBe('loading');
      expect(useTeamStore.getState().currentTeamId).toBeNull();
      d.resolve([T_DEFAULT]);
      await p;
      expect(useTeamStore.getState().status).toBe('success');
    });

    it('换号失败 → error 终态；同号再 ensure 重发（error 非短路）', async () => {
      mockGetMyTeams.mockResolvedValueOnce(LIST);
      await useTeamStore.getState().ensureTeams('a');
      mockGetMyTeams.mockRejectedValueOnce(new Error('boom'));
      await useTeamStore.getState().ensureTeams('b'); // 吞错
      expect(useTeamStore.getState().status).toBe('error');
      mockGetMyTeams.mockResolvedValueOnce(LIST);
      await useTeamStore.getState().ensureTeams('b');
      expect(useTeamStore.getState().status).toBe('success');
    });

    it('fetch 首拉确立 owner：fetchTeams(X) 成功后同号 ensure 短路不重拉', async () => {
      mockGetMyTeams.mockResolvedValueOnce(LIST);
      await useTeamStore.getState().fetchTeams('x');
      await useTeamStore.getState().ensureTeams('x');
      expect(mockGetMyTeams).toHaveBeenCalledTimes(1);
    });

    it('A 在途时 B ensure：A 回包被 seq 丢弃，B 数据落地', async () => {
      const slow = deferred<MyTeam[]>();
      const bList = [team('bd2', { isDefault: true })];
      mockGetMyTeams.mockReturnValueOnce(slow.promise).mockReturnValueOnce(Promise.resolve(bList));
      const pa = useTeamStore.getState().ensureTeams('a'); // seq1 在途
      const pb = useTeamStore.getState().ensureTeams('b'); // 换号 force，seq2
      slow.resolve([T_DEFAULT]); // 旧包：丢弃
      await Promise.all([pa, pb]);
      expect(useTeamStore.getState().teams).toEqual(bList);
    });

    it('首拉不清 currentTeamId：owner 未立时保留既有选择（v4——首拉≠换号）', async () => {
      mockGetMyTeams.mockResolvedValueOnce(LIST);
      useTeamStore.setState({ currentTeamId: 't1' }); // 模拟 LS 读入
      await useTeamStore.getState().ensureTeams('a');
      expect(useTeamStore.getState().currentTeamId).toBe('t1'); // 有效即保留
    });
  });
});
