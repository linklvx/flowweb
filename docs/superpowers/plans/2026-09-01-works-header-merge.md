# 工作空间头部合并一行 UI 改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/works` 页 tabs（个人/团队项目）与工具栏合并为一行（md+ 宽屏 `justify-between`），删除「导入」占位按钮，新建文件夹按钮换皮原生 button。

**Architecture:** tabs 下沉方案——`WorkspacePage` 把 `activeTab`/`onTabChange` 传给 `WorkspaceDimension` → `WorkspaceToolbar`，Toolbar 外层容器左区渲染 `WorkspaceTabBar`；团队 Tabs 通过 children 插槽传入 Dimension（固定顺序 Toolbar→children→Breadcrumb→内容）；团队 4 个非成功分支在 Page 层补 tabs-only 行防「被困」。

**Tech Stack:** React 19 + antd 5.22.5 + @ant-design/icons 5.5 + Tailwind v3.4（preflight: false）+ vitest + @testing-library/react。

**Spec:** `docs/superpowers/specs/2026-09-01-works-header-merge-design.md`

**命令速查**（bash CWD 会漂移，全部带绝对路径）：

| 用途 | 命令 |
|---|---|
| 单文件测试 | `cd D:/flowweb/apps/web && pnpm vitest run src/pages/workspace/__tests__/<file>` |
| 全量测试 | `cd D:/flowweb/apps/web && pnpm test` |
| Lint | `cd D:/flowweb/apps/web && pnpm lint` |
| 类型检查 | `cd D:/flowweb/apps/web && pnpm exec tsc -b` |

**关键约束（preflight: false 专项）：**
- 原生 `<button>` 必须带 `border-none bg-transparent`（或等价）压掉浏览器 UA 默认 `border: 2px outset` 与灰背景
- antd Button 换原生 button 必须补 `font-[inherit]`（index.css 无 button 字体继承规则）
- 红测试阶段**不跑 tsc**（新 props 尚未实现，类型必报错；vitest 经 esbuild 剥离类型可正常运行）

---

### Task 1: 红测试（Toolbar 3 用例 + Page 异常态 1 用例）

**Files:**
- Create: `D:\flowweb\apps\web\src\pages\workspace\__tests__\WorkspaceToolbar.test.tsx`
- Modify: `D:\flowweb\apps\web\src\pages\workspace\__tests__\WorkspacePage.test.tsx`（在 `teams 加载失败` 用例后追加）

- [ ] **Step 1: 新建 WorkspaceToolbar.test.tsx（完整文件）**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { WorkspaceToolbar } from '../components/WorkspaceToolbar';

const props = {
  activeTab: 'personal' as const,
  onTabChange: vi.fn(),
  viewMode: 'grid' as const,
  onViewModeChange: vi.fn(),
  onSearchChange: vi.fn(),
  filter: 'all' as const,
  onFilterChange: vi.fn(),
  onCreateFolder: vi.fn(),
};

