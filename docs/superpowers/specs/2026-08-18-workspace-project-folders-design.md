<!-- doc-status: historical | verified_at: n/a -->
# 工作空间项目文件夹功能 — 前端 UI 设计 Spec

日期：2026-08-18
阶段：第一阶段（纯前端 UI，文件夹为 mock 数据）
状态：待用户审阅

## 1. 背景与目标

工作空间（/works）当前为扁平画布列表，画布多了之后难以管理。本功能引入**项目文件夹**：用户可创建文件夹，把画布归类到文件夹中。

本阶段只实现前端 UI：视觉还原参考效果图，交互完整可用，文件夹数据为前端 mock，画布数据来自现有真实 API。

## 2. 术语定义

| 术语 | 含义 |
|---|---|
| **Canvas（画布）** | 用户创作工程。底层存储为 Template 记录（type='my'），前端视图模型为 `Canvas` |
| **Folder（文件夹）** | 归类画布的容器。一期仅一级（不嵌套），类型支持 `parentId` 自引用为后端阶段预留 |
| **Project** | 历史遗留命名。`createProject()` 创建的实际是画布编辑器工程（CanvasProject），后端阶段应重命名为 createCanvas |
| **占位 Canvas（草稿）** | 新建画布时在目标文件夹插入的本地记录（isPlaceholder），指向编辑器工程 |
| 路由 | `/works` 工作空间列表页；`/works/:id` 画布预览页；`/canvas?projectId=xxx` 画布编辑器 |

## 3. 范围

**做：**
- /works 页面完全重写：顶栏（标签页/搜索/筛选/视图切换/导入/新建画布）、面包屑、文件夹卡片、画布卡片、新建文件夹占位卡
- 完整交互：新建文件夹/画布、进入文件夹（同页切换+面包屑）、重命名、移动到文件夹、删除、搜索、筛选、grid/list 切换（无持久化，会话内生效）
- 画布数据走真实 API（getTemplates type='my'）

**不做（后端阶段）：** 文件夹 API 与持久化、Template.folderId 字段、拖拽、团队空间、分页服务端化、导入功能。

## 4. 文件结构

```
apps/web/src/pages/workspace/
├── WorkspacePage.tsx                # 容器：URL 同步 + UI state + 数据 hook 装配 + onItemClick 路由分流
├── hooks/
│   ├── useWorkspaceData.ts          # 数据层：画布 API + mock 文件夹 + localFolderMap 合并 + 操作方法
│   └── useFolderNavigation.ts       # currentFolderId ↔ URL ?folder=xxx 双向同步 + path: Folder[] 推导
├── components/
│   ├── WorkspaceToolbar.tsx         # 标签页、搜索、筛选、视图切换、导入(占位)、新建画布按钮
│   ├── WorkspaceBreadcrumb.tsx      # path: Folder[] 面包屑；搜索态显示「搜索 "xxx"」+ 清除
│   ├── CreateFolderCard.tsx         # 网格首位占位卡 → 新建文件夹
│   ├── FolderCard.tsx               # folder: FolderViewModel + 回调
│   ├── CanvasCard.tsx               # canvas: Canvas + 回调（不含路由逻辑）
│   ├── FolderStackPreview.tsx       # thumbnails: string[]（0-3），纯展示
│   ├── CreateFolderModal.tsx        # 新建 / 重命名文件夹
│   ├── CreateCanvasModal.tsx        # 新建画布：名称 + 目标文件夹下拉（默认当前文件夹）
│   ├── MoveToFolderModal.tsx        # 移动画布：根目录（未分组）+ 文件夹单选列表
│   ├── EmptyState.tsx               # 空文件夹 / 搜索无结果 / 加载失败 / 根目录全空 四态
│   └── CardGridSkeleton.tsx         # 网格骨架屏
├── utils/
│   ├── gradient.ts                  # getCanvasGradient(id)
│   └── time.ts                      # formatRelativeTime（相对时间 + dayjs）
├── types.ts                         # Folder / FolderViewModel / Canvas / WorkspaceItem
├── fixtures.ts                      # mock 文件夹 + 初始归属（TODO: 后端阶段整体删除）
└── __tests__/
    ├── WorkspacePage.test.tsx
    ├── FolderCard.test.tsx
    ├── CanvasCard.test.tsx
    ├── FolderStackPreview.test.tsx
    └── utils.test.ts
```

