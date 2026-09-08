# teamStore 换账号失效 + 团队入口重入刷新 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec `docs/superpowers/specs/2026-09-08-teamstore-user-invalidation-design.md`（v4）——#17 换账号 store 陈旧（loadedUserId 失效）与 #18 团队入口重入不刷新（挂载改 force）。

**Architecture:** 换号检测内聚 `load(force, userId)`（ensure/fetch 两条路径统一经过），仅 owner 已立的真换号才清 store（首拉保留 LS 记忆）；TeamSwitcher 保持 ensure 语义，TeamPage/useTeams 挂载改 fetchTeams 强制重拉；TS 必填签名编译期逼出全部调用点。

**Tech Stack:** React 18 + TypeScript strict + Zustand + Vitest + @testing-library/react（monorepo，全部改动在 apps/web，另 team.service.ts 一行注释在 apps/api）。

**关键约定（全计划适用）：**
- 测试命令在仓库根 `D:\flowweb` 执行；vitest 不做类型检查（类型错靠 `tsc --noEmit` 抓）。
- userId 取用规则：组件挂载 effect 与重试按钮用 `if (user)` 门控；TeamDetail 写操作异步回调内用 `user!.id`（RequireAuth 保证非空）。
- 各组件测试的 AuthProvider mock 统一格式（先例 TeamPage.test.tsx:30-32；`AuthContext` 默认值 `null!`，无 mock 时 `useAuth()` 返回 null，解构即崩——这是必须补 mock 的原因）：
  ```ts
  vi.mock('@/components/AuthProvider', () => ({
    useAuth: () => ({ user: { id: 'u1', name: '我' }, loading: false }),
  }));
  ```

**文件结构（改动全景）：**

| 文件 | 任务 | 性质 |
|---|---|---|
| `apps/web/src/stores/teamStore.ts` | Task 1 | 核心改造 |
| `apps/web/src/stores/teamStore.test.ts` | Task 1 | 新用例组 + 既有迁移 |
| `apps/web/src/components/TeamSwitcher.tsx` / `.test.tsx` | Task 2 | useAuth + 带参 + mock + 换号用例 |
| `apps/web/src/pages/team/TeamPage.tsx` / `.test.tsx` | Task 2、3 | useAuth + 带参；Task 3 挂载改 fetch + 重入用例 |
| `apps/web/src/pages/team/TeamSidebar.tsx` / `.test.tsx` | Task 2 | useAuth + 重试带参 + mock |
| `apps/web/src/pages/team/TeamDetail.tsx` | Task 2 | 三处 `user!.id` |
| `apps/web/src/pages/workspace/hooks/useTeams.ts` / `.test.tsx` | Task 2、3 | useAuth + 带参；Task 3 挂载改 fetch + 重入用例 |
| `apps/web/src/pages/workspace/__tests__/WorkspacePage.test.tsx`、`WorkspacePage.folder-create.test.tsx`、`apps/web/src/pages/materials/MaterialsPage.test.tsx` | Task 2 | 仅补 AuthProvider mock |
| `apps/api/src/modules/team/team.service.ts` | Task 4 | 一行注释（E4） |

---

### Task 1: teamStore——loadedUserId 换号失效 + 必填签名（TDD，与 Task 2 同一提交）

**Files:**
- Modify: `apps/web/src/stores/teamStore.ts`（load 重写 L55-78、签名 L31-34、`_internal` L118-124）
- Test: `apps/web/src/stores/teamStore.test.ts`

- [x] **Step 1: 新增"换账号失效"用例组（写失败测试）**

在 teamStore.test.ts 的 `describe('teamStore', ...)` 内、`it('selectors...')` 用例之后追加（fixture `team`/`T_DEFAULT`/`LIST`/`deferred` 文件内已有）：

```ts
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
```

- [x] **Step 2: 跑新用例确认失败**

Run: `pnpm --filter @flowweb/web exec vitest run src/stores/teamStore.test.ts`
Expected: FAIL——新用例中 `ensureTeams('a')` 传参在旧签名下被忽略，owner 概念不存在，"换号/短路/fetch 立 owner"断言均红（如第 1 条 `toHaveBeenCalledTimes(2)` 实际 1、第 4 条实际 2 等）。

