# Spec: 工作空间 UI 微调（第二轮视觉打磨）

日期：2026-09-01
状态：已确认（D1 面包屑改造为当前位置指示器；D2 字体用系统平替；D3 Tabs 四色方案）
范围：**纯前端 UI，不改任何逻辑代码、不改接口、不改状态流**
涉及页面：`/works`（WorkspacePage 及其子组件）

## 背景

用户提出 6 处 UI 修改（去面包屑、Tab 文案/字体、新建卡高度对齐、名称白色、去黑点、团队 Tabs 颜色）。

## 侦查结论（2026-09-01 浏览器实测，1280×800，已登录 333@333.com）

| # | 现象 | 实测证据 | 根因 |
|---|------|---------|------|
| 1 | 根目录面包屑只有一个不可点的「工作空间」按钮 | [WorkspaceBreadcrumb.tsx:24](../../../apps/web/src/pages/workspace/components/WorkspaceBreadcrumb.tsx) 根目录态渲染单按钮 nav | 设计冗余 |
| 2 | Tab 文案为「个人/团队项目」，系统字体 | [WorkspaceTabBar.tsx:7](../../../apps/web/src/pages/workspace/components/WorkspaceTabBar.tsx) `text-lg` 已是 18px，默认行高 28px≈1.555；font-family 为 body 的系统栈 | Inter 未引入（全项目无 webfont） |
| 3 | 新建画布卡 191px，画布卡 179px，不同高 | [CreateCanvasCard.tsx:18](../../../apps/web/src/pages/workspace/components/CreateCanvasCard.tsx) 底部 `h-[52px]` 写死占位偏高 | 占位高度与真实信息区不匹配 |
| 4 | 文件夹/画布名称近黑，暗背景看不清 | 实测 computed color `rgba(0,0,0,0.88)` | `.ant-app`（antd App 组件）默认亮色 token colorText 覆盖了 body 的 #e2e8f0；名称 span 无显式颜色 |
| 5 | 卡片块前面有小黑点 + ul 左缩进 | 实测 ul `list-style-type: disc; padding-left: 40px`，li display 仍为 list-item | [tailwind.config.ts:18](../../../apps/web/tailwind.config.ts) `preflight: false` → 浏览器默认 ul 样式生效 |
| 6 | 团队 Tabs 非激活近黑（看不见），激活是 antd 蓝 | 实测非激活 `rgba(0,0,0,0.88)`、激活 `rgb(22,119,255)` | antd 未配置暗色主题，Tabs 用默认亮色 token |

## 修改规格

### R1 面包屑改造为「当前位置」指示器（D1 已确认）
- **形态**（不带方括号，完整路径链，每级可点）：
  - 个人维度根目录：`当前位置：个人项目 · 根目录`
  - 团队维度根目录：`当前位置：<团队名> · 根目录`
  - 个人维度文件夹内：`当前位置：个人项目 · 根目录 / 子文件夹`
  - 搜索态：**保留现状**（「搜索 xxx」+ 清除按钮）
- **修改**：
  - [WorkspaceBreadcrumb.tsx](../../../apps/web/src/pages/workspace/components/WorkspaceBreadcrumb.tsx)：新增 prop `dimensionLabel: string`；渲染改为 `当前位置：`（固定前缀，弱化色不可点）+ `{dimensionLabel}`（弱化色纯展示）+ ` · ` + `根目录`（原「工作空间」按钮，非根时可点回根）+ 既有 path 链（每级可点，行为不变）
  - [WorkspaceDimension.tsx](../../../apps/web/src/pages/workspace/components/WorkspaceDimension.tsx)：新增可选 prop `dimensionLabel`（默认 `'个人项目'`），透传给 WorkspaceBreadcrumb
  - [WorkspacePage.tsx](../../../apps/web/src/pages/workspace/WorkspacePage.tsx)：团队分支给 WorkspaceDimension 传 `dimensionLabel={teamDisplayName(对应团队)}`（数据已在 realTeams 中，纯展示传递，无新请求）
- 「工作空间」文案改为「根目录」

#### 审核核实结论（2026-09-01 代码复核）
- **搜索态隔离**：WorkspaceBreadcrumb 现有结构 `if (searchQuery) return` 独立分支在最前，dimensionLabel/位置链只进非搜索分支，天然不受影响；测试补断言「搜索态 DOM 不含『当前位置：』」
- **「根目录」按钮可点性**：原「工作空间」按钮非根态已是 `cursor-pointer` + `onClick={onNavigate(null)}`（根态 cursor-default），行为已存在，仅改文案
- **R4 list 行背景**：FolderCard/CanvasCard list 行为自绘 div（非 antd List），hover 为 `hover:bg-white/5` 暗色系，无亮色选中态，白字可读无冲突
- **R4 画布卡名称**：CanvasCard grid（:91）与 list（:63）名称均渲染 InlineRename，无独立名称 span，R4 无遗漏

### R2 Tab 文案（D2 已确认：Inter 用平替）
- **修改**：[WorkspaceTabBar.tsx](../../../apps/web/src/pages/workspace/components/WorkspaceTabBar.tsx) `labels` 默认值 `personal: '个人'` → `'个人项目'`（与「团队项目」对仗）
- **字体不改动**：现有 body 字体栈（-apple-system/Segoe UI/Roboto）即 Inter 的系统平替，效果接近；字号/行高 `text-lg`（18px/28px≈1.555）已达标
- 不新增任何字体依赖

