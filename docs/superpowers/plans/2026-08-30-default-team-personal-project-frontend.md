<!-- doc-status: historical | verified_at: n/a -->
# 默认团队个人项目化 — 前端实施计划（Plan B：Phase 7-9 + Phase 10）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec v3.1 §5-§9（docs/superpowers/specs/2026-08-29-default-team-personal-project-design.md）完成前端改造：/works 双页签与团队分组、/team 与 TeamSwitcher 个人项目化、`/team/:id/billing` 团队账单页、上传上下文 projectId/teamId 全链路、顶栏积分 scope-aware 与 Socket 余额口径统一，Phase 10 浏览器联调验收。

**Architecture:** 前端团队上下文沿用既有约定（`localStorage.currentTeamId` + `getMyTeams()`，不新建全局 store）；works 团队页签按「我创建的/我加入的」分组，每组一个 `<TeamSection>` 内部独立 `useWorkspaceData(teamId)` 实例；画布团队上下文经 `canvasStore.teamId`（来自 project 行）分发到上传/素材库/顶栏积分；积分 store 加 `scope: 'personal' | 'team'` 双模式。含 2 处后端小改（canvas.create 返回 teamId、node:status credits 结构统一）。

**Tech Stack:** React 18 + antd 5 + Zustand + react-router（`from 'react-router'`）+ Vitest + @testing-library/react（jsdom）、NestJS（仅 Task 10/13 触及）、TypeScript strict。

**范围说明:** 只覆盖 spec Phase 7-10。Plan A（Phase 0-6 后端）已验收：`getMyTeams` 返回含 `isDefault/isOwner/createdAt` 且默认团队固定第一；`GET /api/team/default`、`GET /api/team/:id/recharge/orders?kind=` 已就绪；folder/template/canvas/material 接口已接受 teamId；presign 三级回落已实现。**后端已定死事实见 Plan A 文末「Plan B 交接约束」5 条，前端不得接反。**

**通用约定:**
- 单文件快速迭代：`cd apps/web && pnpm exec vitest run <文件路径>`；全量门禁：`cd apps/web && pnpm exec tsc -b && pnpm test`（vitest 不查类型，tsc -b 必须显式跑）
- 涉 apps/api 的 Task（10/13）：`cd apps/api && pnpm exec vitest run <文件>`；门禁 `cd apps/api && pnpm test`
- 每个 Task 完成后：双门禁全绿 → commit（风格：`feat(web): ...` / `feat(api): ...` 中文描述）
- antd5 测试坑（见项目 memory）：两字按钮查询带空格、cssinjs workaround 在 `src/test-setup.ts`、`location.reload` stub 用 `Object.defineProperty`（TeamSwitcher.test.tsx:14-21 有现成模板）
- 行号基于 2026-08-30 代码状态，漂移时以内容定位
- 测试 mock 模式：优先 `vi.hoisted` + 整模块 `vi.mock('@/api/xxx')`（对齐 TeamPage.test.tsx / CreditsPage.test.tsx 现状）

---

## 实施决策（本 Plan 拍板，依据 spec §5 + 调研核实）

| # | 决策 | 依据 |
| --- | --- | --- |
| D1 | Socket 余额推送统一为 `{credits, subscriptionCredits, total}` 三字段对象，**不含** spec 提到的 `subscription` 状态字段 | 扣费事件不改变订阅状态，推送它需每次多查 UserSubscription/TeamSubscription 且无信息增量（画布进入时已拉取过订阅态）；spec 已注明「事件名 plan 阶段核实」，调研证实事件为 `/execution` 的 `node:status` |
| D2 | 画布 scope 判定：`project.teamId === 默认团队 id` → `personal`（保留 expiry 显示），否则 → `team` | 个人画布=默认团队；personal 模式沿用 `/api/credits/balance`（含 subscriptionCreditsExpiry），team 模式走 `/team/:id/balance` |
| D3 | /works 切换页签时清空 `?folder=` | 跨 scope 的 folder id 无意义，保留会加载出空视图 |
| D4 | TeamPage 积分 tab 收敛为「余额+流水」，充值/订阅按钮跳 `/team/:id/billing`，WeChatQRModal 从 TeamPage 移除 | spec §2「团队订阅/充值页=独立页面 /team/:id/billing……TeamPage 积分 tab 保留余额/流水」 |
| D5 | 素材库（MaterialLibraryModal 仅挂画布页）按 `canvasStore.teamId` 拉取、presign 传 `projectId` | 画布内素材库应显示当前团队素材；后端 material 接口已接受 teamId、presign ①级回落已实现 |
| D6 | 新建 `utils/uploadContext.ts` 的 `canvasProjectId()` helper 统一 11 处节点上传取值 | DRY；直接 `useCanvasStore.getState().projectId ?? undefined` |
| D7 | TeamSection 文件夹导航用组件内部 state，不进 URL | `?folder=` 归个人页签专用（useFolderNavigation），多团队共用一个 query 参数会互相污染 |
| D8 | `MyTeam` 类型补全 `isDefault/isOwner/createdAt`，显示名统一 `teamDisplayName(t)` | 后端 getMyTeams 已返回（Plan A Task 3），前端类型落后 |
| D9 | creditsStore 保留单例，加 `scope/teamId` 字段区分模式，不拆双 store | 顶栏/菜单/弹层全部消费同一 store，拆双 store 改动面大且无收益 |

---

### Task 0: 测试基线

**Files:** 无变更

- [ ] **Step 1: 跑全量测试确认现状全绿**

Run: `cd apps/web && pnpm exec tsc -b && pnpm test && cd ../api && pnpm test`
Expected: 全部通过（若有既有红测，记录并向用户确认后再继续，不得带病开工）。

---

## Phase 7：/works 双页签与团队分组

### Task 1: MyTeam 类型补全 + teamDisplayName 工具

**Files:**
- Modify: `apps/web/src/api/teamApi.ts:3-11`（MyTeam 接口）、文件尾部（新函数）
- Test: `apps/web/src/api/teamApi.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

```tsx
// apps/web/src/api/teamApi.test.ts
import { describe, it, expect } from 'vitest';
import { teamDisplayName } from './teamApi';

