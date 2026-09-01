# 工作空间列表视图 UI 改版 — TDD 实施计划

日期：2026-09-02
Spec：`docs/superpowers/specs/2026-09-02-workspace-list-view-redesign-design.md`（已确认）
验证命令：`pnpm -C apps/web test -- <路径过滤>`；全量 `pnpm -C apps/web test`

## 前置事实（已核实）

- `formatRelativeTime` 已存在（`utils/time.ts:8`），仅需追加 `formatDateTime`
- 菜单触发器是原生 `<button>`，`bg-black/50` 直接生效，无 antd token 竞争
- time.ts 无现有测试文件，新建 `__tests__/time.test.ts`
- jsdom 对 inline style 的复杂值序列化不稳定 → grid 列断言用 `getAttribute('style')` 子串匹配（FolderStackPreview.test.tsx:14 先例）

## 任务分解（TDD：每任务先测试红 → 实现绿）

### T1 formatDateTime

- **RED** 新建 `apps/web/src/pages/workspace/__tests__/time.test.ts`
  - `formatDateTime('2026-09-01T20:54:30')` → `'2026-09-01 20:54'`
- **GREEN** `utils/time.ts` 追加：
  ```ts
  export function formatDateTime(iso: string): string {
    return dayjs(iso).format('YYYY-MM-DD HH:mm');
  }
  ```

### T2 FolderListPreview 新组件

- **RED** 新建 `__tests__/FolderListPreview.test.tsx`：
  1. 渲染 3 张 `data-testid="stack-card"`
  2. thumbnails[0] 应用于第 1 张卡（style 含 `linear-gradient` 与 `red`）；第 2/3 张 fallback（`#CCCCCC`、`#939E9E`）
  3. 容器尺寸 72x48（style 子串 `width: 72px` / `height: 48px`）
- **GREEN** 新建 `components/FolderListPreview.tsx`：
  - 容器：`relative overflow-hidden rounded-lg`，style `{width:72, height:48, background:'linear-gradient(136deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 100%), rgb(26, 30, 32)'}`
  - 三张小卡绝对定位（spec §4.5 像素表：12.8/15.87/19.56x26.08/-15°/z1，25.6/8.8/20x26.4/0°/z2，40.4/10.87/19.56x26.08/15°/z3），`transform-origin:left top`，`border-radius:4px`，`outline:1px solid rgba(204,204,204,0.4)`，`box-shadow:-2px -1px 10.5px rgba(0,0,0,0.4)`，`background: thumbnails[i] ?? FALLBACK`
  - 每卡左上角复用 `PetalIcon`：当前为 FolderStackPreview.tsx:12 内部常量未 export，加 `export` 关键字导入复用（不复制）
  - FALLBACK 常量 `linear-gradient(#CCCCCC 0%, #939E9E 100%)` 与 FolderStackPreview 一致

### T3 CanvasCard list variant 重写

- **RED** 改写 `__tests__/CanvasCard.test.tsx` 的 list 用例（:80-86）：
  1. 六列 grid：行内 `getAttribute('style')` 含 `grid-template-columns: 72px 1fr 120px 150px 180px 180px`
  2. 类型列文本 `画布`（exact）、创建时间列 `2026-08-18 09:00`（base.createdAt）、`编辑于` 相对时间保留
  3. 菜单容器 `opacity-0` + `group-hover/menu:opacity-100`（className 断言）
  4. 分隔线 `border-white/10`
  5. `h-16` 旧断言删除
  6. 行为回归：菜单删除仍触发 onDelete；isPublic 标签在名称旁仍渲染
- **GREEN** `components/CanvasCard.tsx` 仅重写 `variant === 'list'` 分支（:51-76），结构按 spec §4.3：
  - 外层 div：`relative group/menu` + 现有交互属性（data-testid/tabIndex/role/onClick/onKeyDown）
  - `group/row` 六列 grid：`items-center gap-6 pl-4 pr-14 py-3 rounded-lg transition-colors group-hover/row:bg-white/5`
  - 预览：`shrink-0 rounded-lg overflow-hidden` + **显式 `style={{width:72, height:48}}`**（grid 单元格无内在高度会塌陷，参考 HTML 同款显式尺寸），background 沿用 `coverUrl ?? getCanvasGradient(id)`
  - 名称列：wrapper `min-w-0`（**不加 truncate**——InlineRename 展示态根为 flex span、内层 span 已自带 truncate，照 CanvasCard.tsx:62 现有先例 `flex-1 ml-3 min-w-0`）+ 公开标签（现有样式）
  - 类型/内容列：`text-sm text-white`（内容列空）
  - 时间两列：`text-sm text-white whitespace-nowrap`
  - 菜单：absolute 右侧 hover 显隐容器 + menuButton 改 `bg-black/50`（hover:bg-white/10→去掉或保留由视觉定，倾向 `bg-black/50 hover:bg-black/70`）
  - grid variant、菜单 items、onMenuClick 零改动

