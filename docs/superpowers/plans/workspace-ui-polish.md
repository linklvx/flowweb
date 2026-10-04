<!-- doc-status: historical | verified_at: n/a -->
# Plan: 工作空间 UI 微调（第二轮视觉打磨）

> 【已废止 2026-09-19】preflight:false 红线已被 docs/superpowers/specs/2026-09-18-css-base-layer-theme-design.md 推翻并重开（A 段落地）；本文相关表述仅存历史档。

日期：2026-09-01
Spec: [2026-09-01-workspace-ui-polish-design.md](../specs/2026-09-01-workspace-ui-polish-design.md)（已确认）
约束：纯前端 UI；TDD 红-绿-重构；每任务独立 commit

## 前置事实（探索已核实，实现时直接依赖）

- 既有测试因本次改动**必须同步更新**的断言：
  - [WorkspaceTabBar.test.tsx:11,17](../../../apps/web/src/pages/workspace/__tests__/WorkspaceTabBar.test.tsx) `{ name: '个人' }` → '个人项目'（R2）
  - [WorkspacePage.test.tsx:80](../../../apps/web/src/pages/workspace/__tests__/WorkspacePage.test.tsx) `getByText('工作空间')` → '根目录'（R1）
  - [WorkspacePage.test.tsx:279,281,290,292](../../../apps/web/src/pages/workspace/__tests__/WorkspacePage.test.tsx) `{ name: '个人' }` → '个人项目'（R2）
- WorkspacePage.test.tsx:15 已 mock `teamDisplayName`（isDefault→'个人项目'，否则 name），R1 团队断言直接复用
- antd cssinjs jsdom workaround（test-setup.ts 清空坏选择符 style 标签）→ **jsdom 无法可靠断言 antd 注入的颜色**，R6 颜色以浏览器验收为准
- 测试命令：`cd apps/web && pnpm vitest run <file>`；全量 `pnpm test`

## 任务分解

### T1 — R2 Tab 文案「个人」→「个人项目」

文件：`components/WorkspaceTabBar.tsx`

1. **RED**：更新 WorkspaceTabBar.test.tsx 两处 `{ name: '个人' }` 为 `{ name: '个人项目' }`；更新 WorkspacePage.test.tsx:279/281/290/292 同款断言 → 运行确认失败（按钮名仍是「个人」）
2. **GREEN**：WorkspaceTabBar.tsx `labels` 默认值 `personal: '个人'` → `'个人项目'`
3. 验证：`pnpm vitest run WorkspaceTabBar WorkspacePage` → commit `fix(web): 工作空间 Tab 文案「个人」改「个人项目」`

### T2 — R4 文件夹/画布名称白色

文件：`components/FolderCard.tsx`、`components/InlineRename.tsx`

1. **RED**：
   - FolderCard.test.tsx 加断言：grid 名称 span（getByText('项目文件夹')）`toHaveClass('text-white')`；list 用例加同名断言
   - CanvasCard.test.tsx 加断言：展示态名称 span `toHaveClass('text-white')`（经 InlineRename 渲染）
2. **GREEN**：
   - FolderCard.tsx:73（grid 名称）与 :54（list 名称）加 `text-white`
   - InlineRename.tsx:39 展示态 span 加 `text-white`
3. 验证：`pnpm vitest run FolderCard CanvasCard` → commit `fix(web): 工作空间卡片名称改白色（.ant-app 亮色 token 覆盖根因绕开）`

### T3 — R3 新建画布卡高度对齐

文件：`components/CreateCanvasCard.tsx`

1. **RED**：SupportComponents.test.tsx CreateCanvasCard 用例加断言：
   - `container.querySelector('.h-\[52px\]')` 为 null（占位删除）
   - role=button 外壳 `toHaveClass('h-full')`；预览区 div `toHaveClass('flex-1')`
2. **GREEN**：删 `h-[52px]` 占位 div；外壳加 `h-full flex flex-col`；预览区加 `flex-1`（保留 `aspectRatio: '4 / 3'` inline）
3. 验证：`pnpm vitest run SupportComponents` → commit `fix(web): 新建画布卡与画布卡等高——删 h-[52px] 占位改 flex 撑满`

### T4 — R5 去黑点（ul list-none + 去 40px 缩进）

文件：`components/WorkspaceDimension.tsx`（`gridClass` 与 list 视图 ul 两处）

1. **RED**：WorkspaceDimension.test.tsx：
   - mount 用例加断言：`workspace-grid` className 含 `list-none` 与 `pl-0`
   - 新用例：点 `aria-label="List view"` 切列表，断言 `workspace-list` className 含 `list-none pl-0`
2. **GREEN**：两处 ul class 前加 `list-none pl-0`
3. 验证：`pnpm vitest run WorkspaceDimension` → commit `fix(web): 工作空间网格去 ul 默认黑点与 40px 缩进（preflight:false 遗留）`