### R3 新建画布卡高度对齐
- **修改**：[CreateCanvasCard.tsx](../../../apps/web/src/pages/workspace/components/CreateCanvasCard.tsx)
  - 删除底部 `<div className="px-1 pt-2 pb-2 h-[52px]" aria-hidden="true" />`
  - 外壳 div 加 `h-full flex flex-col`（grid item li 默认 stretch，h-full 撑满同行最高卡片）
  - 预览区 div 加 `flex-1`，保留 `aspectRatio: '4 / 3'` 作为独行时的保底高度（避免某行只有新建卡时塌陷）
- **效果**：与画布卡同行时整卡同高，预览区自然延伸；不再用写死占位
- **已知风险（审核确认）**：新建卡独占一行时，行高由内容 intrinsic 高度决定——flex item 默认 `min-height: auto`（不小于 min-content），aspect-ratio 提供的 intrinsic 高度可打破循环，现代浏览器正常。**验收必须浏览器实测「新建卡独占最后一行」场景**；若实测塌陷，兜底方案：预览区加 `min-h-[120px]`（不影响 flex-1 拉伸）
- list 视图的新建按钮（WorkspaceDimension 内）不动

### R4 文件夹/画布名称改白色
- **修改**：名称 span 加 `text-white`
  - [FolderCard.tsx:73](../../../apps/web/src/pages/workspace/components/FolderCard.tsx) grid 视图名称
  - [FolderCard.tsx:54](../../../apps/web/src/pages/workspace/components/FolderCard.tsx) list 视图名称
  - [InlineRename.tsx:39](../../../apps/web/src/pages/workspace/components/InlineRename.tsx) 展示态名称（画布 grid+list 共用）
- 重命名输入态（antd Input）不动

### R5 去掉小黑点
- **修改**：WorkspaceDimension 中两个 ul（grid 视图 `gridClass` 与 list 视图 `flex flex-col`）各加 `list-none pl-0`
- 同时消除 ul 默认 40px 左缩进（与黑点同根同源，一起修才对称）
- **不动** `tailwind.config.ts` 的 `preflight: false`——全局开启会影响全站样式，违反精准修改

> 【已废止 2026-09-19】preflight:false 红线已被 docs/superpowers/specs/2026-09-18-css-base-layer-theme-design.md 推翻并重开（A 段落地）；本条仅存历史档。

### R6 团队 Tabs 颜色
- **修改**：[WorkspacePage.tsx](../../../apps/web/src/pages/workspace/WorkspacePage.tsx) 团队 `<Tabs>` 外包一层 antd `ConfigProvider`，用 Tabs componentToken 定制（纯样式配置，不动逻辑）：
  - `itemColor: '#7a7a7a'`（非激活）
  - `itemSelectedColor: '#f5f5f5'`（激活）
  - `itemHoverColor: '#a6a6a6'`（hover 过渡，比非激活亮一档引导交互）
  - `inkBarColor: '#f5f5f5'`（指示条与激活文字同色，暗背景上统一）
- 作用域仅这一处 Tabs，不影响其他 antd 组件

## 决策点（已确认 2026-09-01）

- **D1 面包屑**：不删除，改造为「当前位置」指示器——`当前位置：<维度名> · 根目录 / <文件夹链>`，完整路径链、不带方括号、每级可点；搜索态保留现状。
- **D2 Inter 字体**：不引入 webfont，用系统平替（现有 Segoe UI/Roboto 字体栈已是），只改文案。
- **D3 团队 Tabs 修饰**：hover `#a6a6a6` + 指示条 `#f5f5f5` + 非激活 `#7a7a7a` + 激活 `#f5f5f5`。

## 测试策略（TDD）

每条修改先写失败测试再实现（jsdom 断言 class/渲染分支）：
- R1：WorkspaceBreadcrumb 渲染 `当前位置：`前缀 + dimensionLabel + `根目录`；**搜索态 DOM 不含「当前位置：」（独立 return 分支断言）**；WorkspaceDimension 透传 dimensionLabel；WorkspacePage 团队分支传团队名
- R2：WorkspaceTabBar 默认文案含「个人项目」
- R3：CreateCanvasCard 无 `h-[52px]` 占位；外壳含 `h-full`、预览区含 `flex-1`
- R4：FolderCard/InlineRename 名称 span 含 `text-white`
- R5：WorkspaceDimension 两 ul class 含 `list-none pl-0`（在现有 Dimension 测试断言 `workspace-grid`/`workspace-list` className）
- R6：WorkspacePage 团队 Tabs 包裹 ConfigProvider 且 componentToken 值正确（浏览器验收颜色为准）

浏览器验收：六处逐一截图对比。

## 不做的事

- 不动任何逻辑代码（数据流、hooks、导航、事件处理）
- 不动 `preflight: false` 全局配置

> 【已废止 2026-09-19】preflight:false 红线已被 docs/superpowers/specs/2026-09-18-css-base-layer-theme-design.md 推翻并重开（A 段落地）；本条仅存历史档。
- 不动工作空间以外的页面
- 不动 list 视图新建按钮（其无黑点/高度问题）
- 不登记技术债（开发测试阶段，无用户数据）