### T4 FolderCard list variant 重写

- **RED** 改写 `__tests__/FolderCard.test.tsx` 的 list 用例（:68-76）：
  1. 类型列 `文件夹`（exact）、内容列 `3 个画布`、创建时间 `2026-08-18 09:00`
  2. 含 FolderListPreview（`stack-card` × 3）
  3. `h-16` 旧断言删除；分隔线、六列 grid 断言同 T3
  4. 行为回归：菜单重命名仍触发 onRequestRename
- **GREEN** `components/FolderCard.tsx` 仅重写 list 分支（:41-59），列内容按 spec §4.4：预览列 `<FolderListPreview thumbnails={folder.thumbnails} />`（容器自带 72x48 显式尺寸），名称 wrapper `min-w-0` + 内层 span `text-sm text-white truncate`（照 FolderCard.tsx:54 现有先例，不用 font-semibold），内容列 `showCount && N 个画布`
  - grid variant、铅笔按钮、菜单零改动

### T5 WorkspaceDimension list 分支外壳 + 表头

- **RED** 增强 `__tests__/WorkspaceDimension.test.tsx`：
  1. 现有 list 用例（:64-70）保留
  2. 新增：切 list 视图后，外壳 `data-testid="workspace-list-shell"` className 含 `bg-white/5` 与 `rounded-xl`
  3. 表头六列文本存在（`预览/名称/类型/内容/创建时间/最近更新`，exact match）
  4. 新建画布行（create-canvas-card）与加载更多在 list 模式仍渲染（加载更多需 mock hasMore 数据；若现有用例未覆盖 list+loadMore，此处补）
- **GREEN** `components/WorkspaceDimension.tsx` 仅重写 list 分支 JSX（:186-234）：
  - 外壳 `data-testid="workspace-list-shell"`：`rounded-xl bg-white/5 overflow-hidden`
  - 表头区 `px-4 pt-5`：`flex items-center` > 32px 空位 + 表头 grid（`grid flex-1 items-center gap-6 pl-4 pr-14 text-sm font-normal text-white/40` + 六列 style）+ 分隔线 `mx-12 mr-4 mt-4 border-b border-white/10`
  - ul `list-none pl-0 flex flex-col px-4 pb-5`（testid 保留）
  - 新建画布虚线行全宽（保留现有按钮样式，li 的 px-4 py-2 调整为 py-2 即可，套壳内）
  - 加载更多按钮移入外壳内底部：`px-4 pb-4` 包裹居中，按钮样式沿用
  - items.map 渲染分支逻辑、所有 hooks/回调零改动

### T6 回归 + 浏览器验收

- `pnpm -C apps/web test` 全量绿（重点回归：WorkspacePage.test、ToolbarBreadcrumb.test 等未直接改动的关联测试）
- `pnpm -C apps/web build`（tsc strict 通过）
- 浏览器验收 `/works` 切列表视图：表头六列对齐、文件夹/画布行视觉、hover 菜单显隐、公开标签、新建画布行、搜索态（内容列空+新建行隐藏）、grid 模式无回归
  - **新建画布行左对齐核对**：全宽左缘 16px vs 行内容左缘 64px，视觉不协调则改为 `flex > [32px 空位] + [内容 pl-4]` 缩进结构
  - **窄视口 1280px**：六列不溢出、名称列 truncate 生效

## 提交切分

每任务恰好一条 commit（test+impl 同提交，红-绿顺序完成后提交）：
1. `feat(web): time 追加 formatDateTime（含测试）`
2. `feat(web): FolderListPreview 文件夹列表三卡堆叠预览（含测试）`
3. `feat(web): CanvasCard 列表视图六列改版（含测试）`
4. `feat(web): FolderCard 列表视图六列改版（含测试）`
5. `feat(web): 工作空间列表外壳与六列表头（含测试）`

## 风险与回归点

- WorkspaceDimension list 分支结构变化可能影响 `WorkspacePage.folder-create.test.tsx`（若其切过 list 视图——实现时跑该文件确认）
- `getByText('名称', {exact:true})` 需确认页内无撞文本（工具栏/面包屑无此词，已核实）
- preflight:false：新 ul 保持 `list-none pl-0`；外壳无高度链无需 box-border