describe('teamDisplayName', () => {
  it('默认团队显示「个人项目」', () => {
    expect(teamDisplayName({ isDefault: true, name: 'Alice的团队' })).toBe('个人项目');
  });
  it('普通团队显示原名', () => {
    expect(teamDisplayName({ isDefault: false, name: '梦幻团队' })).toBe('梦幻团队');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm exec vitest run src/api/teamApi.test.ts`
Expected: FAIL — teamDisplayName 未导出。

- [ ] **Step 3: 实现**

`teamApi.ts` MyTeam 接口（:3-11）替换为：

```ts
export interface MyTeam {
  id: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  status: string;
  isDefault: boolean;
  isOwner: boolean;
  createdAt: string;
  memberCount: number;
  balance: { credits: number; subscriptionCredits: number };
  subscription: { planName: string; status: string; currentPeriodEnd: string } | null;
}
```

文件尾部追加：

```ts
/** 显示名统一：默认团队（个人项目）在一切 UI 上显示为「个人项目」，不暴露「XX的团队」 */
export function teamDisplayName(t: Pick<MyTeam, 'isDefault' | 'name'>): string {
  return t.isDefault ? '个人项目' : t.name;
}
```

- [ ] **Step 4: 跑测试确认通过 + 门禁**

Run: `cd apps/web && pnpm exec vitest run src/api/teamApi.test.ts && pnpm exec tsc -b && pnpm test`
Expected: PASS（既有 TeamPage/TeamSwitcher fixture 缺 isDefault 字段——TS 类型不匹配的 fixture 在测试文件里是字面量传参，tsc -b 若报错则给 fixture 补 `isDefault: false, isOwner: true, createdAt: '2026-01-01'`；vitest 运行时不校验类型不会挂）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api
git commit -m "feat(web): MyTeam 类型补全 isDefault/isOwner/createdAt + teamDisplayName 统一显示名"
```

---

### Task 2: API 层 teamId 参数（folderApi/templateApi/canvasApi）

**Files:**
- Modify: `apps/web/src/api/folderApi.ts:13-19`（getFolders/createFolder）
- Modify: `apps/web/src/api/templateApi.ts:22-40`（TemplateListQuery/getTemplates）
- Modify: `apps/web/src/api/canvasApi.ts:10-15`（createCanvas）
- Test: `apps/web/src/api/folderApi.test.ts`、`apps/web/src/api/canvasApi.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/api/folderApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ok = (data: unknown) => ({ ok: true, json: async () => ({ code: 0, data }) });

describe('folderApi teamId 透传', () => {
  beforeEach(() => { global.fetch = vi.fn(); });

  it('getFolders 传 teamId 时 query 带 teamId', async () => {
    (global.fetch as any).mockResolvedValue(ok({ folders: [] }));
    const { getFolders } = await import('./folderApi');
    await getFolders('t-1');
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/folders?teamId=t-1');
  });

  it('getFolders 不传 teamId 时保持原 URL', async () => {
    (global.fetch as any).mockResolvedValue(ok({ folders: [] }));
    const { getFolders } = await import('./folderApi');
    await getFolders();
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/folders');
  });

  it('createFolder 传 teamId 时 body 带 teamId', async () => {
    (global.fetch as any).mockResolvedValue(ok({ id: 'f1' }));
    const { createFolder } = await import('./folderApi');
    await createFolder('新文件夹', 't-1');
    const init = (global.fetch as any).mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: '新文件夹', teamId: 't-1' });
  });
});
```

```ts
// apps/web/src/api/canvasApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('canvasApi teamId 透传', () => {
  beforeEach(() => { global.fetch = vi.fn(); });

  it('createCanvas 传 teamId 时 body 带 teamId', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { templateId: 'tp', projectId: 'p', name: 'n' } }) });
    const { createCanvas } = await import('./canvasApi');
    await createCanvas('画布', null, 't-1');
    const init = (global.fetch as any).mock.calls[0][1];
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/canvases');
    expect(JSON.parse(init.body)).toEqual({ name: '画布', folderId: null, teamId: 't-1' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm exec vitest run src/api/folderApi.test.ts src/api/canvasApi.test.ts`
Expected: FAIL — 断言的 URL/body 不含 teamId。

- [ ] **Step 3: 实现**

`folderApi.ts`（:13-19）替换：

```ts
export function getFolders(teamId?: string) {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  return apiFetch<{ folders: FolderDto[] }>(`/folders${qs}`);
}

export function createFolder(name: string, teamId?: string) {
  return apiFetch<{ id: string }>('/folders', {
    method: 'POST',
    body: JSON.stringify(teamId ? { name, teamId } : { name }),
  });
}
```

`templateApi.ts` TemplateListQuery（:22-29）加一行、getTemplates（:31-40）加一行：

```ts
export interface TemplateListQuery {
  type?: 'official' | 'my' | 'community';
  search?: string;
  sort?: 'importCount' | 'newest';
  page?: number;
  limit?: number;
  folderId?: string;
  teamId?: string;
}
```

```ts
  if (query.teamId) params.set('teamId', query.teamId);   // 插在 folderId 之后
```

`canvasApi.ts` createCanvas（:10-15）：签名加第三参，body 加 teamId（**保持该文件现有的请求封装方式不变**——它可能用 apiFetch 或自有 request，只改参数与 body）：

```ts
export function createCanvas(name: string, folderId: string | null, teamId?: string) {
  // 请求调用方式不变，仅 body 改为：
  //   body: JSON.stringify({ name, folderId, teamId })
}
```

（`CreateCanvasResult` 类型保持现状——teamId 返回值 Task 10 再加。）

- [ ] **Step 4: 跑测试确认通过 + 门禁**

Run: `cd apps/web && pnpm exec vitest run src/api/folderApi.test.ts src/api/canvasApi.test.ts && pnpm exec tsc -b && pnpm test`
Expected: PASS 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api
git commit -m "feat(web): folderApi/templateApi/canvasApi 透传 teamId（缺省回落默认团队）"
```

---

### Task 3: useWorkspaceData teamId 化

**Files:**
- Modify: `apps/web/src/pages/workspace/hooks/useWorkspaceData.ts`
- Test: `apps/web/src/pages/workspace/__tests__/useWorkspaceData.test.tsx`（追加）

- [ ] **Step 1: 写失败测试（追加到现有 describe 内）**

```tsx
  it('传 teamId 时 API 调用带团队维度', async () => {
    mocked(folderApi.getFolders).mockResolvedValue({ folders: [] });
    mocked(templateApi.getTemplates).mockResolvedValue({ templates: [], totalPages: 1 });
    const { result } = renderHook(() => useWorkspaceData('t-team'));
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(folderApi.getFolders).toHaveBeenCalledWith('t-team');
    expect(templateApi.getTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ teamId: 't-team' }),
    );
  });

  it('传 teamId 时 createFolder/createCanvas 透传 teamId', async () => {
    mocked(folderApi.getFolders).mockResolvedValue({ folders: [] });
    mocked(templateApi.getTemplates).mockResolvedValue({ templates: [], totalPages: 1 });
    mocked(folderApi.createFolder).mockResolvedValue({ id: 'f1' });
    mocked(canvasApi.createCanvas).mockResolvedValue({ templateId: 'tp', projectId: 'p1', name: 'n' });
    const { result } = renderHook(() => useWorkspaceData('t-team'));
    await waitFor(() => expect(result.current.status).toBe('success'));
    await result.current.createFolder('x');
    await result.current.createCanvas('y', null);
    expect(folderApi.createFolder).toHaveBeenCalledWith('x', 't-team');
    expect(canvasApi.createCanvas).toHaveBeenCalledWith('y', null, 't-team');
  });
```

（`mocked(...)`/import 名以现有测试文件头部的 mock 结构为准——该文件已 `vi.mock('@/api/folderApi')` 等三模块。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm exec vitest run src/pages/workspace/__tests__/useWorkspaceData.test.tsx`
Expected: FAIL — getFolders 被调用时无参。

- [ ] **Step 3: 实现**

`useWorkspaceData.ts` 改造（5 处 API 调用 + 签名 + deps）：

```ts
export function useWorkspaceData(teamId?: string) {
```

```ts
  const refreshFolders = useCallback(async () => {
    const data = await getFolders(teamId);          // :28 原无参
    ...
  }, [teamId]);                                      // deps 从 [] 改
```

```ts
      const [, data] = await Promise.all([
        refreshFolders(),
        getTemplates({ type: 'my', teamId, folderId: folderId ?? 'root', page: 1, limit: PAGE_SIZE }),   // :45
      ]);
      ...
  }, [refreshFolders]);   // loadFolder deps 不变（refreshFolders 已含 teamId）
```

```ts
      const data = await getTemplates({ type: 'my', teamId, folderId: folderId ?? 'root', page: next, limit: PAGE_SIZE });   // :63
```

```ts
  const createFolder = useCallback(async (name: string) => {
    await apiCreateFolder(name, teamId);             // :74
    await refreshFolders();
  }, [refreshFolders, teamId]);
```

```ts
  const createCanvas = useCallback(async (name: string, folderId: string | null): Promise<string> => {
    const { templateId, projectId } = await apiCreateCanvas(name, folderId, teamId);   // :145
    ...
  }, [refreshFolders, teamId]);
```

（`loadMore` 的 useCallback deps 加 `teamId`；其余方法不动。teamId 变化 → refreshFolders 重建 → loadFolder 重建 → `useEffect(() => { loadFolder(null); }, [loadFolder])`（:55）自动重跑初始化。）

- [ ] **Step 4: 跑测试确认通过 + 门禁（含 3 处既有精确断言修正——P0）**

实现层 `apiCreateFolder(name, teamId)` 在个人流以 `(name, undefined)` 三参调用，vitest 的 `toHaveBeenCalledWith` **不忽略尾部 undefined**（数组长度 2 vs 1 不匹配），以下三处既有断言必红，必须同步补 `, undefined`：

| 文件:行 | 原断言 | 改为 |
| --- | --- | --- |
| `__tests__/useWorkspaceData.test.tsx:113` | `toHaveBeenCalledWith('新建')` | `toHaveBeenCalledWith('新建', undefined)` |
| `__tests__/WorkspacePage.test.tsx:187` | `toHaveBeenCalledWith('我的新文件夹')` | `toHaveBeenCalledWith('我的新文件夹', undefined)` |
| `__tests__/WorkspacePage.folder-create.test.tsx:62` | `toHaveBeenCalledWith('文件夹内新作', 'f1')` | `toHaveBeenCalledWith('文件夹内新作', 'f1', undefined)` |

（不得用「实现层条件传参」绕过——Task 5 的 TeamSection 依赖 teamId 透传，只能改断言。）

Run: `cd apps/web && pnpm exec vitest run src/pages/workspace/__tests__/useWorkspaceData.test.tsx && pnpm exec tsc -b && pnpm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/workspace
git commit -m "feat(web): useWorkspaceData 接受 teamId——文件夹/画布/新建全链路团队维度"
```

---

### Task 4: 页签受控 + ?tab= 持久化 + useFolderNavigation 参数保留修复

**Files:**
- Modify: `apps/web/src/pages/workspace/components/WorkspaceToolbar.tsx:8-15,39-42`
- Modify: `apps/web/src/pages/workspace/hooks/useFolderNavigation.ts:11-20`
- Modify: `apps/web/src/pages/workspace/WorkspacePage.tsx`（tab 状态）
- Test: `apps/web/src/pages/workspace/__tests__/ToolbarBreadcrumb.test.tsx`（更新）、`WorkspacePage.test.tsx`（追加）

- [ ] **Step 1: 写失败测试**

ToolbarBreadcrumb.test.tsx 改造（**P1：该文件用 `renderToolbar(overrides)` helper 模式（:14-25），没有 baseProps 变量**——helper 的固定 props 必须补新必填 prop 的默认值，否则本文件全部既有用例 tsc -b 报错）：

```tsx
// renderToolbar helper 的 props 对象补默认值（viewMode...onCreateFolder 之后）：
      activeTab: 'personal' as const,
      onTabChange: vi.fn(),
```

旧用例「个人选中、团队项目禁用」（:27-31）替换为：

```tsx
  it('页签受控：点击「团队项目」触发 onTabChange，激活态样式切换', () => {
    const onTabChange = vi.fn();
    renderToolbar({ onTabChange });
    fireEvent.click(screen.getByRole('button', { name: '团队项目' }));
    expect(onTabChange).toHaveBeenCalledWith('team');
    expect(screen.getByRole('button', { name: '个人' })).toHaveClass('border-b-2');
  });

  it('activeTab=team 时团队项目按钮为激活态', () => {
    renderToolbar({ activeTab: 'team' });
    expect(screen.getByRole('button', { name: '团队项目' })).toHaveClass('border-b-2');
    expect(screen.getByRole('button', { name: '个人' })).not.toHaveClass('border-b-2');
  });

  it('showTools=false 时隐藏搜索/筛选/新建文件夹（团队页签专用，P1-3）', () => {
    renderToolbar({ showTools: false });
    expect(screen.queryByLabelText('搜索')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /新建文件夹/ })).not.toBeInTheDocument();
  });
```

（按钮是原生 `<button>` 非 antd Button，「个人」「团队项目」两字文本查询无空格问题。）

WorkspacePage.test.tsx 追加：

```tsx
  it('?tab=team 持久化页签状态，默认个人', async () => {
    renderPage('/works?tab=team');
    expect(await screen.findByRole('button', { name: '团队项目' })).toHaveClass('border-b-2');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm exec vitest run src/pages/workspace/__tests__/ToolbarBreadcrumb.test.tsx src/pages/workspace/__tests__/WorkspacePage.test.tsx`
Expected: FAIL — props 不存在 / 按钮 disabled。

- [ ] **Step 3: 实现**

WorkspaceToolbar.tsx props 接口（:8-15）与页签按钮（:39-42）替换：

```tsx
interface WorkspaceToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onSearchChange: (query: string) => void;
  filter: FilterKind;
  onFilterChange: (filter: FilterKind) => void;
  onCreateFolder: () => void;
  activeTab: 'personal' | 'team';
  onTabChange: (tab: 'personal' | 'team') => void;
  /** 团队页签置 false：隐藏搜索/筛选/视图/导入/新建文件夹（这些只驱动个人 data，P1-3），仅保留页签行 */
  showTools?: boolean;
}
```

```tsx
      <div className="flex gap-2 text-lg items-center">
        <button
          onClick={() => onTabChange('personal')}
          className={`mx-3 py-1.5 bg-transparent ${activeTab === 'personal' ? 'text-white border-b-2 border-white border-x-0 border-t-0 cursor-pointer' : 'text-white/60 border-none cursor-pointer'}`}
        >个人</button>
        <button
          onClick={() => onTabChange('team')}
          className={`mx-3 py-1.5 bg-transparent ${activeTab === 'team' ? 'text-white border-b-2 border-white border-x-0 border-t-0 cursor-pointer' : 'text-white/60 border-none cursor-pointer'}`}
        >团队项目</button>
      </div>
```

右侧工具组（搜索/筛选/视图/导入/新建文件夹所在的 `<div className="flex items-center gap-2">`，:43 起）整体包条件：

```tsx
      {showTools !== false && (
        <div className="flex items-center gap-2">
          {/* 原搜索/筛选/视图/导入/新建文件夹内容不动 */}
        </div>
      )}
```

（组件签名解构同步加 `activeTab, onTabChange`。）

useFolderNavigation.ts :11-20 两处整体替换改为保留其他参数（否则 `?tab=` 被清掉）：

```ts
  useEffect(() => {
    if (loaded && currentFolderId && !folders.some((f) => f.id === currentFolderId)) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('folder');
        return next;
      }, { replace: true });
      message.info('文件夹不存在');
    }
  }, [loaded, currentFolderId, folders, setSearchParams]);

  const setCurrentFolderId = (id: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('folder', id); else next.delete('folder');
      return next;
    }, { replace: true });
  };
```

WorkspacePage.tsx：组件内加 tab 状态（`useFolderNavigation` 调用处之前）：

```tsx
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: 'personal' | 'team' = searchParams.get('tab') === 'team' ? 'team' : 'personal';
  const setTab = (t: 'personal' | 'team') => {
    // 切页签清 folder（D3）：跨 scope 的 folder id 无意义
    setSearchParams(t === 'team' ? { tab: 'team' } : {}, { replace: true });
  };
```

`useFolderNavigation` 调用（:26）的 `loaded` 参数收紧为仅个人页签校验：

```tsx
  const nav = useFolderNavigation(data.folders, data.status !== 'loading' && tab === 'personal');
```

`<WorkspaceToolbar>`（:107-112）加 props：

```tsx
        activeTab={tab}
        onTabChange={setTab}
        showTools={tab === 'personal'}
```

（本 Task 仅接线状态，团队页签内容 Task 5 渲染；`useSearchParams` 需要 WorkspacePage 已在 Router 上下文内——现有测试已用 MemoryRouter 包裹。）

- [ ] **Step 4: 跑测试确认通过 + 门禁**

Run: `cd apps/web && pnpm exec vitest run src/pages/workspace && pnpm exec tsc -b && pnpm test`
Expected: PASS（ToolbarBreadcrumb.test.tsx:27-30 旧 disabled 断言删除；useFolderNavigation.test.tsx 若因 setSearchParams 函数式更新失败，检查其 MemoryRouter 断言方式并同步修正——函数式更新对 `?folder=` 单参数场景行为不变）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/workspace
git commit -m "feat(web): works 页签受控+?tab=持久化；useFolderNavigation 改保留式参数更新"
```

---

### Task 5: TeamSection 组件 + WorkspacePage 团队页签

**Files:**
- Create: `apps/web/src/pages/workspace/components/TeamSection.tsx`
- Modify: `apps/web/src/pages/workspace/WorkspacePage.tsx`（团队页签渲染）
- Test: `apps/web/src/pages/workspace/__tests__/TeamSection.test.tsx`（新建）、`WorkspacePage.test.tsx`（追加）

- [ ] **Step 1: 写失败测试**

```tsx
// apps/web/src/pages/workspace/__tests__/TeamSection.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const api = vi.hoisted(() => ({
  getFolders: vi.fn(),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  getTemplates: vi.fn(),
  canvasCreate: vi.fn(),
  getNextUntitledName: vi.fn(),
}));
vi.mock('@/api/folderApi', () => api);
vi.mock('@/api/templateApi', () => ({ getTemplates: api.getTemplates, updateTemplate: vi.fn(), deleteTemplate: vi.fn() }));
vi.mock('@/api/canvasApi', () => ({ createCanvas: api.canvasCreate, getNextUntitledName: api.getNextUntitledName }));
// teamApi 不整模块 mock：teamDisplayName 是纯函数，走真实模块（P1-2）
// 注意：api 缺 deleteFolder（useWorkspaceData.ts:4 有该导入绑定）——当前用例不触发删除、运行无碍；后续若补删除用例，记得把 deleteFolder 加进 hoisted api

import { TeamSection } from '../components/TeamSection';

const team = {
  id: 't-1', name: '梦幻团队', role: 'OWNER' as const, status: 'ACTIVE',
  isDefault: false, isOwner: true, createdAt: '2026-08-01', memberCount: 3,
  balance: { credits: 100, subscriptionCredits: 0 }, subscription: null,
};

function renderSection(overrides: Partial<typeof team> = {}) {
  return render(<MemoryRouter><TeamSection team={{ ...team, ...overrides }} /></MemoryRouter>);
}

function folderDto(id: string, name: string, parentId: string | null) {
  return { id, name, parentId, createdAt: '2026-08-01', updatedAt: '2026-08-01', canvasCount: 0, thumbnails: [] };
}