## 5. 数据模型（types.ts）

```typescript
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;      // 自引用，一期恒 null（根级）
  workspaceId: string;          // 一期恒 'personal'，团队空间 Prisma 阶段必需
  createdAt: string;
  updatedAt: string;
}

export interface FolderViewModel extends Folder {
  canvasCount: number;
  thumbnails: string[];         // 每项均为合法 CSS background 值：url("...") 或 linear-gradient(...)，最多 3 项
}

export interface Canvas {
  id: string;                   // Template id；占位记录为 `placeholder-${projectId}`
  name: string;
  coverUrl: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  folderId: string | null;      // null = 根目录
  isPlaceholder?: boolean;
}

export type WorkspaceItem =
  | { type: 'folder'; data: FolderViewModel }
  | { type: 'canvas'; data: Canvas };
```

## 6. 数据流

### 6.1 useWorkspaceData（数据层，UI 与服务端数据的唯一边界）

- **画布**：`getTemplates({ type: 'my', limit: 100 })`（mock 阶段假设个人画布 <100，后端阶段改服务端分页 `getCanvases({ folderId, page })`）→ 映射为 `Canvas[]`
- **文件夹**：`useState(MOCK_FOLDERS)` 初始化后本地 CRUD
- **归属单源化**：`localFolderMap: Record<canvasId, folderId>` 为 hook 私有状态，初始值来自 fixtures；对外只暴露合并结果 `folderId: localFolderMap[c.id] ?? c.folderId`（本地优先）。后端阶段删除 localFolderMap 时 hook 外零改动
- **派生**（useMemo）：`FolderViewModel[]` = 文件夹 + canvasCount + thumbnails（文件夹内按 updatedAt 最近 3 个画布，coverUrl 处理为 `url("...")`，无图用 `getCanvasGradient(id)`）
- **操作方法**：
  - `createFolder(name)` / `renameFolder(id, name)`：纯本地
  - `deleteFolder(id)`：先校验非空（内有画布 → 抛错「请先移出画布」toast，不发请求），校验通过后删除本地记录
  - `moveCanvas(canvasId, folderId)`：写 localFolderMap（乐观，无 API）；**同时刷新源文件夹与目标文件夹的 updatedAt 为当前时间**（mock 本地；后端阶段由 API 级联处理）
  - `renameCanvas(id, name)` / `togglePublic(id)` / `deleteCanvas(id)`：乐观更新本地，API（updateTemplate/deleteTemplate）失败回滚 + message 报错；deleteCanvas 回滚范围含画布状态及涉及文件夹的 updatedAt
  - `deletePlaceholder(id)`：仅移除本地占位记录，不调 API
  - `createCanvas(name, folderId)`：调 `projectApi.createProject(name)` → 本地插入占位 Canvas（isPlaceholder）→ 返回 projectId 供跳转
- **加载状态机**：`'loading' | 'success' | 'error'`（页面进入即加载，无 idle）
- **竞态防护**：请求响应过期（如快速切换）不覆盖新状态（effect cleanup 标记）

### 6.2 useFolderNavigation

- `currentFolderId: string | null` 与 URL `?folder=xxx` 双向同步（useSearchParams），可刷新/分享
- 输出 `path: Folder[]`（根 → 当前层级链）供面包屑递归渲染（一期深 1，逻辑按链写）
- **无效 folderId fallback**：folders 加载后校验 `?folder` 值不存在 → 重置根目录 + 清空参数 + toast「文件夹不存在」

### 6.3 Folder.updatedAt 语义

后端阶段：文件夹内画布创建/更新/删除时级联刷新文件夹 updatedAt（类似文件管理器「修改日期」）。mock 阶段：moveCanvas / deleteCanvas 涉及文件夹时同步刷新对应 mock 文件夹 updatedAt，排序逻辑按此约定。

### 6.4 fixtures.ts