- [x] **Step 3: 实现 store（最小实现）**

teamStore.ts 三处修改。

(a) 模块级变量（L23-24 区域，加一行）：

```ts
let inFlight: Promise<MyTeam[]> | null = null;
let seq = 0;
let loadedUserId: string | null = null;
```

(b) `TeamState` 接口签名（L31-34 替换）：

```ts
  /** 换号检测 + success 跳过；否则拉取并复用 in-flight（双挂载去重）。永不 reject（error 态由三态渲染兜底） */
  ensureTeams: (userId: string) => Promise<void>;
  /** 强制重拉：不复用 in-flight，失败 reject 由调用方 message 提示 */
  fetchTeams: (userId: string) => Promise<void>;
```

(c) `load` 整体替换（L55-78）：

```ts
  const load = (force: boolean, userId: string): Promise<MyTeam[]> => {
    if (loadedUserId !== userId) {
      const isSwitch = loadedUserId !== null; // 首拉（owner 未立）≠ 换号：不清 currentTeamId（保留 LS 记忆）
      loadedUserId = userId; // 进入即记：扛 StrictMode 双 effect（第二发走同人路径复用 in-flight）
      if (isSwitch) set({ teams: [], currentTeamId: null, status: 'loading' });
      force = true;
    }
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
        // 非当代回包不置 error；已有数据失败保留旧数据维持 success（owner 确立在入口分支，无需回包再写）
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
```

(d) action 绑定（L85-89 替换）：

```ts
    ensureTeams: (userId) => load(false, userId).then(
      () => undefined,
      () => undefined, // 永不 reject：error 终态由消费组件三态渲染兜底
    ),
    fetchTeams: (userId) => load(true, userId).then(() => undefined), // 失败透传，调用方 message
```

(e) `_internal.reset()`（L118-124 替换）：

```ts
/** 测试专用：清模块级 inFlight/seq/loadedUserId（setState 清不掉它们） */
export const _internal = {
  reset() {
    inFlight = null;
    seq = 0;
    loadedUserId = null;
  },
};
```

- [x] **Step 4: 跑新用例确认通过**

Run: `pnpm --filter @flowweb/web exec vitest run src/stores/teamStore.test.ts`
Expected: 新 describe 6 条 PASS。既有用例**大概率也绿**（vitest 不做类型检查，无参调用 `ensureTeams()` 运行时 userId=undefined：首调进换号分支记 owner=undefined、二调 undefined===undefined 同人短路——行为自洽），真正逼出 Step 5 迁移的是 Task 2 Step 10 的 `tsc --noEmit`（TS2554 缺参编译错）。勿因既有用例绿而跳过 Step 5。

- [x] **Step 5: 迁移既有用例（机械加参）**

teamStore.test.ts 既有用例中所有无参调用替换为带 `'u1'`（同用例内保持一致即可）：

- L40 `ensureTeams()` → `ensureTeams('u1')`
- L48 两个 `ensureTeams()` → `ensureTeams('u1')`（同轮双调用）
- L53 `ensureTeams()` → `ensureTeams('u1')`
- L60 `ensureTeams()` → `ensureTeams('u1')`
- L69 `ensureTeams()` / L70 `fetchTeams()` → 各带 `'u1'`
- L80 `ensureTeams()` → `ensureTeams('u1')`
- L85、L87 `fetchTeams()` → `fetchTeams('u1')`

注意两个用例在 v4 语义下的行为核对：
- "运行中改 LS 不影响 store"（L34）：`ensureTeams('u1')` 是首拉（owner=null）→ 不清 `currentTeamId:'t1'` → normalize 保留 → 断言绿（正是 v4 语义）。
- "ensureTeams 去重"（L45）：同轮双调，第一次进入换号分支记 owner='u1'，第二次同人 + loading 态复用 in-flight → 1 次请求；成功后再调短路 → 仍 1 次。绿。

- [x] **Step 6: store 测试全绿**

Run: `pnpm --filter @flowweb/web exec vitest run src/stores/teamStore.test.ts`
Expected: 全部 PASS（此时消费组件尚未迁移——不跑全量、不提交，Task 2 末尾统一提交）。

---

