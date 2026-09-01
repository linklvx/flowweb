# 工作空间头部合并一行 UI 改版 Spec

日期：2026-09-01
范围：`/works` 工作空间页头部布局与视觉换皮。**仅 UI 层，不改业务逻辑。**

## 一、背景与目标

现状 `/works` 页：`WorkspaceTabBar`（个人/团队项目 tabs）与 `WorkspaceToolbar`（搜索/筛选/视图切换/新建文件夹）是上下两行，且分属不同组件层级（TabBar 在 Page 层，Toolbar 在 Dimension 层）。

目标：参考给定代码骨架，两块合并为**一行**（md+ 宽屏）：左 tabs、右工具组，`justify-between`；工具栏按钮统一换皮为深色圆角风格；删除无实际功能的「导入」占位按钮。

## 二、现状事实（已核查）

| 事实 | 出处 |
|---|---|
| tab 状态以 URL searchParams 持有于 Page 层，Dimension 不持有 | WorkspacePage.tsx:12 |
| Tailwind v3.4.19，preflight: false，无语义色 token | tailwind.config.ts |
| 图标库 @ant-design/icons ^5.5.0（保留，不引入 tabler） | package.json |
| WorkspaceTabBar 另被 MaterialsPage 引用（labels 定制「个人素材/团队素材」） | MaterialsPage.tsx:45 |
| Toolbar 内 Button 仅导入/新建文件夹 2 处；message 仅导入占位 1 处 | WorkspaceToolbar.tsx:72-73 |
| `team-tabs-row` testid 被 Page 测试引用 5 处；`teams-error`/`team-empty-state` 各 1 处 | WorkspacePage.test.tsx |
| index.css 无全局 `button:hover` 注入，亦无 `button { font-family: inherit }` 规则（仅 body:31 有字体栈） | grep 核查 |
| 参考代码 tabs 为 `ul.flex.gap-2` + `li.mx-3.py-1.5`——容器 gap 与按钮 margin 并存，与现状完全相同 | 用户提供的参考 HTML |

## 三、目标 DOM（正常态）

```
<div class="flex flex-col md:flex-row items-start gap-y-2 pt-2 pb-2 justify-between px-8">
  <WorkspaceTabBar/>（纯按钮组，左）
  <工具组：搜索 | 显示全部 | grid/list | 分隔线 | 新建文件夹>（右，flex-wrap gap-2）
</div>
团队 tab 且选中有效团队时，此行之下（Dimension 内 children 插槽）：
  [antd 团队 Tabs（自带 px-8 容器 + team-tabs-row testid）]
  [面包屑]
  [内容网格]
```

- md(768px) 以下：合并行退化为两行堆叠（`flex-col gap-y-2`），tabs 在上、工具组在下；工具组内部 `flex-wrap` 防溢出。

## 四、各文件改动清单

### 1. WorkspaceTabBar.tsx — 去 padding，样式换皮
- 容器去掉 `px-8 pt-2`，改为 `flex gap-2 text-lg items-center`（纯按钮组，布局归调用方；MaterialsPage 补偿见 5）
- 激活态：`text-white border-b-2 border-white rounded-t-md`（下划线式，非背景填充）
- 非激活态：`text-white/50 rounded-t-md`（不写 hover 类——全局无 button:hover 注入，写 `hover:bg-transparent` 反而暗示存在覆盖层）
- 共同：`mx-3 py-1.5 bg-transparent cursor-pointer`
- **间距组合写死**：容器 `gap-2`（8px）与按钮 `mx-3`（左右各 12px）并存——**沿用现状与参考代码的既有组合**（参考 `ul.flex.gap-2` + `li.mx-3.py-1.5`；现状同构），非笔误，改版前后 tabs 间距视觉零变化。水平间距用 `mx-3`（margin）而非 `px-3`，与参考代码字面一致：激活下划线宽度 = 文字宽度
- **`rounded-t-md` 注明**：透明背景下无视觉作用，为对齐参考代码保留（无副作用）
- **字体不处理**：TabBar 按钮现状即原生 button 且无 font-family 处理，非本次引入的差异，遵循精准修改不碰
- 保留 `<button>` 元素与现有受控 props；`border-b-2` 断言不变，现有测试零改动

### 2. WorkspaceToolbar.tsx — 合并行容器 + 换皮 + 删导入按钮
- props 新增：`activeTab: 'personal' | 'team'`、`onTabChange: (t) => void`
- 外层容器：`flex flex-col md:flex-row items-start gap-y-2 pt-2 pb-2 justify-between px-8`
- 左区渲染 `<WorkspaceTabBar activeTab={activeTab} onTabChange={onTabChange} />`；右区现有工具组 div 加 `flex-wrap`（gap-2 已有）
- **删除「导入」按钮**（无实际功能的 `message.info('即将上线')` 占位）
- 「新建文件夹」按钮：antd `Button type="primary"` → 原生 button：`h-10 px-3 flex items-center gap-1 bg-white/10 hover:bg-white/15 rounded-lg text-white text-sm font-medium transition-colors border-none cursor-pointer font-[inherit]` + `FolderAddOutlined`，文案与 `onClick={onCreateFolder}` 不变
  - `font-[inherit]` 必要性：preflight: false 且 index.css 无 button 字体继承规则，antd Button（自带字体栈）换原生后会回退浏览器默认字体——本次改动引入的差异，必须补偿
