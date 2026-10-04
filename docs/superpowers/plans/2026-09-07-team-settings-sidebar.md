<!-- doc-status: historical | verified_at: n/a -->
# 团队设置页左侧团队列表（无刷新切换）实施计划

> 【已废止 2026-09-19】preflight:false 红线已被 docs/superpowers/specs/2026-09-18-css-base-layer-theme-design.md 推翻并重开（A 段落地）；本文 preflight 目检等相关表述仅存历史档。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** /team 页左侧新增团队列表面板（个人置顶 + 创建组 + 加入组），点击卡片经 teamStore 无刷新切换；后端补 projectCount；TeamSwitcher/useTeams 收编到同一 store。

**Architecture:** 新建 Zustand teamStore（ensureTeams 去重 / fetchTeams 强制 + in-flight/seq 并发防护）；TeamPage 拆为布局壳（持 createModal）+ `<TeamDetail key={team.id}>`（key 重挂载天然重置局部态）；sidebar sticky 布局不动全局。

**Tech Stack:** React 18 + TS strict + Zustand + antd5 + @ant-design/icons（无 lucide）/ NestJS + Prisma _count / Vitest

**Spec:** `docs/superpowers/specs/2026-09-07-team-settings-sidebar-design.md`（四轮审核定稿）

**命令速查**（Bash CWD 会漂移，均用 pnpm filter 从仓库根执行）：
- 前端单测：`pnpm --filter web exec vitest run <相对 apps/web 的路径>`
- 后端单测：`pnpm --filter api exec vitest run src/modules/team/team.service.spec.ts`
- 前端类型：`pnpm --filter web exec tsc -p tsconfig.json --noEmit`
- 后端类型随 `pnpm --filter api test`（script 含 tsc）

---

### Task 1: 后端 getMyTeams 补 projectCount（TDD 红绿）

**Files:**
- Modify: `apps/api/src/modules/team/team.service.ts:82`（_count）、`:115` 区域（行映射）
- Test: `apps/api/src/modules/team/team.service.spec.ts:141-187`（`toEqual` 用例是唯一红绿承载点）

- [x] **Step 1: 改测试（两侧同补字段）**

`team.service.spec.ts` 第一个 getMyTeams 用例：mock 侧两处 `_count: { members: 3 }` → `_count: { members: 3, projects: 2 }`、`_count: { members: 1 }` → `_count: { members: 1, projects: 0 }`；期望对象 `memberCount: 3,` 后加 `projectCount: 2,`、`memberCount: 1,` 后加 `projectCount: 0,`。

第二个 describe（:190 起"个人项目化"）的 mock `_count` 共 5 处（:201、:210、:232-234）顺手一次补全 `projects: 0`（该组用 toMatchObject / 只比对 id 序，不承载红绿，补齐避免 undefined 混入）。

- [x] **Step 2: 跑测试确认红**

Run: `pnpm --filter api exec vitest run src/modules/team/team.service.spec.ts`
Expected: 第一个 getMyTeams 用例 FAIL（`projectCount: undefined` ≠ 期望数字）

- [x] **Step 3: 实现**

team.service.ts `getMyTeams`：
```ts
// :82 原 _count: { select: { members: true } } 改为
_count: { select: { members: true, projects: true } },
```
行映射（:115 `memberCount: m.team._count.members,` 之后）加：
```ts
projectCount: m.team._count.projects,
```

- [x] **Step 4: 跑测试确认绿**

Run: `pnpm --filter api exec vitest run src/modules/team/team.service.spec.ts`
Expected: 全部 PASS

- [x] **Step 5: Commit**

```bash
git add apps/api/src/modules/team/team.service.ts apps/api/src/modules/team/team.service.spec.ts
git commit -m "feat(api): getMyTeams 返回 projectCount（_count.projects 聚合，无 migration）"
```

---

### Task 2: 前端 MyTeam.projectCount + teamCreditsTotal helper（TDD）

**Files:**
- Modify: `apps/web/src/api/teamApi.ts:3-14`（接口）、文件尾部（helper）
- Test: `apps/web/src/api/teamApi.test.ts`（追加断言）

- [x] **Step 1: 写失败测试**

teamApi.test.ts 追加（该文件已有 describe 结构，追加到合适的 describe 或新建 `describe('teamCreditsTotal', ...)`；import 处补 `teamCreditsTotal`）：
```ts
describe('teamCreditsTotal', () => {
  it('通用+订阅两池之和（与后端 getBalanceView total 同式）', () => {
    expect(teamCreditsTotal({ credits: 100, subscriptionCredits: 50 })).toBe(150);
    expect(teamCreditsTotal({ credits: 0, subscriptionCredits: 0 })).toBe(0);
  });
});
```

- [x] **Step 2: 跑测试确认红**

Run: `pnpm --filter web exec vitest run src/api/teamApi.test.ts`
Expected: FAIL（teamCreditsTotal 未导出）

- [x] **Step 3: 实现**

teamApi.ts `MyTeam` 接口 `memberCount: number;` 后加：
```ts
projectCount: number;
```
文件尾部（getMyTeams 等函数之后）加：
```ts
/** 积分合计：与后端 getBalanceView 的 total 同式（credits + subscriptionCredits） */
export function teamCreditsTotal(balance: Pick<MyTeam, 'balance'>['balance']): number {
  return balance.credits + balance.subscriptionCredits;
}
```

- [x] **Step 4: 跑测试 + 类型**

Run: `pnpm --filter web exec vitest run src/api/teamApi.test.ts`
Expected: 该文件 PASS（此时其他 fixture 文件类型红属预期，运行时测试多数仍绿；Task 3 统一修）
Run: `pnpm --filter web exec tsc -p tsconfig.json --noEmit`
Expected: 报 7 个测试文件的 MyTeam 字面量缺 projectCount（记录文件清单，与 Task 3 对照）

- [x] **Step 5: Commit**