### Task 2: 五个消费组件迁移 + 六个测试文件补 mock（#17 闭环；与 Task 1 统一提交）

**Files:**
- Modify: `apps/web/src/components/TeamSwitcher.tsx`
- Modify: `apps/web/src/pages/team/TeamPage.tsx`
- Modify: `apps/web/src/pages/team/TeamSidebar.tsx`
- Modify: `apps/web/src/pages/team/TeamDetail.tsx`（:287/:300/:367）
- Modify: `apps/web/src/pages/workspace/hooks/useTeams.ts`
- Test: 上述组件对应测试 + `WorkspacePage.test.tsx`、`WorkspacePage.folder-create.test.tsx`、`MaterialsPage.test.tsx`

- [x] **Step 1: TeamSwitcher.tsx 改造**

import 区加 `import { useAuth } from '@/components/AuthProvider';`，组件体与 effect 替换：

```tsx
export function TeamSwitcher() {
  const { user } = useAuth();
  const teams = useTeamStore((s) => s.teams);
  const status = useTeamStore((s) => s.status);
  const currentTeamId = useTeamStore((s) => s.currentTeamId);
  const ensureTeams = useTeamStore((s) => s.ensureTeams);
  const switchTo = useTeamStore((s) => s.switchTo);

  useEffect(() => {
    if (user) void ensureTeams(user.id);
  }, [user, ensureTeams]);
```

（其余渲染逻辑不变。）

- [x] **Step 2: TeamPage.tsx 改造（本任务挂载仍 ensure，Task 3 再改 fetch）**

import 区加 `import { useAuth } from '@/components/AuthProvider';`；组件体：

```tsx
  const { user } = useAuth();
  const status = useTeamStore((s) => s.status);
  const teams = useTeamStore((s) => s.teams);
  const currentTeamId = useTeamStore((s) => s.currentTeamId);
  const ensureTeams = useTeamStore((s) => s.ensureTeams);
  const fetchTeams = useTeamStore((s) => s.fetchTeams);
```

挂载 effect（L20-21 替换，注释同步更新）：

```tsx
  // 页面自查数据，不依赖顶栏 TeamSwitcher 恰好挂载（独立 render 测试也无 TopActionBar）
  useEffect(() => { if (user) void ensureTeams(user.id); }, [user, ensureTeams]);
```

创建链路 L36：`await fetchTeams();` → `await fetchTeams(user!.id);`
重试按钮 L62：

```tsx
                  <Button onClick={() => { if (user) void fetchTeams(user.id).catch(() => undefined); }}>重试</Button>
```

- [x] **Step 3: TeamSidebar.tsx 改造**

import 区加 `import { useAuth } from '@/components/AuthProvider';`；`TeamSidebar` 组件体（L42 区域）加：

```tsx
  const { user } = useAuth();
```

重试按钮 onClick（L83）替换：

```tsx
            onClick={() => { if (user) void fetchTeams(user.id).catch(() => undefined); }}
```

- [x] **Step 4: TeamDetail.tsx 三处带参（组件已有 `const { user } = useAuth()`，:50；组件体**无**局部 fetchTeams selector——三处保持 `useTeamStore.getState()` 形式，diff 最小）**

- :287 整行替换：

```ts
                                void useTeamStore.getState().fetchTeams(user!.id).then(refreshAll).catch(() => message.error('团队信息刷新失败'));
```

- :300 与 :367 整行替换（两处相同）：

```ts
                              void useTeamStore.getState().fetchTeams(user!.id).catch(() => undefined);
```

（`user!.id`：三处均在写操作异步回调内，RequireAuth 保证非空；裸 `fetchTeams(...)` 是未定义标识符，勿写。）

- [x] **Step 5: useTeams.ts 改造（本任务挂载仍 ensure，Task 3 再改 fetch）**

整文件替换为：

```ts
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
  const ensureTeams = useTeamStore((s) => s.ensureTeams);
  const fetchTeams = useTeamStore((s) => s.fetchTeams);

  useEffect(() => {
    if (user) void ensureTeams(user.id);
  }, [user, ensureTeams]);

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
```

- [x] **Step 6: TeamSwitcher.test.tsx 补 mock + 新增换号用例**

