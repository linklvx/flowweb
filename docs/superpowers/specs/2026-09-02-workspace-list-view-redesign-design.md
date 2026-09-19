# 工作空间列表视图 UI 改版设计（Spec）

日期：2026-09-02
状态：待用户确认

## 1. 背景与目标

工作空间 `/works` 已有 `viewMode: 'grid' | 'list'` 双模式。当前 list 模式是紧凑单行（48px 缩略图 + 名称 + 公开标签 + 编辑时间 + 常驻菜单按钮），无表头、无外框。

目标：按参考设计（tapnow 列表）重做 list 模式的**纯视觉**呈现——六列表头 grid（预览/名称/类型/内容/创建时间/最近更新）、`bg-white/5 rounded-xl` 外壳、72x48 缩略图、行分隔线、hover 显示三点菜单。

**红线：不修改任何逻辑代码。** 数据流（useWorkspaceData/useFolderNavigation）、排序、搜索、过滤、URL 同步、菜单项与行为、单击打开、模态框、grid 模式、WorkspaceToolbar 全部不动。

## 2. 已确认决策

| 决策点 | 结论 |
|---|---|
| 滚动方式 | **保持页面滚动**。不引入 Radix ScrollArea（项目零 Radix），不改 AppLayout 高度链 |
| 公开标签 | **保留在名称旁**（名称列内，名称文本后小标签，样式沿用 `text-[10px] px-1.5 py-0.5 rounded bg-white/10`） |
| 类型列文案 | 文件夹→`文件夹`，画布→`画布`（贴合项目术语；参考的"项目"不采用） |
| 内容列 | 文件夹→`N 个画布`（showCount 时，搜索态为空）；画布→空（照参考，画布无描述字段） |
| 新依赖 | 无 |

## 3. 颜色映射（参考 CSS → 项目现状）

项目无语义色 token（--border/--card-foreground 不存在），按项目惯用硬编码：