```bash
git add apps/web/src/api/teamApi.ts apps/web/src/api/teamApi.test.ts
git commit -m "feat(web): MyTeam 加 projectCount + teamCreditsTotal 口径 helper"
```

---

### Task 3: 6 个 fixture 文件机械补 projectCount（一致性补齐，非红绿驱动）

**Files（Modify，逐个补 `projectCount: <数字>` 到每个 MyTeam 字面量）：**
1. `apps/web/src/pages/team/TeamPage.test.tsx`（:32 team fixture 及 :129/:138-139/:154-155/:171-172 内联字面量）
2. `apps/web/src/components/TeamSwitcher.test.tsx`（:24-29 team 工厂）
3. `apps/web/src/pages/workspace/hooks/useTeams.test.tsx`（:11 team 工厂）
4. `apps/web/src/pages/materials/MaterialsPage.test.tsx`（:19 team 工厂、:62 内联）
5. `apps/web/src/pages/workspace/__tests__/WorkspacePage.test.tsx`（:203-205/:220/:229/:290/:300）
6. `apps/web/src/pages/team/TeamBillingPage.test.tsx`（:26 teamFixture）

（注：`WorkspacePage.folder-create.test.tsx` 的 getMyTeams 仅 `mockResolvedValue([])` 无字面量可补，不在本任务——它只需 Task 5 的 store 清场。）

- [x] **Step 1: 机械补字段**

每个 MyTeam 字面量的 `memberCount: N,` 后加 `projectCount: 0,`（数字任意，0 即可——测试不断言它）。

**定位说明（勿困惑）**：这些字面量均无 `: MyTeam` 类型标注（vi.fn() 擦除返回类型，基线 tsc 已 0 error），所以本任务**不产生类型红、0 红是正常预期**——补齐仅为未来类型标注兜底的一次性迁移。真正会类型红的是 Task 4/6 新建的带标注测试文件（自带该字段）。

- [x] **Step 2: 类型 + 全量测试门**

Run: `pnpm --filter web exec tsc -p tsconfig.json --noEmit`
Expected: 0 error
Run: `pnpm --filter web test`
Expected: 全绿（与改动前基线一致）

- [x] **Step 3: Commit**

```bash
git add apps/web/src
git commit -m "test(web): 6 个含 MyTeam fixture 的测试文件补 projectCount（一致性补齐，0 红正常）"
```

---

### Task 4: teamStore（TDD，含并发防护）

**Files:**
- Create: `apps/web/src/stores/teamStore.ts`
- Test: Create `apps/web/src/stores/teamStore.test.ts`

- [x] **Step 1: 写失败测试（全量用例）**

```ts
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
    return useTeamStore.getState().ensureTeams().then(() => {
      expect(useTeamStore.getState().currentTeamId).toBe('t1');
    });
  });

  it('ensureTeams 去重：同轮双调用只打一次 /team/mine；success 后再调跳过', async () => {
    const d = deferred<MyTeam[]>();
    mockGetMyTeams.mockReturnValueOnce(d.promise);
    const [a, b] = [useTeamStore.getState().ensureTeams(), useTeamStore.getState().ensureTeams()];
    d.resolve(LIST);
    await Promise.all([a, b]);
    expect(mockGetMyTeams).toHaveBeenCalledTimes(1);
    expect(useTeamStore.getState().status).toBe('success');
    await useTeamStore.getState().ensureTeams();
    expect(mockGetMyTeams).toHaveBeenCalledTimes(1);
  });

  it('归一化：currentTeamId 无效落 list[0] 并写 LS；有效保留', async () => {
    mockGetMyTeams.mockResolvedValue(LIST);
    useTeamStore.setState({ currentTeamId: 'dead' });
    await useTeamStore.getState().ensureTeams();
    expect(useTeamStore.getState().currentTeamId).toBe('d');
    expect(localStorage.getItem('currentTeamId')).toBe('d');
  });

  it('fetchTeams(force) 不复用 in-flight：旧请求回包被 seq 丢弃', async () => {
    const slow = deferred<MyTeam[]>();
    const fresh = deferred<MyTeam[]>();
    mockGetMyTeams.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fresh.promise);
    const ensure = useTeamStore.getState().ensureTeams();      // seq=1 慢
    const force = useTeamStore.getState().fetchTeams();        // seq=2 夺权
    slow.resolve([T_DEFAULT]);                                  // 旧回包：应被丢弃
    fresh.resolve(LIST);                                        // 新回包：落地
    await Promise.all([ensure.catch(() => undefined), force]);
    expect(useTeamStore.getState().teams).toEqual(LIST);
    expect(useTeamStore.getState().currentTeamId).toBe('d');   // 旧包未污染
  });

  it('首次拉取失败 → error 终态且 ensureTeams 不抛；已有数据 force 失败 → 保留旧数据维持 success 且 fetchTeams 抛', async () => {
    mockGetMyTeams.mockRejectedValueOnce(new Error('boom'));
    await useTeamStore.getState().ensureTeams();               // 不抛（三态兜底）
    expect(useTeamStore.getState().status).toBe('error');
    expect(useTeamStore.getState().teams).toEqual([]);

    mockGetMyTeams.mockResolvedValueOnce(LIST);
    await useTeamStore.getState().fetchTeams();
    mockGetMyTeams.mockRejectedValueOnce(new Error('boom2'));
    await expect(useTeamStore.getState().fetchTeams()).rejects.toThrow('boom2');
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
});
```

- [x] **Step 2: 跑测试确认红**

Run: `pnpm --filter web exec vitest run src/stores/teamStore.test.ts`
Expected: FAIL（模块不存在）

- [x] **Step 3: 实现 teamStore.ts（完整文件）**

```ts
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
```

- [x] **Step 4: 跑测试确认绿**

Run: `pnpm --filter web exec vitest run src/stores/teamStore.test.ts`
Expected: 8 用例全 PASS

- [x] **Step 5: Commit**

```bash
git add apps/web/src/stores/teamStore.ts apps/web/src/stores/teamStore.test.ts
git commit -m "feat(web): teamStore——ensureTeams 去重/fetchTeams 强制 + in-flight/seq 并发防护 + 归一化不变量"
```