(a) mock 区（`vi.mock('@/api/teamApi', () => api);` 之后）加可变 user 的 mock：

```ts
const auth = vi.hoisted(() => ({ user: { id: 'a', name: 'A' } }));
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: auth.user, loading: false }),
}));
```

(b) beforeEach 末尾重置：`auth.user = { id: 'a', name: 'A' };`

(c) 新增用例（describe 内末尾）：

```ts
  it('⑦ 换账号：user.id 变化 → 强制重拉，B 团队替换 A 团队', async () => {
    api.getMyTeams.mockResolvedValue([team('a1', 'A团')]);
    const { rerender } = render(<TeamSwitcher />);
    await screen.findByText('A团');
    api.getMyTeams.mockResolvedValue([team('b1', 'B团')]);
    api.getMyTeams.mockClear();
    auth.user = { id: 'b', name: 'B' };
    rerender(<TeamSwitcher />);
    await screen.findByText('B团');
    expect(api.getMyTeams).toHaveBeenCalledTimes(1); // 换号强制重拉
    expect(screen.queryByText('A团')).toBeNull();
  });

  it('⑧ 未登录 user=null：不发起任何拉取（if(user) 门控）', () => {
    auth.user = null;
    render(<TeamSwitcher />);
    expect(api.getMyTeams).not.toHaveBeenCalled();
  });
```

- [x] **Step 7: useTeams.test.tsx 补 mock**

mock 区（`vi.mock('@/api/teamApi', ...)` 之后）加：

```ts
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', name: '我' }, loading: false }),
}));
```

（既有 2 用例断言不变：beforeEach 重置 store 后首拉行为与旧版等价。）

- [x] **Step 8: TeamSidebar.test.tsx 补 mock**

同 Step 7 格式，加在 `vi.mock('@/api/teamApi', ...)` 之后。（"点击重试调 fetchTeams"用例 :40 是 spyOn 断言被调，带参调用不影响。）

- [x] **Step 9: WorkspacePage.test.tsx / WorkspacePage.folder-create.test.tsx / MaterialsPage.test.tsx 补 mock**

三个文件均在各自 `vi.mock('@/api/teamApi', ...)` 块之后加同款：

```ts
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', name: '我' }, loading: false }),
}));
```

（这些页面经 useTeams 间接渲染 useAuth，无 mock 即崩；断言不变——重置态首拉请求次数与旧版相同。）

- [x] **Step 10: 全量回归 + 类型检查**

Run: `pnpm --filter @flowweb/web exec vitest run` 
Expected: 全部 PASS
Run: `pnpm --filter @flowweb/web exec tsc --noEmit`
Expected: 无错误（必填签名下任何漏改调用点在此暴露）

- [x] **Step 11: Commit（Task 1 + Task 2 统一提交）**

```bash
git add apps/web/src/stores/teamStore.ts apps/web/src/stores/teamStore.test.ts apps/web/src/components/TeamSwitcher.tsx apps/web/src/components/TeamSwitcher.test.tsx apps/web/src/pages/team/TeamPage.tsx apps/web/src/pages/team/TeamSidebar.tsx apps/web/src/pages/team/TeamSidebar.test.tsx apps/web/src/pages/team/TeamDetail.tsx apps/web/src/pages/workspace/hooks/useTeams.ts apps/web/src/pages/workspace/hooks/useTeams.test.tsx apps/web/src/pages/workspace/__tests__/WorkspacePage.test.tsx apps/web/src/pages/workspace/__tests__/WorkspacePage.folder-create.test.tsx apps/web/src/pages/materials/MaterialsPage.test.tsx
git commit -m "feat(web): teamStore 换账号失效（loadedUserId，仅真换号清空）+ ensureTeams/fetchTeams userId 必填全调用点迁移（#17）"
```

---

### Task 3: #18——TeamPage / useTeams 挂载 ensure→fetch（TDD）

**Files:**
- Modify: `apps/web/src/pages/team/TeamPage.tsx`（挂载 effect + 删 ensure selector）
- Modify: `apps/web/src/pages/workspace/hooks/useTeams.ts`（同）
- Test: `apps/web/src/pages/team/TeamPage.test.tsx`、`apps/web/src/pages/workspace/hooks/useTeams.test.tsx`