describe('TeamSection', () => {
  beforeEach(() => {
    api.getFolders.mockResolvedValue({ folders: [] });
    api.getTemplates.mockResolvedValue({ templates: [], totalPages: 1 });
  });

  it('按 teamId 拉取文件夹与画布列表', async () => {
    renderSection();
    await waitFor(() => expect(api.getFolders).toHaveBeenCalledWith('t-1'));
    expect(api.getTemplates).toHaveBeenLastCalledWith(expect.objectContaining({ teamId: 't-1' }));
  });

  it('渲染团队名与成员数', async () => {
    renderSection();
    expect(await screen.findByText('梦幻团队')).toBeInTheDocument();
    expect(screen.getByText(/3 名成员/)).toBeInTheDocument();
  });

  it('新建画布归属该团队，编号预填走团队维度', async () => {
    api.canvasCreate.mockResolvedValue({ templateId: 'tp', projectId: 'p1', name: 'n' });
    api.getNextUntitledName.mockResolvedValue({ name: '画布7' });
    renderSection();
    fireEvent.click(await screen.findByTestId('team-create-canvas-t-1'));
    // 复用 CreateCanvasModal：编号预填带 teamId（P2：后端 next-untitled-name 已 teamId 化）
    await waitFor(() => expect(api.getNextUntitledName).toHaveBeenCalledWith('t-1'));
    expect(await screen.findByDisplayValue('画布7')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    await waitFor(() => expect(api.canvasCreate).toHaveBeenCalledWith('画布7', null, 't-1'));
  });

  it('新建文件夹归属该团队（P1-3：各组隔离新建）', async () => {
    renderSection();
    fireEvent.click(await screen.findByTestId('team-create-folder-t-1'));
    fireEvent.change(await screen.findByLabelText('文件夹名称'), { target: { value: '团队文件夹' } });
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    await waitFor(() => expect(api.createFolder).toHaveBeenCalledWith('团队文件夹', 't-1'));
  });

  it('文件夹重命名：onRequestRename 收 folder 对象，Modal 预填旧名走 renameFolder（P1-B）', async () => {
    api.getFolders.mockResolvedValue({ folders: [folderDto('f1', '旧名', null)] });
    renderSection();
    fireEvent.click((await screen.findByTestId('folder-card-f1')).querySelector('button[aria-label="重命名文件夹"]')!);
    const input = await screen.findByLabelText('文件夹名称');
    expect(input).toHaveValue('旧名');   // CreateFolderModal initialName 预填
    fireEvent.change(input, { target: { value: '新名' } });
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    await waitFor(() => expect(api.renameFolder).toHaveBeenCalledWith('f1', '新名'));
  });

  it('文件夹列表按当前层级过滤（root 只显示顶级，进入后只显示子级）', async () => {
    api.getFolders.mockResolvedValue({ folders: [
      folderDto('f-root', '顶级', null),
      folderDto('f-child', '子级', 'f-root'),
    ] });
    api.getTemplates.mockResolvedValue({ templates: [], totalPages: 1 });
    renderSection();
    expect(await screen.findByTestId('folder-card-f-root')).toBeInTheDocument();
    expect(screen.queryByTestId('folder-card-f-child')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('folder-card-f-root'));
    await waitFor(() => expect(screen.getByTestId('folder-card-f-child')).toBeInTheDocument());
    expect(screen.queryByTestId('folder-card-f-root')).not.toBeInTheDocument();
  });

  it('画布卡片点击跳转 /canvas?projectId=', async () => {
    api.getTemplates.mockResolvedValue({ templates: [{ id: 'tp1', projectId: 'p1', name: 'A', isPublic: false, folderId: null, coverUrl: null, createdAt: '2026-08-01', updatedAt: '2026-08-01' }], totalPages: 1 });
    renderSection();
    fireEvent.click(await screen.findByTestId('canvas-card-tp1'));
    await waitFor(() => expect(window.location.search).toContain('projectId=p1'));
  });
});
```

（最后一个用例的跳转断言用 jsdom `window.location.search` 或 mock `useNavigate`——对齐 WorkspacePage.test.tsx:18-21 的 `vi.mock('react-router')` 模式，若 mock 了 useNavigate 则断言 navigate 调用参数。）

WorkspacePage.test.tsx 追加：

```tsx
  it('?tab=team 渲染团队分组（我创建的/我加入的），过滤默认团队', async () => {
    mockGetMyTeams.mockResolvedValue([
      { id: 't-default', name: 'A的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
      { id: 't-owned', name: '我建的团', role: 'OWNER', status: 'ACTIVE', isDefault: false, isOwner: true, createdAt: '2026-08-01', memberCount: 2, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
      { id: 't-joined', name: '加入的团', role: 'MEMBER', status: 'ACTIVE', isDefault: false, isOwner: false, createdAt: '2026-08-02', memberCount: 5, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
    ]);
    renderPage('/works?tab=team');
    expect(await screen.findByText('我创建的')).toBeInTheDocument();
    expect(screen.getByText('我加入的')).toBeInTheDocument();
    expect(await screen.findByText('我建的团')).toBeInTheDocument();
    expect(screen.getByText('加入的团')).toBeInTheDocument();
    expect(screen.queryByText('个人项目')).not.toBeInTheDocument();   // 默认团队不出现在团队页签
  });

  it('?tab=team 无真实团队时空状态引导', async () => {
    mockGetMyTeams.mockResolvedValue([
      { id: 't-default', name: 'A的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
    ]);
    renderPage('/works?tab=team');
    expect(await screen.findByText(/还没有团队/)).toBeInTheDocument();
  });
```

（文件头部补 teamApi 整模块 mock 与 `mockGetMyTeams` hoisted 变量——**P1-2：mock 工厂必须含 teamDisplayName**，否则 TeamSection 调用 undefined 即崩：

```tsx
const { getMyTeams: mockGetMyTeams } = vi.hoisted(() => ({ getMyTeams: vi.fn() }));
vi.mock('@/api/teamApi', () => ({
  getMyTeams: mockGetMyTeams,
  teamDisplayName: (t: { isDefault: boolean; name: string }) => (t.isDefault ? '个人项目' : t.name),
}));
```

）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm exec vitest run src/pages/workspace/__tests__/TeamSection.test.tsx src/pages/workspace/__tests__/WorkspacePage.test.tsx`
Expected: FAIL — TeamSection 不存在 / 无分组渲染。

- [ ] **Step 3: 实现**

**先做后端小改（P2：`/canvases/next-untitled-name` 团队化——CreateCanvasModal 编号预填依赖，否则团队画布预填的是默认团队编号）**：

`canvas.service.ts` getNextUntitledName（:56-59）替换（`assertTeamMember` 自 team.util.ts import，Plan A 已建）：

```typescript
  async getNextUntitledName(userId: string, teamId?: string): Promise<string> {
    let resolved = teamId;
    if (resolved) {
      await assertTeamMember(this.prisma, resolved, userId);
    } else {
      resolved = (await this.teamService.ensureDefaultTeam(userId)).id;
    }
    return CanvasService.nextUntitledName(this.prisma, resolved);
  }
```

`canvas.controller.ts`（:20-25）加 Query（**:1 的 `@nestjs/common` import 现无 `Query`，需同步补入**）：

```typescript
  @Get('next-untitled-name')
  async nextUntitledName(@Req() req: Request, @Query('teamId') teamId?: string) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return { name: await this.canvasService.getNextUntitledName(userId, teamId) };
  }
```

canvas.service.spec.ts 追加（先红后绿）：

```typescript
  describe('getNextUntitledName teamId 维度', () => {
    it('传 teamId 时按该团队编号（校验成员）', async () => {
      // mock 方法名必须是 findFirst：顶层 prisma mock（spec:22-33）teamMember 下只有 findFirst，
      // 且 assertTeamMember 实际调用的就是 teamMember.findFirst（team.util.ts:29）——findUnique 会直接 TypeError
      prisma.teamMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
      prisma.template.findMany.mockResolvedValue([{ name: '画布2' }]);
      await expect(service.getNextUntitledName('u1', 't-team')).resolves.toBe('画布3');
      expect(prisma.template.findMany).toHaveBeenCalledWith({ where: { teamId: 't-team' }, select: { name: true } });
    });
    it('非成员传 teamId → 403', async () => {
      prisma.teamMember.findFirst.mockResolvedValue(null);
      await expect(service.getNextUntitledName('u1', 't-team')).rejects.toThrow('非团队成员');
    });
  });
```

前端配套：`canvasApi.ts` getNextUntitledName 加可选参（query 拼接 teamId，保持文件内现有封装）；`CreateCanvasModal.tsx` 加 `teamId?: string` prop，:22 预填调用改 `getNextUntitledName(teamId)`，**:26 deps 数组同步加 teamId**（防 eslint exhaustive-deps 告警）（WorkspacePage 个人页签不传，行为不变）。

新建 `TeamSection.tsx`：

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Input, message } from 'antd';
import { teamDisplayName, type MyTeam } from '@/api/teamApi';
import { useWorkspaceData } from '../hooks/useWorkspaceData';
import { FolderCard } from './FolderCard';
import { CanvasCard } from './CanvasCard';
import { CreateCanvasCard } from './CreateCanvasCard';
import { CreateCanvasModal } from './CreateCanvasModal';
import { CreateFolderModal } from './CreateFolderModal';

interface TeamSectionProps {
  team: MyTeam;
}

/** 团队页签的单团队区块：文件夹/搜索/新建与个人页签完全隔离（D7：文件夹导航用内部 state 不进 URL） */
export function TeamSection({ team }: TeamSectionProps) {
  const navigate = useNavigate();
  const data = useWorkspaceData(team.id);
  const [search, setSearch] = useState('');
  const [canvasModal, setCanvasModal] = useState(false);
  const [folderModal, setFolderModal] = useState<{ open: boolean; rename?: FolderViewModel }>({ open: false });
  const [moveTarget, setMoveTarget] = useState<Canvas | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);

  // 按当前层级过滤 + 搜索过滤（与个人页签 items 过滤同语义）
  const visibleFolders = data.folders.filter(
    (f) => (folderId ? f.parentId === folderId : !f.parentId) && (!search || f.name.toLowerCase().includes(search.toLowerCase())),
  );
  const filtered = data.canvases.filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()));

  const openCanvas = (canvasProjectId: string) => navigate(`/canvas?projectId=${canvasProjectId}`);

  const handleCreateCanvas = async (name: string, targetFolderId: string | null) => {
    try {
      const projectId = await data.createCanvas(name, targetFolderId);
      setCanvasModal(false);
      openCanvas(projectId);
    } catch (err) {
      message.error('创建失败：' + (err as Error).message);
    }
  };

  const handleFolderOk = async (name: string) => {
    const renaming = folderModal.rename;
    setFolderModal({ open: false });
    try {
      if (renaming) await data.renameFolder(renaming.id, name);
      else await data.createFolder(name);
    } catch (err) {
      message.error((renaming ? '重命名失败：' : '创建失败：') + (err as Error).message);
    }
  };

  return (
    <section className="mb-10" data-testid={`team-section-${team.id}`}>
      <div className="flex items-center justify-between px-8 mb-3">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-bold text-white">{teamDisplayName(team)}</h3>
          <span className="text-xs text-[#888]">{team.memberCount} 名成员</span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            aria-label={`搜索-${team.id}`}
            placeholder="搜索"
            size="small"
            style={{ width: 140 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button size="small" data-testid={`team-create-folder-${team.id}`} onClick={() => setFolderModal({ open: true })}>新建文件夹</Button>
          <Button type="primary" size="small" data-testid={`team-create-canvas-${team.id}`} onClick={() => setCanvasModal(true)}>
            新建画布
          </Button>
        </div>
      </div>
      {folderId && (
        <div className="px-8 mb-2">
          <button className="text-xs text-[#5DDCFF] cursor-pointer bg-transparent border-none" onClick={() => { setFolderId(null); void data.loadFolder(null); }}>
            ← 返回团队根目录
          </button>
        </div>
      )}
      <div className="px-8 grid gap-3 grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
        {data.status === 'loading' ? (
          <p className="text-sm text-[#888]">加载中…</p>
        ) : (
          <>
            {visibleFolders.map((f) => (
              <FolderCard
                key={f.id}
                folder={f}
                variant="grid"
                showCount={!search}
                onClick={() => { setFolderId(f.id); void data.loadFolder(f.id); }}
                onRequestRename={(folder) => setFolderModal({ open: true, rename: folder })}
                onDelete={() => void data.deleteFolder(f.id)}
              />
            ))}
            {filtered.map((c) => (
              <CanvasCard
                key={c.id}
                canvas={c}
                variant="grid"
                onClick={() => (c.projectId ? openCanvas(c.projectId) : navigate(`/works/${c.id}`))}
                onRename={data.renameCanvas}
                onMove={setMoveTarget}
                onTogglePublic={data.togglePublic}
                onDelete={(canvas) => { void data.deleteCanvas(canvas.id); }}
              />
            ))}
            <CreateCanvasCard onClick={() => setCanvasModal(true)} />
          </>
        )}
      </div>
      {data.hasMore && (
        <div className="px-8 mt-3">
          <Button block onClick={() => void data.loadMore()}>加载更多</Button>
        </div>
      )}
      <CreateCanvasModal
        open={canvasModal}
        teamId={team.id}
        folders={data.folders}
        defaultFolderId={folderId}
        onOk={(name, targetFolderId) => void handleCreateCanvas(name, targetFolderId)}
        onCancel={() => setCanvasModal(false)}
      />
      <CreateFolderModal
        open={folderModal.open}
        initialName={folderModal.rename?.name}
        onOk={(name) => void handleFolderOk(name)}
        onCancel={() => setFolderModal({ open: false })}
      />
      <MoveToFolderModal
        open={!!moveTarget}
        folders={data.folders}
        currentFolderId={moveTarget?.folderId ?? null}
        onOk={(targetFolderId) => {
          if (moveTarget) void data.moveCanvas(moveTarget.id, targetFolderId);
          setMoveTarget(null);
        }}
        onCancel={() => setMoveTarget(null)}
      />
    </section>
  );
}
```

（**P1-A/P1-B 契约对齐**：CanvasCard 的 `onMove/onTogglePublic` 是必填 props（CanvasCard.tsx:15-16），缺传 tsc -b 必挂；FolderCard 的 `onRequestRename` 回调收**整个 folder 对象**（FolderCard.tsx:14,:25,:77），不是 name——重命名走 `folderModal.rename` + CreateFolderModal `initialName`（对齐 WorkspacePage.tsx:141 模式）。MoveToFolderModal 契约：`open/folders/currentFolderId/onOk(folderId)/onCancel`。）

（TeamSection 顶部 import 补齐：`import type { Canvas, FolderViewModel } from '../types';` 与 `import { MoveToFolderModal } from './MoveToFolderModal';`。）

**Task 5 门禁含 api 侧**（后端小改）：`cd apps/api && pnpm exec vitest run src/modules/canvas/canvas.service.spec.ts && pnpm test`。

WorkspacePage.tsx 团队页签渲染：

```tsx
import { getMyTeams, teamDisplayName, type MyTeam } from '@/api/teamApi';
import { TeamSection } from './components/TeamSection';

// 组件内：
  const [teams, setTeams] = useState<MyTeam[] | null>(null);
  useEffect(() => {
    if (tab !== 'team' || teams !== null) return;
    getMyTeams().then(setTeams).catch(() => message.error('团队列表加载失败'));
  }, [tab, teams]);
  const realTeams = (teams ?? []).filter((t) => !t.isDefault);
  const ownedTeams = realTeams.filter((t) => t.isOwner);
  const joinedTeams = realTeams.filter((t) => !t.isOwner);
```

主体渲染分叉（原 loading/error/grid/list 区外包一层）；**WorkspaceBreadcrumb（:113-118）同步包 `{tab === 'personal' && (...)}`**——团队页签显示个人专用面包屑是死控件，点击还会写入个人专用 `?folder=`：

```tsx
  {tab === 'team' ? (
    <main className="flex-1 overflow-y-auto pt-4">
      {teams === null ? (
        <p className="text-sm text-[#888] px-8">加载中…</p>
      ) : realTeams.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3" data-testid="team-empty-state">
          <p className="text-sm text-[#888]">还没有团队，创建一个开始协作吧</p>
          <Button type="primary" onClick={() => navigate('/team')}>前往创建团队</Button>
        </div>
      ) : (
        <>
          {ownedTeams.length > 0 && (
            <>
              <h2 className="px-8 text-sm font-bold text-[#888] mb-2 mt-2">我创建的</h2>
              {ownedTeams.map((t) => <TeamSection key={t.id} team={t} />)}
            </>
          )}
          {joinedTeams.length > 0 && (
            <>
              <h2 className="px-8 text-sm font-bold text-[#888] mb-2 mt-2">我加入的</h2>
              {joinedTeams.map((t) => <TeamSection key={t.id} team={t} />)}
            </>
          )}
        </>
      )}
    </main>
  ) : (
    /* 原个人页签的 loading/error/grid/list 渲染保持不动 */
  )}
```

- [ ] **Step 4: 跑测试确认通过 + 门禁（含 api 侧小改）**

Run: `cd apps/web && pnpm exec vitest run src/pages/workspace && pnpm exec tsc -b && pnpm test && cd ../api && pnpm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/workspace apps/api/src/modules/canvas apps/web/src/api
git commit -m "feat: works 团队页签——TeamSection 分组平铺+复用 CreateCanvasModal（next-untitled-name 团队化）"
```

---

## Phase 8：/team、TeamSwitcher、membership/credits、/team/:id/billing

### Task 6: TeamSwitcher 改造

**Files:**
- Modify: `apps/web/src/components/TeamSwitcher.tsx`
- Test: `apps/web/src/components/TeamSwitcher.test.tsx`（更新）

- [ ] **Step 1: 更新测试（先红）**

测试文件重写用例：

```tsx
// 保留既有 location.reload stub（L14-21）；teamApi mock 工厂必须补 teamDisplayName（P1-2：新 TeamSwitcher 调用它）：
//   teamDisplayName: (t) => (t.isDefault ? '个人项目' : t.name)
  it('只有默认团队时整体隐藏（渲染 null）', async () => {
    mockGetMyTeams.mockResolvedValue([
      { id: 't1', name: 'A的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
    ]);
    const { container } = render(<TeamSwitcher />);
    await waitFor(() => expect(mockGetMyTeams).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('button')).toBeNull());
  });

  it('有真实团队时显示，默认团队条目显示「个人项目」且排第一', async () => {
    mockGetMyTeams.mockResolvedValue([
      { id: 't1', name: 'A的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
      { id: 't2', name: 'B 团', role: 'OWNER', status: 'ACTIVE', isDefault: false, isOwner: true, createdAt: '2026-08-02', memberCount: 2, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
    ]);
    render(<TeamSwitcher />);
    fireEvent.click(await screen.findByRole('button'));
    // P2：触发按钮本身也显示「个人项目」，必须在菜单项层查询（findAllByText 会多匹配按钮本体）
    const menuItems = await screen.findAllByRole('menuitem');
    expect(menuItems.map((el) => el.textContent)).toEqual(['个人项目', 'B 团']);
  });

  it('不再有「新建团队」入口', async () => {
    mockGetMyTeams.mockResolvedValue([
      { id: 't1', name: 'A的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
      { id: 't2', name: 'B 团', role: 'OWNER', status: 'ACTIVE', isDefault: false, isOwner: true, createdAt: '2026-08-02', memberCount: 2, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
    ]);
    render(<TeamSwitcher />);
    fireEvent.click(await screen.findByRole('button'));
    await waitFor(() => expect(screen.queryByText('新建团队')).not.toBeInTheDocument());
  });
```

（删除既有「新建团队」相关用例；fixture 补齐 isDefault/isOwner/createdAt。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm exec vitest run src/components/TeamSwitcher.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现**

TeamSwitcher.tsx 整体替换：

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Dropdown, message } from 'antd';
import type { MenuProps } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { getMyTeams, teamDisplayName, type MyTeam } from '@/api/teamApi';

/** 顶栏团队切换器：只有默认团队（无真实团队）时整体隐藏；列表=个人项目（固定第一）+真实团队；新建团队入口在 /team 页 */
export function TeamSwitcher() {
  const [teams, setTeams] = useState<MyTeam[] | null>(null);
  const current = localStorage.getItem('currentTeamId');
  const currentTeam = teams?.find((t) => t.id === current) ?? teams?.[0];

  const load = useCallback(async () => {
    const list = await getMyTeams();
    setTeams(list);
    // 解散回退：current 已不在列表 → 落回第一个（默认团队排第一）
    const cur = localStorage.getItem('currentTeamId');
    if (list.length && !list.some((t) => t.id === cur)) {
      localStorage.setItem('currentTeamId', list[0].id);
      location.reload();
    }
  }, []);
  useEffect(() => {
    void load().catch((err) => message.error('团队列表加载失败：' + (err as Error).message));
  }, [load]);

  const realTeams = (teams ?? []).filter((t) => !t.isDefault);
  if (teams !== null && realTeams.length === 0) return null;

  const switchTo = (id: string) => {
    if (id === current) return;
    localStorage.setItem('currentTeamId', id);
    location.reload();
  };

  const items: MenuProps['items'] = (teams ?? []).map((t) => ({
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

（移除 `Input/Modal/createTeam/create` 与新建 Modal——入口迁至 TeamPage（Task 7）。）

- [ ] **Step 4: 跑测试确认通过 + 门禁**

Run: `cd apps/web && pnpm exec vitest run src/components/TeamSwitcher.test.tsx && pnpm exec tsc -b && pnpm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/TeamSwitcher.tsx apps/web/src/components/TeamSwitcher.test.tsx
git commit -m "feat(web): TeamSwitcher 只有默认团队时隐藏；个人项目固定第一；新建入口移除"
```

---

### Task 7: TeamPage 个人项目精简面板/空状态/新建团队按钮

**Files:**
- Modify: `apps/web/src/pages/team/TeamPage.tsx`
- Test: `apps/web/src/pages/team/TeamPage.test.tsx`（更新+追加）

- [ ] **Step 1: 更新测试（先红）**

TeamPage.test.tsx 追加：

```tsx
  it('只有默认团队时空状态+新建团队按钮', async () => {
    mockGetMyTeams.mockResolvedValue([
      { id: 't1', name: '我的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, balance: { credits: 100, subscriptionCredits: 0 }, subscription: null },
    ]);
    renderPage();
    expect(await screen.findByText(/还没有团队/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建团队' })).toBeInTheDocument();
  });

  it('选中默认团队时渲染个人项目精简面板（余额+订阅状态，无成员管理）', async () => {
    mockGetMyTeams.mockResolvedValue([
      { id: 't1', name: '我的团队', role: 'OWNER', status: 'ACTIVE', isDefault: true, isOwner: true, createdAt: '2026-08-01', memberCount: 1, balance: { credits: 100, subscriptionCredits: 50 }, subscription: { planName: 'pro', status: 'active', currentPeriodEnd: '2026-09-15' } },
      { id: 't2', name: '第二团队', role: 'OWNER', status: 'ACTIVE', isDefault: false, isOwner: true, createdAt: '2026-08-02', memberCount: 2, balance: { credits: 0, subscriptionCredits: 0 }, subscription: null },
    ]);
    localStorage.setItem('currentTeamId', 't1');
    mockGetTeamBalanceView.mockResolvedValue({ credits: 100, subscriptionCredits: 50, total: 150, quota: 0, used: 0 });
    renderPage();
    expect(await screen.findByText('个人项目')).toBeInTheDocument();
    expect(screen.getByTestId('personal-balance-total')).toHaveTextContent('150');
    expect(screen.queryByTestId('tab-members')).not.toBeInTheDocument();
    // 精简模式不拉管理类接口
    await waitFor(() => expect(mockListMembers).not.toHaveBeenCalled());
  });

  it('个人精简面板充值按钮跳 /settings/credits、开通会员跳 /settings/membership', async () => {
    /* fixture 同上一用例 */
    renderPage();
    expect(await screen.findByText('个人项目'));
    expect(screen.getByTestId('link-personal-recharge').getAttribute('href')).toBe('/settings/credits');
    expect(screen.getByTestId('link-personal-membership').getAttribute('href')).toBe('/settings/membership');
  });
```

（`renderPage`/mock 变量名以现有文件为准；既有用例 fixture 补 `isDefault: false, isOwner: true, createdAt`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm exec vitest run src/pages/team/TeamPage.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现**

TeamPage.tsx 改造（对照现状行号）：

1. **import 区**：加 `createTeam, teamDisplayName`（teamApi 已 import 其他函数）；加 `Link`（react-router）。

2. **派生状态**（:115 附近）：

```tsx
  const realTeams = teams.filter((t) => !t.isDefault);
  const isPersonal = team?.isDefault ?? false;
```

3. **新建团队状态与动作**（弹窗状态区 :62-69 旁）：

```tsx
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);
  const doCreateTeam = async () => {
    if (creating || !createName.trim()) return;
    setCreating(true);
    try {
      const t = await createTeam(createName.trim());
      localStorage.setItem('currentTeamId', t.id);
      location.reload();
    } catch (err) {
      message.error('创建失败：' + (err as Error).message);
    } finally {
      setCreating(false);
    }
  };
```

4. **数据拉取分叉**——refreshAll 的触发 effect（:96 附近）改为仅非个人团队拉全量，个人团队只拉余额；**refreshAudit（:109 附近）同样加 `if (isPersonal) return;`**（否则默认团队多发一次审计请求）：

```tsx
  useEffect(() => {
    if (!teamId || !isPersonal) return;
    getTeamBalanceView(teamId).then(setBalance).catch(() => {});
  }, [teamId, isPersonal]);
```

（原 `useEffect(() => { void refreshAll(); }, [teamId, memberPage, txPage])` 加条件 `if (!teamId || isPersonal) return;`；refreshAudit effect 同加 `if (isPersonal) return;`。）

5. **渲染顶层分叉**（return 之前；**P1-4：分叉外壳沿用现状最外层 `<div className="min-h-screen bg-[#111] text-[#e2e8f0]">`（:158），TeamPage 现状不 import/渲染 Navbar，不得引入**——import 清单只有 createTeam/teamDisplayName/Link 三项）：

```tsx
  if (realTeams.length === 0) {
    return (
      <div className="min-h-screen bg-[#111] text-[#e2e8f0]">
        <div className="max-w-xl mx-auto flex flex-col items-center justify-center py-24 gap-4" data-testid="team-empty-state">
          <p className="text-sm text-[#888]">还没有团队——个人项目无需团队管理，创建团队后可邀请成员协作</p>
          <Button type="primary" onClick={() => setCreateOpen(true)}>新建团队</Button>
          {createModal}
        </div>
      </div>
    );
  }

  if (isPersonal) {
    return (
      <div className="min-h-screen bg-[#111] text-[#e2e8f0]">
        <div className="max-w-2xl mx-auto p-8" data-testid="personal-panel">
          <h2 className="text-lg font-bold mb-1">个人项目</h2>
          <p className="text-sm text-[#888] mb-6">个人项目的积分、订阅与作品独立于团队，无需团队管理。</p>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-white/5 rounded-lg p-4">
              <p className="text-3xl font-bold text-[#f59e0b]" data-testid="personal-balance-total">
                {(balance?.total ?? 0).toLocaleString()}
              </p>
              <p className="text-xs text-[#888] mt-1">可用积分（通用 {balance?.credits ?? 0} · 订阅 {balance?.subscriptionCredits ?? 0}）</p>
            </div>
            <div className="bg-white/5 rounded-lg p-4">
              {team?.subscription ? (
                <>
                  <p className="text-base font-bold">{team.subscription.planName}</p>
                  <p className="text-xs text-[#888] mt-1">有效期至 {new Date(team.subscription.currentPeriodEnd).toLocaleDateString()}</p>
                </>
              ) : (
                <p className="text-sm text-[#888]">暂无订阅</p>
              )}
            </div>
          </div>
          <div className="flex gap-3">
            <Link to="/settings/credits" data-testid="link-personal-recharge" className="px-4 py-1.5 rounded-md bg-[#f59e0b] text-black text-sm no-underline">充值</Link>
            <Link to="/settings/membership" data-testid="link-personal-membership" className="px-4 py-1.5 rounded-md bg-[#4ade80] text-black text-sm no-underline">开通/管理会员</Link>
          </div>
        </div>
        {createModal}
      </div>
    );
  }
```

6. **createModal 抽取**（两种空/面板共用，放 return 之前的变量）：

```tsx
  const createModal = (
    <Modal open={createOpen} title="新建团队" okText="创建" cancelText="取消" confirmLoading={creating}
      onCancel={() => setCreateOpen(false)} onOk={doCreateTeam}>
      <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="团队名称" />
    </Modal>
  );
```

7. **顶部新建按钮**（header 区 :157-204 内、团队切换 select 旁）：

```tsx
          <Button size="small" onClick={() => setCreateOpen(true)}>新建团队</Button>
```

8. **teamDisplayName 替换**：header 团队名 :162 `{teamDisplayName(team)}`、切换 select option :201 `{teamDisplayName(t)}`、重命名 placeholder :408 `teamDisplayName(team)`。**团队切换 select 的渲染条件**（:194 `teams.length > 1`）改为 `realTeams.length > 0`（有真实团队才需要切换：个人面板 ↔ 真实团队之间切换）。

9. **积分 tab 收敛（D4）**：credits tab（:317-339）充值/立即开通按钮替换为跳转：

```tsx
        <Button type="primary" onClick={() => navigate(`/team/${teamId}/billing`)}>充值 / 订阅</Button>
```

（需 `useNavigate()`；WeChatQRModal 及 doRecharge/doSubscribe/rechargeOpen/qrOrder/subscribePlan 相关 state 与 Modal 从 TeamPage 删除——`listTeamPlans` 拉取同步删除。此项依赖 Task 9 的路由存在，若 Task 7 先行则跳转 404——**执行顺序上 Task 7 的第 9 小项放到 Task 9 完成后补**，或 Task 7/9 同一执行会话连续完成。计划默认：Task 7 完成其余项，第 9 小项并入 Task 9 Step 3。）

- [ ] **Step 4: 跑测试确认通过 + 门禁**

Run: `cd apps/web && pnpm exec vitest run src/pages/team && pnpm exec tsc -b && pnpm test`
Expected: PASS（既有用例走真实团队分支不受影响）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/team
git commit -m "feat(web): TeamPage 空状态/个人项目精简面板/顶部新建团队；默认团队不拉管理接口"
```

---

### Task 8: teamApi kind 参数 + MembershipPage 文案修正

**Files:**
- Modify: `apps/web/src/api/teamApi.ts:143-147`（listTeamRechargeOrders）
- Modify: `apps/web/src/pages/settings/MembershipPage.tsx:23`（文案）
- Test: `apps/web/src/api/teamApi.test.ts`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```ts
describe('listTeamRechargeOrders kind 参数', () => {
  it('不传 kind 返回全部订单（billing 页用），传 kind 则过滤', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { items: [], total: 0 } }) });
    const { listTeamRechargeOrders } = await import('./teamApi');
    await listTeamRechargeOrders('t-1');
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/team/t-1/recharge/orders?page=1&pageSize=20');
    await listTeamRechargeOrders('t-1', 2, 10, 'credits');
    expect((global.fetch as any).mock.calls[1][0]).toBe('/api/team/t-1/recharge/orders?kind=credits&page=2&pageSize=10');
    await listTeamRechargeOrders('t-1', 1, 20, 'subscription');
    expect((global.fetch as any).mock.calls[2][0]).toBe('/api/team/t-1/recharge/orders?kind=subscription&page=1&pageSize=20');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm exec vitest run src/api/teamApi.test.ts`
Expected: FAIL — 第二次调用仍为 credits。

- [ ] **Step 3: 实现**

teamApi.ts listTeamRechargeOrders（:143-147）替换（**kind 改可选无默认**：不传=后端不过滤=全部订单，billing 页展示充值+订阅订单；原默认 'credits' 会让 CreditsPage 之外的新调用方静默漏单）：

```ts
export function listTeamRechargeOrders(
  teamId: string,
  page = 1,
  pageSize = 20,
  kind?: 'credits' | 'subscription',
) {
  const kindQs = kind ? `kind=${kind}&` : '';
  return apiFetch<{ items: TeamRechargeOrderRow[]; total: number }>(
    `/team/${teamId}/recharge/orders?${kindQs}page=${page}&pageSize=${pageSize}`);
}
```

**配套（防 CreditsPage 回归）**：`CreditsPage.tsx` 的 `loadOrders`（:58-66）调用处显式传 `'credits'`（`listTeamRechargeOrders(team.id, page, 20, 'credits')`）；CreditsPage.test 若断言该调用参数则同步。

MembershipPage.tsx:23 按钮文案替换：

```tsx
        立即订阅
```

（该按钮在个人订阅套餐对比表 PriceCell 内——原「团队订阅（前往团队管理）」与页面个人定位冲突，属 spec §5.3 点名修正项。**spec 同节提到的「删顶部账户余额 ¥」经核实前端已不存在**：MembershipPage 顶部现为「普通积分/订阅积分」文本行（数据来自新 balance 结构，语义正确保留）；「账户余额」卡已随 Plan A Task 13 从 CreditsPage 删除，本 Task 无需再删。）

- [ ] **Step 4: 跑测试确认通过 + 门禁**

Run: `cd apps/web && pnpm exec vitest run src/api/teamApi.test.ts && pnpm exec tsc -b && pnpm test`
Expected: PASS（MembershipPage 无现有测试，不新增——纯文案一行改动）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/teamApi.ts apps/web/src/pages/settings/MembershipPage.tsx apps/web/src/api/teamApi.test.ts
git commit -m "feat(web): listTeamRechargeOrders 支持 kind 参数；MembershipPage 订阅按钮文案改个人语义"
```

---

### Task 9: TeamBillingPage 新页面 + 路由

**Files:**
- Create: `apps/web/src/pages/team/TeamBillingPage.tsx`
- Modify: `apps/web/src/router.tsx:28`（路由）
- Modify: `apps/web/src/pages/team/TeamPage.tsx`（积分 tab 跳转——Task 7 遗留第 9 小项）
- Test: `apps/web/src/pages/team/TeamBillingPage.test.tsx`（新建）

- [ ] **Step 1: 写失败测试**

```tsx
// apps/web/src/pages/team/TeamBillingPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const api = vi.hoisted(() => ({
  getMyTeams: vi.fn(),
  getTeamBalanceView: vi.fn(),
  listTeamPlans: vi.fn(),
  listTeamRechargeOrders: vi.fn(),
  createTeamRechargeOrder: vi.fn(),
  payTeamOrder: vi.fn(),
  createSubscriptionOrder: vi.fn(),
}));
vi.mock('@/api/teamApi', () => ({
  ...api,
  // P1：整模块 mock 必须补 teamDisplayName（组件调用它，mock 后 undefined 即崩）
  teamDisplayName: (t: { isDefault: boolean; name: string }) => (t.isDefault ? '个人项目' : t.name),
}));
vi.mock('@/components/WeChatQRModal', () => ({
  WeChatQRModal: ({ visible }: { visible: boolean }) => (visible ? <div data-testid="wechat-qr-modal" /> : null),
}));
vi.mock('@/pages/home/components/Navbar', () => ({ Navbar: () => <div /> }));

import TeamBillingPage from './TeamBillingPage';

const teamFixture = (overrides: Record<string, unknown> = {}) => ({
  id: 't-1', name: '梦幻团队', role: 'OWNER', status: 'ACTIVE',
  isDefault: false, isOwner: true, createdAt: '2026-08-01', memberCount: 3,
  balance: { credits: 100, subscriptionCredits: 50 },
  subscription: { planName: '团队月卡', status: 'active', currentPeriodEnd: '2026-09-30' },
  ...overrides,
});

function renderBilling(id = 't-1') {
  return render(
    <MemoryRouter initialEntries={[`/team/${id}/billing`]}>
      <Routes><Route path="/team/:id/billing" element={<TeamBillingPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe('TeamBillingPage', () => {
  beforeEach(() => {
    api.getMyTeams.mockResolvedValue([teamFixture()]);
    api.getTeamBalanceView.mockResolvedValue({ credits: 100, subscriptionCredits: 50, total: 150, quota: 0, used: 0 });
    api.listTeamPlans.mockResolvedValue([{ id: 'plan1', name: '团队月卡', priceMonthly: 3000, monthlyCredits: 300, seatLimit: 5, isActive: true }]);
    api.listTeamRechargeOrders.mockResolvedValue({ items: [], total: 0 });
  });

  it('非成员/团队不存在时提示无权', async () => {
    api.getMyTeams.mockResolvedValue([]);
    renderBilling('t-other');
    expect(await screen.findByText(/无权访问/)).toBeInTheDocument();
  });

  it('默认团队 billing 重定向 /settings/credits', async () => {
    api.getMyTeams.mockResolvedValue([teamFixture({ id: 't-default', isDefault: true })]);
    // P2：MemoryRouter 补目标路由渲染 marker——<Navigate> 跳转后整树卸载，直接断言源帧 testid 会 flaky
    render(
      <MemoryRouter initialEntries={['/team/t-default/billing']}>
        <Routes>
          <Route path="/team/:id/billing" element={<TeamBillingPage />} />
          <Route path="/settings/credits" element={<div data-testid="credits-page-marker" />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('credits-page-marker')).toBeInTheDocument());
  });

  it('渲染团队名/余额/充值档位/套餐/订单记录', async () => {
    renderBilling();
    expect(await screen.findByText('梦幻团队')).toBeInTheDocument();
    expect(screen.getByTestId('billing-balance-total')).toHaveTextContent('150');
    expect(screen.getByRole('button', { name: /¥10/ })).toBeInTheDocument();
    expect(await screen.findByText('团队月卡')).toBeInTheDocument();
  });

  it('充值下单走团队链路：createTeamRechargeOrder + payTeamOrder', async () => {
    api.createTeamRechargeOrder.mockResolvedValue({ outTradeNo: 'TEAM1' });
    api.payTeamOrder.mockResolvedValue({ orderNo: 'TEAM1', amount: 1000, status: 'PENDING', codeUrl: 'wx://qr' });
    renderBilling();
    fireEvent.click(await screen.findByRole('button', { name: /¥10/ }));
    await waitFor(() => expect(api.createTeamRechargeOrder).toHaveBeenCalledWith('t-1', 10));
    await waitFor(() => expect(api.payTeamOrder).toHaveBeenCalledWith('t-1', 'TEAM1'));
    await waitFor(() => expect(screen.getByTestId('wechat-qr-modal')).toBeInTheDocument());
  });

  it('订阅下单走 createSubscriptionOrder + payTeamOrder', async () => {
    api.createSubscriptionOrder.mockResolvedValue({ outTradeNo: 'TEAM2' });
    api.payTeamOrder.mockResolvedValue({ orderNo: 'TEAM2', amount: 3000, status: 'PENDING', codeUrl: 'wx://qr2' });
    renderBilling();
    fireEvent.click(await screen.findByRole('button', { name: /开通团队订阅/ }));
    await waitFor(() => expect(api.createSubscriptionOrder).toHaveBeenCalledWith('t-1', 'plan1'));
    await waitFor(() => expect(api.payTeamOrder).toHaveBeenCalledWith('t-1', 'TEAM2'));
    await waitFor(() => expect(screen.getByTestId('wechat-qr-modal')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm exec vitest run src/pages/team/TeamBillingPage.test.tsx`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

新建 `TeamBillingPage.tsx`：

```tsx
import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { Button, message } from 'antd';
import {
  getMyTeams, getTeamBalanceView, listTeamPlans, listTeamRechargeOrders,
  createTeamRechargeOrder, payTeamOrder, createSubscriptionOrder,
  teamDisplayName, type MyTeam, type TeamPlanRow, type TeamRechargeOrderRow,
} from '@/api/teamApi';
import { Navbar } from '@/pages/home/components/Navbar';
import { WeChatQRModal } from '@/components/WeChatQRModal';

const PRESET_AMOUNTS = [10, 30, 50, 100, 200, 500];
const PAGE_SIZE = 20;

interface QrState { orderNo: string; codeUrl: string; amount: number }

/** 团队账单页：订阅+充值独立于 /team 管理页（spec §5.3）；默认团队跳个人积分页（六禁：默认团队不允许团队套餐） */
export default function TeamBillingPage() {
  const { id } = useParams<{ id: string }>();
  const [teams, setTeams] = useState<MyTeam[] | null>(null);
  const [balance, setBalance] = useState<{ credits: number; subscriptionCredits: number; total: number } | null>(null);
  const [plans, setPlans] = useState<TeamPlanRow[]>([]);
  const [orders, setOrders] = useState<{ items: TeamRechargeOrderRow[]; total: number }>({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number>(PRESET_AMOUNTS[0]);
  const [qr, setQr] = useState<QrState | null>(null);

  const team = teams?.find((t) => t.id === id) ?? null;

  useEffect(() => {
    getMyTeams().then(setTeams).catch((e) => message.error('加载失败：' + (e as Error).message));
  }, []);

  const refresh = async (teamId: string, nextPage = 1) => {
    const [b, ps, os] = await Promise.all([
      getTeamBalanceView(teamId),
      listTeamPlans().catch(() => []),
      // 不传 kind：充值+订阅订单都展示（P2-15②，行内以 kind 徽标区分）
      listTeamRechargeOrders(teamId, nextPage, PAGE_SIZE),
    ]);
    setBalance(b);
    setPlans(ps);
    setOrders(os);
    setPage(nextPage);
  };

  useEffect(() => {
    if (id && team && !team.isDefault) void refresh(id).catch(() => {});
  }, [id, team?.id, team?.isDefault]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (teams === null) return <div className="min-h-screen bg-[#111]" />;
  if (!team) {
    return (
      <div className="min-h-screen bg-[#111] text-white">
        <Navbar />
        <p className="max-w-xl mx-auto py-24 text-sm text-[#888]" data-testid="billing-forbidden">无权访问该团队或团队不存在。<Link to="/team" className="text-[#5DDCFF]">返回团队管理</Link></p>
      </div>
    );
  }
  if (team.isDefault) {
    return (
      <div data-testid="redirect-personal">
        <Navigate to="/settings/credits" replace />
      </div>
    );
  }

  const doRecharge = async () => {
    if (!id) return;
    try {
      const { outTradeNo } = await createTeamRechargeOrder(id, selected);
      const pay = await payTeamOrder(id, outTradeNo);
      if (pay.codeUrl) setQr({ orderNo: outTradeNo, codeUrl: pay.codeUrl, amount: pay.amount / 100 });
      else message.error('下单失败');
    } catch (e) {
      message.error('下单失败：' + (e as Error).message);
    }
  };

  const doSubscribe = async (planId: string) => {
    if (!id) return;
    try {
      const { outTradeNo } = await createSubscriptionOrder(id, planId);
      const pay = await payTeamOrder(id, outTradeNo);
      if (pay.codeUrl) setQr({ orderNo: outTradeNo, codeUrl: pay.codeUrl, amount: pay.amount / 100 });
      else message.error('下单失败');
    } catch (e) {
      message.error('下单失败：' + (e as Error).message);
    }
  };

  const statusBadge = (s: string) =>
    s === 'SUCCESS' ? <span className="text-[#4ade80]">成功</span>
    : s === 'PENDING' ? <span className="text-[#f59e0b]">待支付</span>
    : <span className="text-[#888]">{s === 'CLOSED' ? '已关闭' : '失败'}</span>;

  return (
    <div className="min-h-screen bg-[#111] text-white">
      <Navbar />
      <div className="max-w-4xl mx-auto p-8">
        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-lg font-bold">{teamDisplayName(team)} · 账单</h2>
          {team.subscription && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#4ade80]/20 text-[#4ade80]">
              {team.subscription.planName} · 至 {new Date(team.subscription.currentPeriodEnd).toLocaleDateString()}
            </span>
          )}
          <Link to="/team" className="ml-auto text-xs text-[#888] no-underline">返回团队管理</Link>
        </div>

        <div className="bg-white/5 rounded-lg p-4 mb-6">
          <p className="text-3xl font-bold text-[#f59e0b]" data-testid="billing-balance-total">{(balance?.total ?? 0).toLocaleString()}</p>
          <p className="text-xs text-[#888] mt-1">可用积分（通用 {balance?.credits ?? 0} · 订阅 {balance?.subscriptionCredits ?? 0}）</p>
        </div>

        <h3 className="text-sm font-bold mb-3">积分充值（1 元 = 10 积分）</h3>
        <div className="grid grid-cols-6 gap-2 mb-4">
          {PRESET_AMOUNTS.map((yuan) => (
            <button key={yuan} onClick={() => setSelected(yuan)}
              className={`py-3 rounded-lg text-sm border cursor-pointer ${selected === yuan ? 'border-[#5DDCFF] bg-[#5DDCFF]/10 text-white' : 'border-white/10 text-[#888]'}`}>
              <div>¥{yuan}</div>
              <div className="text-xs opacity-70">{yuan * 10} 积分</div>
            </button>
          ))}
        </div>
        <Button type="primary" block onClick={doRecharge} style={{ backgroundColor: '#f59e0b', borderColor: '#f59e0b' }}>
          微信支付 ¥{selected}
        </Button>

        <h3 className="text-sm font-bold mt-8 mb-3">团队套餐订阅</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          {plans.map((p) => (
            <div key={p.id} className="bg-white/5 rounded-lg p-4 flex flex-col gap-2">
              <p className="text-base font-bold">{p.name}</p>
              <p className="text-2xl font-bold text-[#4ade80]">¥{(p.priceMonthly / 100).toFixed(0)}<span className="text-xs text-[#888]">/月</span></p>
              <p className="text-xs text-[#888]">月发放 {p.monthlyCredits} 积分 · {p.seatLimit} 席位</p>
              <Button size="small" onClick={() => void doSubscribe(p.id)}>开通团队订阅</Button>
            </div>
          ))}
        </div>
        {team.subscription && <p className="text-xs text-[#666] mb-4">已有生效订阅，再次开通将覆盖当前周期（旧订阅自动过期）。</p>}

        <h3 className="text-sm font-bold mt-8 mb-3">订单记录（充值 + 订阅）</h3>
        <div className="divide-y divide-white/5">
          {orders.items.map((o) => (
            <div key={o.id} className="flex items-center justify-between py-2 text-sm">
              <span className="font-mono text-xs text-[#888]">{o.outTradeNo}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-[#aaa]">{o.kind === 'subscription' ? '订阅' : '充值'}</span>
              <span>+¥{(o.amountFen / 100).toFixed(2)}</span>
              {statusBadge(o.status)}
              <span className="text-xs text-[#666]">{new Date(o.createdAt).toLocaleString()}</span>
            </div>
          ))}
          {orders.items.length === 0 && <p className="text-xs text-[#666] py-2">暂无订单</p>}
        </div>
        {orders.total > PAGE_SIZE && (
          <div className="flex justify-between mt-3 text-xs">
            <Button size="small" disabled={page <= 1} onClick={() => id && void refresh(id, page - 1)}>上一页</Button>
            <span className="text-[#666]">{page} / {Math.ceil(orders.total / PAGE_SIZE)}</span>
            <Button size="small" disabled={page >= Math.ceil(orders.total / PAGE_SIZE)} onClick={() => id && void refresh(id, page + 1)}>下一页</Button>
          </div>
        )}
      </div>

      <WeChatQRModal
        visible={!!qr}
        onCancel={() => { setQr(null); if (id) void refresh(id); }}
        onSuccess={() => { setQr(null); if (id) void refresh(id); }}
        codeUrl={qr?.codeUrl ?? ''}
        orderNo={qr?.orderNo ?? ''}
        amount={qr?.amount ?? 0}
        expiredAt={new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()}
      />
    </div>
  );
}
```

（**P0：prop 名是 `codeUrl`**——WeChatQRModal.tsx:8 必填 prop 实名，非 qrCodeUrl；写错 tsc -b 双报错。`TeamPlanRow`/`TeamRechargeOrderRow` 已在 teamApi.ts 导出。）

router.tsx:28 `/team` 路由旁加：

```tsx
  { path: '/team/:id/billing', element: <TeamBillingPage /> },
```

（顶部 `import TeamBillingPage from '@/pages/team/TeamBillingPage';`；放在 RequireAuth children 内。）

TeamPage.tsx 积分 tab（Task 7 遗留第 9 小项）：credits tab 的充值/立即开通按钮区（:317-319）替换为：

```tsx
        <Button type="primary" onClick={() => navigate(`/team/${teamId}/billing`)}>充值 / 订阅</Button>
```

并删除：doRecharge/doSubscribe、rechargeOpen/qrOrder/subscribePlan state、充值档位 Modal（:430-440）、订阅 Modal（:442-455）、WeChatQRModal（:457-467）、refreshAll 中 `listTeamPlans()` 与 `plans` state、相关 import（WeChatQRModal/createTeamRechargeOrder/payTeamOrder/createSubscriptionOrder/listTeamPlans）。TeamPage.test.tsx 对应用例（若有 recharge/subscribe 断言）更新为跳转断言。

- [ ] **Step 4: 跑测试确认通过 + 门禁**

Run: `cd apps/web && pnpm exec vitest run src/pages/team && pnpm exec tsc -b && pnpm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/team apps/web/src/router.tsx
git commit -m "feat(web): /team/:id/billing 团队账单页（充值+订阅+订单记录）；TeamPage 积分 tab 收敛为余额+流水"
```

---

## Phase 9：上传上下文、顶栏积分 scope-aware、Socket 余额口径

### Task 10: canvasStore.teamId + 后端 create 返回 teamId + 画布页写入

**Files:**
- Modify: `apps/api/src/modules/canvas/canvas.service.ts`（create 返回值）
- Modify: `apps/web/src/api/canvasApi.ts`（CreateCanvasResult）
- Modify: `apps/web/src/stores/canvasStore.ts`（teamId state，对齐 projectId 四处样板 :90,:114,:162,:765）
- Modify: `apps/web/src/pages/canvas/page.tsx:31-35,:40-59`（新建/加载两条路径写 teamId）
- Test: `apps/api/src/modules/canvas/canvas.service.spec.ts`（追加）、`apps/web/src/pages/canvas/page.test.tsx`（追加断言）

（**不改 projectApi.ProjectData**——page.tsx:44 用裸 `fetch('/api/projects/:id')` 不消费该类型，运行时靠 `json.data.teamId` any 透传，加类型声明是空转改动。）

- [ ] **Step 1: 写失败测试（api 侧先）**

canvas.service.spec.ts 追加：

```typescript
  it('create 返回值含 teamId（前端画布 store 需要）', async () => {
    // 照抄既有「团队化」用例（spec:227-241）的 mock 范式：
    // - teamMember 必须用 findFirst（顶层 mock 只有它，assertTeamMember 也只调它）
    // - 不得出现 prisma.team.findFirst —— 顶层 prisma mock（spec:22-33）没有 team 键，
    //   且 create 事务体不调 team.findFirst（既有用例里的 team.findFirst 在 $transaction 内联 tx 对象中，两码事）
    // - '画布' 非空名不走编号分支，不调 template.findMany，无需 mock
    prisma.teamMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
    prisma.canvasProject.create.mockResolvedValue({ id: 'p1', teamId: 't-team' });
    prisma.template.create.mockResolvedValue({ id: 'tp1' });
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    const result = await service.create('画布', null, 'u1', 't-team');
    expect(result.teamId).toBe('t-team');
  });
```

**既有断言修正表（Step 3 实现后 create 返回值多了 teamId，3 处精确 toEqual 必红，同步补齐——禁止实现层删字段迁就测试）：**

| 行 | 现断言 | 改为 |
|---|---|---|
| :65 | `toEqual({ templateId: 't1', projectId: 'p1', name: '新画布' })` | 补 `teamId: 'team1'`（无 teamId 入参 → ensureDefaultTeam mock 固定返回 team1） |
| :115 | `toEqual({ templateId: 't1', projectId: 'p1', name: '画布1' })` | 补 `teamId: 'team1'` |
| :240 | `toEqual({ templateId: 'tp1', projectId: 'p1', name: '名字' })` | 补 `teamId: 't-team'` |

（:121/:128/:137 只断言 `result.name`，不受影响。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && pnpm exec vitest run src/modules/canvas/canvas.service.spec.ts`
Expected: FAIL — result.teamId undefined。

- [ ] **Step 3: 实现（后端一行）**

canvas.service.ts create 事务返回（Plan A 后约 :104 区域）：

```typescript
      return { templateId: template.id, projectId: project.id, name: finalName, teamId: teamIdResolved };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && pnpm exec vitest run src/modules/canvas/canvas.service.spec.ts && pnpm test`
Expected: PASS。

- [ ] **Step 5: 前端接线**

`canvasApi.ts`：

```ts
export interface CreateCanvasResult { templateId: string; projectId: string; name: string; teamId: string }
```

`canvasStore.ts` 四处对齐 projectId 样板：state 接口（:90 旁）加 `teamId: string | null;` 与 `setTeamId: (teamId: string | null) => void;`；初始值（:162 旁）`teamId: null,`；实现（:765 旁）`setTeamId: (teamId) => set({ teamId }),`。

`page.tsx` 两条路径：

```ts
// createUntitledProject（:31-35）
async function createUntitledProject(): Promise<{ id: string; name: string }> {
  const { projectId, name, teamId } = await createCanvas('', null);
  localStorage.setItem(PROJECT_ID_KEY, projectId);
  useCanvasStore.getState().setTeamId(teamId ?? null);
  return { id: projectId, name };
}
```

```ts
// loadProjectIntoStore（:49-52 之间，第一个 isCancelled 检查后）
  const project = json.data;

  // 丢弃过期响应（effect 重跑/StrictMode）的 store 写入
  if (isCancelled?.()) return project.name || '未命名项目';
  useCanvasStore.getState().setTeamId(project.teamId ?? null);   // ← 新增：画布团队上下文（顶栏积分/上传/素材库消费）
```

page.test.tsx：在现有「加载项目成功」用例（mock fetch 返回 project json 处）的返回数据加 `teamId: 't-1'`，用例末尾追加断言：

```tsx
    await waitFor(() => expect(useCanvasStore.getState().teamId).toBe('t-1'));
```

（page.test.tsx 的 canvasStore 若被部分 mock，以现有 mock 结构为准补 teamId 透传；若整模块 mock 则直接断言 mock 调用。）

- [ ] **Step 6: 双门禁 + Commit**

Run: `cd apps/web && pnpm exec tsc -b && pnpm test && cd ../api && pnpm test`
Expected: 全绿。

```bash
git add apps/api/src/modules/canvas apps/web/src/api apps/web/src/stores/canvasStore.ts apps/web/src/pages/canvas/page.tsx apps/web/src/pages/canvas/page.test.tsx
git commit -m "feat: 画布团队上下文落地——create 返回 teamId、canvasStore.teamId、两条加载路径写入"
```

---

### Task 11: storageApi 参数扩展 + materialLibraryStore 团队维度

**Files:**
- Modify: `apps/web/src/api/storageApi.ts:10-24`（presignUpload params）
- Modify: `apps/web/src/stores/materialLibraryStore.ts`（loadFolders/loadFiles/uploadFile）
- Test: `apps/web/src/stores/materialLibraryStore.test.ts`（追加）

- [ ] **Step 1: 写失败测试（追加）**

现有 storageApi mock 是内联匿名 `vi.fn()`（:27-30），先提为命名变量再供断言引用：

```ts
// :27-30 替换为：
const mockPresignUpload = vi.fn();
const mockConfirmUpload = vi.fn();
vi.mock('@/api/storageApi', () => ({
  presignUpload: mockPresignUpload,
  confirmUpload: mockConfirmUpload,
}));

// 头部补 canvasStore mock（现有 axios/antd mock 旁）
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: { getState: () => ({ projectId: 'p1', teamId: 't-team' }) },
}));
```

用例（注意 loadFolders 判 `data.data?.success`，mock 返回体必须带 `success: true`，:77）：

```ts
  it('loadFolders 按画布团队维度拉取', async () => {
    mockGet.mockResolvedValue({ data: { data: { success: true, data: { folders: [] } } } });
    await useMaterialLibraryStore.getState().loadFolders();
    expect(mockGet).toHaveBeenCalledWith('/api/material/folders', expect.objectContaining({
      params: expect.objectContaining({ teamId: 't-team' }),
    }));
  });

  it('uploadFile presign 传 projectId（后端三级回落①级）', async () => {
    useMaterialLibraryStore.setState({ uploading: false, uploadProgress: 0, selectedFolderId: null });
    await useMaterialLibraryStore.getState().uploadFile(new File(['x'], 'a.png', { type: 'image/png' }));
    expect(mockPresignUpload).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1',
    }));
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm exec vitest run src/stores/materialLibraryStore.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

storageApi.ts presignUpload params（:10-16）加两字段：

```ts
export async function presignUpload(
  params: {
    fileName: string;
    fileSize: number;
    fileType: string;
    type: 'uploaded' | 'temp';
    projectId?: string;
    teamId?: string;
  },
  signal?: AbortSignal,
): Promise<PresignResponse> {
```

materialLibraryStore.ts（画布内素材库=当前团队维度，D5）：

```ts
import { useCanvasStore } from './canvasStore';

// loadFolders（:73-83）：axios.get('/api/material/folders', { params: { teamId: useCanvasStore.getState().teamId ?? undefined } })
// loadFiles（:85-109）：params: { folderId: selectedFolderId, teamId: useCanvasStore.getState().teamId ?? undefined }
// uploadFile presign 段（:170-175）：
      const { fileId, uploadUrl, key, fields } = await presignUpload({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        type: 'uploaded',
        projectId: useCanvasStore.getState().projectId ?? undefined,
      });
```

- [ ] **Step 4: 跑测试确认通过 + 门禁**

Run: `cd apps/web && pnpm exec vitest run src/stores/materialLibraryStore.test.ts && pnpm exec tsc -b && pnpm test`
Expected: PASS（page.test.tsx 的 materialLibraryStore mock 若缺 teamId 路径不触发真实逻辑则不受影响）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/storageApi.ts apps/web/src/stores/materialLibraryStore.ts apps/web/src/stores/materialLibraryStore.test.ts
git commit -m "feat(web): presign 支持 projectId/teamId；素材库按画布团队拉取与上传"
```

---

### Task 12: 画布上传 13 处传 projectId

**Files:**
- Create: `apps/web/src/utils/uploadContext.ts`
- Modify: `apps/web/src/pages/canvas/components/AddNodeMenu.tsx:211`
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx:391,433,582,652,694`
- Modify: `apps/web/src/pages/canvas/components/nodes/MultiImageNode.tsx:151`
- Modify: `apps/web/src/pages/canvas/components/nodes/MultiImageConfigPanel.tsx:128`
- Modify: `apps/web/src/pages/canvas/components/nodes/AudioGenNode.tsx:109`
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx:512`
- Modify: `apps/web/src/pages/canvas/components/nodes/prompt-input/useImageUpload.ts:51`
- Modify: `apps/web/src/utils/splitUploadService.ts`（UploadOptions+uploadOne）+ `apps/web/src/stores/canvasStore.ts:653`（调用点）
- Modify: `apps/web/src/utils/mediaUploadUtils.ts:15-19`（uploadImageBlob）+ `VideoGenNode.tsx:448`（调用点）
- Test: `useImageUpload.test.ts`、`splitUploadService.test.ts`、`mediaUploadUtils.test.ts`（追加断言）

- [ ] **Step 1: 写失败测试（三处代表）**

useImageUpload.test.ts 追加（该文件已 mock storageApi 与 canvasStore 相关依赖，若未 mock canvasStore 则补）：

```ts
  it('上传 presign 传 projectId', async () => {
    // 触发现有用例同款上传流程后断言
    expect(mockPresignUploadFn).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1',
    }));
  });
```

splitUploadService.test.ts 追加：

```ts
  it('uploadOne presign 透传 options.projectId', async () => {
    await uploadSplitBlobs([new Blob(['x'])], { projectId: 'p1', maxConcurrent: 1, maxRetries: 0 } as any);
    expect(mockPresign).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }));
  });
```

mediaUploadUtils.test.ts 追加：

```ts
  it('uploadImageBlob 透传 projectId', async () => {
    await uploadImageBlob(new Blob(['x'], { type: 'image/jpeg' }), 'p1');
    expect(mocks.presignUpload).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }));
  });
```

（触发上传的完整流程代码从同文件现有用例复制——各测试已有现成的「执行上传→断言 presign」路径，本用例只是在断言中加 projectId。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm exec vitest run src/pages/canvas/components/nodes/prompt-input/useImageUpload.test.ts src/utils/splitUploadService.test.ts src/utils/mediaUploadUtils.test.ts`
Expected: FAIL — 断言的调用参数不含 projectId。

- [ ] **Step 3: 实现**

新建 helper：

```ts
// apps/web/src/utils/uploadContext.ts
import { useCanvasStore } from '@/stores/canvasStore';

/** 画布内上传统一取 projectId（后端 presign 三级回落①级：解析 project.teamId + editor 校验） */
export function canvasProjectId(): string | undefined {
  return useCanvasStore.getState().projectId ?? undefined;
}
```

11 处直接调用点统一改造（每处 presignUpload 参数对象加一行 `projectId: canvasProjectId(),` + 顶部 import）：

| 文件:行 | 场景 |
| --- | --- |
| AddNodeMenu.tsx:211 | 菜单上传建节点 |
| ImageGenNode.tsx:391 | 参考图上传 |
| ImageGenNode.tsx:433 | 变换保存 |
| ImageGenNode.tsx:582 | 标注保存 |
| ImageGenNode.tsx:652 | 裁剪保存 |
| ImageGenNode.tsx:694 | 涂抹蒙版上传 |
| MultiImageNode.tsx:151 | 多图上传 |
| MultiImageConfigPanel.tsx:128 | 多图面板上传 |
| AudioGenNode.tsx:109 | 参考音频 |
| VideoGenNode.tsx:512 | 参考视频 |
| useImageUpload.ts:51 | prompt 图片 |

工具层两处：

```ts
// mediaUploadUtils.ts
export async function uploadImageBlob(blob: Blob, projectId?: string): Promise<...> {
  const { fileId, ... } = await presignUpload({ ..., projectId });
}
// VideoGenNode.tsx:448 调用处改 uploadImageBlob(blob, canvasProjectId())
```

**splitUploadService 是位置参数链，不是 options 透传（P2）**——projectId 需沿三级各加一个参数（三个函数均模块私有，签名可自由改）：

```ts
// UploadOptions（:18-24）加 projectId?: string
// uploadOne（:37-43）：namePrefix 后插入第 5 参
async function uploadOne(
  blob: Blob, index: number, cols: number, namePrefix: string,
  projectId: string | undefined,
  signal?: AbortSignal,
): Promise<...> {
  // presignUpload params 加：projectId,
}
// uploadOneWithRetry（:89-96）：同样在 namePrefix 后插入，透传给 uploadOne（:103）
async function uploadOneWithRetry(
  blob: Blob, index: number, cols: number, namePrefix: string,
  projectId: string | undefined,
  signal?: AbortSignal,
  maxRetries = 1,
): Promise<UploadResult> { ... }
// uploadSplitBlobs（:124-128 解构处）加 projectId，:155 调用 uploadOneWithRetry 处补传
// canvasStore.ts:653 调用 uploadSplitBlobs 处加 projectId: get().projectId ?? undefined（canvasStore 内用 get()，不 import helper 防循环）
```

- [ ] **Step 4: 跑测试确认通过 + 门禁**

Run: `cd apps/web && pnpm exec vitest run src/pages/canvas src/utils && pnpm exec tsc -b && pnpm test`
Expected: PASS（节点组件既有 presign 断言若为精确对象匹配则补 `projectId: undefined` 或改 objectContaining——以实际失败信息为准逐个修正；FileUpload.tsx 未改动，其测试不动）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils apps/web/src/pages/canvas apps/web/src/stores/canvasStore.ts
git commit -m "feat(web): 画布内 13 处上传统一传 projectId（presign 三级回落①级落地）"
```

---

### Task 13: 后端 node:status credits 结构统一（D1）

**Files:**
- Modify: `apps/api/src/modules/gateway/execution.gateway.ts:43-52`（emitNodeStatus 类型）
- Modify: `apps/api/src/modules/execution/execution.service.ts:98,:150-152,:208-210`（三处 payload）
- Test: `apps/api/src/modules/execution/execution.service.spec.ts`（更新断言）

- [ ] **Step 1: 更新测试（先红）**

execution.service.spec.ts 中现有 `credits:` 断言（文本/视频/图片三处 done 事件）更新为对象断言，并追加口径用例：

```typescript
  it('node:status credits 为完整余额对象，total = credits + subscriptionCredits', async () => {
    // 以文本节点现有用例的 mock 结构为基础（pricingRule + teamCredit.consume 成功 + getBalanceView 返回双池）
    mockTeamCredit.getBalanceView.mockResolvedValue({ credits: 60, subscriptionCredits: 40, total: 100, quota: 0, used: 0 });
    await service.execute(/* 现有用例参数 */);
    const payload = mockGateway.emitNodeStatus.mock.calls.find((c: any[]) => c[1]?.status === 'done')?.[1];
    expect(payload.credits).toEqual({ credits: 60, subscriptionCredits: 40, total: 100 });
    expect(payload.credits.total).toBe(payload.credits.credits + payload.credits.subscriptionCredits);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && pnpm exec vitest run src/modules/execution/execution.service.spec.ts`
Expected: FAIL — credits 是数字。

- [ ] **Step 3: 实现**

execution.gateway.ts emitNodeStatus（:43-52）payload 类型改：

```typescript
    credits?: { credits: number; subscriptionCredits: number; total: number };
```

execution.service.ts 加私有方法并替换三处：

```typescript
  /** D1：余额推送统一完整三字段对象（原文本节点推 total、图片/视频只推 credits，口径不一） */
  private balancePayload(bal: { credits: number; subscriptionCredits: number; total: number } | null | undefined) {
    return bal ? { credits: bal.credits, subscriptionCredits: bal.subscriptionCredits, total: bal.total } : undefined;
  }
```

- :98 `credits: bal?.total` → `credits: this.balancePayload(bal),`
- :150-152 `credits: newBalance?.credits,` → `credits: this.balancePayload(newBalance),`
- :208-210 `credits: newBalance?.credits,` → `credits: this.balancePayload(newBalance),`

（其余 emitNodeStatus 调用点——loading/error/processor 侧——不带 credits，不动。）

- [ ] **Step 4: 跑测试确认通过 + 门禁**

Run: `cd apps/api && pnpm exec vitest run src/modules/execution && pnpm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/gateway apps/api/src/modules/execution
git commit -m "fix(api): node:status credits 统一完整余额对象 {credits, subscriptionCredits, total}"
```

---

### Task 14: creditsStore scope-aware + CanvasTopBar + CustomEvent 结构化

> **部署顺序铁律：Task 13 必须先于本 Task 上线。** 本 Task 后前端 handler 只认 `typeof data.credits === 'object'`——若后端仍在发数字，推送会被静默丢弃、顶栏不再更新。本地顺序执行无碍（Task 13 在前），分批部署时严禁颠倒。

**Files:**
- Modify: `apps/web/src/stores/creditsStore.ts`（整体重构）
- Modify: `apps/web/src/pages/canvas/components/CanvasTopBar.tsx:39-50`
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx:369-371`、`AudioGenNode.tsx:86-88`、`VideoGenNode.tsx:384-386`（handler 对象化）
- Test: `apps/web/src/stores/creditsStore.test.ts`（新建）、`CanvasTopBar.test.tsx`（更新）

- [ ] **Step 1: 写失败测试**

新建 creditsStore.test.ts：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const subApi = vi.hoisted(() => ({ getBalance: vi.fn(), getMe: vi.fn() }));
const teamApi = vi.hoisted(() => ({ getTeamBalanceView: vi.fn() }));
vi.mock('@/api/subscriptionApi', () => ({ subscriptionApi: subApi }));
vi.mock('@/api/teamApi', () => ({ getTeamBalanceView: teamApi.getTeamBalanceView }));

import { useCreditsStore } from './creditsStore';

describe('creditsStore scope-aware', () => {
  beforeEach(() => {
    subApi.getBalance.mockResolvedValue({ credits: 10, subscriptionCredits: 20, total: 30, subscriptionCreditsExpiry: '2099-01-01', updatedAt: '2026-01-01' });
    subApi.getMe.mockResolvedValue({ tier: 'pro' });
    teamApi.getTeamBalanceView.mockResolvedValue({ credits: 5, subscriptionCredits: 0, total: 5, quota: 0, used: 0 });
  });

  it('fetchBalance（personal）：双池+expiry+tier', async () => {
    await useCreditsStore.getState().fetchBalance();
    const s = useCreditsStore.getState();
    expect(s.scope).toBe('personal');
    expect(s.credits).toBe(10);
    expect(s.subscriptionCredits).toBe(20);
    expect(s.isSubscriptionActive()).toBe(true);
  });

  it('fetchTeamBalance（team）：团队双池，无 expiry，tier 清空', async () => {
    await useCreditsStore.getState().fetchTeamBalance('t-1');
    const s = useCreditsStore.getState();
    expect(s.scope).toBe('team');
    expect(s.teamId).toBe('t-1');
    expect(s.credits).toBe(5);
    expect(s.tier).toBeNull();
    // 团队 scope 订阅积分直接计活（无 expiry 概念）
    expect(s.isSubscriptionActive()).toBe(false);   // subscriptionCredits=0
  });

  it('团队 scope 且 subscriptionCredits>0 时订阅态为活', async () => {
    teamApi.getTeamBalanceView.mockResolvedValue({ credits: 0, subscriptionCredits: 30, total: 30, quota: 0, used: 0 });
    await useCreditsStore.getState().fetchTeamBalance('t-1');
    expect(useCreditsStore.getState().isSubscriptionActive()).toBe(true);
  });

  it('applyBalance：Socket 推送的完整对象写入双池', () => {
    useCreditsStore.getState().applyBalance({ credits: 7, subscriptionCredits: 8 });
    expect(useCreditsStore.getState().credits).toBe(7);
    expect(useCreditsStore.getState().subscriptionCredits).toBe(8);
  });
});
```

CanvasTopBar.test.tsx 更新（现有 mock creditsStore 结构上补 scope 字段），追加分流用例：

```tsx
  it('画布属非默认团队：挂载拉 /team/:id/balance（fetchTeamBalance）', async () => {
    // mock：canvasStore teamId='t-team'；getDefaultTeam 返回 {id:'t-default'}
    renderTopBarWith({ teamId: 't-team' });
    await waitFor(() => expect(mockFetchTeamBalance).toHaveBeenCalledWith('t-team'));
  });

  it('画布属默认团队：挂载走 personal fetchBalance', async () => {
    renderTopBarWith({ teamId: 't-default' });
    await waitFor(() => expect(mockFetchTeamBalance).not.toHaveBeenCalled());
    expect(mockCreditsStore.fetchBalance).toHaveBeenCalled();
  });

  it('credits:update CustomEvent detail 为对象时 applyBalance', () => {
    renderTopBarWith({ teamId: 't-default' });
    act(() => {
      window.dispatchEvent(new CustomEvent('credits:update', { detail: { credits: 1, subscriptionCredits: 2 } }));
    });
    expect(mockCreditsStore.applyBalance).toHaveBeenCalledWith({ credits: 1, subscriptionCredits: 2 });
  });
```

（`renderTopBarWith` 基于现有 render 包装补 canvasStore teamId 与 `@/api/teamApi` 的 getDefaultTeam mock——mock 形式对齐该文件现有 `vi.hoisted` 模式。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm exec vitest run src/stores/creditsStore.test.ts src/pages/canvas/components/CanvasTopBar.test.tsx`
Expected: FAIL — scope/fetchTeamBalance/applyBalance 不存在。

- [ ] **Step 3: 实现**

creditsStore.ts 整体替换：

```ts
import { create } from 'zustand';
import { subscriptionApi } from '@/api/subscriptionApi';
import { getTeamBalanceView } from '@/api/teamApi';

interface BalancePatch {
  credits: number;
  subscriptionCredits: number;
}

interface CreditsState {
  credits: number;
  subscriptionCredits: number;
  subscriptionCreditsExpiry: string | null;
  tier: string | null;
  /** scope-aware（D2/D9）：画布内按 project.teamId 判定，个人=默认团队 */
  scope: 'personal' | 'team';
  teamId: string | null;
  loading: boolean;
  error: string | null;
  fetchBalance: () => Promise<void>;
  fetchTeamBalance: (teamId: string) => Promise<void>;
  applyBalance: (patch: BalancePatch) => void;
  isSubscriptionActive: () => boolean;
}

export const useCreditsStore = create<CreditsState>((set, get) => ({
  credits: 0,
  subscriptionCredits: 0,
  subscriptionCreditsExpiry: null,
  tier: null,
  scope: 'personal',
  teamId: null,
  loading: true,
  error: null,

  fetchBalance: async () => {
    set({ loading: true, error: null, scope: 'personal', teamId: null });
    try {
      const [data, sub] = await Promise.all([
        subscriptionApi.getBalance(),
        subscriptionApi.getMe(),
      ]);
      set({
        credits: data.credits,
        subscriptionCredits: data.subscriptionCredits,
        subscriptionCreditsExpiry: data.subscriptionCreditsExpiry,
        tier: sub?.tier ?? null,
        loading: false,
      });
    } catch {
      set({ error: '积分获取失败', loading: false });
    }
  },

  fetchTeamBalance: async (teamId) => {
    set({ loading: true, error: null, scope: 'team', teamId });
    try {
      const b = await getTeamBalanceView(teamId);
      set({
        credits: b.credits,
        subscriptionCredits: b.subscriptionCredits,
        subscriptionCreditsExpiry: null,
        tier: null,
        loading: false,
      });
    } catch {
      set({ error: '积分获取失败', loading: false });
    }
  },

  applyBalance: (patch) => set({ credits: patch.credits, subscriptionCredits: patch.subscriptionCredits }),

  isSubscriptionActive: () => {
    const { scope, subscriptionCredits, subscriptionCreditsExpiry } = get();
    if (scope === 'team') return subscriptionCredits > 0;
    if (!subscriptionCreditsExpiry) return false;
    return new Date(subscriptionCreditsExpiry).getTime() > Date.now();
  },
}));
```

CanvasTopBar.tsx（:39-50 两段替换）：

```tsx
  const teamId = useCanvasStore((s) => s.teamId);

  // 画布初始余额：经 project.teamId 判 scope（D2——不只依赖 Socket 推送）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!teamId) {
        store.fetchBalance();
        return;
      }
      const def = await getDefaultTeam().catch(() => null);
      if (cancelled) return;
      if (def && teamId !== def.id) store.fetchTeamBalance(teamId);
      else store.fetchBalance();
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  // Socket 扣费推送：node:status credits 为完整余额对象（D1）
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      const d = ce.detail;
      if (d && typeof d === 'object' && 'credits' in d) store.applyBalance(d);
    };
    window.addEventListener('credits:update', handler);
    return () => window.removeEventListener('credits:update', handler);
  }, []);
```

顶部 import 加：`import { useCanvasStore } from '@/stores/canvasStore';`、`import { getDefaultTeam } from '@/api/teamApi';`。

（`loadProjectIntoStore` 在 CanvasPageInner 渲染前已写入 teamId（Task 10），此 effect 首跑即拿到正确 teamId，无个人值闪烁。tier 徽章在 team scope 下因 `store.tier === null` 自动不渲染，:131-140 无需改动。）

三节点 handler 对象化（各文件 node:status 处）：

```ts
        // ImageGenNode.tsx:369-371 / AudioGenNode.tsx:86-88 / VideoGenNode.tsx:384-386 统一改为：
        if (data.credits && typeof data.credits === 'object') {
          window.dispatchEvent(new CustomEvent('credits:update', { detail: data.credits }));
        }
```

- [ ] **Step 4: 跑测试确认通过 + 门禁**

Run: `cd apps/web && pnpm exec vitest run src/stores/creditsStore.test.ts src/pages/canvas && pnpm exec tsc -b && pnpm test`
Expected: PASS（三节点现有 socket 用例若断言 `credits:update` detail 为数字——更新为对象；`updateCredits` 引用全部消除后删除该旧 action，若有其他消费方 tsc 会指出，一并迁移到 applyBalance）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/creditsStore.ts apps/web/src/pages/canvas
git commit -m "feat(web): 顶栏积分 scope-aware——画布按 project.teamId 拉 /team/:id/balance；Socket 余额对象化"
```

---

### Task 15: CreditsDropdown 充值分流 + 团队 scope 适配

**Files:**
- Modify: `apps/web/src/pages/canvas/components/CreditsDropdown.tsx`（:65-75 props、:220-222 到期行、:313-317 充值跳转）
- Test: `apps/web/src/pages/canvas/components/CreditsDropdown.test.tsx`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```tsx
  it('scope=team 时充值按钮跳 /team/:id/billing', async () => {
    (useCreditsStore as unknown as Mock).mockReturnValue({
      ...baseProps,
      scope: 'team',
      teamId: 't-1',
      loading: false,
      error: null,
      onRetry: vi.fn(),
      onInvite: vi.fn(),
    });
    // CreditsDropdown 主组件渲染后触发充值按钮
    render(<MemoryRouter><CreditsDropdown /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /充值/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/team/t-1/billing');
  });

  it('scope=personal 时充值跳 /settings/credits', () => {
    /* 同结构，scope: 'personal' */
    expect(mockNavigate).toHaveBeenCalledWith('/settings/credits');
  });

  it('scope=team 时订阅积分卡显示团队语义（无到期日期）', () => {
    render(<CreditsPanelContent {...baseProps} scope="team" subscriptionCredits={30} />);
    expect(screen.getByText('团队订阅积分')).toBeInTheDocument();
  });
```

（`baseProps`/`mockNavigate` 以现有测试文件结构为准；CreditsPanelContent 用例为 props 直测。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm exec vitest run src/pages/canvas/components/CreditsDropdown.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现**

CreditsDropdown.tsx：

1. Props 接口（:65-75）加：

```ts
  scope: 'personal' | 'team';
```

2. 订阅积分卡到期行（:220-222 区域）替换：

```tsx
            {scope === 'team'
              ? <span className="text-xs text-[#888]">{subscriptionCredits > 0 ? '团队订阅积分' : '暂无团队订阅'}</span>
              : formatExpiry(subscriptionCreditsExpiry, isActive)}
```

（找到现有调用 `formatExpiry(...)` 的那一行替换，保留外层容器/样式类。）

3. 充值跳转（:313-317）与重试分流（**P2：onRetry 在 team scope 下不得拉个人接口**——:346 现状 `onRetry={() => store.fetchBalance()}` 会把 scope 翻回 personal）：

```ts
  const handleRecharge = () => {
    manualCloseRef.current = true;
    setOpen(false);
    const { scope: s, teamId } = useCreditsStore.getState();
    navigate(s === 'team' && teamId ? `/team/${teamId}/billing` : '/settings/credits');
  };

  // :346 替换为（Popover content 内）：
  onRetry={() => (store.scope === 'team' && store.teamId ? store.fetchTeamBalance(store.teamId) : store.fetchBalance())}
```

4. 主组件向 `CreditsPanelContent` 透传（:338-349 解构区）：`scope={store.scope}`；充值按钮文案区域（:258-275）无需改（「充值」通用）。

（默认导出的 CreditsDropdown 主组件从 store 取 scope；CreditsPanelContent 的 scope prop 设默认值 `scope = 'personal'` 保持既有直测用例兼容。）

- [ ] **Step 4: 跑测试确认通过 + 门禁**

Run: `cd apps/web && pnpm exec vitest run src/pages/canvas/components/CreditsDropdown.test.tsx && pnpm exec tsc -b && pnpm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/CreditsDropdown.tsx apps/web/src/pages/canvas/components/CreditsDropdown.test.tsx
git commit -m "feat(web): 画布充值跳转分流——个人→/settings/credits，团队→/team/:id/billing；订阅卡团队语义"
```

---

## Phase 10：联调验收

### Task 16: 浏览器联调验收（对齐 spec §9）

**Files:** 视验收发现修复（无预设变更）

前置：按项目启动流程拉起全部服务（Postgres/Redis/MinIO/API/Web），准备两个测试账号 A/B（B 加入 A 创建的团队）。

- [ ] **Step 1: works 双页签与分组**

- [ ] `/works` 默认个人页签，数据=个人（默认团队）现状不回归；`?tab=team` 直链进团队页签
- [ ] 团队页签按「我创建的/我加入的」分组；每组文件夹/搜索/新建隔离（B 账号在团队 section 建画布 → DB 验证 canvasProject.teamId=该团队，Prisma 查库）
- [ ] 点击团队画布进入 `/canvas?projectId=`，画布可编辑保存
- [ ] 无真实团队账号：团队页签空状态引导

- [ ] **Step 2: /team 与 TeamSwitcher**

- [ ] 只有默认团队的账号：顶栏 TeamSwitcher 不渲染；`/team` 空状态+新建团队按钮
- [ ] 新建团队后：TeamSwitcher 出现，列表第一项「个人项目」，切换正常
- [ ] 选中「个人项目」：精简面板（余额+订阅状态+充值/会员跳转），无成员管理
- [ ] 选中真实团队：现状管理面板正常（成员/申请/审计）

- [ ] **Step 3: billing 与支付链路**

- [ ] `/team/:id/billing` 渲染余额/档位/套餐/订单；`/team/t-default的id/billing` 重定向 `/settings/credits`
- [ ] 团队充值下单到微信二维码弹出；订单记录出现 PENDING（微信侧无法真扫——用后端回调模拟或验证订单落库即可）
- [ ] `/settings/credits` 个人充值（默认团队）不回归；`/settings/membership` 个人订阅页文案已个人化
- [ ] 画布内充值按钮：个人画布跳 `/settings/credits`、团队画布跳 `/team/:id/billing`

- [ ] **Step 4: 上传与素材库**

- [ ] 团队画布内：AddNodeMenu 上传图片 → DB 验证 media.teamId=project.teamId（Prisma 查库替代 psql）
- [ ] 团队画布内：素材库显示该团队素材；上传素材归属 project.teamId；B 账号在同一画布可见
- [ ] 个人画布（默认团队）：上传归属默认团队
- [ ] B 团队成员猜 A 团队 billing URL `/team/<A团队id>/billing` → 「无权访问」提示（TeamGuard 403 前端呈现）

- [ ] **Step 5: 顶栏积分与 Socket**

- [ ] 团队画布进入：顶栏显示该团队余额（与 `/team/:id/balance` 一致）；tier 徽章不渲染
- [ ] 个人画布进入：显示个人余额+订阅到期+tier 徽章
- [ ] 团队画布执行一次生成（文本节点）→ 顶栏余额即时更新（node:status 推送 total 口径）
- [ ] 扣费后余额=扣费前-成本（验证 credits 对象双池正确展示）

- [ ] **Step 6: 回归与门禁**

Run: `cd apps/web && pnpm exec tsc -b && pnpm test && cd ../api && pnpm test`
Expected: 全绿。发现的问题逐个修复（修复走 TDD：先补失败测试再修），全部通过后进入验收。

- [ ] **Step 7: 验收 Commit（如有修复）**

```bash
git add -A
git commit -m "fix: Phase 10 联调验收修复"
```

---

## Plan B 验收清单（对齐 spec §9 前端部分）

- [ ] `/works?tab=team` 按「我创建的/我加入的」分组，组间不串团队；每组新建归属该组团队
- [ ] `/settings/membership` 只操作个人；`/team/:id/billing` 只操作当前团队
- [ ] TeamSwitcher：只有默认团队时隐藏；有团队时「个人项目」固定第一；新建入口在 /team
- [ ] /team：空状态 + 个人项目精简面板 + 顶部新建团队按钮
- [ ] 画布内上传全部经 projectId 归属 project.teamId；素材库团队维度
- [ ] 画布顶栏显当前团队积分（HTTP 初始 + Socket 扣费推送双通道）；充值跳转分流
- [ ] B 团队不可猜 ID 访问 A 团队的 billing/资源（前端呈现 403 提示）
- [ ] TypeScript strict 无报错；`cd apps/web && pnpm exec tsc -b && pnpm test` 与 `cd apps/api && pnpm test` 全绿

## 已知缺口登记（本 Plan 不处理）

- spec §5.1「UI 优化：团队数 >3 折叠」——spec 已注明暂不实现
- **画布外团队素材库页面不存在**（全仓无 /materials 路由，MaterialLibraryModal 仅挂画布页）——presign 三级回落第②级（dto.teamId 通道）后端已就绪但前端暂无消费方；建独立素材库页属新功能，超出本 spec 范围
- FileUpload.tsx 通用组件无生产挂载点（遗留），未改造；其 presign 调用走默认团队回落
- **/admin/team-plans 端点仅 AuthGuard、无角色守卫**（读+写均如此，app.module.ts 全局仅 AuthGuard）——开发阶段无用户数据可接受，**上线前必须补 admin 角色守卫**（读侧 TeamBillingPage 依赖它拉套餐，加守卫时需同步给普通成员开放只读套餐通道或改走非 admin 前缀端点）
- Navbar（全局顶栏）的积分显示仍为个人口径（`/api/credits/balance`）——全局上下文无团队语义，个人口径即正确；画布内 CanvasTopBar 已 scope-aware