---

### Task 5: useTeams 收编为 store 适配层（保绿）

**Files:**
- Modify: `apps/web/src/pages/workspace/hooks/useTeams.ts`（整体重写，返回形状不变）
- Modify: `apps/web/src/pages/workspace/hooks/useTeams.test.tsx`（仅 beforeEach 加清场）

- [x] **Step 1: 四个测试文件补 store 清场（单例污染链：上一用例残留 success → 下一用例 ensureTeams「success 跳过」→ 自己的 mock 不发请求 → 空态用例超时）**

(a) useTeams.test.tsx 头部 import 改为：
```ts
import { useTeams } from './useTeams';
import { useTeamStore, _internal } from '@/stores/teamStore';
```
describe 内 beforeEach 改为：
```ts
beforeEach(() => {
  vi.clearAllMocks();
  _internal.reset();
  useTeamStore.setState({ teams: [], status: 'loading', currentTeamId: null });
});
```
（两个用例本体与断言零改动——用例 1 断言 `['owned-1', 'joined-1']`：适配层 realTeams = owned 组 + joined 组拼接，结果一致）

(b) 同样的清场补进 3 个页面测试（它们经 useTeams 读同一 store 单例；MaterialsPage「无真实团队空态」、WorkspacePage「无真实团队空状态」两用例在前序用例残留非空 teams 时必然超时）：
- `apps/web/src/pages/materials/MaterialsPage.test.tsx`
- `apps/web/src/pages/workspace/__tests__/WorkspacePage.test.tsx`
- `apps/web/src/pages/workspace/__tests__/WorkspacePage.folder-create.test.tsx`（当前全 mock `[]` 侥幸绿，统一补避免时序脆弱）

每个文件：import 行加 `import { useTeamStore, _internal } from '@/stores/teamStore';`，已有 beforeEach 的 `vi.clearAllMocks()` 后追加：
```ts
_internal.reset();
useTeamStore.setState({ teams: [], status: 'loading', currentTeamId: null });
```
（无 beforeEach 的文件新建一个；源码零改动——清场只动测试）

- [x] **Step 2: 重写 useTeams.ts（完整文件，注意 retry 保持旧版吞错契约）**

```ts
import { useCallback, useEffect } from 'react';
import type { MyTeam } from '@/api/teamApi';
import { useTeamStore, selectOwnedTeams, selectJoinedTeams } from '@/stores/teamStore';

export type TeamsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; teams: MyTeam[] };

/** 团队列表三态 hook（works 与 /materials 复用）——teamStore 适配层，形状与旧版一致 */
export function useTeams() {
  const teams = useTeamStore((s) => s.teams);
  const status = useTeamStore((s) => s.status);
  const ensureTeams = useTeamStore((s) => s.ensureTeams);
  const fetchTeams = useTeamStore((s) => s.fetchTeams);

  useEffect(() => {
    void ensureTeams();
  }, [ensureTeams]);

  // 旧版 retry 永不 reject（load 内部 try/catch）；消费页 onClick={() => retry()} 无 catch，
  // fetchTeams 失败会 reject → 必须包一层维持吞错契约（错误已由 status==='error' 三态表达）
  const retry = useCallback(() => {
    void fetchTeams().catch(() => undefined);
  }, [fetchTeams]);

  const realTeams = [...selectOwnedTeams(teams), ...selectJoinedTeams(teams)];
  const state: TeamsState = status === 'success'
    ? { status, teams }
    : { status };
  return { state, realTeams, retry };
}
```

- [x] **Step 3: 跑相关测试**

Run: `pnpm --filter web exec vitest run src/pages/workspace/hooks/useTeams.test.tsx src/pages/workspace/__tests__/WorkspacePage.test.tsx src/pages/workspace/__tests__/WorkspacePage.folder-create.test.tsx src/pages/materials/MaterialsPage.test.tsx`
Expected: 全 PASS（页面源码零改动；测试仅加清场）

- [x] **Step 4: Commit**

```bash
git add apps/web/src/pages/workspace apps/web/src/pages/materials
git commit -m "refactor(web): useTeams 收编为 teamStore 适配层（形状不变、retry 吞错契约保持，删前端 ownerFirst 重排）"
```

---

### Task 6: TeamSidebar 组件（TDD）

**Files:**
- Create: `apps/web/src/pages/team/TeamSidebar.tsx`
- Test: Create `apps/web/src/pages/team/TeamSidebar.test.tsx`

- [x] **Step 1: 写失败测试（预置 store state，不 mock api）**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TeamSidebar } from './TeamSidebar';
import { useTeamStore, _internal } from '@/stores/teamStore';
import type { MyTeam } from '@/api/teamApi';

vi.mock('@/api/teamApi', () => ({
  teamCreditsTotal: (b: { credits: number; subscriptionCredits: number }) => b.credits + b.subscriptionCredits,
  teamDisplayName: (t: { isDefault: boolean; name: string }) => (t.isDefault ? '个人项目' : t.name),
}));

const team = (id: string, o: Partial<MyTeam> = {}): MyTeam => ({
  id, name: id, role: 'OWNER', status: 'ACTIVE', isDefault: false, isOwner: true,
  createdAt: '2026-08-01', memberCount: 1, projectCount: 2,
  balance: { credits: 100, subscriptionCredits: 50 }, subscription: null, ...o,
});
const LIST: MyTeam[] = [
  team('d', { isDefault: true, name: 'A的团队' }),
  team('t1', { name: '我建的' }),
  team('t2', { isOwner: false, role: 'MEMBER', name: '加入的团', memberCount: 5 }),
];
const setSuccess = (currentTeamId = 't1') => {
  useTeamStore.setState({ teams: LIST, status: 'success', currentTeamId });
};
const reset = () => {
  _internal.reset();
  useTeamStore.setState({ teams: [], status: 'loading', currentTeamId: null });
};