```typescript
// TODO: 后端阶段整体删除，替换为真实文件夹 API
export const MOCK_FOLDERS: Folder[] = [
  { id: 'folder-demo-1', name: '未命名文件夹', ... },
  { id: 'folder-demo-2', name: '项目文件夹', ... },
];
// 初始归属：按加载后的画布列表前几个 id 分配（folder-demo-1 得前 2 个，folder-demo-2 得第 3-4 个），
// 使预置文件夹含真实缩略图，还原效果图「文件夹堆叠预览有内容」的视觉
// 时序：localFolderMap 的 useState 初始为 {}，在 getTemplates 成功回调中用返回的 canvasIds
// 调 buildInitialFolderMap 后 set（不能在 useState 初始化时调用，此时 canvasIds 尚未就绪）
export function buildInitialFolderMap(canvasIds: string[]): Record<string, string>;
```

## 7. 交互行为规范

### 7.1 顶栏 WorkspaceToolbar

| 控件 | 行为 |
|---|---|
| 标签页 | 「个人」选中态（下边框高亮）；「团队项目」禁用置灰（一期） |
| 搜索框 | 300ms 防抖；全局匹配画布名+文件夹名（不区分大小写，跨所有文件夹）；后端阶段同样防抖调 API |
| 筛选下拉 | antd Dropdown：显示全部 / 仅文件夹 / 仅画布，作用于当前数据范围 |
| 视图切换 | grid（默认）/ list 两图标按钮，选中态高亮；选择存组件状态 |
| 导入按钮 | 点击 toast「即将上线」 |
| 「+ 新建画布」 | 打开 CreateCanvasModal |

### 7.2 网格与卡片

- **排序**：文件夹在前（updatedAt 降序）→ 画布在后（updatedAt 降序）
- **CreateFolderCard 显隐**：搜索态隐藏；筛选「仅画布」隐藏；其余状态固定首位显示
- **FolderCard**：onClick 统一行为 = `setCurrentFolderId(id)` + 清除搜索词（如有）+ 同步 URL（无分支判断）；⋯ 菜单：重命名 / 删除（非空 → toast「请先移出画布」）
- **CanvasCard**：
  - 路由分流在 WorkspacePage 的 `onItemClick(item)` 统一处理：普通 → `/works/:id`；占位 → `/canvas?projectId=xxx`（卡片组件不含路由逻辑）
  - hover 铅笔快捷重命名（与菜单重命名双入口，效率习惯）：铅笔为自定义 EditOutlined 图标，位置在**标题文字右侧**（跟随效果图，右上角是 ⋯ 菜单），hover 时 opacity-0 → 100 过渡 150ms；点击后标题切换为 antd Input（回车/失焦确认、Esc 取消），确认后调 renameCanvas。不用 Typography.Text 内置 editable（trigger 位置不可控）
  - ⋯ 菜单：重命名 / 移动到文件夹 / 设为公开(私有) / 删除；占位记录菜单仅「删除」（只移除本地）
- **MoveToFolderModal**：列表 = 「根目录（未分组）」+ 全部文件夹单选；画布当前所在文件夹禁用 + 标记「当前位置」
- **CreateCanvasModal**：名称 + 目标文件夹下拉（选项与 MoveToFolderModal 一致：「根目录（未分组）」+ 全部文件夹；默认选中当前所在文件夹）→ createProject → 插入占位 Canvas → 跳转 `/canvas?projectId=xxx`
- **加载中点击卡片**：不触发导航

### 7.3 面包屑 WorkspaceBreadcrumb

- 根视图：「工作空间」
- 文件夹内：`工作空间 / 文件夹名`，点击任意层级返回该层
- 搜索态：替换为「搜索 "xxx"」+ 清除按钮（清除后回到文件夹视图）

### 7.4 搜索结果语义

- 全局搜索返回 Folder + Canvas 混合结果
- 点击 Folder = 进入该文件夹并清除搜索（即 7.2 统一行为）
- 搜索结果中 Folder 卡不显示 canvasCount，只显示名称
- 点击 Canvas → 正常路由（按 7.2 分流）

### 7.5 空状态（EmptyState 四态）

| 态 | 文案要点 | 动作 |
|---|---|---|
| 空文件夹 | 「文件夹还是空的」 | 主按钮「新建画布」（内置入口，缩短操作路径） |
| 搜索无结果 | 「未找到匹配项」 | 「清除搜索」按钮 |
| 加载失败 | 「加载失败」 | 「重试」按钮重新触发 fetch |
| 根目录全空 | 「开始创建你的第一个画布」 | 主按钮「新建画布」 |