### T5 — R1 面包屑改造「当前位置」指示器

文件：`components/WorkspaceBreadcrumb.tsx`、`components/WorkspaceDimension.tsx`、`WorkspacePage.tsx`

1. **RED**：新建 `__tests__/WorkspaceBreadcrumb.test.tsx`：
   - 非搜索态：渲染 `当前位置：`、`dimensionLabel`、`根目录`（根目录态 cursor-default；path 态末级弱化可点上级/「根目录」可点）——**分元素断言**（`当前位置：`/label/`根目录` 各自 getByText 精确匹配；禁止跨元素拼接文本查询，多文本节点 getByText 必失败）
   - 搜索态：DOM 不含 `当前位置：`，含「搜索」文案与清除按钮
   - path 链各级点击触发 onNavigate
   - nav 的 `aria-label` 由「面包屑」改为「当前位置」（语义对齐，无既有测试依赖）；测试用 `getByRole('navigation', { name: '当前位置' })` 定位
   - WorkspaceDimension.test.tsx：个人维度 mount 后** scope 到 nav 容器**断言 textContent 含「个人项目」（T1 后 Tab 栏也渲染「个人项目」，全局 getByText 必 multiple）
   - WorkspacePage.test.tsx：团队用例 scope 到同款 nav，断言 textContent 含团队名（团队 Tabs label 同样渲染团队名，全局查询冲突）；:80 `getByText('工作空间')` 改 `getByText('根目录')`
2. **GREEN**：
   - WorkspaceBreadcrumb：新增 `dimensionLabel: string` prop；nav `aria-label` 改「当前位置」；非搜索分支渲染 `当前位置：`（`text-white/40` 不可点）+ `{dimensionLabel}`（`text-white/40` 纯展示）+ ` · ` + 「根目录」按钮（原逻辑与 class 不变，仅文案）+ 既有 path 链
   - WorkspaceDimension：新增 `dimensionLabel?: string`（默认 `'个人项目'`），透传
   - WorkspacePage：团队分支 `dimensionLabel={teamDisplayName(realTeams.find(t => t.id === validTeamId)!)}`（validTeamId 已校验存在）
3. 验证：`pnpm vitest run WorkspaceBreadcrumb WorkspaceDimension WorkspacePage` → commit `feat(web): 面包屑改造为当前位置指示器——当前位置：<维度名> · 根目录 / 路径链`

### T6 — R6 团队 Tabs 四色（浏览器验收驱动，jsdom 不可断言颜色）

文件：`WorkspacePage.tsx`

1. 实现：团队 `<Tabs>` 外包 `ConfigProvider theme={{ components: { Tabs: { itemColor: '#7a7a7a', itemHoverColor: '#a6a6a6', itemSelectedColor: '#f5f5f5', inkBarColor: '#f5f5f5' } } }}`（ConfigProvider 从 antd 导入，仅包 team-tabs-row 的 Tabs）
2. jsdom 回归：`pnpm vitest run WorkspacePage`（既有团队 tabs 用例全绿 = 渲染无回归）
3. 颜色正确性在 T7 浏览器验收（inspect 计算 color 四值）
4. commit `fix(web): 团队 Tabs 暗色适配——非激活 #7a7a7a/激活 #f5f5f5/hover #a6a6a6/指示条 #f5f5f5`

### T7 — 浏览器验收（全部任务完成后）

服务：preview_start api/web；登录 333@333.com（已登录态直接用）

| # | 场景 | 验证 |
|---|------|------|
| 1 | 个人根目录（1280×800） | `当前位置：个人项目 · 根目录`；无黑点无缩进；名称白色；新建卡与画布卡同高；Tab「个人项目」 |
| 2 | 个人文件夹内 | `当前位置：个人项目 · 根目录 / 子文件夹`，各级可点返回 |
| 3 | 搜索态 | 「搜索 xxx」+ 清除按钮，无「当前位置：」 |
| 4 | 团队 tab | `当前位置：<团队名> · 根目录`；Tabs 四色 inspect 实测（#7a7a7a/#f5f5f5/#a6a6a6/ink bar） |
| 5 | **R3 风险项**：新建卡独占最后一行 | 缩窄视口/筛选使新建卡独行，确认不塌陷（塌陷则加 `min-h-[120px]` 兜底并回归） |
| 6 | list 视图回归 | 名称白色、无黑点、新建按钮（虚线横条）不变 |
| 7 | 截图对比 | 验收前后对比留证 |

## 提交顺序

T1→T2→T3→T4→T5→T6（每任务 RED→GREEN→全量 `pnpm test`→commit）→ T7 浏览器验收（发现问题回到对应任务修复）

## 风险与回退

- 全部为展示层改动，无状态/接口变更；任一处回退 = revert 对应单 commit
- R3 独占行塌陷为唯一技术风险，兜底 `min-h-[120px]` 已预案