- [x] **Step 1: TeamPage.test 新增重入用例（写失败测试）**

describe 内末尾追加（fixture `team` 与 `setup()` 文件内已有）：

```ts
  it('⑫ 重入刷新：success 态重挂载强制重拉 /team/mine（他人侧变更可见）', async () => {
    const { unmount } = render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await waitFor(() => expect(useTeamStore.getState().status).toBe('success')); // 首挂成功
    api.getMyTeams.mockResolvedValue([
      team,
      { ...team, id: 't2', name: '第二团队', role: 'MEMBER' as const, isOwner: false },
      { ...team, id: 't3', name: '新批准的团队', role: 'MEMBER' as const, isOwner: false },
    ]);
    api.getMyTeams.mockClear();
    unmount();
    render(<MemoryRouter><TeamPage /></MemoryRouter>);
    await waitFor(() => expect(api.getMyTeams).toHaveBeenCalledTimes(1)); // ensure 会跳过 → 当前红
    expect(await screen.findByText('新批准的团队')).toBeInTheDocument();
  });
```

- [x] **Step 2: useTeams.test 新增重入用例（写失败测试）**

```ts
  it('重入刷新：success 后重新挂载强制重拉（新团队可见）', async () => {
    mockGetMyTeams.mockResolvedValue([team('owned-1', true)]);
    const first = renderHook(() => useTeams());
    await waitFor(() => expect(first.result.current.state.status).toBe('success'));
    mockGetMyTeams.mockResolvedValue([team('owned-1', true), team('owned-2', true)]);
    mockGetMyTeams.mockClear();
    first.unmount();
    const second = renderHook(() => useTeams());
    await waitFor(() => expect(mockGetMyTeams).toHaveBeenCalledTimes(1)); // ensure 会跳过 → 当前红
    await waitFor(() => expect(second.result.current.realTeams.map((t) => t.id)).toEqual(['owned-1', 'owned-2']));
  });
```

- [x] **Step 3: 跑两个新用例确认失败**

Run: `pnpm --filter @flowweb/web exec vitest run src/pages/team/TeamPage.test.tsx src/pages/workspace/hooks/useTeams.test.tsx`
Expected: 两条新用例 FAIL（挂载仍 ensure，success 态跳过 → `toHaveBeenCalledTimes(1)` 实际 0）；既有用例 PASS。

- [x] **Step 4: TeamPage.tsx 挂载改 fetch**

删除 `const ensureTeams = useTeamStore((s) => s.ensureTeams);` 行；挂载 effect 替换：

```tsx
  // 页面自查数据 + 每次进入强制拉新（他人侧变更：被批准入团/被移出/充值后返回）；
  // 失败吞错——已有数据时 store 保留 success 静默旧数据，空列表失败走 error 三态
  useEffect(() => { if (user) void fetchTeams(user.id).catch(() => undefined); }, [user, fetchTeams]);
```

- [x] **Step 5: useTeams.ts 挂载改 fetch**

删除 `const ensureTeams = useTeamStore((s) => s.ensureTeams);` 行；effect 替换：

```ts
  useEffect(() => {
    if (user) void fetchTeams(user.id).catch(() => undefined); // 每次进入拉新（#18）
  }, [user, fetchTeams]);
```

（retry 不变。）

- [x] **Step 6: 跑两个文件确认全绿**

Run: `pnpm --filter @flowweb/web exec vitest run src/pages/team/TeamPage.test.tsx src/pages/workspace/hooks/useTeams.test.tsx`
Expected: 全部 PASS（新用例绿；既有用例不受影响——beforeEach 重置态下 ensure 与 fetch 首拉行为等价）。

- [x] **Step 7: 全量回归 + 类型检查**

Run: `pnpm --filter @flowweb/web exec vitest run` 
Expected: 全部 PASS
Run: `pnpm --filter @flowweb/web exec tsc --noEmit`
Expected: 无错误

- [x] **Step 8: Commit**