## 8. 视觉规范

### 8.1 全局

- 页面背景纯黑 `#000000`；文字白色系（white/90 主、white/50 次、white/30 弱）
- 时间显示：相对时间（「编辑于 3 小时前」）+ antd Tooltip 悬停显绝对时间
- canvasCount 文案：「N 个画布」
- 图标：@ant-design/icons 近似映射（SearchOutlined / DownOutlined / AppstoreOutlined / UnorderedListOutlined / FolderAddOutlined / PlusOutlined / MoreOutlined / EditOutlined / FolderOutlined），不新增图标依赖

### 8.2 顶栏

- 左侧标签页 + 右侧操作区（搜索/筛选/视图切换/分隔线/导入/新建画布），`justify-between` + `items-center`，控件间 gap-2
- 控件统一：h-10、`bg-white/5`、`ring-1 ring-white/10`、圆角 8px；搜索框宽 160px 起-focus-within ring-white/20
- 标签项：`text-lg`，选中项 `text-white` + `border-b-2 border-white`；未选中 `text-white/60`

### 8.3 grid 视图

- 网格：`grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`，gap-4
- 卡片：背景 `#1F1F1F`、外圆角 16px（rounded-2xl）、padding p-2、描边 `outline 1px white/[0.08]`（-offset-1）
- 缩略图区：`aspect-ratio 4/3`、圆角 12px、overflow-hidden
- hover 态：背景提亮 `#262626`、描边提亮 `white/[0.16]`、缩略图 `scale-110` 过渡 200ms
- 标题行：14px semibold 白色；副信息行：12px——文件夹卡：左「编辑于 N 前」右「N 个画布」；画布卡：左「编辑于 N 前」，右侧 isPublic 时显示「公开」小标签（10px，bg-white/10 rounded px-1.5），否则留空
- **FolderStackPreview**（标志性视觉，精确还原参考 HTML）：
  - 3 张卡片错位堆叠：left 5.6% / 31.3% / 58.5%，top 37.9% / 18.5% / 24.6%，rotate -15° / 0° / 15°，宽 37.3%，比例 100:134，z-index 1/2/3
  - 每张：圆角 12px、阴影 `[-2px -1px 10.5px rgba(0,0,0,0.4)]`、描边 1px `#CCCCCC/50`、左上角花瓣图标（16px，stroke #646464）
  - 缩略图内容 = thumbnails 的 CSS background 直接渲染（真实封面或渐变），空文件夹 fallback 白色系渐变卡（`linear-gradient(#CCCCCC, #939E9E)`）
  - 容器背景：`linear-gradient(136deg, rgba(255,255,255,0.1), transparent), rgb(29,36,42)` + perspective 400px
  - 底部玻璃凹槽：高度 45%、`backdrop-blur(10px)`、SVG mask 路径（圆角矩形口袋造型）+ 内阴影 rgba(89,103,107,0.3)
- **CreateFolderCard**：虚线描边 `border-dashed border-white/20`、缩略区中央 FolderAddOutlined 图标（32px white/60）+「新建文件夹」14px
- **画布缩略图**：coverUrl 存在显示图片；为空 `getCanvasGradient(id)` 渐变（hash(id) charCode 累加 % 360 色相，HSL s=70%，l 55%→75% 双色 linear-gradient）；占位画布右下角「草稿」角标（10px，bg-black/60 rounded）

### 8.4 list 视图

- 每行 h-16、px-4、hover `bg-white/5`、行间 `border-b border-white/5`
- 行内布局：缩略图 `w-12 h-12 rounded-lg object-cover` + 标题（14px semibold，flex-1，ml-3）+ 时间（12px white/40，mr-4）+ ⋯ 菜单
- 文件夹行：FolderOutlined 图标容器（w-12 h-12 居中 bg-white/5 rounded-lg）替代缩略图，名称 + 「N 个画布」
- CreateFolderCard list 形态：整行虚线占位

### 8.5 组件级规格