describe('TeamSidebar', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); reset(); });

  it('loading：渲染骨架占位', () => {
    render(<TeamSidebar onCreateTeam={vi.fn()} />);
    expect(screen.getByTestId('sidebar-loading')).toBeInTheDocument();
  });

  it('error：显示失败与重试，点击调 fetchTeams', () => {
    useTeamStore.setState({ teams: [], status: 'error', currentTeamId: null });
    const spy = vi.spyOn(useTeamStore.getState(), 'fetchTeams').mockResolvedValue();
    render(<TeamSidebar onCreateTeam={vi.fn()} />);
    fireEvent.click(screen.getByTestId('sidebar-error').querySelector('button')!);
    expect(spy).toHaveBeenCalled();
  });

  it('success：个人置顶 + 创建组 + 加入组（徽标=组长度）+ 选中态', () => {
    setSuccess('t1');
    render(<TeamSidebar onCreateTeam={vi.fn()} />);
    expect(screen.getByTestId('team-card-d')).toBeInTheDocument();
    expect(screen.getByText('创建的团队').parentElement!.textContent).toContain('1');
    expect(screen.getByText('加入的团队').parentElement!.textContent).toContain('1');
    // 选中卡片带渐变类
    expect(screen.getByTestId('team-card-t1').className).toContain('from-cyan-500/10');
    expect(screen.getByTestId('team-card-t2').className).not.toContain('from-cyan-500/10');
  });

  it('卡片统计：成员/项目/积分（teamCreditsTotal 口径）', () => {
    setSuccess('t2');
    render(<TeamSidebar onCreateTeam={vi.fn()} />);
    const card = screen.getByTestId('team-card-t2');
    expect(card.textContent).toContain('5');   // 成员
    expect(card.textContent).toContain('2');   // 项目
    expect(card.textContent).toContain('150'); // 积分 100+50
  });

  it('点击团队卡片与个人项都调 switchTo', () => {
    setSuccess('t1');
    const spy = vi.spyOn(useTeamStore.getState(), 'switchTo');
    render(<TeamSidebar onCreateTeam={vi.fn()} />);
    fireEvent.click(screen.getByTestId('team-card-t2'));
    expect(spy).toHaveBeenCalledWith('t2');
    fireEvent.click(screen.getByTestId('team-card-d'));
    expect(spy).toHaveBeenCalledWith('d');
  });

  it('「加入的团队」为 0 时整组不渲染（含组头）', () => {
    useTeamStore.setState({ teams: [LIST[0], LIST[1]], status: 'success', currentTeamId: 't1' });
    render(<TeamSidebar onCreateTeam={vi.fn()} />);
    expect(screen.queryByText('加入的团队')).not.toBeInTheDocument();
  });

  it('+ 按钮打开创建弹窗（onCreateTeam 回调）', () => {
    setSuccess();
    const onCreateTeam = vi.fn();
    render(<TeamSidebar onCreateTeam={onCreateTeam} />);
    fireEvent.click(screen.getByRole('button', { name: '创建团队' }));
    expect(onCreateTeam).toHaveBeenCalled();
  });
});
```

- [x] **Step 2: 跑测试确认红**

Run: `pnpm --filter web exec vitest run src/pages/team/TeamSidebar.test.tsx`
Expected: FAIL（组件不存在）

- [x] **Step 3: 实现 TeamSidebar.tsx（完整文件）**

```tsx
import {
  CrownFilled, FolderOutlined, PlusOutlined, SketchOutlined, TeamOutlined, UserOutlined,
} from '@ant-design/icons';
import { useAnnouncementStore } from '@/stores/announcementStore';
import { selectJoinedTeams, selectOwnedTeams, selectPersonalTeam, useTeamStore } from '@/stores/teamStore';
import { teamCreditsTotal, teamDisplayName, type MyTeam } from '@/api/teamApi';