```bash
git add apps/web/src/pages/team/TeamPage.tsx apps/web/src/pages/team/TeamPage.test.tsx apps/web/src/pages/workspace/hooks/useTeams.ts apps/web/src/pages/workspace/hooks/useTeams.test.tsx
git commit -m "feat(web): /team 与 works/materials 挂载改 fetchTeams 强制重拉——他人侧变更（入团/移出/充值）重入可见（#18）"
```

---

### Task 4: E4 后端注释 + 双端回归

**Files:**
- Modify: `apps/api/src/modules/team/team.service.ts`（:89-91 注释区）

- [x] **Step 1: 加不变量注释（纯注释，无行为变化，无需测试）**

`getMyTeams` 的 map 内（:88-92 区域），在 `if (m.team.isDefault) {` 上方加一行注释：

```ts
    const rows = await Promise.all(memberships.map(async (m) => {
      // 订阅状态分叉：默认团队查个人订阅（UserSubscription），普通团队查 TeamSubscription
      // 注意：默认团队每用户唯一——下方 isDefault 分支至多执行一次；若放开多 default 会退化为逐团队查询
      let subscription: { planName: string; status: string; currentPeriodEnd: Date } | null = null;
      if (m.team.isDefault) {
```

- [x] **Step 2: 后端 team 模块回归**

Run: `pnpm --filter @flowweb/api exec vitest run team.service`
Expected: 全部 PASS（注释无行为影响）

- [x] **Step 3: Commit**

```bash
git add apps/api/src/modules/team/team.service.ts
git commit -m "docs(api): getMyTeams 注明默认团队唯一性前提——isDefault 订阅查询至多一次的依据（E4）"
```

---

### Task 5: 浏览器验收（spec §7 九项）

**Files:** 无代码改动。使用 preview 工具（用户偏好：浏览器可视化协作）。

- [x] **Step 1: 启动 dev server**（`preview_start`，配置见 `.claude/launch.json`；启动流程参照 memory project_startup）

- [x] **Step 2: 逐项验收 spec §7**

| # | 验收项 | 操作要点 |
|---|---|---|
| 1 | 换号（#17 核心） | A 登录态 → 顶栏 LoginModal 切换登录 B（无 reload）→ TeamSwitcher 显示 B 团队（骨架过渡不闪 A 数据）；进 /team 侧栏为 B 团队；无 403 |
| 2 | LS 覆盖 | 换号成功后 `localStorage.getItem('currentTeamId')` = B 的默认团队 id（preview_eval 查） |
| 3 | 被批准入团 | 需双账号协作（B 申请 + A 批准）——若验证码流程阻碍自动化，标注请用户人工辅助 |
| 4 | 被移出 | 同上双账号；陈旧卡片消失不可点入 403 |
| 5 | 积分刷新 | TeamBillingPage 操作后返回 /team，侧栏积分=新值 |
| 6 | 顶栏不重复拉取 | 同账号路由来回切换，preview_network 中 `/team/mine` 无新增 |
| 7 | works/materials 重入 | 每次进入恰一次 `/team/mine`（生产单请求） |
| 8 | 硬刷新 /team 双发 + 选中保持 | F5 后恰 2 次 `/team/mine`（ensure 首拉（owner 未立，v4 不清 currentTeamId）+ TeamPage force），均 200；**F5 后当前选中团队不被重置**（v4 首拉保留 LS 记忆的用户可感行为，单测已锁机制、浏览器层补验） |
| 9 | 同号重登 | 登出同账号再登录（LoginModal）→ 无 `/team/mine` 新增；随后进 /team 恰一次 |

- [x] **Step 3: 验收记录**（2026-09-08 执行，账号 www/微信登录）

**自动化完成：**