- 搜索框/显示全部 trigger/grid-list 容器/分隔线：样式不变（与参考一致），仅补 `transition-colors`

### 3. WorkspaceDimension.tsx — 接 props + children 插槽
- props 新增可选：`activeTab?: 'personal' | 'team'`（默认 `'personal'`）、`onTabChange?: (t) => void`（默认 no-op）、`children?: React.ReactNode`
- 可选默认值保证现有 Dimension 测试与调用方零改动
- JSX 固定顺序：`WorkspaceToolbar（合并行）→ {children} → WorkspaceBreadcrumb → 内容`
- 转发 activeTab/onTabChange 给 Toolbar

### 4. WorkspacePage.tsx — 删 TabBar 渲染 + children 传团队 Tabs + 异常态补 tabs 行
- 删除 `<WorkspaceTabBar/>` 直接渲染与 import
- **`key` 为既有代码非本次新增**：现状即 `key="personal"` / `key={validTeamId}`，remount 是刻意设计（切维度强制重挂载，搜索/筛选/folder 本地 state 归零，见 WorkspacePage.tsx:59 注释），本次仅追加 props 不动 key 行为
- 个人分支：`<WorkspaceDimension key="personal" activeTab="personal" onTabChange={setTab} />`
- 团队 validTeamId 分支：团队 Tabs JSX（含 `px-8` 容器与 `team-tabs-row` testid，整体原样挪动）作为 `children` 传入 Dimension，`activeTab="team"` + `onTabChange={setTab}` + `key={validTeamId}`
- **团队 4 个非成功分支补 tabs-only 行**（防「被困」，见第五节）

### 5. MaterialsPage.tsx — 补偿 wrapper（+1 行）
- TabBar 外包 `<div className="px-8 pt-2">`，视觉零变化

## 五、团队非成功分支的 tabs 行（回归防护）

改后 tabs 在 Dimension 内，而团队非成功分支不渲染 Dimension → tabs 消失 → 用户无法切回个人 tab（现状 TabBar 常驻可切）。4 个分支（互斥三元链，逐条列出）外补 tabs-only 行：

| # | 分支判定条件 | 现有渲染 |
|---|---|---|
| 1 | `state.status === 'loading'` | 加载中… |
| 2 | `state.status === 'error'` | teams-error 重试 |
| 3 | success 且 `realTeams.length === 0` | team-empty-state 前往创建团队 |
| 4 | success 且 `!validTeamId`（URL teamId 缺失/无效，等待回落 effect 补默认团队） | 加载中…（过渡帧） |

tabsRow 提取为 JSX 变量复用（4 分支共享）：

```tsx
const tabsRow = (
  <div className="flex flex-col md:flex-row items-start gap-y-2 pt-2 pb-2 px-8">
    <WorkspaceTabBar activeTab="team" onTabChange={setTab} />
  </div>
);
```

- 容器类与正常态合并行对齐，唯去掉 `justify-between`（单子元素无两端分布需求），保留 `md:flex-row` 确保响应式行为一致

**已知限制（非本次回归）**：空团队分支（#3）不渲染 Dimension，该态无工具栏、无法新建内容——既有架构限制。若产品要求空态可新建，需单独排期（空态渲染 Dimension 轻量版），不在本次范围。

## 六、import 清理清单（WorkspaceToolbar.tsx）

| import | 原使用点 | 删按钮后 | 处理 |
|---|---|---|---|
| `Button` (antd) | 导入 + 新建文件夹 ×2 | 两处均移除 | **删** |
| `message` (antd) | 导入 onClick ×1 | 孤儿 | **删**（其他文件的 message 使用不受影响，import 文件级） |
| `UploadOutlined` | 导入按钮 ×1 | 孤儿 | **删** |
| `FolderAddOutlined` | 新建文件夹 ×1 | 仍在用 | 保留 |

强制验证：`tsc` 严格模式 + eslint `no-unused-vars` 零警告。

## 七、测试策略（TDD）

实施顺序（tab 状态已在 Page 层 URL，**无前置状态上提重构**）：

1. **红**：新增 `WorkspaceToolbar.test.tsx`——① tabs 与工具组渲染于同一 `md:flex-row` 容器；② tab 点击透传 `onTabChange`；③ 无「导入」按钮、「新建文件夹」按钮存在。新增 Page 级用例——④ 团队 error/empty 分支下 tab 按钮存在于头部行容器（class 含 `md:flex-row`）内且可点击切回个人（现状 TabBar 不在此类容器中，断言可红）。预期失败
2. **绿**：按文件清单实施（TabBar 去 padding → Toolbar 合并换皮 → Dimension props+children → Page 删 TabBar/children/异常态 → MaterialsPage wrapper）
3. **重构**：孤儿 import 清理，tsc + eslint 零警告
4. **验证**：现有测试全绿（TabBar 受控/激活态、Page 新建文件夹流程、folder-create、team-tabs-row 5 处引用）+ 新增测试通过 + 浏览器手动验证：个人/团队切换、团队 4 非成功分支 tabs 可点击

## 八、不在范围

- 素材页（MaterialsPage）布局改版（仅 +1 行补偿 wrapper）
- 空团队态的工具栏/新建能力（已知限制，单独排期）
- 图标库更换（保留 antd 图标）
- 团队 Tabs（antd Tabs）自身样式