/** 左侧团队列表：个人置顶 + 创建组 + 加入组；sticky 自滚（不动全局布局） */
function TeamCard({ team, active, onClick }: { team: MyTeam; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`team-card-${team.id}`}
      className={`w-full box-border p-3 rounded-lg text-left transition-all cursor-pointer border border-solid bg-transparent ${
        active
          ? 'bg-gradient-to-r from-cyan-500/10 to-emerald-500/10 border-cyan-500/30'
          : 'border-transparent hover:bg-white/5'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br from-cyan-500/20 to-emerald-500/20">
          {team.isDefault ? <UserOutlined className="text-white" /> : <span className="text-lg font-medium text-white">{team.name.slice(0, 1)}</span>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate text-white text-sm">{teamDisplayName(team)}</span>
            {!team.isDefault && team.isOwner && <CrownFilled className="text-xs shrink-0 text-amber-400" />}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span className="flex items-center gap-1"><TeamOutlined /><span>{team.memberCount}</span></span>
            <span className="flex items-center gap-1"><FolderOutlined /><span>{team.projectCount}</span></span>
            <span className="flex items-center gap-1"><SketchOutlined /><span>{teamCreditsTotal(team.balance)}</span></span>
          </div>
        </div>
      </div>
    </button>
  );
}

export function TeamSidebar({ onCreateTeam }: { onCreateTeam: () => void }) {
  const teams = useTeamStore((s) => s.teams);
  const status = useTeamStore((s) => s.status);
  const currentTeamId = useTeamStore((s) => s.currentTeamId);
  const switchTo = useTeamStore((s) => s.switchTo);
  const fetchTeams = useTeamStore((s) => s.fetchTeams);
  const announcement = useAnnouncementStore((s) => s.announcement);
  // 与 AppLayout:17 同口径：公告 64 / 无 0；顶栏容器 60px 在其下
  const topOffset = announcement ? 64 : 0;

  const personal = selectPersonalTeam(teams);
  const owned = selectOwnedTeams(teams);
  const joined = selectJoinedTeams(teams);

  return (
    <aside
      data-testid="team-sidebar"
      className="w-64 shrink-0 sticky self-start overflow-y-auto box-border py-1 pr-1"
      style={{ top: 60 + topOffset, maxHeight: `calc(100vh - ${60 + topOffset}px)` }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-400">我的团队</h3>
        <button
          type="button" title="创建团队" aria-label="创建团队" onClick={onCreateTeam}
          className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-md transition-colors bg-transparent border-none cursor-pointer"
        >
          <PlusOutlined className="text-sm" />
        </button>
      </div>

      {status === 'loading' && (
        <div data-testid="sidebar-loading" className="space-y-2">
          <div className="h-16 rounded-lg bg-white/5 animate-pulse" />
          <div className="h-16 rounded-lg bg-white/5 animate-pulse" />
        </div>
      )}

      {status === 'error' && (
        <div data-testid="sidebar-error" className="text-xs text-gray-500 py-4 text-center">
          <p className="mb-2">团队列表加载失败</p>
          <button
            type="button"
            onClick={() => { void fetchTeams().catch(() => undefined); }}
            className="px-3 py-1 rounded border border-solid border-gray-600 text-gray-300 bg-transparent cursor-pointer"
          >
            重试
          </button>
        </div>
      )}

      {status === 'success' && (
        <div className="space-y-4">
          {personal && (
            <TeamCard team={personal} active={personal.id === currentTeamId} onClick={() => switchTo(personal.id)} />
          )}
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <CrownFilled className="text-xs text-amber-400" />
              <span className="text-xs font-medium text-amber-400/80">创建的团队</span>
              <span className="text-xs text-gray-600">{owned.length}</span>
            </div>
            {owned.map((t) => (
              <TeamCard key={t.id} team={t} active={t.id === currentTeamId} onClick={() => switchTo(t.id)} />
            ))}
          </div>
          {joined.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <TeamOutlined className="text-xs text-gray-400" />
                <span className="text-xs font-medium text-gray-400">加入的团队</span>
                <span className="text-xs text-gray-600">{joined.length}</span>
              </div>
              {joined.map((t) => (
                <TeamCard key={t.id} team={t} active={t.id === currentTeamId} onClick={() => switchTo(t.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
```

- [x] **Step 4: 跑测试确认绿**

Run: `pnpm --filter web exec vitest run src/pages/team/TeamSidebar.test.tsx`
Expected: 7 用例全 PASS

- [x] **Step 5: Commit**

```bash
git add apps/web/src/pages/team/TeamSidebar.tsx apps/web/src/pages/team/TeamSidebar.test.tsx
git commit -m "feat(web): TeamSidebar——个人置顶+创建/加入分组+三统计卡片+sticky 自滚（三态渲染）"
```

---

### Task 7: TeamPage 拆分（布局壳 + TeamDetail key 重挂载）+ 测试迁移

**Files:**
- Create: `apps/web/src/pages/team/TeamDetail.tsx`（自 TeamPage.tsx 搬运）
- Modify: `apps/web/src/pages/team/TeamPage.tsx`（重写为布局壳）
- Test: Modify `apps/web/src/pages/team/TeamPage.test.tsx`

- [x] **Step 1: 先迁移测试（红）**

TeamPage.test.tsx 改动：

(a) 头部 import 增加：
```ts
import { useTeamStore, _internal } from '@/stores/teamStore';
import { within } from '@testing-library/react';
```

(b) hoisted api 工厂（:6-24）内补 TeamSidebar 依赖的 helper（整模块 mock 下缺失则渲染即崩）：
```ts
teamCreditsTotal: (b: { credits: number; subscriptionCredits: number }) => b.credits + b.subscriptionCredits,
```

(c) describe 内 beforeEach 改为：
```ts
beforeEach(() => {
  vi.clearAllMocks();
  setup();
  localStorage.clear();
  _internal.reset();
  useTeamStore.setState({ teams: [], status: 'loading', currentTeamId: null });
});
```

(d) 用例 ③（:69-76）改写为 within 作用域——sidebar 同屏后卡片积分 500/成员 2 与概览 total 500/席位 2 撞文本，getByText 多匹配直接抛错：
```ts
it('③ OverviewCard：剩余积分=总额+通用积分、席位 n/20、存储 1.0G/6.0G', async () => {
  render(<MemoryRouter><TeamPage /></MemoryRouter>);
  await screen.findByText('张三');
  const detail = within(screen.getByTestId('team-detail'));
  expect(detail.getByText('500')).toBeInTheDocument();
  expect(detail.getByText('通用积分 400')).toBeInTheDocument();
  expect(detail.getByText('2')).toBeInTheDocument();
  expect(detail.getByText('1.0G')).toBeInTheDocument();
});
```
（依赖 Step 4 布局壳 section 上的 `data-testid="team-detail"`；其余用例已核不撞，无需动）

(e) 用例 ⑪（:112-119）改写为点击列表项 + 集成断言：
```ts
it('⑪ 点击左侧列表项切换：store 更新且右侧数据以新 teamId 重拉（无刷新核心承诺）', async () => {
  render(<MemoryRouter><TeamPage /></MemoryRouter>);
  await screen.findByText('张三');
  fireEvent.click(screen.getByTestId('team-card-t2'));
  expect(useTeamStore.getState().currentTeamId).toBe('t2');
  await waitFor(() => expect(api.listMembers).toHaveBeenCalledWith('t2', 1));
});
```

(f) 空态用例（:127-134"只有默认团队时空状态"）改写——A1 下空态不可达，默认选中即个人面板：
```ts
it('只有默认团队时：渲染个人面板（无空态），创建入口在 sidebar', async () => {
  api.getMyTeams.mockResolvedValue([
    { id: 't1', name: '我的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, projectCount: 0, balance: { credits: 100, subscriptionCredits: 0 }, subscription: null },
  ]);
  render(<MemoryRouter><TeamPage /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: '个人项目' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '创建团队' })).toBeInTheDocument();
  expect(screen.queryByText(/还没有团队/)).not.toBeInTheDocument();
});
```

(g) "个人面板提供团队切换 select"（:151-167）改写为点击列表项：
```ts
it('个人面板下点击右侧团队卡片切换到团队管理', async () => {
  api.getMyTeams.mockResolvedValue([
    { id: 't1', name: '我的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, projectCount: 0, balance: { credits: 100, subscriptionCredits: 50 }, subscription: { planName: 'pro', status: 'active', currentPeriodEnd: '2026-09-15' } },
    { id: 't2', name: '第二团队', role: 'OWNER', status: 'ACTIVE', isDefault: false, isOwner: true, createdAt: '2026-08-02', memberCount: 2, projectCount: 0, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
  ]);
  useTeamStore.setState({ currentTeamId: 't1' });
  api.getTeamBalanceView.mockResolvedValue({ credits: 100, subscriptionCredits: 50, total: 150, quota: 0, used: 0 });
  render(<MemoryRouter><TeamPage /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: '个人项目' })).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('team-card-t2'));
  await waitFor(() => expect(useTeamStore.getState().currentTeamId).toBe('t2'));
  expect(await screen.findByTestId('tab-members')).toBeInTheDocument();
});
```

(h) 个人面板另两用例（:136-149、:169-181）：把 `localStorage.setItem('currentTeamId', 't1')` 替换为 `useTeamStore.setState({ currentTeamId: 't1' })`（store 初始化只读一次 LS，运行中 set LS 无效）；断言不变。

(i) `team` fixture（:31-35）已在 Task 3 补过 projectCount，无需再动。

- [x] **Step 2: 跑测试确认红**

Run: `pnpm --filter web exec vitest run src/pages/team/TeamPage.test.tsx`
Expected: FAIL（team-sidebar/team-card 不存在、仍渲染 select）

- [x] **Step 3: 创建 TeamDetail.tsx（搬运 + 改造点）**

新文件骨架：从 TeamPage.tsx **原样搬运**以下区块，再应用改动点：

搬运清单（行号针对当前 TeamPage.tsx）：
- :13-38 常量 `ACCENT`、`fmtBytes`、`ROLE_LABEL`、`ACTION_LABEL`
- :46-66 除 createOpen/createName/creating 外的全部 state（tab、members、memberPage、balance、transactions、txPage、limits、usage、requests、auditLogs、auditPage、renameOpen、renameValue、inviteOpen、quotaTarget、quotaValue）
- :88-121 数据拉取（refreshAll、个人余额 effect、refreshAudit）
- :160-203 个人面板
- :205-217 角色/tabs 派生
- :222-269 header
- :270-494 概览卡、tabs、模态（rename/invite/quota）

改动点（逐处替换，其余原样）：

1. 头部：
```tsx
import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import { Table, Button, Modal, Input, Progress, Tag, message, Pagination, Switch } from 'antd';
import {
  listMembers, changeRole, removeMember, setQuota, renameTeam, disbandTeam, transferOwnership,
  listJoinRequests, approveJoinRequest, rejectJoinRequest,
  getTeamBalanceView, listTeamTransactions,
  getTeamLimits, getTeamUsage,
  getAuditLogs, teamDisplayName, type AuditLogRow, type MyTeam,
} from '@/api/teamApi';
import { useAuth } from '@/components/AuthProvider';
import { useTeamStore } from '@/stores/teamStore';

interface TeamDetailProps {
  team: MyTeam;
  /** 打开外层 createModal（个人面板与 header 的新建团队按钮共用） */
  onCreateTeam: () => void;
}

/** 团队/个人面板主体：key={team.id} 由父层强制重挂载，切换团队时本地 state 天然归零 */
export function TeamDetail({ team, onCreateTeam }: TeamDetailProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const teamId = team.id;
```
（不再有 teams/teamId/team state；isPersonal/isOwner/isAdmin/tabs 派生中的 `team` 直接用 prop）

2. 删除原 :68-86（realTeams 派生、switchTeam、refreshTeams、其 useEffect）——列表职责移交 store/sidebar。

3. refreshAll / 个人余额 effect / refreshAudit 依赖数组中的 `teamId` 已是 prop 派生常量，`team` 同理；refreshAudit 中 `!team ||` 判断可删（prop 恒非空）。

4. 个人面板（原 :184-198）按钮行：
```tsx
<div className="flex gap-3">
  <Link to="/settings/credits" data-testid="link-personal-recharge" className="px-4 py-1.5 rounded-md bg-[#f59e0b] text-black text-sm no-underline">充值</Link>
  <Link to="/settings/membership" data-testid="link-personal-membership" className="px-4 py-1.5 rounded-md bg-[#4ade80] text-black text-sm no-underline">开通/管理会员</Link>
  <Button size="small" onClick={onCreateTeam}>新建团队</Button>
</div>
```
（select 块删除）

5. header 解散按钮（原 :249-258）：
```tsx
{isOwner && (
  <Button danger size="small" onClick={() => {
    Modal.confirm({
      title: '解散团队',
      content: useTeamStore.getState().teams.length <= 1 ? '不能解散唯一团队' : '解散后项目与素材将被删除，支付凭证保留。确认解散？',
      okButtonProps: { disabled: useTeamStore.getState().teams.length <= 1 },
      onOk: async () => {
        await disbandTeam(teamId);
        message.success('已解散');
        useTeamStore.getState().remove(teamId);
      },
    });
  }}>解散团队</Button>
)}
```
（口径注意：全量 teams 含默认团队，不得用 realTeams）

6. header 新建按钮（原 :259）：`onClick={() => setCreateOpen(true)}` → `onClick={onCreateTeam}`；紧随的 select 块（:260-269）删除。

7. 重命名模态 onOk（原 :470）：
```tsx
onOk={async () => {
  await renameTeam(teamId, renameValue || team.name);
  setRenameOpen(false);
  useTeamStore.getState().upsert({ id: teamId, name: renameValue || team.name });
}}
```

8. 转让所有权 onOk（原 :352-361）：成功分支 `void refreshTeams(); void refreshAll();` 改为：
```tsx
void useTeamStore.getState().fetchTeams().then(refreshAll).catch(() => message.error('团队信息刷新失败'));
```

9. 成员数同步（memberCount 变化必须刷 store，否则 sidebar 卡片数字陈旧）。**只改这两处**：移除成员（原 :368 removeMember）与批准入团（原 :430 approveJoinRequest）的 `.then(refreshAll)` 改为：
```tsx
.then(() => {
  void useTeamStore.getState().fetchTeams().catch(() => undefined);
  return refreshAll();
})
```
**不要顺手改**：拒绝申请（原 :431 reject——成员数不变，fetchTeams 纯冗余，仅保留 refreshAll）、改角色（原 :345 changeRole——memberCount 不变）。

10. 文件尾部去掉 `{createModal}` 与其定义（留在外层壳）。

- [x] **Step 4: 重写 TeamPage.tsx 为布局壳（完整文件）**

```tsx
import { useEffect, useState } from 'react';
import { Button, Modal, Input, message } from 'antd';
import { createTeam } from '@/api/teamApi';
import { useTeamStore } from '@/stores/teamStore';
import { TeamSidebar } from './TeamSidebar';
import { TeamDetail } from './TeamDetail';

/** /team 布局壳：订阅 store 三态；持有 createModal（sidebar 与右侧共用）；TeamDetail key 重挂载 */
export default function TeamPage() {
  const status = useTeamStore((s) => s.status);
  const teams = useTeamStore((s) => s.teams);
  const currentTeamId = useTeamStore((s) => s.currentTeamId);
  const ensureTeams = useTeamStore((s) => s.ensureTeams);
  const fetchTeams = useTeamStore((s) => s.fetchTeams);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);

  // 页面自查数据，不依赖顶栏 TeamSwitcher 恰好挂载（独立 render 测试也无 TopActionBar）
  useEffect(() => { void ensureTeams(); }, [ensureTeams]);

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
      await fetchTeams();
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
                  <Button onClick={() => { void fetchTeams().catch(() => undefined); }}>重试</Button>
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
```

- [x] **Step 5: 跑测试确认绿**

Run: `pnpm --filter web exec vitest run src/pages/team/TeamPage.test.tsx`
Expected: 全 PASS（含新集成断言用例）
Run: `pnpm --filter web exec tsc -p tsconfig.json --noEmit`
Expected: 0 error

- [x] **Step 6: Commit**

```bash
git add apps/web/src/pages/team/TeamPage.tsx apps/web/src/pages/team/TeamDetail.tsx apps/web/src/pages/team/TeamPage.test.tsx
git commit -m "feat(web): /team 左侧团队列表布局——TeamDetail key 重挂载无刷新切换 + 删两个 select 与空态分支"
```

---

### Task 8: TeamSwitcher 订阅 store（TDD 迁移）

**Files:**
- Modify: `apps/web/src/components/TeamSwitcher.tsx`（重写）
- Test: Modify `apps/web/src/components/TeamSwitcher.test.tsx`

- [x] **Step 1: 迁移测试（红）**

TeamSwitcher.test.tsx 改动：

(a) import 增 `import { useTeamStore, _internal } from '@/stores/teamStore';`；删除 stubLocation/mockReload 定义与调用（不再有 reload）。

(b) beforeEach 改为：
```ts
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  _internal.reset();
  useTeamStore.setState({ teams: [], status: 'loading', currentTeamId: null });
});
```

(c) 用例 ①：`localStorage.setItem('currentTeamId', 't2')` → `useTeamStore.setState({ currentTeamId: 't2' })`；断言不变。

(d) 用例 ②（切换）改写：
```ts
it('② 切换：点 A 团 → store.currentTeamId=t1（无 reload）', async () => {
  api.getMyTeams.mockResolvedValue([team('t1', 'A 团'), team('t2', 'B 团')]);
  useTeamStore.setState({ currentTeamId: 't2' });
  render(<TeamSwitcher />);
  await screen.findByText('B 团');
  fireEvent.click(screen.getByRole('button', { name: /B 团/ }));
  fireEvent.click(await screen.findByText('A 团'));
  await waitFor(() => expect(useTeamStore.getState().currentTeamId).toBe('t1'));
  expect(localStorage.getItem('currentTeamId')).toBe('t1');
});
```

(e) 用例 ③（解散回退）改写：
```ts
it('③ 归一化：currentTeamId=dead 不在列表 → store 与 LS 回退 t1（无 reload）', async () => {
  api.getMyTeams.mockResolvedValue([team('t1', 'A 团')]);
  useTeamStore.setState({ currentTeamId: 'dead' });
  render(<TeamSwitcher />);
  await waitFor(() => expect(useTeamStore.getState().currentTeamId).toBe('t1'));
  expect(localStorage.getItem('currentTeamId')).toBe('t1');
});
```

(f) 用例 ④⑤⑥：断言不变（④ 只默认团队隐藏；⑤ 菜单序+✓；⑥ 无新建入口）。

- [x] **Step 2: 跑测试确认红**

Run: `pnpm --filter web exec vitest run src/components/TeamSwitcher.test.tsx`
Expected: FAIL（组件仍走 localStorage/reload）

- [x] **Step 3: 重写 TeamSwitcher.tsx（完整文件）**

```tsx
import { useEffect } from 'react';
import { Dropdown, message } from 'antd';
import type { MenuProps } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { teamDisplayName } from '@/api/teamApi';
import { useTeamStore } from '@/stores/teamStore';

/** 顶栏团队切换器：teamStore 驱动（挂载即 ensureTeams 拉取点）；只有默认团队时整体隐藏 */
export function TeamSwitcher() {
  const teams = useTeamStore((s) => s.teams);
  const status = useTeamStore((s) => s.status);
  const currentTeamId = useTeamStore((s) => s.currentTeamId);
  const ensureTeams = useTeamStore((s) => s.ensureTeams);
  const switchTo = useTeamStore((s) => s.switchTo);

  useEffect(() => {
    void ensureTeams();
  }, [ensureTeams]);

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
```

- [x] **Step 4: 跑测试确认绿**

Run: `pnpm --filter web exec vitest run src/components/TeamSwitcher.test.tsx`
Expected: 6 用例全 PASS

- [x] **Step 5: Commit**

```bash
git add apps/web/src/components/TeamSwitcher.tsx apps/web/src/components/TeamSwitcher.test.tsx
git commit -m "refactor(web): TeamSwitcher 订阅 teamStore——无 reload 切换、归一化收编 store、挂载即拉取点"
```

---

### Task 9: 全量验证门 + 浏览器验收

- [x] **Step 1: 全量门**

Run: `pnpm --filter web exec tsc -p tsconfig.json --noEmit`
Expected: 0 error
Run: `pnpm --filter web test`
Expected: 全绿
Run: `pnpm --filter api test`
Expected: 全绿（含 tsc）
Run: `pnpm --filter web lint`
Run: `pnpm --filter api lint`
Expected: 均 0 error 0 warning（搬运后未使用导入之类问题在此拦截；Windows shell 下勿用 && 链接，分两次执行）

- [x] **Step 2: Commit（如有零星修正）**

```bash
git add -A apps/web/src apps/api/src
git commit -m "test(team): 全量验证门通过"
```
（无修正则跳过）

- [x] **Step 3: 浏览器验收（spec §9 九项，用 preview_* 工具）**

启动 dev server 后逐项验证并截图留证：
1. 左列表：个人置顶 / 创建组 / 加入组 / 徽标 / 选中渐变态
2. 点击切换无刷新（右侧标题、成员、积分跟随；URL 不变）
3. 顶栏 TeamSwitcher 同步更新
4. 创建团队 → 自动切新团队且列表即时出现
5. 解散 → 列表移除 + 回退；唯一团队时禁用
6. 重命名 → 列表即时更新
7. 公告开/关时 sidebar sticky 偏移（64/0）
8. preflight 目检：卡片边框显示、button 无 UA 灰底
9. sidebar 卡片积分与右侧概览 total 一致

发现问题 → 修复 → 回归 Step 1 全量门（循环直至九项全过）。

- [x] **Step 4: 最终 Commit**

```bash
git add docs
git commit -m "docs(team): 浏览器验收记录（九项）"
```

---

## 浏览器验收记录（2026-09-08，spec §9 九项）

环境：dev（web:5173 + api:3000 + 本地 PG/MinIO），账号 admin@flowweb.local，preview_* 工具实测。

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| 1 | 左列表渲染 | ✅ | 个人项目置顶卡（UserOutlined 头像）+「创建的团队 2」（CrownFilled+徽标）+「加入的团队 1」（TeamOutlined+徽标，MEMBER 卡无皇冠）；无加入团队时该组整组不渲染（实证）；选中卡 `from-cyan-500/10` 渐变+青边框 |
| 2 | 点击切换无刷新 | ✅ | 点「团队测试」卡：active 卡切换、右侧 header/成员跟随、`window.__noReload` 标记保持（无整页 reload）、URL 恒为 /team |
| 3 | 顶栏 TeamSwitcher 同步 | ✅ | 切换后顶栏按钮文案即时变为新团队名（含切到加入团队场景），无 reload |
| 4 | 创建团队 | ✅ | 「验收临时团队」创建后：sidebar 即时出现第 4 卡、自动切到新团队（active+右侧 header）、无 reload（弹窗关闭为 antd 默认 DOM 保留 display:none，非异常） |
| 5 | 解散回退 | ✅ | 解散「验收改名团队」：列表移除、回退个人项目（active/LS/右侧面板三处一致）；「唯一团队禁用」分支浏览器不可达（唯一团队=默认团队=个人面板无解散按钮），由代码审查（全量 teams 口径）+单测覆盖 |
| 6 | 重命名即时更新 | ✅ | 「验收临时团队」→「验收改名团队」：sidebar 卡片名与右侧 header 即时更新（upsert 链路），无 reload |
| 7 | 公告 sticky 偏移 | ✅ | 注入公告：AnnouncementBar 出现，sidebar top 60→124px、maxHeight calc(100vh-124px)；置空恢复 60px/calc(100vh-60px)，响应式切换实证 |
| 8 | preflight 目检 | ✅ | computed style 实证：卡片 button background-color rgba(0,0,0,0)（无 UA 灰底）、border-style solid（边框显示）、box-sizing border-box、font-family 继承全局栈（font-[inherit] 修复生效）、text-align left |
| 9 | 积分双源一致 | ✅ | 个人项目：sidebar 卡 100 = 右侧「可用积分（通用 100·订阅 0）」100（teamCreditsTotal 同式）；团队场景 0=0 一致 |

全量验证门：web tsc 0 error / web 2038 tests 全绿 / api（含 tsc）941 tests 全绿。lint 门：eslint 从未在本仓库声明安装（三级 package.json 均无），环境缺失非代码违规，跳过并记录。

过程偏差登记：
- plan Task 2 Step 4「tsc 报 7 文件红」预期过时（fixture 无类型标注，实际 0 红——与 Task 3 定位说明一致，非实现问题）
- plan Task 4「8 用例」为笔误，实际测试代码 9 个 it 块，9 passed
- 质量审查追加修复 a3c4239：TeamSidebar button 补 font-[inherit]（preflight 无继承，站内先例 WorkspaceToolbar）+ 统计断言 toContain('5') 被 '150' 吸收改 getByText 独立匹配
- 新登记上线必修项 #17：teamStore 换账号后陈旧（spec「不做登出 reset」的「失效回退兜底」理由不成立——ensureTeams 在 success 态不进 load；works/materials 存量同病，本次把常驻顶栏纳入暴露面）
- 既有 UX 观察（不在本次 scope）：MEMBER 视角右侧 header 仍显示「重命名」按钮（后端 TeamGuard 会 403 兜底，前端无 role 门控系搬运前既有行为）

验收临时数据已清理（临时团队/用户删除，TeamMember 随 Cascade）。