| # | 结果 | 证据 |
|---|---|---|
| 6 | ✅ 通过 | fetch 插桩计数：非团队入口路由切换（/settings ↔ / 共 3 跳）`/team/mine` **0 新增**——TeamSwitcher ensure success 短路生效，顶栏不成为请求源 |
| 7 | ✅ 通过（dev 语义） | SPA 进 /works 恰 2 发、回 /team 恰 2 发 = 每挂载点 1 发 × StrictMode 双跑（spec §4 已接受的 dev 取舍；生产每挂载 1 发，单测 TeamPage.test ⑫/useTeams.test 重入用例锁定） |
| 8 | ✅ 选中保持 / 计数登记 | F5 后 `localStorage.currentTeamId` 保持不变（cmtsofds4…，v4 首拉不清语义用户可感验证 ✓）。请求计数 dev 观测 4 发（StrictMode effect 双跑 + AuthProvider /me 双跑引发 user 引用二次变化 → 下游 effect 重跑的 dev-only 组合放大；DOM 单树已排除双实例）。生产语义（无 StrictMode、/me 单跑）：ensure 首拉 1 + TeamPage force 1 = 2 发，行为由设计保证 + 单测锁定；如需生产实证可 `vite build && vite preview` 复验（未做，非阻塞） |
| 5 | ✅ 机制层 | 充值返回 /team 的积分新鲜 = #18 重入强制重拉 → 侧栏从 store 渲染（与验收 7 同机制已验）；支付全链路人工 |
| — | 页面渲染 | /team 正常：侧栏个人项目卡片（1成员/0项目/150积分）+ 个人面板 150 积分（截图留证）；console 无错误 |

**人工验收项（1/2/3/4/9）**：当前会话账号为微信登录（phoneNumber=null），浏览器层换号将不可逆丢失该会话（无法登回）且验证码走真实短信（Redis OTP 可读但需双手机号协作）——机制已由 teamStore.test 换号组 6 条 + TeamSwitcher.test ⑦ 组件级全覆盖（user.id 变化 → 强制重拉 + 旧团队消失），浏览器层留人工：A/B 双账号走 LoginModal 换号、入团/移出协作、同号重登。

- [x] **Step 4: 收尾**——更新 memory `project_launch_blockers.md`：#17/#18 标记已解决（含日期与 commit）；浏览器验收人工辅助项（1/2/3/4/9）如实登记。

---

## 自审记录（writing-plans Self-Review）

1. **Spec coverage**：§3.1/3.2（loadedUserId、isSwitch、成功回包写 owner）→ Task 1；§4 挂载表与调用点迁移 → Task 2；§4 ensure→fetch + TeamSwitcher 保持 ensure → Task 2/3；§5 清单逐文件对应 Task 2/3；§6 测试清单 ①-⑥ → Task 1 Step 1（⑥拆为换号清空时序+首拉保留两条）、迁移 → Task 1 Step 5、TeamSwitcher 带参 → Task 2 Step 6、TeamPage/useTeams force → Task 3 Step 1/2、机械保绿 → Task 2 Step 6-9；§7 验收 → Task 5；§8 注意事项（E4 注释）→ Task 4。无缺口。
2. **Placeholder scan**：无 TBD/TODO；所有代码步骤含完整代码；命令含期望输出。
3. **Type consistency**：`ensureTeams(userId: string)`/`fetchTeams(userId: string)` 签名在 Task 1 定义、Task 2/3 调用一致；`_internal.reset()` 行为与测试清场四件套一致；`user!.id` 仅用于 TeamDetail 三处与 TeamPage 创建链路（异步回调），其余 `if (user)` 门控——规则与"关键约定"节一致。

**外部审核修订记录（2026-09-08，执行前）**：①全部 pnpm filter 改完整包名 `@flowweb/web`/`@flowweb/api`（短名实测 No projects matched）；②TeamDetail 三处目标代码写全 `useTeamStore.getState().fetchTeams(user!.id)`（组件无局部 selector，裸标识符即 TS2304）；③补 TeamSwitcher 用例⑧ user=null 门控（spec §6 硬性要求）；④Task5 验收 8 措辞改 v4 语义（ensure 首拉非换号）+ F5 选中保持断言；⑤Task1 Step4 Expected 改准（vitest 不查类型，既有用例运行时自洽，迁移由 tsc 逼出）。不采纳：PowerShell `&&` 兼容提示（本执行环境为 bash）。

**执行期修订记录（2026-09-08，Task 1+2 质量审查后，commit 7020b0d）**：⑥删除成功回包内 `loadedUserId = userId` 死赋值——质量审查证明任何 loadedUserId 变更必伴随 `++seq`，回调执行到该行时恒等；owner 确立全部在入口分支（spec v5 同步修正）。"fetch 首拉确立 owner"用例仍绿，行为零变化。⑦错误分支注释补全覆盖两个条件。