describe('WorkspaceToolbar 头部合并', () => {
  it('tabs 与工具组渲染于同一 md:flex-row 行容器', () => {
    render(<WorkspaceToolbar {...props} />);
    const row = screen.getByRole('button', { name: '个人' }).closest('div[class*="md:flex-row"]');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByRole('button', { name: /新建文件夹/ })).toBeInTheDocument();
  });

  it('tab 点击透传 onTabChange', () => {
    render(<WorkspaceToolbar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '团队项目' }));
    expect(props.onTabChange).toHaveBeenCalledWith('team');
  });

  it('无「导入」按钮，「新建文件夹」按钮存在', () => {
    render(<WorkspaceToolbar {...props} />);
    expect(screen.queryByRole('button', { name: /导入/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新建文件夹/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: WorkspacePage.test.tsx 追加用例**（插入到 `teams 加载失败：渲染失败+重试，不挂载维度组件（不死屏）` 用例之后）

```tsx
  it('团队 error 分支：tabs 位于头部行容器内且可切回个人', async () => {
    mockGetMyTeams.mockRejectedValue(new Error('boom'));
    renderPage('/works?tab=team');
    await waitFor(() => expect(screen.getByTestId('teams-error')).toBeInTheDocument());
    const row = screen.getByRole('button', { name: '个人' }).closest('div[class*="md:flex-row"]');
    expect(row).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '个人' }));
    expect(await screen.findByTestId('create-canvas-card')).toBeInTheDocument();
  });
```

- [ ] **Step 3: 跑红**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/workspace/__tests__/WorkspaceToolbar.test.tsx src/pages/workspace/__tests__/WorkspacePage.test.tsx`

Expected: **4 个新用例全 FAIL**——Toolbar 3 例因 `Unable to find a role="button" name="个人"`（现状 Toolbar 不渲染 tabs，且导入按钮存在）；Page 1 例因 `row` 为 null（现状 TabBar 容器无 `md:flex-row` 类）。其余既有用例 PASS。

- [ ] **Step 4: Commit**

```bash
cd D:/flowweb && git add apps/web/src/pages/workspace/__tests__/WorkspaceToolbar.test.tsx apps/web/src/pages/workspace/__tests__/WorkspacePage.test.tsx && git commit -m "$(cat <<'EOF'
test(web): 头部合并红测试——Toolbar 同容器/透传/删导入 + Page 异常态 tabs 行

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: WorkspaceTabBar 去 padding 换皮 + MaterialsPage 补偿 wrapper

同 commit 原因：TabBar 去掉自身 `px-8 pt-2` 后素材页立即丢 padding，补偿必须与改造原子落地。

**Files:**
- Modify: `D:\flowweb\apps\web\src\pages\workspace\components\WorkspaceTabBar.tsx`（整文件替换）
- Modify: `D:\flowweb\apps\web\src\pages\materials\MaterialsPage.tsx:44-49`

- [ ] **Step 1: WorkspaceTabBar.tsx 替换为**

```tsx
interface WorkspaceTabBarProps {
  activeTab: 'personal' | 'team';
  onTabChange: (tab: 'personal' | 'team') => void;
  labels?: { personal: string; team: string };
}

export function WorkspaceTabBar({ activeTab, onTabChange, labels = { personal: '个人', team: '团队项目' } }: WorkspaceTabBarProps) {
  return (
    <div className="flex gap-2 text-lg items-center">
      <button
        onClick={() => onTabChange('personal')}
        className={`mx-3 py-1.5 bg-transparent cursor-pointer rounded-t-md ${activeTab === 'personal' ? 'text-white border-b-2 border-white border-x-0 border-t-0' : 'text-white/50 border-none'}`}
      >{labels.personal}</button>
      <button
        onClick={() => onTabChange('team')}
        className={`mx-3 py-1.5 bg-transparent cursor-pointer rounded-t-md ${activeTab === 'team' ? 'text-white border-b-2 border-white border-x-0 border-t-0' : 'text-white/50 border-none'}`}
      >{labels.team}</button>
    </div>
  );
}
```

要点：容器 `gap-2` 与按钮 `mx-3` 并存沿用现状与参考（间距视觉零变化）；`border-x-0 border-t-0` / `border-none` 压 UA 默认边框；`border-b-2` 断言保留。

- [ ] **Step 2: MaterialsPage.tsx 包补偿 wrapper**

旧：

```tsx
      <div className="pt-4">
        <WorkspaceTabBar
          activeTab={tab}
          onTabChange={setTab}
          labels={{ personal: '个人素材', team: '团队素材' }}
        />
```

新：

```tsx
      <div className="pt-4">
        <div className="px-8 pt-2">
          <WorkspaceTabBar
            activeTab={tab}
            onTabChange={setTab}
            labels={{ personal: '个人素材', team: '团队素材' }}
          />
        </div>
```

- [ ] **Step 3: 跑 TabBar 既有测试确认仍绿**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/workspace/__tests__/WorkspaceTabBar.test.tsx`

Expected: **2 PASS**（受控切换、激活态 `border-b-2` 断言不变）。

- [ ] **Step 4: Commit**

```bash
cd D:/flowweb && git add apps/web/src/pages/workspace/components/WorkspaceTabBar.tsx apps/web/src/pages/materials/MaterialsPage.tsx && git commit -m "$(cat <<'EOF'
feat(web): TabBar 去 padding 换皮——纯按钮组/激活下划线保留/素材页补偿 wrapper

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: WorkspaceToolbar 合并行 + 删导入按钮 + import 清理

**Files:**
- Modify: `D:\flowweb\apps\web\src\pages\workspace\components\WorkspaceToolbar.tsx`（整文件替换）

- [ ] **Step 1: 替换为**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Dropdown } from 'antd';
import { SearchOutlined, DownOutlined, AppstoreOutlined, UnorderedListOutlined, FolderAddOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import type { FilterKind, ViewMode } from '../types';
import { WorkspaceTabBar } from './WorkspaceTabBar';

interface WorkspaceToolbarProps {
  activeTab: 'personal' | 'team';
  onTabChange: (tab: 'personal' | 'team') => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onSearchChange: (query: string) => void;
  filter: FilterKind;
  onFilterChange: (filter: FilterKind) => void;
  onCreateFolder: () => void;
}

const FILTER_LABEL: Record<FilterKind, string> = { all: '显示全部', folders: '仅文件夹', canvases: '仅画布' };

export function WorkspaceToolbar({ activeTab, onTabChange, viewMode, onViewModeChange, onSearchChange, filter, onFilterChange, onCreateFolder }: WorkspaceToolbarProps) {
  const [text, setText] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const handleSearch = (value: string) => {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearchChange(value.trim()), 300);
  };

  const filterMenu: MenuProps['items'] = [
    { key: 'all', label: '显示全部' },
    { key: 'folders', label: '仅文件夹' },
    { key: 'canvases', label: '仅画布' },
  ];

  return (
    <div className="flex flex-col md:flex-row items-start gap-y-2 pt-2 pb-2 justify-between px-8">
      <WorkspaceTabBar activeTab={activeTab} onTabChange={onTabChange} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="h-10 px-3 flex items-center gap-1 bg-white/5 rounded-lg ring-1 ring-inset ring-white/10 focus-within:ring-white/20 transition-colors" style={{ width: 160 }}>
          <SearchOutlined className="text-[#646464] shrink-0" />
          <input
            aria-label="搜索"
            type="text" placeholder="搜索" value={text}
            onChange={(e) => handleSearch(e.target.value)}
            className="flex-1 bg-transparent border-none text-sm text-white placeholder:text-[#646464] min-w-0 focus:outline-none"
          />
        </div>
        <Dropdown menu={{ items: filterMenu, onClick: ({ key }) => onFilterChange(key as FilterKind) }} trigger={['click']}>
          <button className="h-10 px-3 flex items-center gap-1 bg-white/5 rounded-lg ring-1 ring-inset ring-white/10 hover:bg-white/10 text-white text-sm border-none cursor-pointer transition-colors">
            {FILTER_LABEL[filter]}
            <DownOutlined style={{ fontSize: 12 }} />
          </button>
        </Dropdown>
        <div className="p-1 flex items-center gap-2 bg-white/5 rounded-lg ring-1 ring-inset ring-white/10">
          <button
            aria-label="Grid view"
            onClick={() => onViewModeChange('grid')}
            className={`p-1.5 rounded-md border-none cursor-pointer transition-colors ${viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}
          >
            <AppstoreOutlined />
          </button>
          <button
            aria-label="List view"
            onClick={() => onViewModeChange('list')}
            className={`p-1.5 rounded-md border-none cursor-pointer transition-colors ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}
          >
            <UnorderedListOutlined />
          </button>
        </div>
        <div className="h-6 w-px bg-white/10 mx-1" />
        <button
          onClick={onCreateFolder}
          className="h-10 px-3 flex items-center gap-1 bg-white/10 hover:bg-white/15 rounded-lg text-white text-sm font-medium transition-colors border-none cursor-pointer font-[inherit]"
        ><FolderAddOutlined />新建文件夹</button>
      </div>
    </div>
  );
}
```

清理落实：`Button`/`message`（antd）与 `UploadOutlined` import 删除；「导入」按钮删除；搜索框/trigger/grid-list/分隔线仅补 `transition-colors`。

- [ ] **Step 2: 跑 Toolbar 测试确认变绿**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/workspace/__tests__/WorkspaceToolbar.test.tsx`

Expected: **3 PASS**。

- [ ] **Step 3: Commit**

```bash
cd D:/flowweb && git add apps/web/src/pages/workspace/components/WorkspaceToolbar.tsx && git commit -m "$(cat <<'EOF'
feat(web): Toolbar 合并行——tabs 左区/删导入占位/新建文件夹原生换皮

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: WorkspaceDimension 接 props + children 插槽

**Files:**
- Modify: `D:\flowweb\apps\web\src\pages\workspace\components\WorkspaceDimension.tsx:21-30`（interface 与函数签名）、`117-122`（Toolbar 调用处）

- [ ] **Step 1: interface 与签名**

旧（line 21-30）：

```tsx
interface WorkspaceDimensionProps {
  teamId?: string;
}

/**
 * 工作区维度组件：个人（teamId=undefined）与团队 tab 选中团队渲染同一组件。
 * 以 key={teamId ?? 'personal'} 重挂载实现切维度状态归零；nav+data+URL effect 全部内聚，
 * 父组件只产出有效选中 teamId。
 */
export function WorkspaceDimension({ teamId }: WorkspaceDimensionProps) {
```

新：

```tsx
interface WorkspaceDimensionProps {
  teamId?: string;
  activeTab?: 'personal' | 'team';
  onTabChange?: (tab: 'personal' | 'team') => void;
  children?: React.ReactNode;
}

/**
 * 工作区维度组件：个人（teamId=undefined）与团队 tab 选中团队渲染同一组件。
 * 以 key={teamId ?? 'personal'} 重挂载实现切维度状态归零；nav+data+URL effect 全部内聚，
 * 父组件只产出有效选中 teamId。activeTab/onTabChange/children 供头部合并行（Tabs 左区 + 团队 Tabs 插槽）。
 */
export function WorkspaceDimension({ teamId, activeTab = 'personal', onTabChange, children }: WorkspaceDimensionProps) {
```

- [ ] **Step 2: Toolbar 调用处转发 + children 渲染位**

旧（line 117-122）：

```tsx
      <WorkspaceToolbar
        viewMode={viewMode} onViewModeChange={setViewMode}
        onSearchChange={setSearchQuery}
        filter={filter} onFilterChange={setFilter}
        onCreateFolder={() => setFolderModal({ open: true })}
      />
```

新：

```tsx
      <WorkspaceToolbar
        activeTab={activeTab} onTabChange={onTabChange ?? (() => {})}
        viewMode={viewMode} onViewModeChange={setViewMode}
        onSearchChange={setSearchQuery}
        filter={filter} onFilterChange={setFilter}
        onCreateFolder={() => setFolderModal({ open: true })}
      />
      {children}
```

`{children}` 紧跟 Toolbar 之后、`<WorkspaceBreadcrumb>` 之前（spec 固定顺序）。

- [ ] **Step 3: 跑 Dimension 既有测试确认仍绿（可选 props 默认值零改动验证）**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/workspace/__tests__/WorkspaceDimension.test.tsx`

Expected: **全 PASS**（现有用例不传新 props，默认 `personal` + no-op）。

- [ ] **Step 4: Commit**

```bash
cd D:/flowweb && git add apps/web/src/pages/workspace/components/WorkspaceDimension.tsx && git commit -m "$(cat <<'EOF'
feat(web): Dimension 接 activeTab/onTabChange/children——头部合并行插槽

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: WorkspacePage 删常驻 TabBar + children 团队 Tabs + 异常态 tabsRow

**Files:**
- Modify: `D:\flowweb\apps\web\src\pages\workspace\WorkspacePage.tsx:33-71`（return 部分）

- [ ] **Step 1: 在 `validTeamId` 定义之后、`useEffect` 之前插入 tabsRow 变量**

```tsx
  // 团队非成功分支的头部 tabs 行（spec §五）：容器类与合并行对齐，唯无 justify-between（单子元素）
  const tabsRow = (
    <div className="flex flex-col md:flex-row items-start gap-y-2 pt-2 pb-2 px-8">
      <WorkspaceTabBar activeTab="team" onTabChange={setTab} />
    </div>
  );
```

- [ ] **Step 2: 替换 return 的 JSX**

旧（line 33-71 整段 return）：

```tsx
  return (
    <div>
      <div className="pt-4">
        <WorkspaceTabBar activeTab={tab} onTabChange={setTab} />
        {tab === 'team' ? (
          state.status === 'loading' ? (
            <p className="text-sm text-[#888] px-8 pt-4">加载中…</p>
          ) : state.status === 'error' ? (
            <div className="flex flex-col items-center py-20 gap-3" data-testid="teams-error">
              <p className="text-sm text-[#888]">团队列表加载失败</p>
              <Button onClick={() => retry()}>重试</Button>
            </div>
          ) : realTeams.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3" data-testid="team-empty-state">
              <p className="text-sm text-[#888]">还没有团队，创建一个开始协作吧</p>
              <Button type="primary" onClick={() => navigate('/team')}>前往创建团队</Button>
            </div>
          ) : validTeamId ? (
            <>
              <div className="px-8" data-testid="team-tabs-row">
                <Tabs
                  activeKey={validTeamId}
                  onChange={setTeamId}
                  items={realTeams.map((t) => ({ key: t.id, label: teamTabLabel(t) }))}
                />
              </div>
              {/* key=validTeamId：切团队强制重挂载维度组件，搜索/筛选/folder 等本地 state 归零 */}
              <WorkspaceDimension key={validTeamId} teamId={validTeamId} />
            </>
          ) : (
            // success 但 URL teamId 尚未补默认的过渡帧，与 loading 同形避免闪空
            <p className="text-sm text-[#888] px-8 pt-4">加载中…</p>
          )
        ) : (
          <WorkspaceDimension key="personal" />
        )}
      </div>
    </div>
  );
```

新：

```tsx
  return (
    <div>
      <div className="pt-4">
        {tab === 'team' ? (
          state.status === 'loading' ? (
            <>{tabsRow}<p className="text-sm text-[#888] px-8 pt-4">加载中…</p></>
          ) : state.status === 'error' ? (
            <>
              {tabsRow}
              <div className="flex flex-col items-center py-20 gap-3" data-testid="teams-error">
                <p className="text-sm text-[#888]">团队列表加载失败</p>
                <Button onClick={() => retry()}>重试</Button>
              </div>
            </>
          ) : realTeams.length === 0 ? (
            <>
              {tabsRow}
              <div className="flex flex-col items-center justify-center py-20 gap-3" data-testid="team-empty-state">
                <p className="text-sm text-[#888]">还没有团队，创建一个开始协作吧</p>
                <Button type="primary" onClick={() => navigate('/team')}>前往创建团队</Button>
              </div>
            </>
          ) : validTeamId ? (
            /* key=validTeamId：切团队强制重挂载维度组件，搜索/筛选/folder 等本地 state 归零（既有行为） */
            <WorkspaceDimension key={validTeamId} teamId={validTeamId} activeTab="team" onTabChange={setTab}>
              <div className="px-8" data-testid="team-tabs-row">
                <Tabs
                  activeKey={validTeamId}
                  onChange={setTeamId}
                  items={realTeams.map((t) => ({ key: t.id, label: teamTabLabel(t) }))}
                />
              </div>
            </WorkspaceDimension>
          ) : (
            // success 但 URL teamId 尚未补默认的过渡帧，与 loading 同形避免闪空
            <>{tabsRow}<p className="text-sm text-[#888] px-8 pt-4">加载中…</p></>
          )
        ) : (
          <WorkspaceDimension key="personal" activeTab="personal" onTabChange={setTab} />
        )}
      </div>
    </div>
  );
```

注意：`WorkspaceTabBar` 的 import **保留**（tabsRow 使用）；团队 Tabs 的 `px-8` 容器与 `team-tabs-row` testid 原样挪入 children，5 处测试引用零改动。

- [ ] **Step 3: 跑 Page 测试确认新用例绿且既有全绿**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/workspace/__tests__/WorkspacePage.test.tsx src/pages/workspace/__tests__/WorkspacePage.folder-create.test.tsx`

Expected: **全 PASS**（含 Task 1 的 `团队 error 分支：tabs 位于头部行容器内且可切回个人`，与 `team-tabs-row` 相关 5 处、`新建文件夹流程`、folder-create 流程）。

- [ ] **Step 4: Commit**

```bash
cd D:/flowweb && git add apps/web/src/pages/workspace/WorkspacePage.tsx && git commit -m "$(cat <<'EOF'
feat(web): Page 头部合并——删常驻 TabBar/团队 Tabs 入 children/异常分支补 tabsRow

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 全量验证门（test + lint + tsc）

**Files:** 无新增改动（发现问题回改上游任务文件）

- [ ] **Step 1: 全量测试**

Run: `cd D:/flowweb/apps/web && pnpm test`

Expected: **全 PASS，0 FAIL**（含 workspace 全部 + materials 相关 + 全站既有套件）。

- [ ] **Step 2: ESLint**

Run: `cd D:/flowweb/apps/web && pnpm lint`

Expected: **0 error 0 warning**（重点验证 WorkspaceToolbar 无 `Button`/`message`/`UploadOutlined` 残留引用——no-unused-vars）。

- [ ] **Step 3: TypeScript 严格模式**

Run: `cd D:/flowweb/apps/web && pnpm exec tsc -b`

Expected: **0 errors**（新 props 链路 Page→Dimension→Toolbar 类型贯通；`React.ReactNode` 无需额外 import——React 19 JSX transform 下 `React` 命名空间类型可用，若报错改为 `import type { ReactNode } from 'react'`）。

- [ ] **Step 4: 若全部通过，无需 commit（无新改动）；若有修复，修复后单独 commit**

```bash
cd D:/flowweb && git add -A apps/web && git commit -m "$(cat <<'EOF'
fix(web): 头部合并验证门修复——<具体项>

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 浏览器验收（preview 工具）

**Files:** 无（发现问题回改并补测试）

前置：API(3000)/Web(5173) dev server 已运行（本会话已启动，`mcp__Claude_Preview__preview_list` 确认）。

- [ ] **Step 1: 正常态布局验证**

`preview_eval` 打开 `http://localhost:5173/works`（reload），`preview_snapshot` 确认：tabs（个人/团队项目）与工具组（搜索/显示全部/grid-list/新建文件夹）同行；`preview_inspect` 行容器 `display: flex; flex-direction: row`（宽屏）。

- [ ] **Step 2: 团队 tab 验证**

点击「团队项目」：合并行 → 团队 Tabs（下一行）→ 面包屑 → 内容；无「导入」按钮；「新建文件夹」点击弹窗正常。

- [ ] **Step 3: font-family 继承验证（spec §七.4）**

`preview_inspect` 新建文件夹按钮 `font-family`——应为 body 继承值（`-apple-system, ...` 栈）而非浏览器默认 `Arial`。若 `font-[inherit]` 未生效，改为任意属性写法 `[font-family:inherit]` 后复验。

- [ ] **Step 4: 响应式验证**

`preview_resize` mobile(375x812)：合并行退化为两行（tabs 上、工具组下），工具组 `flex-wrap` 不溢出视口。

- [ ] **Step 5: 素材页回归验证**

`preview_eval` 打开 `/materials`：tabs 间距/位置与改版前一致（补偿 wrapper 生效）。

- [ ] **Step 6: 验收发现问题则回改对应任务文件 + 补测试 + commit；全部通过即完成**

---

## Self-Review 记录

1. **Spec 覆盖**：§四.1→Task 2；§四.2→Task 3；§四.3→Task 4；§四.4→Task 5；§四.5→Task 2；§五→Task 5（4 分支 tabsRow）；§六→Task 3（import 清理）+Task 6（lint/tsc 验证门）；§七→Tasks 1-7 顺序一致。无缺口。
2. **占位符扫描**：全部步骤含完整代码/命令/预期输出，无 TBD/TODO。
3. **类型一致性**：`activeTab: 'personal' | 'team'` / `onTabChange: (tab: 'personal' | 'team') => void` 在 Toolbar（必传）、Dimension（可选默认）签名一致；`children?: React.ReactNode` 与 Task 5 用法一致；测试文件 props 常量与 Toolbar interface 字段一致。