- **WorkspaceBreadcrumb**：13px；非当前级 `white/60`（hover white/90），当前级 `white/90`；分隔符「/」`white/30`
- **EmptyState**：图标 48px white/30、主文案 14px white/90、次文案 12px white/50、主按钮 antd Button type="primary"
- **CardGridSkeleton**：每卡 = 缩略图块（4/3 rounded-xl）+ 标题行 + 副信息行，`animate-pulse`；网格同 grid 布局

### 8.6 可访问性基础项

- 卡片 `tabIndex={0}`，Enter/Space 触发点击
- ⋯ 菜单按钮 `aria-label="更多操作"`；搜索框 `aria-label="搜索"`；CreateFolderCard `role="button"` + `aria-label="新建文件夹"`

## 9. 已知限制（mock 阶段，spec 明示）

1. 文件夹与归属关系为会话内状态，刷新还原（预置 fixtures 除外）
2. 画布保存为 Template 后，占位 Canvas 与真实记录并存（id 不同无法关联）；后端 folderId 持久化时彻底解决
3. 删除占位 Canvas 不清理后端已创建的 CanvasProject（孤儿工程）；后端阶段提供草稿清理/恢复
4. 画布 >100 不分页

## 10. 测试策略

框架：项目现有 Vitest + @testing-library/react + jsdom（**已验证**：package.json 依赖齐全，vite.config.ts 含 `test: { globals, environment: 'jsdom', setupFiles }` 配置，现有测试可运行）。dayjs 已是 apps/web 直接依赖（^1.11.21），可直接 import。

**mock 范围**：`templateApi`（getTemplates/deleteTemplate/updateTemplate）、`projectApi.createProject`；路由用 MemoryRouter；防抖用 `vi.useFakeTimers()`；不单独 mock Zustand store。

| 文件 | 用例 |
|---|---|
| FolderStackPreview.test | 3 张缩略图渲染；空文件夹 fallback；thumbnails 均为合法 CSS background 值；**snapshot 锁定 DOM 结构**（标志性视觉，像素级参数） |
| CanvasCard.test | 标题/时间渲染；点击回调（占位 vs 普通由页面层分流，卡片只验证 onClick 透传）；菜单项差异（4 项 vs 占位仅删除）；铅笔重命名回调 |
| FolderCard.test | 名称/数量/时间渲染；onClick 进入回调；菜单回调；搜索态不显示 canvasCount |
| utils.test | getCanvasGradient 确定性（同 id 同值、异 id 高概率不同）；空字符串/特殊字符 id 不报错；formatRelativeTime 边界 |
| WorkspacePage.test | 列表加载渲染；混排排序（文件夹前画布后、各自 updatedAt 降序）；搜索过滤 + 防抖（fake timers）；三种筛选；grid/list 切换；新建文件夹流程；新建画布流程（占位 + 跳转）；移动画布（当前位置禁用）；删除非空文件夹报错；面包屑 + URL 同步；无效 folderId 重置；空态四态；加载失败重试；加载中点击不导航；快速切换文件夹竞态 |

## 11. 破坏性变更清单

开发测试阶段，无需考虑历史数据兼容：

| 文件 | 处理 |
|---|---|
| `pages/templates/MyTemplatesPage.tsx` + `.test.tsx` | 删除（/works 指向 WorkspacePage） |
| `pages/templates/TemplateCard.tsx` | 删除（删除前 grep 全局确认零引用） |
| `pages/templates/EditTemplateDialog.tsx` | 删除（新对话框体系替代）。**已 grep 确认**：仅 MyTemplatesPage 引用（随其删除），TemplatePreviewPage 与 /templates 模板广场零引用，删除安全 |
| `api/templateApi.ts` | 保留（仍是画布数据源） |
| `pages/templates/TemplatePreviewPage.tsx` + `/works/:id` 路由 | 保留不动 |
| 模板广场 `/templates` | 完全不动，与工作空间数据无关 |

## 12. 后端阶段预留（接口演进方向，不在本阶段实现）

- Prisma：Folder 表（含 parentId 自引用、workspaceId、级联 updatedAt）；Template.folderId
- API：`GET/POST/PATCH/DELETE /api/folders`；`getCanvases({ folderId, page })` 服务端分页
- 前端：useWorkspaceData 内删除 localFolderMap 与 fixtures，直连文件夹 API
- `createProject` 重命名为 `createCanvas`；占位/草稿机制由后端工程状态替代