| 参考 | 项目采用 |
|---|---|
| `bg-white/5 rounded-xl` 外壳 | 原样可用 |
| `text-muted-foreground` (#7a7a7a) 表头 | `text-white/40` |
| `text-card-foreground` (#fafafa) 行文本 | `text-white` |
| `border-border` (#ffffff1a) 分隔线 | `border-white/10` |
| `group-hover/row:bg-white/5` 行 hover | 原样可用 |
| 菜单按钮 `bg-black/50` | 原样可用 |

## 4. 布局结构

### 4.1 列定义（表头与行共用）

> **2026-09-02 实现期修订**：参考列宽（72px 1fr 120px 150px 180px 180px + gap-6）在 1280 视口下溢出 77px（本项目内容区含侧边栏，参考布局无）。经用户确认改为压缩列宽适配：

```
grid-template-columns: 72px 1fr 70px 100px 145px 145px; gap-4 (1rem)
```
行内左缩进 `pl-4`、右留白 `pr-12`（菜单 hover 预留）、左侧固定 32px 空位列（`shrink-0 width:32px`）。分隔线左缩进 `mx-12 mr-4`。1280 视口下名称列约 141px，更大视口自动更宽（1fr 弹性）。

### 4.2 外壳（WorkspaceDimension.tsx list 分支重写）

```
<div rounded-xl bg-white/5 overflow-hidden>          ← 外壳
  <div px-4 pt-5>                                     ← 表头区（sticky 不需要，页面滚动）
    <div flex items-center>
      <div shrink-0 width:32px />
      <div grid flex-1 items-center gap-6 pl-4 pr-14 text-sm text-white/40   ← 表头 grid，padding 与行 grid 完全一致
           style="grid-template-columns:72px 1fr 120px 150px 180px 180px">
        预览 | 名称 | 类型 | 内容 | 创建时间 | 最近更新
      </div>
    </div>
    <div mx-12 mr-4 mt-4 border-b border-white/10 />  ← 表头下分隔线
  </div>
  <ul list-none pl-0 flex flex-col px-4 pb-5 data-testid="workspace-list">
    [新建画布虚线行（全宽，不套 32px+pl-4 缩进——入口行非数据行，保持现有全宽样式）]
    [FolderCard / CanvasCard variant="list" 新样式]
  </ul>
  [加载更多按钮（保留现有样式，置于外壳内底部居中，包 px-4 pb-4）]
</div>
```

注意：preflight:false → `ul` 必须 `list-none pl-0`；外壳无高度链，不需要 box-border。
> 【已废止 2026-09-19】preflight:false 红线已被 docs/superpowers/specs/2026-09-18-css-base-layer-theme-design.md 推翻并重开（A 段落地）；本条仅存历史档。
**硬性对齐**：表头 grid 与行 grid 的 `pl-4 pr-14`、`gap-6`、`grid-template-columns`、`items-center` 必须完全一致，否则首列错位 16px / 末列多伸 56px。

### 4.3 行结构（FolderCard / CanvasCard 的 list variant 重写）

```
<div relative group/menu data-testid role=button tabIndex onKeyDown onClick>   ← 交互属性保持在外层
  <div flex items-center>
    <div shrink-0 width:32px />
    <div grid 六列 items-center gap-6 pl-4 pr-14 py-3 rounded-lg transition-colors group-hover/row:bg-white/5>
      <预览/> <名称/> <类型/> <内容/> <创建时间/> <最近更新/>
    </div>
  </div>
  <div mx-12 mr-4 border-b border-white/10 />        ← 行分隔线（最后一行也保留，照参考）
  <div absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover/menu:opacity-100 transition-opacity z-30>
    {menuButton}                                       ← antd Dropdown 原样；触发器为原生 <button>，className 直接改 bg-black/50，无 antd token 优先级问题
  </div>
</div>
```

- 原 `h-16 px-4 border-b border-white/5` 紧凑行样式废弃。
- hover 高亮作用域为 grid 区（`group/row`），行高由内容撑开（py-3 + 48px 预览 ≈ 72px）。

### 4.4 各列内容

| 列 | 文件夹 | 画布 |
|---|---|---|
| 预览 72px | 三张小卡旋转堆叠（见 4.5） | 72x48 `rounded-lg` 容器，`background: coverUrl ?? getCanvasGradient(id)`（沿用现有 background div 方案） |
| 名称 1fr | `text-sm text-white truncate` + 名称 | `InlineRename`（原样）+ 公开标签 |
| 类型 120px | `文件夹` | `画布` |
| 内容 150px | `N 个画布`（showCount，否则空） | 空 |
| 创建时间 180px | `formatDateTime(createdAt)` | 同左 |
| 最近更新 180px | `编辑于 {formatRelativeTime(updatedAt)}` | 同左 |

时间列加 `whitespace-nowrap`，文本 `text-sm text-white`（与参考一致，非 white/40 弱化——时间也是信息列）。

### 4.5 文件夹列表预览（新组件 FolderListPreview）

72x48 容器：`background: linear-gradient(136deg, rgba(255,255,255,.1) 0%, rgba(255,255,255,0) 100%), rgb(26,30,32)`，`rounded-lg overflow-hidden relative`。

内部三张小卡，绝对定位像素照参考：

| 卡 | left | top | w×h | rotate | z |
|---|---|---|---|---|---|
| 1 | 12.8 | 15.87 | 19.56×26.08 | -15° | 1 |
| 2 | 25.6 | 8.8 | 20×26.4 | 0° | 2 |
| 3 | 40.4 | 10.87 | 19.56×26.08 | 15° | 3 |

每卡：`border-radius:4px`、`outline:1px solid rgba(204,204,204,.4)`、`box-shadow:-2px -1px 10.5px rgba(0,0,0,.4)`、`background: thumbnails[i] ?? linear-gradient(#CCCCCC, #939E9E)`（FALLBACK 与 FolderStackPreview 一致）、左上角复用现有 `PetalIcon`（缩至 8x8）。transform-origin: left top。

## 5. 新增/修改文件清单

| 文件 | 改动 |
|---|---|
| `apps/web/src/pages/workspace/components/WorkspaceDimension.tsx` | 仅 list 分支 JSX（:186-234）：外壳 + 表头 + ul 结构调整；逻辑零改动 |
| `apps/web/src/pages/workspace/components/CanvasCard.tsx` | 仅 list variant JSX 重写；grid variant、菜单逻辑零改动 |
| `apps/web/src/pages/workspace/components/FolderCard.tsx` | 同上 |
| `apps/web/src/pages/workspace/components/FolderListPreview.tsx` | **新增**（三卡堆叠小预览） |
| `apps/web/src/pages/workspace/utils/time.ts` | 追加 `formatDateTime`（dayjs `YYYY-MM-DD HH:mm`；dayjs 为 antd 既有依赖） |
| 对应 `__tests__/` | 测试先行修改/新增（见 §6） |

## 6. 测试计划（TDD，先红后绿）

1. **utils/time**：`formatDateTime` 输出 `YYYY-MM-DD HH:mm`（time 测试文件追加或新建）
2. **FolderListPreview.test.tsx**（新增）：渲染 3 张 `stack-card`；thumbnails 不足时 fallback 渐变
3. **CanvasCard.test.tsx**：list 用例改为断言——六列 grid style（`grid-template-columns`）、类型列文本 `画布`、创建时间文本格式、公开标签跟随名称、菜单容器 `opacity-0` + `group-hover/menu:opacity-100`、分隔线 `border-white/10`；旧 `h-16` 等断言移除
4. **FolderCard.test.tsx**：list 用例断言类型 `文件夹`、内容 `N 个画布`、含 FolderListPreview
5. **WorkspaceDimension.test.tsx**：list 模式断言外壳 `bg-white/5`、表头六列文本、`workspace-list` testid 保留、新建画布行与加载更多仍在

## 7. 不改动清单（回归保障）

- 所有 hooks、API 层、排序/搜索/过滤逻辑
- 菜单项内容与点击行为、InlineRename 交互
- grid 模式全部 JSX、WorkspaceToolbar、WorkspaceBreadcrumb
- EmptyState / CardGridSkeleton / 模态框

## 8. 验证方式

- `pnpm --filter web test` 全绿（先红后绿）
- 浏览器验收：`/works` 切列表视图，核对表头六列、文件夹/画布行视觉、hover 菜单显隐、公开标签、新建画布行、加载更多、亮暗（项目仅暗色）

## 9. 边界情况

- 画布 coverUrl 为 null → 渐变 fallback（现有 getCanvasGradient）
- 文件夹 thumbnails 空/不足 3 张 → FALLBACK 渐变补位
- 搜索态：showCount=false → 内容列为空；新建画布行隐藏（现有 showCreateCanvasCard 逻辑）
- 超长名称 → truncate
- min-w-[1200px] 视口：六列固定宽度总计约 72+120+150+180+180+32+gap*5+padding ≈ 1000px，1fr 名称列仍有余量
